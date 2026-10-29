/* Pure gameplay: no DOM, canvas, timers, storage, or network dependencies.
 * Intent: fixed 10 x 20 visible grid, two hidden spawn rows, seven-bag queue,
 * SRS quarter-turn kicks, deterministic millisecond ticks and bounded lock delay.
 * Scoring: 100/300/500/800 x current level; soft/hard drops add 1/2 per cell.
 */
(function (root) {
  'use strict';

  const COLS = 10;
  const ROWS = 20;
  const HIDDEN_ROWS = 2;
  const TOTAL_ROWS = ROWS + HIDDEN_ROWS;
  const LOCK_DELAY = 500;
  const MAX_LOCK_RESETS = 15;
  const CLEAR_DELAY = 160;
  const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  const BASE = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
    O: [[1, 0], [2, 0], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]]
  };
  const SHAPES = {};
  for (const type of TYPES) {
    SHAPES[type] = [BASE[type]];
    const size = type === 'I' ? 4 : 3;
    for (let r = 1; r < 4; r++) {
      SHAPES[type].push(type === 'O' ? BASE[type] : SHAPES[type][r - 1].map(([x, y]) => [size - 1 - y, x]));
    }
  }
  // Official SRS offsets, converted from Y-up to our downward-positive board.
  const JLSTZ_KICKS = {
    '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]
  };
  const I_KICKS = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]
  };
  const LINE_POINTS = [0, 100, 300, 500, 800];
  const blankRow = () => Array(COLS).fill(null);

  class Game {
    constructor(random = Math.random) {
      this.random = random;
      this.reset();
    }

    reset() {
      this.board = Array.from({ length: TOTAL_ROWS }, blankRow);
      this.active = null;
      this.queue = [];
      this.bag = [];
      this.state = 'ready';
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.gravityClock = 0;
      this.lockClock = 0;
      this.lockResets = 0;
      this.hasTouchedGround = false;
      this.clearingRows = [];
      this.clearClock = 0;
      this.events = [];
      this.piecesLocked = 0;
      this.fillQueue();
    }

    start() {
      this.reset();
      this.state = 'running';
      this.spawn();
      this.events.push({ type: 'start' });
    }

    get dropInterval() {
      return Math.max(65, 1000 * Math.pow(0.8, this.level - 1));
    }

    get canAct() {
      return this.state === 'running' && this.active !== null && this.clearingRows.length === 0;
    }

    fillQueue() {
      while (this.queue.length < 3) {
        if (this.bag.length === 0) {
          this.bag = TYPES.slice();
          for (let i = this.bag.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
          }
        }
        this.queue.push(this.bag.pop());
      }
    }

    spawn() {
      this.active = { type: this.queue.shift(), rotation: 0, x: 3, y: HIDDEN_ROWS - 1 };
      this.fillQueue();
      this.gravityClock = 0;
      this.lockClock = 0;
      this.lockResets = 0;
      this.hasTouchedGround = false;
      if (this.collides(this.active)) this.endGame();
    }

    cells(piece = this.active) {
      if (!piece) return [];
      return SHAPES[piece.type][piece.rotation].map(([x, y]) => [piece.x + x, piece.y + y]);
    }

    collides(piece) {
      return this.cells(piece).some(([x, y]) =>
        x < 0 || x >= COLS || y < 0 || y >= TOTAL_ROWS || this.board[y][x] !== null
      );
    }

    grounded() {
      return this.active !== null && this.collides({ ...this.active, y: this.active.y + 1 });
    }

    resetLockAfterManipulation() {
      // Reset only after the first floor contact, with a per-piece cap to prevent stalling.
      if (this.hasTouchedGround && this.lockResets < MAX_LOCK_RESETS) {
        this.lockClock = 0;
        this.lockResets++;
      }
      if (this.grounded()) this.hasTouchedGround = true;
    }

    move(direction) {
      if (!this.canAct || (direction !== -1 && direction !== 1)) return false;
      const candidate = { ...this.active, x: this.active.x + direction };
      if (this.collides(candidate)) return false;
      if (this.grounded()) this.hasTouchedGround = true;
      this.active = candidate;
      this.resetLockAfterManipulation();
      return true;
    }

    rotate(direction) {
      if (!this.canAct || (direction !== -1 && direction !== 1)) return false;
      if (this.active.type === 'O') return true; // Square rotation must not move or reset locking.
      const from = this.active.rotation;
      const to = (from + direction + 4) % 4;
      const table = this.active.type === 'I' ? I_KICKS : JLSTZ_KICKS;
      for (const [dx, dy] of table[`${from}>${to}`]) {
        const candidate = { ...this.active, rotation: to, x: this.active.x + dx, y: this.active.y + dy };
        if (!this.collides(candidate)) {
          if (this.grounded()) this.hasTouchedGround = true;
          this.active = candidate;
          this.resetLockAfterManipulation();
          return true;
        }
      }
      return false;
    }

    softDrop() {
      if (!this.canAct) return false;
      const candidate = { ...this.active, y: this.active.y + 1 };
      if (this.collides(candidate)) {
        this.hasTouchedGround = true;
        return false;
      }
      this.active = candidate;
      this.score++;
      this.gravityClock = 0;
      if (this.grounded()) this.hasTouchedGround = true;
      return true;
    }

    ghostY() {
      if (!this.active) return null;
      let y = this.active.y;
      while (!this.collides({ ...this.active, y: y + 1 })) y++;
      return y;
    }

    hardDrop() {
      if (!this.canAct) return false;
      const distance = this.ghostY() - this.active.y;
      this.active.y += distance;
      this.score += distance * 2;
      this.lock();
      return true;
    }

    lock() {
      if (!this.canAct) return;
      const cells = this.cells();
      for (const [x, y] of cells) this.board[y][x] = this.active.type;
      this.piecesLocked++;
      this.active = null;
      this.events.push({ type: 'lock' });
      // A piece locking completely above the visible well is a top-out.
      if (cells.every(([, y]) => y < HIDDEN_ROWS)) {
        this.endGame();
        return;
      }
      this.clearingRows = [];
      this.board.forEach((row, y) => {
        if (row.every(cell => cell !== null)) this.clearingRows.push(y);
      });
      if (this.clearingRows.length) {
        this.clearClock = 0;
        this.events.push({ type: 'clearing', count: this.clearingRows.length });
      } else {
        this.spawn();
      }
    }

    finishClear() {
      const count = this.clearingRows.length;
      const previousLevel = this.level;
      const points = LINE_POINTS[count] * previousLevel;
      const rows = new Set(this.clearingRows);
      this.board = this.board.filter((_, y) => !rows.has(y));
      while (this.board.length < TOTAL_ROWS) this.board.unshift(blankRow());
      this.score += points;
      this.lines += count;
      this.level = 1 + Math.floor(this.lines / 10);
      this.clearingRows = [];
      this.clearClock = 0;
      this.events.push({ type: 'clear', count, points, levelUp: this.level > previousLevel });
      this.spawn();
    }

    tick(milliseconds) {
      if (this.state !== 'running' || !Number.isFinite(milliseconds) || milliseconds <= 0) return;
      // The app feeds fixed steps. Bound direct callers too, so background tabs never fast-forward.
      let remaining = Math.min(milliseconds, 250);
      while (remaining > 0 && this.state === 'running') {
        const step = Math.min(remaining, 10);
        remaining -= step;
        if (this.clearingRows.length) {
          this.clearClock += step;
          if (this.clearClock >= CLEAR_DELAY) this.finishClear();
          continue;
        }
        if (!this.active) break;
        if (this.grounded()) {
          this.hasTouchedGround = true;
          this.lockClock += step;
          if (this.lockClock >= LOCK_DELAY) this.lock();
        } else {
          this.gravityClock += step;
          if (this.gravityClock >= this.dropInterval) {
            this.gravityClock -= this.dropInterval;
            const candidate = { ...this.active, y: this.active.y + 1 };
            if (!this.collides(candidate)) this.active = candidate;
            if (this.grounded()) this.hasTouchedGround = true;
          }
        }
      }
    }

    pause() {
      if (this.state !== 'running') return false;
      this.state = 'paused';
      this.events.push({ type: 'pause' });
      return true;
    }

    resume() {
      if (this.state !== 'paused') return false;
      this.state = 'running';
      this.events.push({ type: 'resume' });
      return true;
    }

    endGame() {
      this.state = 'over';
      this.active = null;
      this.events.push({ type: 'over', score: this.score });
    }

    drainEvents() {
      const events = this.events;
      this.events = [];
      return events;
    }
  }

  root.TetrisCore = { Game, COLS, ROWS, HIDDEN_ROWS, TOTAL_ROWS, TYPES, SHAPES, LOCK_DELAY, MAX_LOCK_RESETS, CLEAR_DELAY };
})(globalThis);
