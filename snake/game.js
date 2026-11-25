"use strict";

/*
 * Snake — a small original canvas game for the 1915 Arcade.
 *
 * How it is put together:
 *   1. Board constants and game state
 *   2. Food placement
 *   3. One fixed-step update (the heart of the game)
 *   4. Rendering
 *   5. Input (keyboard + button)
 *   6. The requestAnimationFrame loop that feeds the fixed steps
 *
 * The update step is kept separate from the animation loop so the game
 * logic can be driven on its own (handy for testing and for keeping the
 * snake's speed independent of the display's refresh rate).
 */

(function () {
  // ------------------------------------------------------------------
  // 1. Constants and state
  // ------------------------------------------------------------------
  var COLS = 20;              // board width, in cells
  var ROWS = 20;              // board height, in cells
  var CELL = 24;              // pixel size of one cell (canvas is 480x480)

  var START_LENGTH = 3;
  var START_STEP_MS = 150;    // time between moves at the start
  var MIN_STEP_MS = 70;       // fastest the snake is allowed to move
  var STEP_SHRINK_MS = 3;     // each apple shaves this much off the step
  var POINTS_PER_APPLE = 10;

  var PHASE_READY = "ready";      // waiting for the first move key
  var PHASE_PLAYING = "playing";
  var PHASE_PAUSED = "paused";
  var PHASE_OVER = "over";

  var state = null;   // built by resetGame()

  // Best score, persisted in localStorage (falls back to 0 / in-memory
  // when storage is unavailable, e.g. private mode or a headless test).
  var BEST_KEY = "arcade-snake-best";

  function loadBest() {
    try {
      if (typeof localStorage !== "undefined") {
        var saved = parseInt(localStorage.getItem(BEST_KEY), 10);
        if (!isNaN(saved) && saved > 0) return saved;
      }
    } catch (e) { /* storage unavailable: fall through to 0 */ }
    return 0;
  }

  function saveBest() {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(BEST_KEY, String(best));
      }
    } catch (e) { /* storage unavailable: best stays in memory */ }
  }

  var best = loadBest();

  function resetGame() {
    var midY = Math.floor(ROWS / 2);
    var startX = Math.floor(COLS / 2);
    var body = [];
    for (var i = 0; i < START_LENGTH; i++) {
      body.push({ x: startX - i, y: midY });   // head first, tail last
    }
    state = {
      snake: body,
      dir: { x: 1, y: 0 },          // moving right
      dirQueue: [],                  // turns waiting for the next step
      food: null,
      score: 0,
      stepMs: START_STEP_MS,
      phase: PHASE_READY,
      grown: 0,                      // segments owed by apples just eaten
      popups: []                     // floating "+10" score popups
    };
    placeFood();
  }

  // ------------------------------------------------------------------
  // 2. Food placement — pick a random empty cell
  // ------------------------------------------------------------------
  function cellTaken(x, y) {
    for (var i = 0; i < state.snake.length; i++) {
      if (state.snake[i].x === x && state.snake[i].y === y) return true;
    }
    return false;
  }

  function placeFood() {
    var empty = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (!cellTaken(x, y)) empty.push({ x: x, y: y });
      }
    }
    if (empty.length === 0) {        // board is completely full: a win
      state.food = null;
      endGame(true);
      return;
    }
    state.food = empty[Math.floor(Math.random() * empty.length)];
  }

  // ------------------------------------------------------------------
  // 3. The fixed update step
  // ------------------------------------------------------------------
  function queueDirection(x, y) {
    // Compare against the last queued (or current) direction so the
    // player cannot reverse the snake into itself within one step.
    var last = state.dirQueue.length > 0
      ? state.dirQueue[state.dirQueue.length - 1]
      : state.dir;
    if (last.x === -x && last.y === -y) return;   // no 180-degree turns
    if (last.x === x && last.y === y) return;     // already heading there
    if (state.dirQueue.length < 3) state.dirQueue.push({ x: x, y: y });
  }

  function stepOnce() {
    if (state.phase !== PHASE_PLAYING) return;

    if (state.dirQueue.length > 0) {
      state.dir = state.dirQueue.shift();
    }

    var head = state.snake[0];
    var nx = head.x + state.dir.x;
    var ny = head.y + state.dir.y;

    // Wall collision.
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      endGame(false);
      return;
    }

    // Self collision. The tail cell is about to move away, so it only
    // counts as an obstacle when the snake is growing this step.
    var willGrow = state.grown > 0 ||
      (state.food !== null && nx === state.food.x && ny === state.food.y);
    var limit = willGrow ? state.snake.length : state.snake.length - 1;
    for (var i = 0; i < limit; i++) {
      if (state.snake[i].x === nx && state.snake[i].y === ny) {
        endGame(false);
        return;
      }
    }

    state.snake.unshift({ x: nx, y: ny });

    if (state.food !== null && nx === state.food.x && ny === state.food.y) {
      state.score += POINTS_PER_APPLE;
      state.grown += 1;
      state.stepMs = Math.max(MIN_STEP_MS, state.stepMs - STEP_SHRINK_MS);
      state.popups.push({
        x: nx, y: ny,
        text: "+" + POINTS_PER_APPLE,
        born: nowMs()
      });
      placeFood();
    }

    if (state.grown > 0) {
      state.grown -= 1;              // keep the tail: snake gets longer
    } else {
      state.snake.pop();             // normal move: tail follows along
    }
  }

  function nowMs() {
    return (typeof performance !== "undefined" && performance.now)
      ? performance.now()
      : Date.now();
  }

  function endGame(won) {
    state.phase = PHASE_OVER;
    state.won = won;
    if (state.score > best) {
      best = state.score;
      saveBest();
    }
    showOverlay(won);
    syncHud();
  }

  // ------------------------------------------------------------------
  // 4. Rendering
  // ------------------------------------------------------------------
  var canvas = null;
  var ctx = null;

  function drawCell(x, y, colour, inset) {
    var pad = inset || 1;
    ctx.fillStyle = colour;
    ctx.fillRect(x * CELL + pad, y * CELL + pad, CELL - pad * 2, CELL - pad * 2);
  }

  function render() {
    if (!ctx) return;
    // Board background with a faint checkerboard so movement reads well.
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#10142a" : "#121733";
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }

    // Food: a gold apple with a small highlight.
    if (state.food) {
      drawCell(state.food.x, state.food.y, "#ffd54f", 3);
      ctx.fillStyle = "#fff3c4";
      ctx.fillRect(state.food.x * CELL + 6, state.food.y * CELL + 6, 5, 5);
    }

    // Snake: pale tail fading to a bright green head.
    for (var i = state.snake.length - 1; i >= 0; i--) {
      var seg = state.snake[i];
      if (i === 0) {
        drawCell(seg.x, seg.y, "#69f0ae", 1);
        // Eyes, offset toward the direction of travel.
        ctx.fillStyle = "#0b0e1a";
        var ex = seg.x * CELL + CELL / 2 + state.dir.x * 3;
        var ey = seg.y * CELL + CELL / 2 + state.dir.y * 3;
        var px = state.dir.y !== 0 ? 5 : 0;   // eye spread perpendicular
        var py = state.dir.x !== 0 ? 5 : 0;
        ctx.fillRect(ex - px - 2, ey - py - 2, 4, 4);
        ctx.fillRect(ex + px - 2, ey + py - 2, 4, 4);
      } else {
        var shade = i % 2 === 0 ? "#2e7d32" : "#388e3c";
        drawCell(seg.x, seg.y, shade, 2);
      }
    }

    // Score popups: float up from the eaten apple and fade out.
    if (state.popups && state.popups.length > 0) {
      var popupNow = nowMs();
      var POPUP_LIFE_MS = 700;
      ctx.font = "bold 14px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      for (var p = state.popups.length - 1; p >= 0; p--) {
        var popup = state.popups[p];
        var popupAge = popupNow - popup.born;
        if (popupAge >= POPUP_LIFE_MS) {
          state.popups.splice(p, 1);
          continue;
        }
        var popupT = popupAge / POPUP_LIFE_MS;
        ctx.globalAlpha = 1 - popupT;
        ctx.fillStyle = "#ffd54f";
        ctx.fillText(popup.text,
          popup.x * CELL + CELL / 2,
          popup.y * CELL - 2 - popupT * 14);
      }
      ctx.globalAlpha = 1;
    }

    if (state.phase === PHASE_PAUSED) {
      ctx.fillStyle = "rgba(8, 10, 22, 0.65)";
      ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
      ctx.fillStyle = "#ffd54f";
      ctx.font = "bold 34px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", (COLS * CELL) / 2, (ROWS * CELL) / 2);
    }

    if (state.phase === PHASE_READY) {
      ctx.fillStyle = "#9fa8c9";
      ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Press an arrow key or WASD to start",
        (COLS * CELL) / 2, (ROWS * CELL) - 14);
    }
  }

  // ------------------------------------------------------------------
  // 5. HUD and overlay wiring
  // ------------------------------------------------------------------
  var scoreEl = null, bestEl = null, lengthEl = null;
  var overlayEl = null, overlayTitleEl = null, overlayTextEl = null;

  function syncHud() {
    if (scoreEl) scoreEl.textContent = String(state.score);
    if (bestEl) bestEl.textContent = String(best);
    if (lengthEl) lengthEl.textContent = String(state.snake.length);
  }

  function showOverlay(won) {
    if (!overlayEl) return;
    overlayTitleEl.textContent = won ? "You Filled the Board!" : "Game Over";
    overlayTextEl.textContent =
      "Score: " + state.score + " · Length: " + state.snake.length +
      " · Best: " + best;
    overlayEl.classList.add("show");
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.classList.remove("show");
  }

  function restart() {
    resetGame();
    hideOverlay();
    syncHud();
    render();
  }

  function togglePause() {
    if (state.phase === PHASE_PLAYING) {
      state.phase = PHASE_PAUSED;
    } else if (state.phase === PHASE_PAUSED) {
      state.phase = PHASE_PLAYING;
    }
    render();
  }

  // ------------------------------------------------------------------
  // 6. Input
  // ------------------------------------------------------------------
  var KEY_DIRS = {
    ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 }
  };

  function onKeyDown(event) {
    var code = event.code || "";
    if (KEY_DIRS[code]) {
      if (event.preventDefault) event.preventDefault();
      if (state.phase === PHASE_OVER) return;
      if (state.phase === PHASE_PAUSED) return;
      queueDirection(KEY_DIRS[code].x, KEY_DIRS[code].y);
      if (state.phase === PHASE_READY) state.phase = PHASE_PLAYING;
      return;
    }
    if (code === "KeyP" || code === "Escape") {
      togglePause();
    } else if (code === "KeyR" || code === "Enter") {
      if (state.phase === PHASE_OVER || state.phase === PHASE_PAUSED) restart();
    }
  }

  // Touch input: swipe on the board to steer (same no-reverse rule as
  // the keyboard, via queueDirection); a tap restarts from game over.
  var touchStartX = null;
  var touchStartY = null;
  var SWIPE_MIN_PX = 24;

  function onTouchStart(event) {
    if (event.preventDefault) event.preventDefault();
    var touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }

  function onTouchMove(event) {
    // Stop the page scrolling while playing on the board.
    if (event.preventDefault) event.preventDefault();
  }

  function onTouchEnd(event) {
    if (event.preventDefault) event.preventDefault();
    if (touchStartX === null || touchStartY === null) return;
    var touch = event.changedTouches && event.changedTouches[0];
    var startX = touchStartX;
    var startY = touchStartY;
    touchStartX = null;
    touchStartY = null;
    if (!touch) return;

    var dx = touch.clientX - startX;
    var dy = touch.clientY - startY;
    var adx = Math.abs(dx);
    var ady = Math.abs(dy);

    if (Math.max(adx, ady) < SWIPE_MIN_PX) {
      // A tap: restart when the game-over overlay is shown.
      if (state.phase === PHASE_OVER) restart();
      return;
    }

    if (state.phase === PHASE_OVER) return;
    if (state.phase === PHASE_PAUSED) return;
    if (adx > ady) {
      queueDirection(dx > 0 ? 1 : -1, 0);
    } else {
      queueDirection(0, dy > 0 ? 1 : -1);
    }
    if (state.phase === PHASE_READY) state.phase = PHASE_PLAYING;
  }

  // ------------------------------------------------------------------
  // 7. Main loop — fixed timestep fed by requestAnimationFrame
  // ------------------------------------------------------------------
  var lastTime = 0;
  var accumulator = 0;

  function frame(timestamp) {
    if (!lastTime) lastTime = timestamp;
    var elapsed = timestamp - lastTime;
    lastTime = timestamp;
    if (elapsed > 250) elapsed = 250;   // tab was away; don't lurch

    if (state.phase === PHASE_PLAYING) {
      accumulator += elapsed;
      while (accumulator >= state.stepMs) {
        accumulator -= state.stepMs;
        stepOnce();
        if (state.phase !== PHASE_PLAYING) { accumulator = 0; break; }
      }
    }
    syncHud();
    render();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------
  // Boot: grab the DOM, wire events, start the loop
  // ------------------------------------------------------------------
  function init() {
    canvas = document.getElementById("game");
    if (canvas && canvas.getContext) ctx = canvas.getContext("2d");
    scoreEl = document.getElementById("score");
    bestEl = document.getElementById("best");
    lengthEl = document.getElementById("length");
    overlayEl = document.getElementById("overlay");
    overlayTitleEl = document.getElementById("overlay-title");
    overlayTextEl = document.getElementById("overlay-text");

    var restartBtn = document.getElementById("restart-btn");
    if (restartBtn && restartBtn.addEventListener) {
      restartBtn.addEventListener("click", restart);
    }
    document.addEventListener("keydown", onKeyDown);

    if (canvas && canvas.addEventListener) {
      var touchOpts = { passive: false };
      canvas.addEventListener("touchstart", onTouchStart, touchOpts);
      canvas.addEventListener("touchmove", onTouchMove, touchOpts);
      canvas.addEventListener("touchend", onTouchEnd, touchOpts);
    }
    // The overlay covers the canvas on game over, so it needs the tap
    // handlers too for tap-to-restart to land there.
    if (overlayEl && overlayEl.addEventListener) {
      overlayEl.addEventListener("touchstart", onTouchStart, { passive: false });
      overlayEl.addEventListener("touchend", onTouchEnd, { passive: false });
    }

    resetGame();
    syncHud();
    render();
    requestAnimationFrame(frame);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  // Small public handle — used by the page if ever needed, and by the
  // headless smoke test to drive the real game logic.
  var api = {
    start: restart,
    snapshot: function () {
      return {
        phase: state.phase,
        score: state.score,
        best: best,
        length: state.snake.length,
        head: { x: state.snake[0].x, y: state.snake[0].y },
        dir: { x: state.dir.x, y: state.dir.y },
        food: state.food ? { x: state.food.x, y: state.food.y } : null,
        stepMs: state.stepMs
      };
    },
    pressKey: function (code) { onKeyDown({ code: code, preventDefault: function () {} }); },
    stepOnce: stepOnce,
    placeFoodAt: function (x, y) { state.food = { x: x, y: y }; },
    togglePause: togglePause
  };
  if (typeof window !== "undefined") window.SnakeGame = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
