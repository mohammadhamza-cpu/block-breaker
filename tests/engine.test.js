/* Run in tests/index.html or JavaScriptCore: jsc engine.js tests/engine.test.js */
(function () {
  'use strict';
  const { Game, TYPES, SHAPES, COLS, ROWS, TOTAL_ROWS, HIDDEN_ROWS, CLEAR_DELAY, LOCK_DELAY, MAX_LOCK_RESETS } = TetrisCore;
  const results = [];
  const assert = (value, message = 'Assertion failed') => { if (!value) throw new Error(message); };
  const equal = (actual, expected, message = '') => assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  function test(name, run) { try { run(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } }
  function rng(seed = 12345) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
  function fresh(type = 'T') {
    const g = new Game(rng()); g.start();
    g.active = { type, rotation: 0, x: 3, y: 5 };
    g.drainEvents(); return g;
  }
  function advance(g, milliseconds, step = 10) {
    for (let left = milliseconds; left > 0; left -= step) g.tick(Math.min(step, left));
  }
  function floorFixture(count, level = 1, lines = 0) {
    const g = fresh('I');
    g.level = level; g.lines = lines;
    for (let y = TOTAL_ROWS - count; y < TOTAL_ROWS; y++) {
      g.board[y].fill('J'); g.board[y][4] = null;
    }
    g.active = { type: 'I', rotation: 1, x: 2, y: TOTAL_ROWS - 4 };
    return g;
  }

  test('Ready state has a fixed 10 x 20 well plus two hidden rows', () => {
    const g = new Game(rng()); equal(g.state, 'ready'); equal(g.board.length, ROWS + HIDDEN_ROWS);
    assert(g.board.every(row => row.length === COLS && row.every(x => x === null)));
    equal(g.active, null); equal(g.queue.length, 3);
    g.board[0][0] = 'I'; equal(g.board[1][0], null, 'Rows are independent');
  });
  test('All seven pieces have four blocks in each of four orientations', () => {
    equal(TYPES.length, 7);
    for (const type of TYPES) {
      equal(SHAPES[type].length, 4);
      for (const shape of SHAPES[type]) { equal(shape.length, 4); equal(new Set(shape.map(String)).size, 4); }
    }
  });
  test('Seven-bag randomizer: every consecutive bag contains all seven pieces', () => {
    const g = new Game(rng(84)); const sequence = [];
    for (let i = 0; i < 140; i++) { sequence.push(g.queue.shift()); g.fillQueue(); }
    for (let i = 0; i < 140; i += 7) equal(sequence.slice(i, i + 7).sort(), TYPES.slice().sort());
    assert(new Set(Array.from({ length: 20 }, (_, i) => sequence.slice(i * 7, i * 7 + 7).join(''))).size > 10);
  });
  test('Preview matches the next spawn and queue stays at three', () => {
    const g = fresh(); const expected = g.queue[0]; g.hardDrop(); equal(g.active.type, expected); equal(g.queue.length, 3);
  });
  test('Both walls stop every tetromino without changing its last valid position', () => {
    for (const type of TYPES) {
      const g = fresh(type);
      for (let i = 0; i < 20; i++) g.move(-1);
      equal(Math.min(...g.cells().map(([x]) => x)), 0); const x = g.active.x;
      assert(!g.move(-1)); equal(g.active.x, x);
      for (let i = 0; i < 20; i++) g.move(1);
      equal(Math.max(...g.cells().map(([x]) => x)), 9); assert(!g.move(1)); assert(!g.collides(g.active));
    }
  });
  test('Horizontal movement rejects occupied cells', () => {
    const g = fresh('O'); g.board[5][6] = 'J'; const before = { ...g.active };
    assert(!g.move(1)); equal(g.active, before);
  });
  test('Collision detects floor, walls, occupied cells, and hidden-row ceiling', () => {
    const g = fresh('O');
    assert(g.collides({ ...g.active, x: -2 })); assert(g.collides({ ...g.active, x: 8 }));
    assert(g.collides({ ...g.active, y: TOTAL_ROWS - 1 })); assert(g.collides({ ...g.active, y: -1 }));
    g.board[5][4] = 'Z'; assert(g.collides(g.active));
  });
  test('Four clockwise and four counterclockwise turns restore every shape', () => {
    for (const type of TYPES) for (const direction of [-1, 1]) {
      const g = fresh(type); const before = { ...g.active };
      for (let i = 0; i < 4; i++) assert(g.rotate(direction)); equal(g.active, before);
    }
  });
  test('Clockwise and counterclockwise are inverse rotations', () => {
    for (const type of TYPES) { const g = fresh(type); const before = { ...g.active }; g.rotate(1); g.rotate(-1); equal(g.active, before); }
  });
  test('JLSTZ rotation kicks away from left wall', () => {
    const g = fresh(); g.active = { type: 'T', rotation: 1, x: -1, y: 5 };
    assert(!g.collides(g.active)); assert(g.rotate(-1)); equal(g.active.rotation, 0); equal(g.active.x, 0); assert(!g.collides(g.active));
  });
  test('I rotation uses its two-cell wall kick', () => {
    const g = fresh('I'); g.active = { type: 'I', rotation: 1, x: -2, y: 5 };
    assert(!g.collides(g.active)); assert(g.rotate(-1)); equal(g.active.x, 0); equal(g.active.rotation, 0);
  });
  test('JLSTZ floor kick moves rotation above the floor', () => {
    const g = fresh(); g.active.y = TOTAL_ROWS - 2; assert(g.grounded());
    assert(g.rotate(1)); assert(g.active.y < TOTAL_ROWS - 2); assert(!g.collides(g.active));
  });
  test('I floor kick clears the floor without overlap', () => {
    const g = fresh('I'); g.active.y = TOTAL_ROWS - 2; assert(g.grounded());
    assert(g.rotate(1)); assert(g.active.y < TOTAL_ROWS - 2); assert(!g.collides(g.active));
  });
  test('Completely blocked rotation leaves the piece unchanged', () => {
    const g = fresh(); g.board.forEach(row => row.fill('J'));
    for (const [x, y] of g.cells()) g.board[y][x] = null;
    const before = { ...g.active }; assert(!g.rotate(1)); equal(g.active, before); assert(!g.rotate(-1)); equal(g.active, before);
  });
  test('O rotation does not move or reset its lock delay', () => {
    const g = fresh('O'); g.active.y = TOTAL_ROWS - 2; advance(g, 200); const before = { ...g.active };
    for (let i = 0; i < 30; i++) g.rotate(1);
    equal(g.active, before); equal(g.lockClock, 200); equal(g.lockResets, 0);
  });
  test('Soft drop moves one cell and adds one point only on successful movement', () => {
    const g = fresh(); const y = g.active.y; assert(g.softDrop()); equal(g.active.y, y + 1); equal(g.score, 1);
    g.active.y = g.ghostY(); const score = g.score; assert(!g.softDrop()); equal(g.score, score);
  });
  test('Hard drop lands at ghost, awards two points per cell, and locks immediately', () => {
    const g = fresh(); const expected = g.cells({ ...g.active, y: g.ghostY() }); const distance = g.ghostY() - g.active.y;
    assert(g.hardDrop()); equal(g.score, distance * 2); equal(g.piecesLocked, 1);
    for (const [x, y] of expected) equal(g.board[y][x], 'T');
  });
  test('Zero-distance hard drop still locks with no drop points', () => {
    const g = fresh(); g.active.y = g.ghostY(); g.hardDrop(); equal(g.score, 0); equal(g.piecesLocked, 1);
  });
  test('Ghost and hard drop respect stacked blocks, not just the floor', () => {
    const g = fresh('O'); g.board[15][4] = 'J'; equal(g.ghostY(), 13); g.hardDrop(); equal(g.board[14][4], 'O'); equal(g.board[15][4], 'J');
  });
  test('Gravity does not move early and awards no points', () => {
    const g = fresh(); const y = g.active.y; advance(g, 990); equal(g.active.y, y); advance(g, 10); equal(g.active.y, y + 1); equal(g.score, 0);
  });
  test('Fixed timestep chunking produces the same free-fall result', () => {
    const a = fresh(); const b = fresh(); advance(a, 4200, 10); advance(b, 4200, 100); equal(a.active, b.active); equal(a.score, b.score);
  });
  test('Ground contact locks at 500ms, not before', () => {
    const g = fresh('O'); g.active.y = g.ghostY(); advance(g, LOCK_DELAY - 10); equal(g.piecesLocked, 0); advance(g, 10); equal(g.piecesLocked, 1);
  });
  test('Successful ground movement resets locking; blocked movement does not', () => {
    const g = fresh('O'); g.active.y = g.ghostY(); advance(g, 300); assert(g.move(-1)); equal(g.lockClock, 0); equal(g.lockResets, 1);
    for (let i = 0; i < 10; i++) g.move(-1);
    advance(g, 300); assert(!g.move(-1)); equal(g.lockClock, 300);
  });
  test('Lock reset cap prevents indefinite floor shuffling', () => {
    const g = fresh('O'); g.active.y = g.ghostY(); advance(g, 10);
    for (let i = 0; i < MAX_LOCK_RESETS; i++) { advance(g, 20); g.move(i % 2 ? -1 : 1); }
    equal(g.lockResets, MAX_LOCK_RESETS); advance(g, 400); g.move(-1); equal(g.lockClock, 400); advance(g, 100); equal(g.piecesLocked, 1);
  });
  for (let count = 1; count <= 4; count++) {
    test(`${count}-line clear scores correctly and collapses the grid`, () => {
      const g = floorFixture(count); g.board[12][0] = 'Z'; g.hardDrop();
      equal(g.clearingRows.length, count); equal(g.active, null); equal(g.score, 0);
      advance(g, CLEAR_DELAY); equal(g.lines, count); equal(g.score, [0, 100, 300, 500, 800][count]);
      equal(g.board[12 + count][0], 'Z'); equal(g.board.length, TOTAL_ROWS);
      assert(g.board.slice(0, count).every(row => row.every(x => x === null))); assert(g.active !== null);
    });
  }
  test('Clearing animation freezes input and can be paused and resumed', () => {
    const g = floorFixture(2); g.hardDrop(); advance(g, 70); assert(!g.move(1)); assert(!g.hardDrop()); assert(!g.rotate(1));
    g.pause(); advance(g, 2000); equal(g.clearClock, 70); equal(g.lines, 0);
    g.resume(); advance(g, 90); equal(g.lines, 2);
  });
  test('Level increases every 10 lines; crossing clear uses the previous level multiplier', () => {
    const g = floorFixture(2, 1, 9); const speed = g.dropInterval; g.hardDrop(); advance(g, CLEAR_DELAY);
    equal(g.lines, 11); equal(g.level, 2); equal(g.score, 300); assert(g.dropInterval < speed);
  });
  test('Line scoring is multiplied by the current level', () => {
    const g = floorFixture(4, 5, 40); g.hardDrop(); advance(g, CLEAR_DELAY); equal(g.score, 4000); equal(g.lines, 44); equal(g.level, 5);
  });
  test('Gravity speed is monotonically increasing and has a safe minimum interval', () => {
    const g = fresh(); let previous = Infinity;
    for (let level = 1; level <= 100; level++) { g.level = level; assert(g.dropInterval <= previous); assert(g.dropInterval >= 65); previous = g.dropInterval; }
  });
  test('Pause freezes gravity, locking, and every gameplay input', () => {
    const g = fresh(); advance(g, 400); g.pause(); const before = JSON.stringify({ active: g.active, board: g.board, score: g.score, gravity: g.gravityClock });
    advance(g, 5000); assert(!g.move(1)); assert(!g.softDrop()); assert(!g.rotate(-1)); assert(!g.hardDrop());
    equal(JSON.stringify({ active: g.active, board: g.board, score: g.score, gravity: g.gravityClock }), before);
    g.resume(); advance(g, 600); equal(g.active.y, 6);
  });
  test('Pause/resume states reject invalid repeated transitions', () => {
    const g = new Game(); assert(!g.pause()); assert(!g.resume()); g.start(); assert(g.pause()); assert(!g.pause()); assert(g.resume()); assert(!g.resume());
  });
  test('Spawn overlap causes game over without overwriting occupied blocks', () => {
    const g = fresh(); g.queue[0] = 'O'; g.board[1][4] = 'Z'; g.spawn(); equal(g.state, 'over'); equal(g.active, null); equal(g.board[1][4], 'Z');
  });
  test('A piece locking entirely in hidden rows tops out', () => {
    const g = fresh('I'); g.active = { type: 'I', rotation: 0, x: 3, y: 0 }; g.board[2].fill('O');
    g.hardDrop(); equal(g.state, 'over'); equal(g.active, null);
  });
  test('Game over rejects input and simulation', () => {
    const g = fresh(); g.endGame(); const before = JSON.stringify(g.board);
    assert(!g.move(1)); assert(!g.rotate(1)); assert(!g.softDrop()); assert(!g.hardDrop()); advance(g, 4000); equal(JSON.stringify(g.board), before);
  });
  test('100 restarts reset board, score, phase, queue and timers without stale rows', () => {
    const g = fresh();
    for (let i = 0; i < 100; i++) {
      g.board[21].fill('I'); g.lines = 83; g.level = 9; g.score = 9000; g.clearingRows = [21]; g.clearClock = 90; g.lockResets = 15; g.state = i % 2 ? 'paused' : 'over';
      g.start(); equal(g.state, 'running'); equal(g.lines, 0); equal(g.score, 0); equal(g.level, 1); equal(g.queue.length, 3);
      equal(g.clearingRows, []); equal(g.clearClock, 0); equal(g.lockClock, 0); equal(g.lockResets, 0); equal(g.piecesLocked, 0);
      assert(g.board.every(row => row.every(cell => cell === null))); assert(!g.collides(g.active));
    }
  });
  test('Invalid deltas are ignored and large deltas do not fast-forward', () => {
    const g = fresh(); const before = { ...g.active }; for (const dt of [NaN, Infinity, -100, 0]) g.tick(dt); equal(g.active, before);
    g.tick(60000); equal(g.gravityClock, 250); equal(g.active, before);
  });
  test('Events drain once and restarts discard previous-run events', () => {
    const g = fresh(); g.hardDrop(); assert(g.drainEvents().some(e => e.type === 'lock')); equal(g.drainEvents(), []);
    g.pause(); g.start(); equal(g.drainEvents().map(e => e.type), ['start']);
  });
  test('Seeded stress play preserves board and collision invariants through 5,000 actions', () => {
    const random = rng(813); const g = new Game(random); g.start();
    for (let i = 0; i < 5000; i++) {
      if (g.state === 'over') g.start();
      const action = Math.floor(random() * 8);
      if (action < 2) g.move(action ? 1 : -1);
      else if (action < 4) g.rotate(action === 2 ? 1 : -1);
      else if (action === 4) g.softDrop();
      else if (action === 5) g.hardDrop();
      else advance(g, 200);
      equal(g.board.length, TOTAL_ROWS); assert(g.board.every(row => row.length === COLS));
      assert(g.board.flat().every(cell => cell === null || TYPES.includes(cell)));
      assert(Number.isSafeInteger(g.score) && g.score >= 0);
      equal(g.level, 1 + Math.floor(g.lines / 10));
      if (g.active) assert(!g.collides(g.active), 'Live piece overlaps the board');
    }
  });

  globalThis.TetrisTestResults = results;
  const failed = results.filter(result => !result.passed);
  if (typeof document !== 'undefined') {
    const target = document.getElementById('results');
    if (target) {
      for (const result of results) {
        const line = document.createElement('li'); line.textContent = `${result.passed ? 'PASS' : 'FAIL'} — ${result.name}${result.error ? ': ' + result.error : ''}`;
        line.style.color = result.passed ? '#91dca7' : '#ff9292'; target.append(line);
      }
      document.getElementById('summary').textContent = `${results.length - failed.length}/${results.length} tests passed`;
    }
  } else if (typeof print === 'function') {
    results.forEach(result => print(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ': ' + result.error : ''}`));
    print(`${results.length - failed.length}/${results.length} tests passed`);
    if (failed.length) throw new Error(`${failed.length} tests failed`);
  }
})();
