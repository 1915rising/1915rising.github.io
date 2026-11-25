"use strict";

// Keystorm — an original typing game. Vanilla JS, no libraries.
//
// Targeting: typing a letter targets the LOWEST active word (largest y)
// that starts with that letter. Once a word is partly typed it stays the
// target until it is completed or reaches the bottom.
// Scoring: each completed word scores 10 points per letter, so longer
// words are worth more. A floating "+N" popup shows the award.
// WPM: (correct characters typed / 5) / minutes of active (unpaused) play.
// Accuracy: correct keystrokes / total letter keystrokes, as a percentage.
//   Wrong keys include letters typed with no matching/targeted word.
// Persistence: best score in localStorage key "arcade-keystorm-best",
//   best WPM in a second key "arcade-keystorm-bestwpm" (both plain numbers).
// Pause / "P" conflict: Escape always toggles pause. "P" toggles pause
//   ONLY when no word is currently targeted / partly typed (or when the
//   game is already paused, so P can resume). Otherwise "p" is typed as a
//   normal letter into the targeted word.

var WORDS = [
  // 3 letters
  "cat", "dog", "sun", "sky", "sea", "ant", "bee", "cow", "pig", "hen",
  "fox", "owl", "bat", "rat", "web", "net", "box", "toy", "bus", "car",
  "van", "hat", "cup", "pen", "ink", "egg", "key", "map", "red", "run",
  // 4 letters
  "tree", "leaf", "rock", "rain", "snow", "wind", "fire", "star", "moon", "fish",
  "bird", "frog", "bear", "wolf", "lion", "cake", "book", "door", "blue", "ball",
  "kite", "lamp", "milk", "rice", "soup", "road", "lake", "hill", "pond", "ship",
  // 5 letters
  "apple", "river", "cloud", "storm", "beach", "house", "mouse", "horse", "tiger", "zebra",
  "piano", "bread", "water", "light", "night", "plant", "stone", "paper", "lemon", "melon",
  "grape", "peach", "smile", "happy", "dance", "music", "story", "world", "earth", "ocean",
  // 6 letters
  "forest", "guitar", "cheese", "pencil", "garden", "orange", "banana", "window", "bridge", "castle",
  "flower", "summer", "winter", "spring", "autumn", "silver", "golden", "purple", "yellow", "kitten",
  "puppy", "rabbit", "turtle", "monkey", "donkey", "picnic", "basket", "candle", "button", "pocket",
  // 7 letters
  "rainbow", "thunder", "lantern", "morning", "evening", "kitchen", "blanket", "pillow", "journey", "harvest",
  "meadow", "village", "compass", "feather", "popcorn", "muffin", "waffle", "pretzel", "dolphin", "penguin",
  "octopus", "giraffe", "elephant", "kangaroo", "squirrel", "raccoon", "sparrow", "firefly",
  // 8 letters
  "mountain", "waterway", "sunshine", "starfish", "sunlight", "campfire", "snowball", "raindrop", "apricots", "cherries",
  "mulberry", "cinnamon", "zucchini", "discover", "treasure", "umbrella", "backpack", "notebook", "painting", "birthday",
  "holiday", "weekend", "pancakes", "sandwich", "dumpling", "cucumber", "broccoli", "avocado", "hedgehog", "flamingo"
];

var PLAY_W = 720;
var PLAY_H = 440;
var FLOOR = PLAY_H - 30; // a word whose top passes this line has landed

var playEl = document.getElementById("play");
var stageEl = document.getElementById("stage");
var scoreEl = document.getElementById("score");
var bestEl = document.getElementById("best");
var livesEl = document.getElementById("lives");
var streakEl = document.getElementById("streak");
var clearedEl = document.getElementById("cleared");
var bestWpmEl = document.getElementById("best-wpm");
var overlayEl = document.getElementById("overlay");
var overlayTitleEl = document.getElementById("overlay-title");
var overlayTextEl = document.getElementById("overlay-text");
var restartBtn = document.getElementById("restart-btn");

var best = parseInt(localStorage.getItem("arcade-keystorm-best") || "0", 10) || 0;
var bestWpm = parseInt(localStorage.getItem("arcade-keystorm-bestwpm") || "0", 10) || 0;

var state = "idle"; // idle | running | paused | over
var words = [];     // { el, text, typed, x, y, speed }
var target = null;  // the partly-typed word object, or null
var score = 0;
var lives = 3;
var streak = 0;
var cleared = 0;
var totalKeys = 0;
var correctKeys = 0;
var correctChars = 0;
var playMs = 0;     // active (unpaused) play time, for WPM
var spawnTimer = 0; // ms until next spawn
var lastTs = null;
var rafId = null;

function updateHud() {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  livesEl.textContent = String(lives);
  streakEl.textContent = String(streak);
  clearedEl.textContent = String(cleared);
  bestWpmEl.textContent = String(bestWpm);
}

function currentWpm() {
  var minutes = playMs / 60000;
  if (minutes <= 0) return 0;
  return Math.round((correctChars / 5) / minutes);
}

function currentAccuracy() {
  if (totalKeys === 0) return 100;
  return Math.round((correctKeys / totalKeys) * 100);
}

// Difficulty ramps with active play time, capped fairly.
function difficulty() {
  var seconds = playMs / 1000;
  return {
    fallSpeed: Math.min(30 + seconds * 0.55, 95),        // px per second
    spawnEvery: Math.max(700, 1900 - seconds * 20)       // ms between spawns
  };
}

function renderWord(w) {
  var html = "";
  for (var i = 0; i < w.text.length; i++) {
    if (i < w.typed) html += '<span class="done">' + w.text[i] + "</span>";
    else if (i === w.typed && w === target) html += '<span class="next">' + w.text[i] + "</span>";
    else html += "<span>" + w.text[i] + "</span>";
  }
  w.el.innerHTML = html;
  w.el.classList.toggle("targeted", w === target);
}

function spawnWord() {
  var text = WORDS[Math.floor(Math.random() * WORDS.length)];
  var el = document.createElement("div");
  el.className = "word";
  playEl.appendChild(el);
  var w = { el: el, text: text, typed: 0, x: 8, y: -34, speed: 0 };
  var d = difficulty();
  w.speed = d.fallSpeed * (0.85 + Math.random() * 0.3);
  renderWord(w);
  var maxX = Math.max(8, PLAY_W - el.offsetWidth - 8);
  w.x = 8 + Math.random() * (maxX - 8);
  el.style.left = w.x + "px";
  el.style.top = w.y + "px";
  words.push(w);
}

function removeWord(w) {
  var idx = words.indexOf(w);
  if (idx !== -1) words.splice(idx, 1);
  if (target === w) target = null;
  if (w.el.parentNode) w.el.parentNode.removeChild(w.el);
}

function showPopup(x, y, text) {
  var el = document.createElement("div");
  el.className = "popup";
  el.textContent = text;
  el.style.left = x + "px";
  el.style.top = y + "px";
  playEl.appendChild(el);
  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 850);
}

function flashEdge() {
  playEl.classList.add("flash");
  setTimeout(function () { playEl.classList.remove("flash"); }, 260);
}

function shakeWord(w) {
  if (!w) return;
  w.el.classList.remove("shake");
  void w.el.offsetWidth; // restart the animation
  w.el.classList.add("shake");
  setTimeout(function () { w.el.classList.remove("shake"); }, 240);
}

function completeWord(w) {
  var gained = w.text.length * 10;
  score += gained;
  cleared += 1;
  streak += 1;
  showPopup(w.x, w.y, "+" + gained);
  removeWord(w);
  updateHud();
}

function wordLanded(w) {
  removeWord(w);
  lives -= 1;
  streak = 0;
  flashEdge();
  updateHud();
  if (lives <= 0) gameOver();
}

function handleLetter(ch) {
  totalKeys += 1;
  if (target) {
    if (target.text[target.typed] === ch) {
      correctKeys += 1;
      correctChars += 1;
      target.typed += 1;
      if (target.typed >= target.text.length) completeWord(target);
      else renderWord(target);
    } else {
      streak = 0;
      shakeWord(target);
      updateHud();
    }
    return;
  }
  // No current target: pick the LOWEST word starting with this letter.
  var bestMatch = null;
  for (var i = 0; i < words.length; i++) {
    if (words[i].text[0] === ch && (!bestMatch || words[i].y > bestMatch.y)) {
      bestMatch = words[i];
    }
  }
  if (bestMatch) {
    correctKeys += 1;
    correctChars += 1;
    target = bestMatch;
    target.typed = 1;
    if (target.typed >= target.text.length) completeWord(target);
    else renderWord(target);
  } else {
    streak = 0;
    updateHud();
  }
}

function loop(ts) {
  if (state !== "running") { rafId = null; lastTs = null; return; }
  if (lastTs === null) lastTs = ts;
  var dt = Math.min(ts - lastTs, 100); // clamp tab-switch jumps
  lastTs = ts;
  playMs += dt;

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnWord();
    spawnTimer = difficulty().spawnEvery;
  }

  var landed = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    w.y += (w.speed * dt) / 1000;
    w.el.style.top = w.y + "px";
    if (w.y >= FLOOR) landed.push(w);
  }
  for (var j = 0; j < landed.length; j++) {
    if (state !== "running") break; // gameOver() may have fired mid-loop
    wordLanded(landed[j]);
  }

  if (state === "running") rafId = requestAnimationFrame(loop);
  else { rafId = null; lastTs = null; }
}

function startLoop() {
  if (rafId === null) {
    lastTs = null;
    rafId = requestAnimationFrame(loop);
  }
}

function showOverlay(title, text, buttonText) {
  overlayTitleEl.textContent = title;
  overlayTextEl.textContent = text;
  restartBtn.textContent = buttonText;
  overlayEl.classList.add("show");
}

function hideOverlay() {
  overlayEl.classList.remove("show");
}

function startGame() {
  for (var i = words.length - 1; i >= 0; i--) removeWord(words[i]);
  words = [];
  target = null;
  score = 0;
  lives = 3;
  streak = 0;
  cleared = 0;
  totalKeys = 0;
  correctKeys = 0;
  correctChars = 0;
  playMs = 0;
  spawnTimer = 350; // first word arrives almost immediately
  state = "running";
  hideOverlay();
  updateHud();
  startLoop();
}

function pauseGame() {
  if (state !== "running") return;
  state = "paused";
  showOverlay("Paused", "Take a breath — the storm is holding.\nPress Esc or P to resume, or start fresh below.", "Resume");
}

function resumeGame() {
  if (state !== "paused") return;
  state = "running";
  hideOverlay();
  startLoop();
}

function gameOver() {
  state = "over";
  var wpm = currentWpm();
  var acc = currentAccuracy();
  if (score > best) {
    best = score;
    localStorage.setItem("arcade-keystorm-best", String(best));
  }
  if (wpm > bestWpm) {
    bestWpm = wpm;
    localStorage.setItem("arcade-keystorm-bestwpm", String(bestWpm));
  }
  updateHud();
  showOverlay(
    "Game Over",
    "Final score: " + score + "\n" +
    "Words cleared: " + cleared + "\n" +
    "Speed: " + wpm + " WPM\n" +
    "Accuracy: " + acc + "%",
    "Play Again"
  );
}

restartBtn.addEventListener("click", function () {
  if (state === "paused") resumeGame();
  else startGame();
  restartBtn.blur(); // keep keystrokes aimed at the game, not the button
});

document.addEventListener("keydown", function (e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === "Escape") {
    if (state === "running") { pauseGame(); e.preventDefault(); }
    else if (state === "paused") { resumeGame(); e.preventDefault(); }
    return;
  }

  if (state === "idle") {
    // First keypress starts the game (that key itself is not typed).
    startGame();
    e.preventDefault();
    return;
  }

  if (state === "over") {
    if (e.key === "Enter") startGame();
    return;
  }

  if (state === "paused") {
    if (e.key === "p" || e.key === "P" || e.key === "Enter") resumeGame();
    return;
  }

  // state === "running"
  // "P" pauses only when no word is partly typed; otherwise it types.
  if ((e.key === "p" || e.key === "P") && !target) {
    pauseGame();
    e.preventDefault();
    return;
  }
  if (e.key.length === 1) {
    var ch = e.key.toLowerCase();
    if (ch >= "a" && ch <= "z") {
      handleLetter(ch);
      e.preventDefault();
    }
  }
});

updateHud();
