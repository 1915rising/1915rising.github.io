"use strict";
/*
 * Skyflap — an original one-button flying game.
 *
 * A little sky-skiff falls under gravity. Tap, click, or press Space to
 * flap upward. Thread it through the scrolling gates: each gate cleared
 * is +1. Clip a gate, the ground, or the ceiling and the run ends.
 *
 * Vanilla JavaScript + Canvas 2D. No libraries, no assets — everything
 * is drawn with canvas paths at runtime.
 */
(function () {
  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  var W = 420;            // canvas width  (CSS pixels)
  var H = 640;            // canvas height (CSS pixels)
  var GROUND_H = 56;      // height of the ground strip at the bottom
  var SKY_H = H - GROUND_H;

  var BIRD_X = 96;        // the skiff never moves horizontally
  var BIRD_R = 15;        // collision radius
  var GRAVITY = 1500;     // downward acceleration, px/s^2
  var FLAP_VY = -470;     // upward velocity granted by one flap, px/s
  var MAX_FALL = 800;     // terminal fall speed, px/s

  var GATE_W = 72;        // gate pillar width
  var GATE_GAP = 154;     // vertical opening between the pillars
  var GATE_SPEED = 172;   // leftward scroll speed, px/s
  var GATE_EVERY = 1.45;  // seconds between new gates

  var BEST_KEY = "skyflap-best";

  // ------------------------------------------------------------------
  // Canvas + HUD elements
  // ------------------------------------------------------------------
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  var S = {
    mode: "ready",        // "ready" | "playing" | "over"
    time: 0,              // seconds since this run state began
    birdY: SKY_H / 2,
    birdVy: 0,
    tilt: 0,              // nose angle for drawing, radians
    gates: [],            // { x, gapCenter, scored }
    spawnIn: 0,           // seconds until the next gate spawns
    score: 0,
    best: loadBest(),
    overAt: -1            // S.time when the run ended (restart lockout)
  };

  function loadBest() {
    try {
      var v = parseInt(window.localStorage.getItem(BEST_KEY), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) {
      return 0; // storage unavailable (private mode, file://, ...)
    }
  }

  function saveBest() {
    try {
      window.localStorage.setItem(BEST_KEY, String(S.best));
    } catch (e) { /* keeping the best score is best-effort */ }
  }

  // ------------------------------------------------------------------
  // Run control
  // ------------------------------------------------------------------
  function reset() {
    S.mode = "ready";
    S.time = 0;
    S.birdY = SKY_H / 2;
    S.birdVy = 0;
    S.tilt = 0;
    S.gates = [];
    S.spawnIn = 0.6;      // first gate arrives quickly
    S.score = 0;
    S.overAt = -1;
  }

  function flap() {
    if (S.mode === "ready") {
      S.mode = "playing";
      S.birdVy = FLAP_VY;
    } else if (S.mode === "playing") {
      S.birdVy = FLAP_VY;
    } else if (S.mode === "over") {
      // Small lockout so the tap that killed you doesn't instantly restart.
      if (S.time - S.overAt >= 0.4) {
        reset();
        S.mode = "playing";
        S.birdVy = FLAP_VY;
      }
    }
  }

  function gameOver() {
    S.mode = "over";
    S.overAt = S.time;
    if (S.score > S.best) {
      S.best = S.score;
      saveBest();
    }
  }

  // ------------------------------------------------------------------
  // Simulation
  // ------------------------------------------------------------------
  function spawnGate() {
    var margin = 70;
    var half = GATE_GAP / 2;
    var center = margin + half + Math.random() * (SKY_H - 2 * margin - GATE_GAP);
    S.gates.push({ x: W + 10, gapCenter: center, scored: false });
  }

  function update(dt) {
    S.time += dt;
    if (S.mode !== "playing") return;

    // Bird physics: gravity, capped fall speed, nose tilt follows velocity.
    S.birdVy = Math.min(S.birdVy + GRAVITY * dt, MAX_FALL);
    S.birdY += S.birdVy * dt;
    S.tilt = Math.max(-0.45, Math.min(1.15, S.birdVy / 700));

    // Gates: spawn on a timer, scroll left, drop once fully off-screen.
    S.spawnIn -= dt;
    if (S.spawnIn <= 0) {
      spawnGate();
      S.spawnIn = GATE_EVERY;
    }
    for (var i = S.gates.length - 1; i >= 0; i--) {
      var g = S.gates[i];
      g.x -= GATE_SPEED * dt;
      if (!g.scored && g.x + GATE_W < BIRD_X - BIRD_R) {
        g.scored = true;
        S.score += 1;
      }
      if (g.x + GATE_W < 0) S.gates.splice(i, 1);
    }

    if (hitsSomething()) gameOver();
  }

  function hitsSomething() {
    // Ceiling and ground.
    if (S.birdY - BIRD_R <= 0) return true;
    if (S.birdY + BIRD_R >= SKY_H) return true;
    // Gates: circle vs. the two pillar rectangles.
    for (var i = 0; i < S.gates.length; i++) {
      var g = S.gates[i];
      if (BIRD_X + BIRD_R < g.x || BIRD_X - BIRD_R > g.x + GATE_W) continue;
      var gapTop = g.gapCenter - GATE_GAP / 2;
      var gapBottom = g.gapCenter + GATE_GAP / 2;
      if (S.birdY - BIRD_R < gapTop || S.birdY + BIRD_R > gapBottom) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function draw() {
    // Sky.
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#0b0e1a");
    sky.addColorStop(1, "#182036");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    drawGates();
    drawGround();
    drawBird();

    // In-canvas prompts for the non-playing states.
    ctx.textAlign = "center";
    if (S.mode === "ready") {
      ctx.fillStyle = "#e8eaf6";
      ctx.font = "600 22px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("Click or press Space to flap", W / 2, SKY_H / 2 - 64);
    } else if (S.mode === "over") {
      ctx.fillStyle = "#ffd54f";
      ctx.font = "700 40px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("Game Over", W / 2, SKY_H / 2 - 40);
      ctx.fillStyle = "#e8eaf6";
      ctx.font = "600 20px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("Score " + S.score + "  ·  Best " + S.best, W / 2, SKY_H / 2);
      ctx.font = "400 16px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("Flap to fly again", W / 2, SKY_H / 2 + 30);
    }

    // Keep the HTML score readout in sync.
    scoreEl.textContent = String(S.score);
    bestEl.textContent = String(S.best);
  }

  function drawGates() {
    for (var i = 0; i < S.gates.length; i++) {
      var g = S.gates[i];
      var gapTop = g.gapCenter - GATE_GAP / 2;
      var gapBottom = g.gapCenter + GATE_GAP / 2;
      pillar(g.x, 0, gapTop);
      pillar(g.x, gapBottom, SKY_H - gapBottom);
    }
  }

  function pillar(x, y, h) {
    if (h <= 0) return;
    ctx.fillStyle = "#2e7d4f";
    ctx.fillRect(x, y, GATE_W, h);
    ctx.fillStyle = "#43a465";
    ctx.fillRect(x, y, 10, h); // lit edge
    // Gold cap on the end that faces the gap.
    ctx.fillStyle = "#ffd54f";
    if (y === 0) ctx.fillRect(x - 3, y + h - 16, GATE_W + 6, 16);
    else ctx.fillRect(x - 3, y, GATE_W + 6, 16);
  }

  function drawGround() {
    ctx.fillStyle = "#141a2e";
    ctx.fillRect(0, SKY_H, W, GROUND_H);
    ctx.fillStyle = "#ffd54f";
    ctx.fillRect(0, SKY_H, W, 3);
  }

  function drawBird() {
    ctx.save();
    ctx.translate(BIRD_X, S.birdY);
    ctx.rotate(S.tilt);

    // Hull — a little sky-skiff drawn from paths.
    ctx.fillStyle = "#ffd54f";
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.quadraticCurveTo(8, -13, -10, -11);
    ctx.quadraticCurveTo(-20, -8, -18, 0);
    ctx.quadraticCurveTo(-20, 9, -8, 12);
    ctx.quadraticCurveTo(10, 13, 20, 0);
    ctx.fill();

    // Wing, flapping with time while a run is live.
    var wingLift = S.mode === "playing" ? Math.sin(S.time * 26) * 4 : 0;
    ctx.fillStyle = "#ffb300";
    ctx.beginPath();
    ctx.moveTo(-2, 2);
    ctx.quadraticCurveTo(-14, 8 + wingLift, -20, 14 + wingLift);
    ctx.quadraticCurveTo(-8, 14, 2, 9);
    ctx.closePath();
    ctx.fill();

    // Eye.
    ctx.fillStyle = "#0b0e1a";
    ctx.beginPath();
    ctx.arc(9, -4, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Main loop — requestAnimationFrame with a clamped timestep
  // ------------------------------------------------------------------
  var lastTs = null;
  function loop(ts) {
    if (lastTs === null) lastTs = ts;
    var dt = Math.min((ts - lastTs) / 1000, 0.033);
    lastTs = ts;
    update(dt);
    draw();
    window.requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------
  // Input — keyboard, mouse, and touch all just flap
  // ------------------------------------------------------------------
  function onFlapInput(e) {
    if (e && e.preventDefault) e.preventDefault();
    flap();
  }

  document.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      onFlapInput(e);
    }
  });
  canvas.addEventListener("pointerdown", onFlapInput);
  canvas.addEventListener("touchstart", onFlapInput, { passive: false });

  // ------------------------------------------------------------------
  // Go
  // ------------------------------------------------------------------
  reset();
  draw();
  window.requestAnimationFrame(loop);

  // Small handle for automated smoke tests (and curious consoles).
  window.Skyflap = { state: S, flap: flap, reset: reset };
})();
