"use strict";

/* =====================================================================
   Blockfall — a falling-block puzzle game.
   Original implementation in vanilla JavaScript + Canvas 2D.

   Structure:
     1. Constants & piece definitions
     2. Pure board logic (create, collide, merge, clear lines)
     3. Game state & piece control (spawn, move, rotate, drop, lock)
     4. Rendering (browser only)
     5. Input & main loop (browser only)
   The logic in sections 1–3 has no DOM dependencies, so it can be
   driven headlessly for testing.
   ===================================================================== */

/* ---------------- 1. Constants & piece definitions ---------------- */

const COLS = 10;
const ROWS = 20;
const BLOCK = 30; // pixel size of one cell on the main canvas

// The seven falling pieces. Each shape is a matrix; the number is the
// piece id (also an index into COLORS). 0 means empty inside the matrix.
const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[2, 0, 0], [2, 2, 2], [0, 0, 0]],
  L: [[0, 0, 3], [3, 3, 3], [0, 0, 0]],
  O: [[4, 4], [4, 4]],
  S: [[0, 5, 5], [5, 5, 0], [0, 0, 0]],
  T: [[0, 6, 0], [6, 6, 6], [0, 0, 0]],
  Z: [[7, 7, 0], [0, 7, 7], [0, 0, 0]],
};
const PIECE_KEYS = Object.keys(SHAPES);

// One colour per piece id (index 0 unused — empty cells are not drawn).
const COLORS = [
  null,
  "#4dd0e1", // I — cyan
  "#5c6bc0", // J — indigo
  "#ffa726", // L — orange
  "#ffee58", // O — yellow
  "#66bb6a", // S — green
  "#ab47bc", // T — purple
  "#ef5350", // Z — red
];

// Points for clearing 1–4 lines at once (multiplied by level).
const LINE_POINTS = [0, 100, 300, 500, 800];
// Lines needed to advance each level.
const LINES_PER_LEVEL = 10;

/* ---------------- 2. Pure board logic ---------------- */

// A fresh, empty well: ROWS arrays of COLS zeroes.
function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

// Deep-copy a shape matrix so rotations never mutate the definitions.
function cloneMatrix(m) {
  return m.map((row) => row.slice());
}

// Rotate a matrix 90 degrees. dir = 1 clockwise, -1 counter-clockwise.
function rotateMatrix(m, dir) {
  const transposed = m[0].map((_, x) => m.map((row) => row[x]));
  return dir > 0
    ? transposed.map((row) => row.reverse())
    : transposed.reverse();
}

// Would `matrix` placed at (px, py) overlap a wall, the floor, or a
// settled block? Empty matrix cells never collide.
function collide(board, matrix, px, py) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue;
      const bx = px + x;
      const by = py + y;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && board[by][bx]) return true;
    }
  }
  return false;
}

// Stamp a piece's filled cells into the board.
function merge(board, piece) {
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) board[piece.y + y][piece.x + x] = value;
    });
  });
}

// Remove every full row, drop the rows above, and report how many
// lines were cleared.
function clearLines(board) {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (board[y].every((cell) => cell !== 0)) {
      board.splice(y, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      y++; // re-check the row that just fell into this slot
    }
  }
  return cleared;
}

/* ---------------- 3. Game state & piece control ---------------- */

// A bag randomiser: shuffle all seven pieces, deal them out, reshuffle.
// This guarantees every piece appears once in each run of seven.
function createBag(rng) {
  const bag = PIECE_KEYS.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function createGame(rng) {
  const random = rng || Math.random;
  const game = {
    board: createBoard(),
    bag: [],
    current: null,
    nextKey: null,
    score: 0,
    lines: 0,
    level: 1,
    over: false,
    rng: random,
  };
  game.nextKey = drawFromBag(game);
  spawnPiece(game);
  return game;
}

function drawFromBag(game) {
  if (game.bag.length === 0) game.bag = createBag(game.rng);
  return game.bag.pop();
}

// Bring the queued piece into play at the top centre of the well.
// If it cannot even spawn, the stack has topped out: game over.
function spawnPiece(game) {
  const key = game.nextKey;
  const matrix = cloneMatrix(SHAPES[key]);
  const piece = {
    key,
    matrix,
    x: Math.floor((COLS - matrix[0].length) / 2),
    y: key === "I" ? -1 : 0,
  };
  game.nextKey = drawFromBag(game);
  if (collide(game.board, piece.matrix, piece.x, piece.y)) {
    // Nudge down once — a piece may legally peek above the well.
    if (!collide(game.board, piece.matrix, piece.x, piece.y + 1)) {
      piece.y += 1;
    } else {
      game.current = piece;
      game.over = true;
      return game.current;
    }
  }
  game.current = piece;
  return game.current;
}

function movePiece(game, dx) {
  if (game.over || !game.current) return false;
  const p = game.current;
  if (!collide(game.board, p.matrix, p.x + dx, p.y)) {
    p.x += dx;
    return true;
  }
  return false;
}

// Rotate with a few simple wall-kick offsets tried in order.
function rotatePiece(game, dir) {
  if (game.over || !game.current) return false;
  const p = game.current;
  if (p.key === "O") return true; // the square looks the same rotated
  const rotated = rotateMatrix(p.matrix, dir);
  const kicks = [0, -1, 1, -2, 2];
  for (const dx of kicks) {
    if (!collide(game.board, rotated, p.x + dx, p.y)) {
      p.matrix = rotated;
      p.x += dx;
      return true;
    }
  }
  return false;
}

// One gravity step. Returns false when the piece lands and locks.
function stepDown(game) {
  if (game.over || !game.current) return false;
  const p = game.current;
  if (!collide(game.board, p.matrix, p.x, p.y + 1)) {
    p.y += 1;
    return true;
  }
  lockPiece(game);
  return false;
}

// Player-driven soft drop: same as a gravity step, plus a point.
function softDrop(game) {
  if (game.over || !game.current) return false;
  if (stepDown(game)) {
    game.score += 1;
    return true;
  }
  return false;
}

// Slam the piece straight down, score the distance, and lock it.
function hardDrop(game) {
  if (game.over || !game.current) return 0;
  const p = game.current;
  let distance = 0;
  while (!collide(game.board, p.matrix, p.x, p.y + 1)) {
    p.y += 1;
    distance++;
  }
  game.score += distance * 2;
  lockPiece(game);
  return distance;
}

// Settle the current piece, clear any completed lines, update the
// score/level, and spawn the next piece.
function lockPiece(game) {
  merge(game.board, game.current);
  const cleared = clearLines(game.board);
  if (cleared > 0) {
    game.score += LINE_POINTS[cleared] * game.level;
    game.lines += cleared;
    game.level = Math.floor(game.lines / LINES_PER_LEVEL) + 1;
  }
  spawnPiece(game);
}

// Milliseconds between gravity steps at a given level.
function dropInterval(level) {
  return Math.max(80, 800 - (level - 1) * 70);
}

// Start over with a clean well.
function resetGame(game) {
  const fresh = createGame(game.rng);
  game.board = fresh.board;
  game.bag = fresh.bag;
  game.current = fresh.current;
  game.nextKey = fresh.nextKey;
  game.score = fresh.score;
  game.lines = fresh.lines;
  game.level = fresh.level;
  game.over = fresh.over;
  return game;
}

/* ---------------- 4 & 5. Browser rendering, input, loop ---------------- */

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const nextCanvas = document.getElementById("next");
  const nextCtx = nextCanvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const linesEl = document.getElementById("lines");
  const levelEl = document.getElementById("level");
  const overlayEl = document.getElementById("overlay");

  const BEST_KEY = "arcade-blockfall-best";
  let best = 0;
  try {
    best = parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
  } catch (e) {
    best = 0;
  }
  function saveBest() {
    try {
      window.localStorage.setItem(BEST_KEY, String(best));
    } catch (e) {
      // Storage unavailable (e.g. private mode) — best stays in-memory.
    }
  }

  const game = createGame();
  let dropCounter = 0;
  let lastTime = 0;
  let paused = false;

  function drawCell(c, x, y, size, color) {
    c.fillStyle = color;
    c.fillRect(x * size, y * size, size, size);
    c.strokeStyle = "rgba(0, 0, 0, 0.35)";
    c.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
    // small highlight to give the block a little depth
    c.fillStyle = "rgba(255, 255, 255, 0.18)";
    c.fillRect(x * size, y * size, size, size * 0.3);
  }

  function drawMatrix(c, matrix, ox, oy, size) {
    matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) drawCell(c, ox + x, oy + y, size, COLORS[value]);
      });
    });
  }

  // Where the current piece would land if dropped straight down.
  function ghostY() {
    const p = game.current;
    let gy = p.y;
    while (!collide(game.board, p.matrix, p.x, gy + 1)) gy++;
    return gy;
  }

  function draw() {
    // well background
    ctx.fillStyle = "#11142a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // faint grid
    ctx.strokeStyle = "rgba(232, 234, 246, 0.06)";
    for (let x = 1; x < COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * BLOCK, 0);
      ctx.lineTo(x * BLOCK, canvas.height);
      ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * BLOCK);
      ctx.lineTo(canvas.width, y * BLOCK);
      ctx.stroke();
    }
    // settled blocks
    drawMatrix(ctx, game.board, 0, 0, BLOCK);
    // ghost + falling piece
    if (game.current && !game.over) {
      const p = game.current;
      ctx.globalAlpha = 0.25;
      drawMatrix(ctx, p.matrix, p.x, ghostY(), BLOCK);
      ctx.globalAlpha = 1;
      drawMatrix(ctx, p.matrix, p.x, p.y, BLOCK);
    }
    // next-piece preview
    nextCtx.fillStyle = "#11142a";
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (game.nextKey) {
      const m = SHAPES[game.nextKey];
      const size = 20;
      const ox = (nextCanvas.width / size - m[0].length) / 2;
      const oy = (nextCanvas.height / size - m.length) / 2;
      drawMatrix(nextCtx, cloneMatrix(m), ox, oy, size);
    }
    // paused indicator
    if (paused && !game.over) {
      ctx.fillStyle = "rgba(11, 14, 26, 0.65)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffd54f";
      ctx.font = "700 28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
    }
    // HUD
    if (game.score > best) {
      best = game.score;
      saveBest();
    }
    scoreEl.textContent = game.score;
    if (bestEl) bestEl.textContent = best;
    linesEl.textContent = game.lines;
    levelEl.textContent = game.level;
    overlayEl.style.display = game.over ? "flex" : "none";
  }

  function update(time) {
    requestAnimationFrame(update);
    const delta = time - lastTime;
    lastTime = time;
    if (!game.over && !paused) {
      dropCounter += delta;
      if (dropCounter > dropInterval(game.level)) {
        stepDown(game);
        dropCounter = 0;
      }
    }
    draw();
  }

  document.addEventListener("keydown", (event) => {
    if (game.over) {
      if (event.key === "Enter" || event.key === "r" || event.key === "R") {
        resetGame(game);
        paused = false;
        dropCounter = 0;
      }
      return;
    }
    if (event.key === "r" || event.key === "R") {
      resetGame(game);
      paused = false;
      dropCounter = 0;
      draw();
      return;
    }
    if (
      event.key === "p" ||
      event.key === "P" ||
      event.key === "Escape"
    ) {
      paused = !paused;
      dropCounter = 0;
      draw();
      return;
    }
    if (paused) return;
    switch (event.key) {
      case "ArrowLeft":
        movePiece(game, -1);
        break;
      case "ArrowRight":
        movePiece(game, 1);
        break;
      case "ArrowDown":
        softDrop(game);
        dropCounter = 0;
        break;
      case "ArrowUp":
      case "x":
      case "X":
        rotatePiece(game, 1);
        break;
      case "z":
      case "Z":
        rotatePiece(game, -1);
        break;
      case " ":
        hardDrop(game);
        dropCounter = 0;
        event.preventDefault();
        break;
      default:
        return;
    }
    if (event.key.startsWith("Arrow")) event.preventDefault();
    draw();
  });

  document.getElementById("restart").addEventListener("click", () => {
    resetGame(game);
    paused = false;
    dropCounter = 0;
    draw();
  });

  // Basic touch controls on the whole game container (the canvas alone
  // is small): tap = rotate, swipe left/right = move, swipe down =
  // hard drop (matching the Space key).
  const touchTarget = document.querySelector(".stage") || canvas;
  let touchStartX = null;
  let touchStartY = null;
  touchTarget.addEventListener(
    "touchstart",
    (event) => {
      if (event.target && event.target.closest && event.target.closest("button, a")) return;
      if (event.touches.length !== 1) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
      event.preventDefault();
    },
    { passive: false }
  );
  touchTarget.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
    },
    { passive: false }
  );
  touchTarget.addEventListener(
    "touchend",
    (event) => {
      if (event.target && event.target.closest && event.target.closest("button, a")) return;
      event.preventDefault();
      if (touchStartX === null || touchStartY === null) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      touchStartX = null;
      touchStartY = null;
      if (game.over || paused) return;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const THRESHOLD = 24;
      if (absX < THRESHOLD && absY < THRESHOLD) {
        rotatePiece(game, 1); // tap
      } else if (absX >= absY) {
        const steps = Math.max(1, Math.floor(absX / 30));
        for (let i = 0; i < steps; i++) movePiece(game, dx > 0 ? 1 : -1);
      } else if (dy > 0) {
        hardDrop(game);
        dropCounter = 0;
      } else {
        rotatePiece(game, 1); // swipe up also rotates
      }
      draw();
    },
    { passive: false }
  );

  requestAnimationFrame(update);
}

/* ---------------- Exports for headless testing ---------------- */

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    COLS,
    ROWS,
    SHAPES,
    COLORS,
    LINE_POINTS,
    createBoard,
    createGame,
    collide,
    merge,
    clearLines,
    spawnPiece,
    movePiece,
    rotatePiece,
    stepDown,
    softDrop,
    hardDrop,
    lockPiece,
    dropInterval,
    resetGame,
  };
}
