"use strict";
/*
 * Moonshot — an original lunar-lander physics game.
 *
 * A small lander drifts over jagged moon ground under constant gravity.
 * Fire the main thruster to slow your fall and the side thrusters to
 * slide sideways, but every burn drinks fuel. Set down gently on the
 * one flat pad to score and advance; come in too hot, or touch down
 * anywhere else, and the run ends.
 *
 * Vanilla JavaScript + Canvas 2D. No libraries, no assets — everything
 * is drawn with canvas paths at runtime.
 */
(function () {
  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  var W = 720;              // canvas width  (px)
  var H = 480;              // canvas height (px)

  // Physics (px/s and px/s^2). No damping — velocity carries, purely
  // Newtonian. Thrust comfortably beats gravity so a careful pilot can
  // always recover, but gravity wins fast if you daydream.
  var GRAVITY_BASE = 55;    // downward acceleration, level 1
  var GRAVITY_PER_LEVEL = 4;
  var GRAVITY_MAX = 87;
  var THRUST_MAIN = 135;    // upward acceleration from the main thruster
  var THRUST_SIDE = 72;     // lateral acceleration from a side thruster
  var BURN_MAIN = 14;       // fuel units per second, main thruster
  var BURN_SIDE = 6;        // fuel units per second, one side thruster

  // Safe landing envelope (also printed in the help line on the page).
  var SAFE_VY = 22;         // max |vertical speed| on touchdown, px/s
  var SAFE_VX = 14;         // max |horizontal speed| on touchdown, px/s

  // Level 1 supplies, shrinking as levels advance.
  var FUEL_BASE = 100;
  var FUEL_PER_LEVEL = 8;
  var FUEL_MIN = 52;
  var PAD_W_BASE = 112;     // landing pad width, level 1
  var PAD_W_PER_LEVEL = 10;
  var PAD_W_MIN = 52;

  var LANDER_HALF_W = 13;   // half the lander's body width
  var LANDER_BOTTOM = 15;   // distance from centre to the foot of a leg
  var FOOT_SPAN = 11;       // horizontal distance from centre to each foot

  var BEST_KEY = "arcade-moonshot-best";

  function gravity() { return Math.min(GRAVITY_BASE + (S.level - 1) * GRAVITY_PER_LEVEL, GRAVITY_MAX); }
  function startFuel() { return Math.max(FUEL_BASE - (S.level - 1) * FUEL_PER_LEVEL, FUEL_MIN); }
  function padWidth() { return Math.max(PAD_W_BASE - (S.level - 1) * PAD_W_PER_LEVEL, PAD_W_MIN); }

  // ------------------------------------------------------------------
  // Canvas + HUD elements
  // ------------------------------------------------------------------
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var levelEl = document.getElementById("level");
  var altitudeEl = document.getElementById("altitude");
  var vspeedEl = document.getElementById("vspeed");
  var hspeedEl = document.getElementById("hspeed");
  var fuelEl = document.getElementById("fuel");
  var overlayEl = document.getElementById("overlay");
  var overlayTitleEl = document.getElementById("overlay-title");
  var overlayTextEl = document.getElementById("overlay-text");
  var overlayBtn = document.getElementById("overlay-btn");

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  var S = {
    mode: "playing",      // "playing" | "landed" | "over"
    paused: false,        // only meaningful while mode === "playing"
    time: 0,              // seconds of (unpaused) play this level
    level: 1,
    score: 0,
    best: loadBest(),
    x: W / 2,             // lander centre
    y: 56,
    vx: 0,
    vy: 0,
    fuel: FUEL_BASE,
    terrain: [],          // [{ x, y }] silhouette points, left to right
    padX: 0,              // left edge of the landing pad
    padY: 0,              // surface height of the pad
    padW: PAD_W_BASE,
    stars: [],            // [{ x, y, r }] background starfield
    fireMain: false,      // thrusters firing this frame (for drawing)
    fireLeft: false,
    fireRight: false,
    endAt: -1             // S.time when the level ended (restart lockout)
  };

  var keys = {};          // held-key codes, e.g. keys["ArrowUp"]

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
  // Terrain — one jagged silhouette with one flat pad per level
  // ------------------------------------------------------------------
  function buildLevel() {
    S.padW = padWidth();
    S.padY = 398 + Math.random() * 44;                       // 398..442
    S.padX = 56 + Math.random() * (W - 112 - S.padW);

    // Jagged ridge: a wandering baseline, clamped to the lower sky.
    var pts = [];
    var step = 30;
    var y = 392 + Math.random() * 40;
    for (var x = 0; x <= W; x += step) {
      y += (Math.random() - 0.5) * 52;
      y = Math.max(356, Math.min(462, y));
      pts.push({ x: x, y: y });
    }
    // Flatten every point the pad spans (plus a point at each pad edge,
    // so the flat stretch is exactly the pad, no slope creeping in).
    var flat = [];
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].x > S.padX && pts[i].x < S.padX + S.padW) {
        flat.push({ x: pts[i].x, y: S.padY });
      } else {
        flat.push(pts[i]);
      }
    }
    flat.push({ x: S.padX, y: S.padY });
    flat.push({ x: S.padX + S.padW, y: S.padY });
    flat.sort(function (a, b) { return a.x - b.x; });
    S.terrain = flat;

    // Starfield.
    S.stars = [];
    for (var s = 0; s < 120; s++) {
      S.stars.push({
        x: Math.random() * W,
        y: Math.random() * 330,
        r: Math.random() < 0.18 ? 1.8 : 1
      });
    }

    // Fresh lander near the top, with a gentle sideways drift.
    S.x = 70 + Math.random() * (W - 140);
    if (Math.abs(S.x - (S.padX + S.padW / 2)) < 90) {
      S.x = S.padX < W / 2 ? W - 90 : 90; // don't spawn right over the pad
    }
    S.y = 56;
    S.vx = (Math.random() - 0.5) * 24;
    S.vy = 0;
    S.fuel = startFuel();
    S.time = 0;
    S.endAt = -1;
    S.fireMain = S.fireLeft = S.fireRight = false;
  }

  // Terrain surface height at a given x (linear between points).
  function terrainYAt(x) {
    var t = S.terrain;
    if (x <= t[0].x) return t[0].y;
    for (var i = 1; i < t.length; i++) {
      if (x <= t[i].x) {
        var a = t[i - 1], b = t[i];
        var f = (x - a.x) / (b.x - a.x);
        return a.y + (b.y - a.y) * f;
      }
    }
    return t[t.length - 1].y;
  }

  function onPad() {
    // Both feet must be over the pad for a touchdown to count as on it.
    return (S.x - FOOT_SPAN >= S.padX && S.x + FOOT_SPAN <= S.padX + S.padW);
  }

  // ------------------------------------------------------------------
  // Run control
  // ------------------------------------------------------------------
  function startRun() {
    S.level = 1;
    S.score = 0;
    S.mode = "playing";
    S.paused = false;
    buildLevel();
    hideOverlay();
  }

  function nextLevel() {
    S.level += 1;
    S.mode = "playing";
    S.paused = false;
    buildLevel();
    hideOverlay();
  }

  function showOverlay(title, text, buttonLabel) {
    overlayTitleEl.textContent = title;
    overlayTextEl.textContent = text;
    overlayBtn.textContent = buttonLabel;
    overlayEl.classList.add("show");
  }

  function hideOverlay() {
    overlayEl.classList.remove("show");
  }

  function recordBest() {
    if (S.score > S.best) {
      S.best = S.score;
      saveBest();
    }
  }

  function land() {
    // Score: base for the level + leftover-fuel bonus + a softness
    // bonus that pays out the closer both speeds are to zero.
    var base = 100 + (S.level - 1) * 25;
    var fuelBonus = Math.round(S.fuel) * 2;
    var softness = 1 - (Math.abs(S.vy) / SAFE_VY + Math.abs(S.vx) / SAFE_VX) / 2;
    var softBonus = Math.round(Math.max(0, softness) * 100);
    var gained = base + fuelBonus + softBonus;
    S.score += gained;
    S.mode = "landed";
    S.endAt = S.time;
    S.y = S.padY - LANDER_BOTTOM; // settle onto the pad
    S.vx = 0;
    S.vy = 0;
    recordBest();
    showOverlay(
      "Touchdown! Level " + S.level + " complete",
      "+" + gained + " points (base " + base + " + fuel bonus " + fuelBonus +
        " + soft-landing bonus " + softBonus + "). Total score: " + S.score,
      "Next Level"
    );
  }

  function crash(reason) {
    S.mode = "over";
    S.endAt = S.time;
    recordBest();
    showOverlay(
      "Crashed!",
      reason + " Final score: " + S.score + "  ·  Best: " + S.best,
      "Play Again"
    );
  }

  // The overlay button: advance after a landing, restart after a crash.
  function overlayAction() {
    if (S.mode === "landed") nextLevel();
    else if (S.mode === "over") startRun();
  }

  // ------------------------------------------------------------------
  // Simulation
  // ------------------------------------------------------------------
  function update(dt) {
    if (S.mode !== "playing" || S.paused) return;
    S.time += dt;

    var hasFuel = S.fuel > 0;
    S.fireMain = hasFuel && !!(keys["ArrowUp"] || keys["KeyW"]);
    S.fireLeft = hasFuel && !!(keys["ArrowLeft"] || keys["KeyA"]);
    S.fireRight = hasFuel && !!(keys["ArrowRight"] || keys["KeyD"]);

    // Newtonian physics: gravity always pulls, thrusters push back,
    // and nothing damps the velocity you have built up.
    S.vy += gravity() * dt;
    if (S.fireMain) {
      S.vy -= THRUST_MAIN * dt;
      S.fuel -= BURN_MAIN * dt;
    }
    if (S.fireLeft) {
      S.vx -= THRUST_SIDE * dt;
      S.fuel -= BURN_SIDE * dt;
    }
    if (S.fireRight) {
      S.vx += THRUST_SIDE * dt;
      S.fuel -= BURN_SIDE * dt;
    }
    if (S.fuel < 0) S.fuel = 0;

    S.x += S.vx * dt;
    S.y += S.vy * dt;

    // Walls and ceiling: stop dead against them, no bouncing.
    if (S.x < LANDER_HALF_W) { S.x = LANDER_HALF_W; if (S.vx < 0) S.vx = 0; }
    if (S.x > W - LANDER_HALF_W) { S.x = W - LANDER_HALF_W; if (S.vx > 0) S.vx = 0; }
    if (S.y < LANDER_BOTTOM) { S.y = LANDER_BOTTOM; if (S.vy < 0) S.vy = 0; }

    // Touchdown: the first foot to reach the ground decides it.
    var groundY = Math.min(
      terrainYAt(S.x - FOOT_SPAN),
      terrainYAt(S.x),
      terrainYAt(S.x + FOOT_SPAN)
    );
    if (S.y + LANDER_BOTTOM >= groundY) {
      if (!onPad()) {
        crash("You came down off the landing pad.");
      } else if (Math.abs(S.vy) > SAFE_VY || Math.abs(S.vx) > SAFE_VX) {
        crash("You hit the pad too fast — down at " + Math.round(S.vy) +
          " vertical / " + Math.round(Math.abs(S.vx)) + " horizontal.");
      } else {
        land();
      }
    }
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function draw() {
    // Night sky.
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#070912");
    sky.addColorStop(1, "#141a30");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Stars.
    ctx.fillStyle = "#cfd6f4";
    for (var i = 0; i < S.stars.length; i++) {
      var st = S.stars[i];
      ctx.globalAlpha = st.r > 1 ? 0.95 : 0.55;
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    drawTerrain();
    drawLander();

    if (S.paused) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd54f";
      ctx.font = "700 40px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("Paused", W / 2, H / 2 - 30);
      ctx.fillStyle = "#e8eaf6";
      ctx.font = "400 16px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText("Press P or Esc to resume", W / 2, H / 2 + 2);
    }

    syncHud();
  }

  function drawTerrain() {
    // Filled silhouette.
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (var i = 0; i < S.terrain.length; i++) {
      ctx.lineTo(S.terrain[i].x, S.terrain[i].y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = "#232a47";
    ctx.fill();
    ctx.strokeStyle = "#4a5578";
    ctx.lineWidth = 2;
    ctx.stroke();

    // The pad, drawn over the silhouette in green with gold posts.
    ctx.strokeStyle = "#66bb6a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(S.padX, S.padY);
    ctx.lineTo(S.padX + S.padW, S.padY);
    ctx.stroke();
    ctx.fillStyle = "#ffd54f";
    ctx.fillRect(S.padX - 2, S.padY - 2, 4, 10);
    ctx.fillRect(S.padX + S.padW - 2, S.padY - 2, 4, 10);
    ctx.lineWidth = 1;
  }

  function drawLander() {
    if (S.mode === "over") {
      // Wreck: a burst of debris where the lander came apart.
      ctx.save();
      ctx.translate(S.x, S.y + 6);
      ctx.strokeStyle = "#ff7043";
      ctx.lineWidth = 2;
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
        ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(S.x, S.y);

    // Flames first, so the body draws over their roots. The main flame
    // flickers; side flames point away from the burn direction.
    if (S.mode === "playing" && !S.paused) {
      ctx.fillStyle = "#ff7043";
      if (S.fireMain) {
        var flame = 16 + Math.random() * 12;
        ctx.beginPath();
        ctx.moveTo(-5, 10);
        ctx.lineTo(5, 10);
        ctx.lineTo(0, 10 + flame);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffd54f";
        ctx.beginPath();
        ctx.moveTo(-2.5, 10);
        ctx.lineTo(2.5, 10);
        ctx.lineTo(0, 10 + flame * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = "#ff7043";
      if (S.fireLeft) {  // burning left pushes right-flame out the left side
        ctx.beginPath();
        ctx.moveTo(-11, 2);
        ctx.lineTo(-11, 7);
        ctx.lineTo(-11 - (8 + Math.random() * 5), 4.5);
        ctx.closePath();
        ctx.fill();
      }
      if (S.fireRight) {
        ctx.beginPath();
        ctx.moveTo(11, 2);
        ctx.lineTo(11, 7);
        ctx.lineTo(11 + (8 + Math.random() * 5), 4.5);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Legs.
    ctx.strokeStyle = "#ffd54f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-7, 6);
    ctx.lineTo(-FOOT_SPAN, LANDER_BOTTOM);
    ctx.moveTo(7, 6);
    ctx.lineTo(FOOT_SPAN, LANDER_BOTTOM);
    ctx.moveTo(-FOOT_SPAN - 3, LANDER_BOTTOM);
    ctx.lineTo(-FOOT_SPAN + 3, LANDER_BOTTOM);
    ctx.moveTo(FOOT_SPAN - 3, LANDER_BOTTOM);
    ctx.lineTo(FOOT_SPAN + 3, LANDER_BOTTOM);
    ctx.stroke();

    // Body — a gold wedge with a window.
    ctx.fillStyle = "#ffd54f";
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(11, 2);
    ctx.lineTo(8, 9);
    ctx.lineTo(-8, 9);
    ctx.lineTo(-11, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#10142a";
    ctx.beginPath();
    ctx.arc(0, -4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9fc3ff";
    ctx.beginPath();
    ctx.arc(0, -4, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function speedColour(el, v, safe) {
    el.style.color = Math.abs(v) <= safe ? "#66bb6a" : "#ef5350";
  }

  function syncHud() {
    scoreEl.textContent = String(S.score);
    bestEl.textContent = String(S.best);
    levelEl.textContent = String(S.level);
    var alt = Math.max(0, terrainYAt(S.x) - (S.y + LANDER_BOTTOM));
    altitudeEl.textContent = String(Math.round(alt));
    vspeedEl.textContent = String(Math.round(S.vy));
    hspeedEl.textContent = String(Math.round(S.vx));
    fuelEl.textContent = String(Math.round(S.fuel));
    speedColour(vspeedEl, S.vy, SAFE_VY);
    speedColour(hspeedEl, S.vx, SAFE_VX);
    fuelEl.style.color = S.fuel <= 25 ? "#ef5350" : "";
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
  // Input
  // ------------------------------------------------------------------
  document.addEventListener("keydown", function (e) {
    if (e.code === "ArrowUp" || e.code === "ArrowDown" ||
        e.code === "ArrowLeft" || e.code === "ArrowRight" || e.code === "Space") {
      e.preventDefault(); // keep the page from scrolling under the game
    }
    keys[e.code] = true;

    if (e.code === "KeyP" || e.code === "Escape") {
      if (S.mode === "playing") S.paused = !S.paused;
      return;
    }

    if (e.code === "KeyR" || e.code === "Enter") {
      if (S.mode === "over") {
        startRun(); // the end overlay: R / Enter restarts from level 1
      } else if (S.mode === "landed" && e.code === "Enter") {
        nextLevel();
      } else if (S.mode === "landed" && e.code === "KeyR") {
        startRun();
      }
    }
  });
  document.addEventListener("keyup", function (e) {
    keys[e.code] = false;
  });
  window.addEventListener("blur", function () {
    keys = {}; // a lost keyup shouldn't leave a thruster stuck on
    if (S.mode === "playing") S.paused = true;
  });
  overlayBtn.addEventListener("click", overlayAction);

  // ------------------------------------------------------------------
  // Go
  // ------------------------------------------------------------------
  startRun();
  draw();
  window.requestAnimationFrame(loop);

  // Small handle for automated smoke tests (and curious consoles).
  window.Moonshot = { state: S, startRun: startRun, nextLevel: nextLevel };
})();
