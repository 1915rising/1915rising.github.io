"use strict";

// Memory Match — 4x4 card-flip matching game (vanilla JS, DOM-based).

var SYMBOLS = [
  { glyph: "★", color: "#ffd54f" },
  { glyph: "●", color: "#64b5f6" },
  { glyph: "▲", color: "#81c784" },
  { glyph: "◆", color: "#e57373" },
  { glyph: "♥", color: "#f06292" },
  { glyph: "♠", color: "#ba68c8" },
  { glyph: "♣", color: "#4db6ac" },
  { glyph: "♦", color: "#ffb74d" }
];

var BEST_KEY = "arcade-memory-match-best";
var TOTAL_PAIRS = SYMBOLS.length; // 8
var FLIP_BACK_MS = 700;

var boardEl = document.getElementById("board");
var movesEl = document.getElementById("moves");
var timeEl = document.getElementById("time");
var pairsEl = document.getElementById("pairs");
var bestEl = document.getElementById("best");
var overlayEl = document.getElementById("overlay");
var overlayTextEl = document.getElementById("overlay-text");
var restartBtn = document.getElementById("restart-btn");
var playAgainBtn = document.getElementById("play-again-btn");

var firstCard = null;   // first face-up, unmatched card element
var lockBoard = false;  // true while two unmatched cards are showing
var moves = 0;
var matchedPairs = 0;
var timerId = null;
var startTime = 0;
var elapsedSeconds = 0;
var timerStarted = false;

// Fisher-Yates shuffle (in place, returns the same array).
function shuffle(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

function formatTime(totalSeconds) {
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
}

function startTimer() {
  timerStarted = true;
  startTime = Date.now();
  elapsedSeconds = 0;
  timeEl.textContent = formatTime(0);
  timerId = setInterval(function () {
    elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    timeEl.textContent = formatTime(elapsedSeconds);
  }, 250);
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  if (timerStarted) {
    elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    timeEl.textContent = formatTime(elapsedSeconds);
  }
}

// Best = fewest moves; ties broken by fastest time.
function loadBest() {
  try {
    var raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (typeof parsed.moves !== "number" || typeof parsed.time !== "number") return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function showBest() {
  var best = loadBest();
  bestEl.textContent = best
    ? best.moves + " moves · " + formatTime(best.time)
    : "—";
}

function saveBestIfBetter() {
  var best = loadBest();
  var better =
    !best ||
    moves < best.moves ||
    (moves === best.moves && elapsedSeconds < best.time);
  if (better) {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify({ moves: moves, time: elapsedSeconds }));
    } catch (e) {
      // Storage unavailable (e.g. private mode) — the game still works.
    }
  }
  showBest();
  return better;
}

function updateHud() {
  movesEl.textContent = String(moves);
  pairsEl.textContent = matchedPairs + " / " + TOTAL_PAIRS;
}

function buildBoard() {
  // Build the deck as exactly two copies of each symbol, then shuffle it,
  // so every game is winnable by construction (pairs only).
  var deck = shuffle(SYMBOLS.concat(SYMBOLS));
  boardEl.innerHTML = "";

  deck.forEach(function (symbol, index) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    card.dataset.symbol = symbol.glyph;
    card.setAttribute("aria-label", "Card " + (index + 1) + ", face down");

    var inner = document.createElement("span");
    inner.className = "card-inner";

    var back = document.createElement("span");
    back.className = "card-face card-back";
    back.textContent = "◇";
    back.setAttribute("aria-hidden", "true");

    var front = document.createElement("span");
    front.className = "card-face card-front";
    front.textContent = symbol.glyph;
    front.style.color = symbol.color;
    front.setAttribute("aria-hidden", "true");

    inner.appendChild(back);
    inner.appendChild(front);
    card.appendChild(inner);
    card.addEventListener("click", onCardClick);
    boardEl.appendChild(card);
  });
}

function onCardClick(event) {
  var card = event.currentTarget;
  if (lockBoard) return;
  if (card.classList.contains("flipped")) return; // already up or matched

  if (!timerStarted) startTimer();

  card.classList.add("flipped");
  card.setAttribute("aria-label", "Card showing " + card.dataset.symbol);

  if (!firstCard) {
    firstCard = card;
    return;
  }

  // Second card of the pair attempt: that completes one move.
  moves += 1;
  updateHud();

  if (firstCard.dataset.symbol === card.dataset.symbol) {
    firstCard.classList.add("matched");
    card.classList.add("matched");
    firstCard.disabled = true;
    card.disabled = true;
    firstCard = null;
    matchedPairs += 1;
    updateHud();
    if (matchedPairs === TOTAL_PAIRS) onWin();
  } else {
    lockBoard = true;
    var a = firstCard;
    var b = card;
    firstCard = null;
    setTimeout(function () {
      a.classList.remove("flipped");
      b.classList.remove("flipped");
      a.setAttribute("aria-label", "Card, face down");
      b.setAttribute("aria-label", "Card, face down");
      lockBoard = false;
    }, FLIP_BACK_MS);
  }
}

function onWin() {
  stopTimer();
  var isBest = saveBestIfBetter();
  overlayTextEl.textContent =
    "Time: " + formatTime(elapsedSeconds) + " · Moves: " + moves +
    (isBest ? " · New best!" : "");
  overlayEl.classList.add("show");
}

function newGame() {
  stopTimer();
  timerStarted = false;
  elapsedSeconds = 0;
  timeEl.textContent = formatTime(0);
  moves = 0;
  matchedPairs = 0;
  firstCard = null;
  lockBoard = false;
  overlayEl.classList.remove("show");
  updateHud();
  showBest();
  buildBoard();
}

restartBtn.addEventListener("click", newGame);
playAgainBtn.addEventListener("click", newGame);

newGame();
