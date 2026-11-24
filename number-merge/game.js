/*
 * Number Merge — a sliding-tile merge puzzle.
 *
 * Slide every tile on a 4x4 grid with the arrow keys (or WASD / swipe).
 * When two tiles of the same value collide they merge into one tile of
 * double the value. After every move that actually changes the board, a
 * new tile (2, or sometimes 4) appears in a random empty cell. Reach the
 * 2048 tile to win; the game ends when the board is full and no two
 * neighbouring tiles match.
 *
 * The file is split into two halves:
 *   1. Pure board logic — no DOM access, so it can be unit-tested in Node.
 *   2. Browser wiring — rendering and input, only runs in a real page.
 */
'use strict';

/* ------------------------------------------------------------------ */
/* 1. Constants                                                        */
/* ------------------------------------------------------------------ */

var SIZE = 4;              // the grid is SIZE x SIZE
var WIN_TILE = 2048;       // reaching this tile wins the game
var FOUR_CHANCE = 0.1;     // probability a spawned tile is a 4, not a 2

/* ------------------------------------------------------------------ */
/* 2. Pure board logic                                                 */
/*                                                                     */
/* A board is a flat array of SIZE*SIZE numbers in row-major order.    */
/* 0 means an empty cell.                                              */
/* ------------------------------------------------------------------ */

function createEmptyBoard() {
  var board = [];
  for (var i = 0; i < SIZE * SIZE; i++) board.push(0);
  return board;
}

function emptyCells(board) {
  var cells = [];
  for (var i = 0; i < board.length; i++) {
    if (board[i] === 0) cells.push(i);
  }
  return cells;
}

/*
 * Place one new tile (2, or a 4 with FOUR_CHANCE probability) in a random
 * empty cell. `rng` is injectable so tests can be deterministic.
 * Returns the index used, or -1 when the board is full.
 */
function addRandomTile(board, rng) {
  rng = rng || Math.random;
  var cells = emptyCells(board);
  if (cells.length === 0) return -1;
  var idx = cells[Math.floor(rng() * cells.length)];
  board[idx] = rng() < FOUR_CHANCE ? 4 : 2;
  return idx;
}

/* A fresh game board: empty, then two random tiles. */
function createStartingBoard(rng) {
  var board = createEmptyBoard();
  addRandomTile(board, rng);
  addRandomTile(board, rng);
  return board;
}

/*
 * Slide one row to the left, merging equal neighbours once each.
 * Returns { row: <new row>, gained: <points scored by merges> }.
 * Example: [2, 2, 2, 0] -> [4, 2, 0, 0], gained 4.
 *          [4, 4, 8, 8] -> [8, 16, 0, 0], gained 24.
 */
function slideRowLeft(row) {
  var tiles = row.filter(function (v) { return v !== 0; });
  var out = [];
  var gained = 0;
  for (var i = 0; i < tiles.length; i++) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      var merged = tiles[i] * 2;
      out.push(merged);
      gained += merged;
      i++; // the partner tile is consumed by the merge
    } else {
      out.push(tiles[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  return { row: out, gained: gained };
}

/* Extract row `r` from the flat board. */
function getRow(board, r) {
  return board.slice(r * SIZE, r * SIZE + SIZE);
}

/* Extract column `c` from the flat board, top to bottom. */
function getCol(board, c) {
  var col = [];
  for (var r = 0; r < SIZE; r++) col.push(board[r * SIZE + c]);
  return col;
}

function boardsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/*
 * Move the whole board in one direction: 'left', 'right', 'up', 'down'.
 * Every line (row or column) is normalised to a leftward slide, slid,
 * then written back. Returns { board, moved, gained } where `moved`
 * tells whether anything changed — only then may a new tile spawn.
 */
function moveBoard(board, dir) {
  var next = createEmptyBoard();
  var gained = 0;
  var line, result, i, r, c;

  if (dir === 'left' || dir === 'right') {
    for (r = 0; r < SIZE; r++) {
      line = getRow(board, r);
      if (dir === 'right') line.reverse();
      result = slideRowLeft(line);
      if (dir === 'right') result.row.reverse();
      gained += result.gained;
      for (c = 0; c < SIZE; c++) next[r * SIZE + c] = result.row[c];
    }
  } else if (dir === 'up' || dir === 'down') {
    for (c = 0; c < SIZE; c++) {
      line = getCol(board, c);
      if (dir === 'down') line.reverse();
      result = slideRowLeft(line);
      if (dir === 'down') result.row.reverse();
      gained += result.gained;
      for (r = 0; r < SIZE; r++) next[r * SIZE + c] = result.row[r];
    }
  } else {
    throw new Error('unknown direction: ' + dir);
  }

  return { board: next, moved: !boardsEqual(board, next), gained: gained };
}

/* True while at least one move can still change the board. */
function canMove(board) {
  if (emptyCells(board).length > 0) return true;
  var r, c, v;
  for (r = 0; r < SIZE; r++) {
    for (c = 0; c < SIZE; c++) {
      v = board[r * SIZE + c];
      if (c + 1 < SIZE && board[r * SIZE + c + 1] === v) return true;
      if (r + 1 < SIZE && board[(r + 1) * SIZE + c] === v) return true;
    }
  }
  return false;
}

/* True once the winning tile exists on the board. */
function hasWon(board) {
  return board.indexOf(WIN_TILE) !== -1;
}

/* ------------------------------------------------------------------ */
/* 3. Browser wiring (skipped entirely under Node)                     */
/* ------------------------------------------------------------------ */

if (typeof document !== 'undefined') {
  (function () {
    var boardEl = document.getElementById('board');
    var scoreEl = document.getElementById('score');
    var bestEl = document.getElementById('best');
    var overlayEl = document.getElementById('overlay');
    var overlayTitle = document.getElementById('overlay-title');
    var overlayText = document.getElementById('overlay-text');
    var overlayButton = document.getElementById('overlay-button');

    var board, score, best, won, over, keepPlaying;

    /* Build the 16 cell elements once; render() just updates them. */
    var cellEls = [];
    for (var i = 0; i < SIZE * SIZE; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      boardEl.appendChild(cell);
      cellEls.push(cell);
    }

    function startGame() {
      board = createStartingBoard();
      score = 0;
      won = false;
      over = false;
      keepPlaying = false;
      overlayEl.className = '';
      render();
    }

    function render() {
      for (var i = 0; i < board.length; i++) {
        var v = board[i];
        cellEls[i].textContent = v === 0 ? '' : String(v);
        cellEls[i].className = 'cell' + (v === 0 ? '' : (v <= 2048 ? ' v' + v : ' vbig'));
      }
      scoreEl.textContent = String(score);
      if (score > best) {
        best = score;
        try { localStorage.setItem('numberMergeBest', String(best)); } catch (e) { /* private mode */ }
      }
      bestEl.textContent = String(best);
    }

    function showOverlay(title, text, buttonText) {
      overlayTitle.textContent = title;
      overlayText.textContent = text;
      overlayButton.textContent = buttonText;
      overlayEl.className = 'show';
    }

    function doMove(dir) {
      if (over) return;
      if (won && !keepPlaying) return; // win overlay is up; wait for the choice
      var result = moveBoard(board, dir);
      if (!result.moved) return;       // invalid move: no spawn, no score
      board = result.board;
      score += result.gained;
      addRandomTile(board);
      if (!won && hasWon(board)) {
        won = true;
        render();
        showOverlay('You made 2048!', 'Keep going for a higher score, or start a new game.', 'Keep Playing');
        return;
      }
      if (!canMove(board)) {
        over = true;
        render();
        showOverlay('Game Over', 'No moves left. Final score: ' + score, 'Play Again');
        return;
      }
      render();
    }

    /* Keyboard: arrows and WASD slide, R restarts. */
    var KEY_DIRS = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      a: 'left', d: 'right', w: 'up', s: 'down',
      A: 'left', D: 'right', W: 'up', S: 'down'
    };
    document.addEventListener('keydown', function (event) {
      if (event.key === 'r' || event.key === 'R') { startGame(); return; }
      var dir = KEY_DIRS[event.key];
      if (dir) {
        event.preventDefault(); // keep the page from scrolling
        doMove(dir);
      }
    });

    /* Touch: a swipe of 24px or more counts as a move. */
    var touchX = null, touchY = null;
    boardEl.addEventListener('touchstart', function (event) {
      var t = event.changedTouches[0];
      touchX = t.clientX;
      touchY = t.clientY;
    }, { passive: true });
    boardEl.addEventListener('touchend', function (event) {
      if (touchX === null) return;
      var t = event.changedTouches[0];
      var dx = t.clientX - touchX;
      var dy = t.clientY - touchY;
      touchX = touchY = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left')
                                         : (dy > 0 ? 'down' : 'up'));
    }, { passive: true });

    document.getElementById('restart').addEventListener('click', startGame);
    overlayButton.addEventListener('click', function () {
      if (won && !over) {
        /* "Keep Playing" after the win: hide the overlay and continue. */
        keepPlaying = true;
        overlayEl.className = '';
      } else {
        startGame();
      }
    });

    best = 0;
    try { best = parseInt(localStorage.getItem('numberMergeBest') || '0', 10) || 0; } catch (e) { /* ignore */ }
    startGame();
  })();
}

/* Export the pure logic for the Node smoke test. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SIZE: SIZE,
    WIN_TILE: WIN_TILE,
    createEmptyBoard: createEmptyBoard,
    createStartingBoard: createStartingBoard,
    emptyCells: emptyCells,
    addRandomTile: addRandomTile,
    slideRowLeft: slideRowLeft,
    moveBoard: moveBoard,
    canMove: canMove,
    hasWon: hasWon
  };
}
