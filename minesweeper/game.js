"use strict";

/*
 * Minesweeper — 1915 Arcade
 * Beginner board: 9x9 with 10 mines.
 *
 * The board logic (state creation, mine placement, reveal/flood fill,
 * flagging, win/lose checks) is kept separate from the DOM rendering so
 * it can be driven directly from tests. The DOM layer at the bottom only
 * runs in a browser.
 */

const ROWS = 9;
const COLS = 9;
const MINE_COUNT = 10;

/* ------------------------------------------------------------------ */
/* Board logic (no DOM)                                                */
/* ------------------------------------------------------------------ */

function createCell() {
  return { mine: false, revealed: false, flagged: false, count: 0 };
}

function createGame(rows, cols, mineTotal) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(createCell());
    cells.push(row);
  }
  return {
    rows,
    cols,
    mineTotal,
    cells,
    started: false,     // mines are placed on the first reveal
    over: false,
    won: false,
    flagsUsed: 0,
    revealedCount: 0,
    explodedAt: null,   // { r, c } of the mine that ended the game
  };
}

function inBounds(game, r, c) {
  return r >= 0 && r < game.rows && c >= 0 && c < game.cols;
}

function forEachNeighbour(game, r, c, fn) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(game, nr, nc)) fn(nr, nc, game.cells[nr][nc]);
    }
  }
}

/*
 * Place mines after the first reveal. The clicked cell and all of its
 * neighbours are excluded, so the first click always opens an area.
 * `rng` is injectable for deterministic tests; defaults to Math.random.
 */
function placeMines(game, safeR, safeC, rng) {
  const random = rng || Math.random;
  const excluded = new Set([safeR * game.cols + safeC]);
  forEachNeighbour(game, safeR, safeC, (nr, nc) => excluded.add(nr * game.cols + nc));

  let placed = 0;
  while (placed < game.mineTotal) {
    const idx = Math.floor(random() * game.rows * game.cols);
    if (excluded.has(idx)) continue;
    const r = Math.floor(idx / game.cols);
    const c = idx % game.cols;
    if (game.cells[r][c].mine) continue;
    game.cells[r][c].mine = true;
    placed++;
  }

  for (let r = 0; r < game.rows; r++) {
    for (let c = 0; c < game.cols; c++) {
      let n = 0;
      forEachNeighbour(game, r, c, (nr, nc, cell) => { if (cell.mine) n++; });
      game.cells[r][c].count = n;
    }
  }
  game.started = true;
}

/*
 * Reveal a cell. Returns one of:
 *   "ignored" — game over, or cell already revealed/flagged
 *   "mine"    — a mine was hit, game lost
 *   "win"     — this reveal cleared the last safe cell
 *   "ok"      — ordinary reveal
 * Empty cells (count 0) flood-fill their neighbourhood.
 */
function reveal(game, r, c, rng) {
  if (game.over || !inBounds(game, r, c)) return "ignored";
  const start = game.cells[r][c];
  if (start.revealed || start.flagged) return "ignored";

  if (!game.started) placeMines(game, r, c, rng);

  if (start.mine) {
    start.revealed = true;
    game.over = true;
    game.won = false;
    game.explodedAt = { r, c };
    return "mine";
  }

  const stack = [[r, c]];
  while (stack.length > 0) {
    const [cr, cc] = stack.pop();
    const cell = game.cells[cr][cc];
    if (cell.revealed || cell.flagged || cell.mine) continue;
    cell.revealed = true;
    game.revealedCount++;
    if (cell.count === 0) {
      forEachNeighbour(game, cr, cc, (nr, nc, nCell) => {
        if (!nCell.revealed) stack.push([nr, nc]);
      });
    }
  }

  const safeTotal = game.rows * game.cols - game.mineTotal;
  if (game.revealedCount === safeTotal) {
    game.over = true;
    game.won = true;
    return "win";
  }
  return "ok";
}

/* Toggle a flag on an unrevealed cell. Returns true if state changed. */
function toggleFlag(game, r, c) {
  if (game.over || !inBounds(game, r, c)) return false;
  const cell = game.cells[r][c];
  if (cell.revealed) return false;
  cell.flagged = !cell.flagged;
  game.flagsUsed += cell.flagged ? 1 : -1;
  return true;
}

function minesRemaining(game) {
  return game.mineTotal - game.flagsUsed;
}

function countMines(game) {
  let n = 0;
  for (const row of game.cells) for (const cell of row) if (cell.mine) n++;
  return n;
}

/* ------------------------------------------------------------------ */
/* DOM layer (browser only)                                            */
/* ------------------------------------------------------------------ */

if (typeof document !== "undefined") {
  const boardEl = document.getElementById("board");
  const counterEl = document.getElementById("counter");
  const timerEl = document.getElementById("timer");
  const bestEl = document.getElementById("best");
  const statusEl = document.getElementById("status");
  const restartBtn = document.getElementById("restart");

  let game = createGame(ROWS, COLS, MINE_COUNT);
  let cellEls = [];

  /* ---------------- Timer & best time ---------------- */
  /* The timer starts on the first reveal and stops on win or loss. */
  const BEST_KEY = "arcade-minesweeper-best";
  let timerId = null;
  let startStamp = null;

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function elapsedSeconds() {
    if (startStamp === null) return 0;
    return Math.floor((Date.now() - startStamp) / 1000);
  }

  function startTimer() {
    if (timerId !== null || startStamp !== null) return;
    startStamp = Date.now();
    timerEl.textContent = formatTime(0);
    timerId = setInterval(() => {
      timerEl.textContent = formatTime(elapsedSeconds());
    }, 250);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    timerEl.textContent = formatTime(elapsedSeconds());
  }

  function resetTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    startStamp = null;
    timerEl.textContent = formatTime(0);
  }

  function loadBest() {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    } catch (e) {
      return null;
    }
  }

  function showBest() {
    const best = loadBest();
    bestEl.textContent = best === null ? "—" : formatTime(best);
  }

  /* Record a winning clear time; keeps only the lowest. */
  function recordBest(seconds) {
    const best = loadBest();
    if (best === null || seconds < best) {
      try {
        localStorage.setItem(BEST_KEY, String(seconds));
      } catch (e) { /* storage unavailable — best time just won't persist */ }
    }
    showBest();
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    cellEls = [];
    for (let r = 0; r < game.rows; r++) {
      const rowEls = [];
      for (let c = 0; c < game.cols; c++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cell";
        btn.dataset.r = r;
        btn.dataset.c = c;
        btn.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}`);
        btn.addEventListener("click", onReveal);
        btn.addEventListener("contextmenu", onFlag);
        btn.addEventListener("pointerdown", onPressStart);
        btn.addEventListener("pointerup", onPressEnd);
        btn.addEventListener("pointerleave", onPressEnd);
        btn.addEventListener("pointercancel", onPressEnd);
        boardEl.appendChild(btn);
        rowEls.push(btn);
      }
      cellEls.push(rowEls);
    }
  }

  function render() {
    counterEl.textContent = minesRemaining(game);
    for (let r = 0; r < game.rows; r++) {
      for (let c = 0; c < game.cols; c++) {
        const cell = game.cells[r][c];
        const el = cellEls[r][c];
        el.className = "cell";
        el.textContent = "";
        const showMine = cell.mine && (cell.revealed || (game.over && !game.won));
        if (cell.revealed && !cell.mine) {
          el.classList.add("revealed");
          if (cell.count > 0) {
            el.textContent = cell.count;
            el.classList.add("n" + cell.count);
          }
        } else if (showMine) {
          el.classList.add("revealed", "mine");
          if (game.explodedAt && game.explodedAt.r === r && game.explodedAt.c === c) {
            el.classList.add("exploded");
          }
          el.textContent = "💣";
        } else if (cell.flagged) {
          el.classList.add("flagged");
          el.textContent = "🚩";
        }
      }
    }
    if (game.over) {
      statusEl.textContent = game.won ? "You win! 🎉" : "Boom! Game over.";
    } else if (game.started) {
      statusEl.textContent = "Careful out there…";
    } else {
      statusEl.textContent = "Good luck!";
    }
  }

  function onReveal(event) {
    /* A completed long-press already flagged this cell; swallow the
       click the browser fires on release so it doesn't also reveal. */
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const r = Number(event.currentTarget.dataset.r);
    const c = Number(event.currentTarget.dataset.c);
    reveal(game, r, c);
    if (game.started && !game.over) startTimer();
    if (game.over) {
      stopTimer();
      if (game.won) recordBest(elapsedSeconds());
    }
    render();
  }

  function onFlag(event) {
    event.preventDefault();
    /* A long-press may also make the browser fire contextmenu for the
       same press; that flag toggle already happened, so ignore it. */
    if (suppressContextMenu) {
      suppressContextMenu = false;
      return;
    }
    const r = Number(event.currentTarget.dataset.r);
    const c = Number(event.currentTarget.dataset.c);
    toggleFlag(game, r, c);
    render();
  }

  /* -------- Long-press to flag (touch / pen) -------- */
  /* Quick taps still reveal via the normal click; holding a cell for
     LONG_PRESS_MS toggles its flag instead. Mouse input is untouched
     (left-click reveals, right-click flags, as before). */
  const LONG_PRESS_MS = 450;
  let pressTimer = null;
  let pressEl = null;
  let suppressClick = false;
  let suppressContextMenu = false;

  function onPressStart(event) {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const el = event.currentTarget;
    pressEl = el;
    el.classList.add("holding");
    pressTimer = setTimeout(() => {
      pressTimer = null;
      pressEl = null;
      el.classList.remove("holding");
      suppressClick = true;
      suppressContextMenu = true;
      toggleFlag(game, Number(el.dataset.r), Number(el.dataset.c));
      render();
    }, LONG_PRESS_MS);
  }

  function onPressEnd() {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (pressEl) {
      pressEl.classList.remove("holding");
      pressEl = null;
    }
  }

  restartBtn.addEventListener("click", () => {
    game = createGame(ROWS, COLS, MINE_COUNT);
    resetTimer();
    buildBoard();
    render();
  });

  buildBoard();
  showBest();
  render();
}

/* Export the logic for headless tests (ignored by browsers). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ROWS, COLS, MINE_COUNT,
    createGame, placeMines, reveal, toggleFlag,
    minesRemaining, countMines,
  };
}
