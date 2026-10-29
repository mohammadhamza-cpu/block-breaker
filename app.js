/* Browser integration: input, fixed-step timing, UI, and best-effort local persistence. */
(function () {
  'use strict';
  const game = new TetrisCore.Game();
  const byId = id => document.getElementById(id);
  const board = byId('board');
  const renderer = new TetrisRenderer(board, byId('next'));
  const music = new TetrisMusic(updateMusicButton);
  const STORAGE_KEY = 'one-more-line.tetris.high-score.v1';
  const FIXED_STEP = 1000 / 60;
  const MOVE_DELAY = 150;
  const MOVE_REPEAT = 45;
  const SOFT_REPEAT = 35;
  const number = value => value.toLocaleString('en-US');
  let best = 0;
  let savedBest = 0;
  let storageAvailable = true;
  let lastTime = null;
  let accumulator = 0;
  let lastState = '';
  let inputSequence = 0;
  const held = new Map();
  const keyActions = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down',
    ArrowUp: 'cw', KeyX: 'cw', KeyZ: 'ccw', Space: 'drop'
  };
  const textCache = new Map();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isSafeInteger(parsed) && parsed >= 0) best = parsed;
    savedBest = best;
    // Probe even before a first high score, because storage can exist but reject writes.
    localStorage.setItem(STORAGE_KEY, String(best));
  } catch (_) {
    storageAvailable = false;
    byId('storage-note').hidden = false;
  }

  function text(id, value) {
    if (textCache.get(id) !== value) {
      byId(id).textContent = value;
      textCache.set(id, value);
    }
  }

  function persistBest() {
    if (!storageAvailable || best <= savedBest) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(best));
      savedBest = best;
    } catch (_) {
      storageAvailable = false;
      byId('storage-note').hidden = false;
    }
  }

  function resetInput() {
    held.clear();
    document.querySelectorAll('.touch-controls .pressed').forEach(button => button.classList.remove('pressed'));
  }

  function resetClock() {
    lastTime = null;
    accumulator = 0;
  }

  function announce(message) { byId('live-status').textContent = message; }

  function updateMusicButton() {
    const button = byId('music-button');
    const label = music.available ? (music.enabled ? 'Mute all audio' : 'Enable audio') : 'Audio unavailable in this browser';
    button.disabled = !music.available;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(music.enabled && music.available));
    button.title = `Neon Sprint + game sounds · ${label}`;
  }

  function start() {
    best = Math.max(best, game.score);
    persistBest();
    resetInput();
    resetClock();
    byId('board-announcement').classList.remove('flash');
    game.start();
    music.play(true);
    board.focus({ preventScroll: true });
    updateUI();
  }

  function togglePause() {
    if (game.state === 'running') {
      game.pause();
      resetInput();
      persistBest();
    } else if (game.state === 'paused') {
      game.resume();
      music.play();
      resetInput();
      board.focus({ preventScroll: true });
    } else return;
    resetClock();
    updateUI();
  }

  function autoPause() {
    resetInput();
    // Also silence a game-over melody if the player switches tabs after top-out.
    music.pause();
    if (game.state === 'running') {
      game.pause();
      persistBest();
      resetClock();
      updateUI();
    }
  }

  function action(name) {
    if (!game.canAct) return;
    if (name === 'left') game.move(-1);
    else if (name === 'right') game.move(1);
    else if (name === 'down') {
      if (game.softDrop()) music.effect('soft');
    }
    else if (name === 'cw') game.rotate(1);
    else if (name === 'ccw') game.rotate(-1);
    else if (name === 'drop') {
      if (game.hardDrop()) music.effect('hard');
    }
  }

  function press(id, name) {
    if (held.has(id) || game.state !== 'running') return;
    action(name);
    if (['left', 'right', 'down'].includes(name)) {
      held.set(id, { name, sequence: ++inputSequence, clock: 0, delay: name === 'down' ? SOFT_REPEAT : MOVE_DELAY });
    }
  }

  function repeatInput(dt) {
    // Most recently pressed horizontal direction wins; releasing it restores the other.
    let horizontal = null;
    let vertical = null;
    for (const item of held.values()) {
      if (item.name === 'down') {
        if (!vertical || item.sequence > vertical.sequence) vertical = item;
      } else if (!horizontal || item.sequence > horizontal.sequence) horizontal = item;
    }
    for (const item of [horizontal, vertical]) {
      if (!item) continue;
      item.clock += dt;
      while (item.clock >= item.delay) {
        item.clock -= item.delay;
        item.delay = item.name === 'down' ? SOFT_REPEAT : MOVE_REPEAT;
        action(item.name);
      }
    }
  }

  function handleKeyDown(event) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    const code = event.code;
    // Focused buttons keep native Space activation; board focus uses Space for hard drop.
    if (code === 'Space' && event.target.tagName === 'BUTTON') return;
    if (code === 'Enter') {
      // Native buttons retain normal Enter activation and accessibility behavior.
      if (event.target.tagName === 'BUTTON') return;
      if (game.state === 'ready' || game.state === 'over') { event.preventDefault(); if (!event.repeat) start(); }
      else if (game.state === 'paused') { event.preventDefault(); if (!event.repeat) togglePause(); }
      return;
    }
    if (!keyActions[code] && !['KeyP', 'Escape', 'KeyR'].includes(code)) return;
    event.preventDefault();
    if (event.repeat) return; // OS repeat never controls simulation or toggles pause twice.
    if (code === 'KeyP' || code === 'Escape') togglePause();
    else if (code === 'KeyR') start();
    else press(`key:${code}`, keyActions[code]);
  }

  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', event => {
    held.delete(`key:${event.code}`);
    if (event.code === 'Space' && event.target.tagName === 'BUTTON') return;
    if (keyActions[event.code]) event.preventDefault();
  });
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
  window.addEventListener('pagehide', () => { music.pause(); best = Math.max(best, game.score); persistBest(); });
  window.addEventListener('resize', () => { renderer.resize(); renderer.draw(game); });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => { renderer.resize(); renderer.draw(game); });
    observer.observe(byId('board-shell'));
  }

  byId('primary-button').addEventListener('click', () => game.state === 'paused' ? togglePause() : start());
  byId('pause-button').addEventListener('click', togglePause);
  byId('restart-button').addEventListener('click', start);
  byId('music-button').addEventListener('click', () => music.toggle());

  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (game.state !== 'running') return;
      button.setPointerCapture(event.pointerId);
      button.classList.add('pressed');
      press(`pointer:${event.pointerId}`, button.dataset.action);
    });
    const release = event => {
      held.delete(`pointer:${event.pointerId}`);
      button.classList.remove('pressed');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', event => event.preventDefault());
    // Keyboard/assistive clicks have no pointerdown; real pointer clicks must not double-act.
    button.addEventListener('click', event => { if (event.detail === 0) action(button.dataset.action); });
  });

  function flash(message) {
    const element = byId('board-announcement');
    element.textContent = message;
    element.classList.remove('flash');
    void element.offsetWidth;
    element.classList.add('flash');
  }

  function consumeEvents() {
    for (const event of game.drainEvents()) {
      if (event.type === 'clear') {
        // Reward completed row removal, not the earlier clearing animation.
        if (game.state === 'running') music.effect('clear', event.count);
        const label = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'][event.count];
        flash(event.levelUp ? `LEVEL ${game.level}\n+${number(event.points)}` : `${label}\n+${number(event.points)}`);
        announce(`${event.count} lines cleared. Score ${game.score}. Level ${game.level}.`);
      } else if (event.type === 'over') {
        resetInput();
        byId('board-announcement').classList.remove('flash');
        announce(`Game over. Score ${game.score}. Press Enter or R to play again.`);
      } else if (event.type === 'start') announce('Game started. Good luck!');
      else if (event.type === 'pause') announce('Paused. Press P or Escape to resume.');
      else if (event.type === 'resume') announce('Game resumed.');
      if (['lock', 'clear', 'over'].includes(event.type)) {
        best = Math.max(best, game.score);
        persistBest();
      }
    }
  }

  function updateUI() {
    best = Math.max(best, game.score);
    text('score', number(game.score));
    text('best', number(best));
    text('level', String(game.level).padStart(2, '0'));
    text('lines', number(game.lines));
    text('progress-text', `${game.lines % 10} / 10`);
    text('speed-label', `${(game.dropInterval / 1000).toFixed(2)}s / STEP`);
    byId('progress-fill').style.width = `${game.lines % 10 * 10}%`;
    byId('level-progress').setAttribute('aria-valuenow', String(game.lines % 10));
    byId('next').setAttribute('aria-label', `Next pieces: ${game.queue.join(', ')}`);

    if (lastState === game.state) return;
    lastState = game.state;
    if (game.state !== 'running') {
      music.pause();
      // This state transition runs once: stop the backing loop before the finale.
      if (game.state === 'over' && !document.hidden) music.effect('over');
    }
    const overlay = byId('game-overlay');
    overlay.hidden = game.state === 'running';
    byId('pause-button').disabled = !['running', 'paused'].includes(game.state);
    byId('pause-button').setAttribute('aria-label', game.state === 'paused' ? 'Resume game' : 'Pause game');
    text('pause-symbol', game.state === 'paused' ? '▷' : 'Ⅱ');
    const labels = { ready: 'READY WHEN YOU ARE', running: 'IN THE FLOW', paused: 'TAKE YOUR TIME', over: 'ANOTHER ROUND?' };
    byId('status-label').innerHTML = `<i></i>${labels[game.state]}`;
    if (game.state === 'paused') {
      text('overlay-eyebrow', 'NO RUSH. WE’LL WAIT.');
      byId('overlay-title').innerHTML = 'Take a<br><span>breather.</span>';
      text('overlay-description', 'Your next great move can wait a moment.');
      byId('primary-button').innerHTML = 'Keep going <span aria-hidden="true">→</span>';
      text('overlay-hint', 'P / ESC TO RESUME');
      byId('board-announcement').classList.remove('flash');
    } else if (game.state === 'over') {
      text('overlay-eyebrow', game.score > 0 && game.score >= best ? 'A PERSONAL BEST. NICE.' : 'EVERY RUN IS A FRESH START.');
      byId('overlay-title').innerHTML = 'Nice<br><span>run.</span>';
      text('overlay-description', `${number(game.score)} points · ${game.lines} lines · Level ${game.level}`);
      byId('primary-button').innerHTML = 'Play again <span aria-hidden="true">↻</span>';
      text('overlay-hint', 'ENTER / R TO RESTART');
    }
  }

  function frame(now) {
    if (lastTime === null) lastTime = now;
    const elapsed = Math.min(250, Math.max(0, now - lastTime));
    lastTime = now;
    if (game.state === 'running') {
      accumulator += elapsed;
      while (accumulator >= FIXED_STEP && game.state === 'running') {
        repeatInput(FIXED_STEP);
        game.tick(FIXED_STEP);
        accumulator -= FIXED_STEP;
      }
    } else accumulator = 0;
    consumeEvents();
    updateUI();
    renderer.draw(game);
    requestAnimationFrame(frame);
  }

  // Small read-only handle for reproducible browser QA; no external APIs or dependencies.
  window.TetrisApp = Object.freeze({ game, renderer, music });
  updateMusicButton();
  updateUI();
  renderer.draw(game);
  requestAnimationFrame(frame);
})();
