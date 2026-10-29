/* Canvas presentation only. Gameplay stays in engine.js. */
(function (root) {
  'use strict';
  const { COLS, ROWS, HIDDEN_ROWS, SHAPES } = root.TetrisCore;
  const COLORS = {
    I: '#63d5e8', J: '#7495f5', L: '#f6ad69', O: '#edd36e',
    S: '#81d8a0', T: '#b79aee', Z: '#ed8299'
  };
  const SIZE = 30;

  class Renderer {
    constructor(boardCanvas, nextCanvas) {
      this.boardCanvas = boardCanvas;
      this.nextCanvas = nextCanvas;
      this.context = boardCanvas.getContext('2d');
      this.nextContext = nextCanvas.getContext('2d');
      if (!this.context || !this.nextContext) throw new Error('Canvas 2D is not available in this browser.');
      this.resize();
    }

    resize() {
      const ratio = Math.min(root.devicePixelRatio || 1, 3);
      for (const [canvas, context, width, height] of [
        [this.boardCanvas, this.context, 300, 600],
        [this.nextCanvas, this.nextContext, 180, 252]
      ]) {
        const displayedWidth = canvas.getBoundingClientRect().width || width;
        canvas.width = Math.round(displayedWidth * ratio);
        canvas.height = Math.round(displayedWidth * height / width * ratio);
        context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      }
    }

    block(ctx, x, y, size, type, ghost = false) {
      const padding = size > 20 ? 1.5 : 1;
      const left = x + padding;
      const top = y + padding;
      const side = size - padding * 2;
      if (ghost) {
        ctx.fillStyle = COLORS[type] + '12';
        ctx.fillRect(left, top, side, side);
        ctx.strokeStyle = COLORS[type] + '80';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(left + .5, top + .5, side - 1, side - 1);
        ctx.setLineDash([]);
        return;
      }
      const gradient = ctx.createLinearGradient(left, top, left, top + side);
      gradient.addColorStop(0, COLORS[type]);
      gradient.addColorStop(1, COLORS[type] + 'bb');
      ctx.fillStyle = gradient;
      ctx.fillRect(left, top, side, side);
      ctx.strokeStyle = '#ffffff30';
      ctx.lineWidth = 1;
      ctx.strokeRect(left + .5, top + .5, side - 1, side - 1);
      ctx.fillStyle = '#ffffff35';
      ctx.fillRect(left + 2, top + 1, side - 4, 2);
      ctx.fillStyle = '#11101f20';
      ctx.fillRect(left + 2, top + side - 3, side - 4, 2);
    }

    draw(game) {
      const ctx = this.context;
      ctx.clearRect(0, 0, 300, 600);
      ctx.fillStyle = '#0d0f19';
      ctx.fillRect(0, 0, 300, 600);
      ctx.strokeStyle = '#ffffff06';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < COLS; x++) { ctx.moveTo(x * SIZE + .5, 0); ctx.lineTo(x * SIZE + .5, 600); }
      for (let y = 1; y < ROWS; y++) { ctx.moveTo(0, y * SIZE + .5); ctx.lineTo(300, y * SIZE + .5); }
      ctx.stroke();

      for (let y = HIDDEN_ROWS; y < game.board.length; y++) {
        for (let x = 0; x < COLS; x++) {
          const type = game.board[y][x];
          if (type) this.block(ctx, x * SIZE, (y - HIDDEN_ROWS) * SIZE, SIZE, type);
        }
      }
      if (game.active) {
        const ghost = { ...game.active, y: game.ghostY() };
        if (ghost.y !== game.active.y) {
          for (const [x, y] of game.cells(ghost)) {
            if (y >= HIDDEN_ROWS) this.block(ctx, x * SIZE, (y - HIDDEN_ROWS) * SIZE, SIZE, ghost.type, true);
          }
        }
        for (const [x, y] of game.cells()) {
          if (y >= HIDDEN_ROWS) this.block(ctx, x * SIZE, (y - HIDDEN_ROWS) * SIZE, SIZE, game.active.type);
        }
      }
      if (game.clearingRows.length) {
        const progress = game.clearClock / root.TetrisCore.CLEAR_DELAY;
        ctx.fillStyle = `rgba(238, 226, 255, ${0.75 * (1 - progress)})`;
        for (const row of game.clearingRows) ctx.fillRect(0, (row - HIDDEN_ROWS) * SIZE, 300, SIZE);
      }
      this.drawNext(game.queue);
    }

    drawNext(queue) {
      const ctx = this.nextContext;
      ctx.clearRect(0, 0, 180, 252);
      queue.slice(0, 3).forEach((type, i) => {
        const cells = SHAPES[type][0];
        const minX = Math.min(...cells.map(([x]) => x));
        const maxX = Math.max(...cells.map(([x]) => x));
        const minY = Math.min(...cells.map(([, y]) => y));
        const maxY = Math.max(...cells.map(([, y]) => y));
        const size = i === 0 ? 26 : 22;
        const ox = (180 - (maxX - minX + 1) * size) / 2;
        const oy = i * 84 + (84 - (maxY - minY + 1) * size) / 2;
        ctx.globalAlpha = i === 0 ? 1 : .64;
        for (const [x, y] of cells) this.block(ctx, ox + (x - minX) * size, oy + (y - minY) * size, size, type);
        ctx.globalAlpha = 1;
        if (i < 2) {
          ctx.fillStyle = '#ffffff08';
          ctx.fillRect(16, (i + 1) * 84, 148, 1);
        }
      });
    }
  }
  root.TetrisRenderer = Renderer;
})(globalThis);
