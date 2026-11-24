"use strict";

/* =====================================================================
   SPRINT — an endless runner.
   You auto-run along the ground. Jump the blocks, duck the bars.
   The world speeds up the farther you get. One hit ends the run.

   Plain Canvas 2D, no libraries, no assets: the runner and the
   obstacles are all simple shapes drawn at runtime.

   Sections:
     1. Constants & canvas
     2. Input
     3. Runner
     4. Obstacles
     5. State & run control
     6. Update logic
     7. Rendering
     8. Main loop
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. Constants & canvas
   --------------------------------------------------------------------- */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const VIEW_W = canvas.width;          // 800
const VIEW_H = canvas.height;         // 300
const GROUND_Y = VIEW_H - 52;         // y of the ground surface

const GRAVITY = 2400;                 // px/s^2 pulling the runner down
const JUMP_VELOCITY = 880;            // px/s initial upward speed
const JUMP_HOLD_TIME = 0.18;          // s of reduced gravity while held
const JUMP_HOLD_GRAVITY = 0.32;       // gravity multiplier during hold
const FAST_FALL = 2600;               // extra px/s^2 when ducking mid-air

const START_SPEED = 330;              // px/s world scroll at run start
const MAX_SPEED = 760;                // px/s scroll cap
const SPEED_RAMP = 6.5;               // px/s gained per second survived

const PX_PER_METER = 46;              // distance score conversion

/* ---------------------------------------------------------------------
   2. Input
   A Set of currently held key codes, plus a one-shot "pressed" set
   consumed by the update step each frame.
   --------------------------------------------------------------------- */

const held = new Set();
const pressed = new Set();

const JUMP_KEYS = ["Space", "ArrowUp", "KeyW"];
const DUCK_KEYS = ["ArrowDown", "KeyS"];

function onKeyDown(e) {
  if (JUMP_KEYS.includes(e.code) || DUCK_KEYS.includes(e.code)) {
    e.preventDefault();
  }
  if (!e.repeat) pressed.add(e.code);
  held.add(e.code);
}

function onKeyUp(e) {
  held.delete(e.code);
}

function onPointerDown(e) {
  e.preventDefault();
  pressed.add("Space");
  held.add("Space");
}

function onPointerUp() {
  held.delete("Space");
}

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
canvas.addEventListener("mousedown", onPointerDown);
window.addEventListener("mouseup", onPointerUp);
canvas.addEventListener("touchstart", onPointerDown, { passive: false });
window.addEventListener("touchend", onPointerUp);

function jumpHeld() {
  return JUMP_KEYS.some((k) => held.has(k));
}

function duckHeld() {
  return DUCK_KEYS.some((k) => held.has(k));
}

function jumpPressed() {
  return JUMP_KEYS.some((k) => pressed.has(k));
}

/* ---------------------------------------------------------------------
   3. Runner
   Fixed x position; the world scrolls past. Height changes when
   ducking, which is what lets it slip under floating bars.
   --------------------------------------------------------------------- */

const RUNNER_X = 120;
const RUNNER_W = 26;
const RUNNER_H_STAND = 46;
const RUNNER_H_DUCK = 27;

const runner = {
  y: 0,               // height of the runner's feet above the ground
  vy: 0,              // vertical velocity, px/s (up is positive)
  grounded: true,
  ducking: false,
  jumpHold: 0,        // time spent in the variable-jump hold window
  runPhase: 0,        // leg-swing animation phase

  height() {
    return this.ducking ? RUNNER_H_DUCK : RUNNER_H_STAND;
  },

  // Axis-aligned hitbox in world coordinates (y grows downward).
  box() {
    const h = this.height();
    return {
      x: RUNNER_X + 3,
      y: GROUND_Y - this.y - h,
      w: RUNNER_W - 6,
      h: h,
    };
  },

  jump() {
    this.vy = JUMP_VELOCITY;
    this.grounded = false;
    this.ducking = false;
    this.jumpHold = 0;
  },

  reset() {
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.ducking = false;
    this.jumpHold = 0;
    this.runPhase = 0;
  },
};

/* ---------------------------------------------------------------------
   4. Obstacles
   Two kinds:
     - "block": sits on the ground, jump it.
     - "bar":   floats at head height; a standing runner hits it,
                a ducking runner passes underneath.
   --------------------------------------------------------------------- */

let obstacles = [];
let spawnTimer = 0;

function spawnObstacle(speed) {
  const kind = Math.random() < 0.62 ? "block" : "bar";
  if (kind === "block") {
    const w = 24 + Math.random() * 22;
    const h = 28 + Math.random() * 26;
    obstacles.push({ kind, x: VIEW_W + 40, w, h });
  } else {
    const w = 46 + Math.random() * 30;
    const h = 13;
    // Bottom edge sits between duck height and stand height.
    const clearance = RUNNER_H_DUCK + 9;
    obstacles.push({ kind, x: VIEW_W + 40, w, h, clearance });
  }
  // Next spawn: a gap the runner can always clear at current speed,
  // plus a random extra stretch.
  const minGap = 250 + speed * 0.42;
  const gap = minGap + Math.random() * 320;
  spawnTimer = gap / speed;
}

/* ---------------------------------------------------------------------
   5. State & run control
   phase: "ready" -> "running" -> "over" (then back to "running")
   --------------------------------------------------------------------- */

let phase = "ready";
let speed = START_SPEED;
let distancePx = 0;
let bestMeters = loadBest();

function loadBest() {
  try {
    return Number(localStorage.getItem("sprint-best")) || 0;
  } catch (err) {
    return 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem("sprint-best", String(bestMeters));
  } catch (err) {
    /* storage unavailable (private mode etc.) — best just won't persist */
  }
}

function scoreMeters() {
  return Math.floor(distancePx / PX_PER_METER);
}

function startRun() {
  runner.reset();
  obstacles = [];
  speed = START_SPEED;
  distancePx = 0;
  spawnTimer = 0.9;
  phase = "running";
}

function endRun() {
  phase = "over";
  const m = scoreMeters();
  if (m > bestMeters) {
    bestMeters = m;
    saveBest();
  }
}

/* ---------------------------------------------------------------------
   6. Update logic
   --------------------------------------------------------------------- */

function update(dt) {
  if (phase === "ready" || phase === "over") {
    if (jumpPressed()) startRun();
    pressed.clear();
    return;
  }

  // --- world speed & distance ---
  speed = Math.min(MAX_SPEED, speed + SPEED_RAMP * dt);
  distancePx += speed * dt;

  // --- runner vertical motion ---
  const ducking = duckHeld();
  if (jumpPressed() && runner.grounded) runner.jump();

  if (!runner.grounded) {
    let g = GRAVITY;
    if (runner.vy > 0 && jumpHeld() && runner.jumpHold < JUMP_HOLD_TIME) {
      g *= JUMP_HOLD_GRAVITY;             // variable jump height
      runner.jumpHold += dt;
    }
    if (ducking) g += FAST_FALL;          // slam down when ducking mid-air
    runner.vy -= g * dt;
    runner.y += runner.vy * dt;
    if (runner.y <= 0) {
      runner.y = 0;
      runner.vy = 0;
      runner.grounded = true;
    }
  }
  runner.ducking = runner.grounded && ducking;
  runner.runPhase += dt * (6 + speed / 55);

  // --- obstacles ---
  spawnTimer -= dt;
  if (spawnTimer <= 0) spawnObstacle(speed);
  for (const ob of obstacles) ob.x -= speed * dt;
  obstacles = obstacles.filter((ob) => ob.x + ob.w > -60);

  // --- collisions ---
  const rb = runner.box();
  for (const ob of obstacles) {
    const obBox = obstacleBox(ob);
    if (boxesOverlap(rb, obBox)) {
      endRun();
      break;
    }
  }

  pressed.clear();
}

function obstacleBox(ob) {
  if (ob.kind === "block") {
    return { x: ob.x, y: GROUND_Y - ob.h, w: ob.w, h: ob.h };
  }
  // bar: floats so its underside is `clearance` above the ground
  return { x: ob.x, y: GROUND_Y - ob.clearance - ob.h, w: ob.w, h: ob.h };
}

function boxesOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/* ---------------------------------------------------------------------
   7. Rendering
   --------------------------------------------------------------------- */

function drawBackground() {
  // Distant skyline silhouettes drifting slowly (parallax).
  ctx.fillStyle = "#12173a";
  const offset = (distancePx * 0.25) % 160;
  for (let x = -offset; x < VIEW_W; x += 160) {
    ctx.fillRect(x + 10, GROUND_Y - 120, 52, 120);
    ctx.fillRect(x + 78, GROUND_Y - 88, 40, 88);
    ctx.fillRect(x + 128, GROUND_Y - 104, 24, 104);
  }
}

function drawGround() {
  ctx.fillStyle = "#1b2148";
  ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);
  ctx.fillStyle = "#ffd54f";
  ctx.fillRect(0, GROUND_Y, VIEW_W, 3);
  // Scrolling ground ticks.
  ctx.fillStyle = "#39406e";
  const offset = distancePx % 48;
  for (let x = -offset; x < VIEW_W; x += 48) {
    ctx.fillRect(x, GROUND_Y + 18, 22, 4);
  }
}

function drawRunner() {
  const baseY = GROUND_Y - runner.y;      // runner's feet, screen y
  const h = runner.height();
  const topY = baseY - h;

  ctx.save();
  if (phase === "over") {
    // Tipped over: draw the body rotated flat on the ground.
    ctx.translate(RUNNER_X + RUNNER_W / 2, GROUND_Y - 8);
    ctx.rotate(-Math.PI / 2.4);
    ctx.translate(-RUNNER_W / 2, -RUNNER_H_STAND);
    drawRunnerBody(0, 0, RUNNER_H_STAND, false);
    ctx.restore();
    return;
  }
  drawRunnerBody(RUNNER_X, topY, h, runner.ducking);
  ctx.restore();

  // Legs (only meaningful while upright).
  if (runner.grounded && phase === "running") {
    const swing = Math.sin(runner.runPhase) * 8;
    ctx.strokeStyle = "#e8eaf6";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(RUNNER_X + 9, baseY - 14);
    ctx.lineTo(RUNNER_X + 9 + swing, baseY);
    ctx.moveTo(RUNNER_X + 17, baseY - 14);
    ctx.lineTo(RUNNER_X + 17 - swing, baseY);
    ctx.stroke();
  } else if (!runner.grounded) {
    // Tucked legs mid-jump.
    ctx.strokeStyle = "#e8eaf6";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(RUNNER_X + 9, baseY - 12);
    ctx.lineTo(RUNNER_X + 5, baseY - 2);
    ctx.moveTo(RUNNER_X + 17, baseY - 12);
    ctx.lineTo(RUNNER_X + 22, baseY - 3);
    ctx.stroke();
  }
}

// Body + head at an (x, y) top-left with the given total height.
function drawRunnerBody(x, y, h, ducking) {
  // Torso.
  ctx.fillStyle = "#4fc3f7";
  const torsoH = Math.max(10, h - 16);
  ctx.fillRect(x + 4, y + (h - torsoH), RUNNER_W - 8, torsoH);
  // Head: a circle perched at the top, pushed forward when ducking.
  ctx.fillStyle = "#ffd54f";
  const headR = 8;
  const headX = x + RUNNER_W / 2 + (ducking ? 5 : 0);
  const headY = y + headR - 1;
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();
}

function drawObstacles() {
  for (const ob of obstacles) {
    const b = obstacleBox(ob);
    if (ob.kind === "block") {
      ctx.fillStyle = "#ef5350";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "#b71c1c";
      ctx.fillRect(b.x, b.y, b.w, 5);
    } else {
      ctx.fillStyle = "#ab47bc";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "#6a1b9a";
      ctx.fillRect(b.x, b.y + b.h - 4, b.w, 4);
    }
  }
}

function drawHud() {
  ctx.fillStyle = "#e8eaf6";
  ctx.font = "bold 22px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(scoreMeters() + " m", VIEW_W - 18, 34);
  ctx.font = "14px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "#9fa8c9";
  ctx.fillText("Best " + bestMeters + " m", VIEW_W - 18, 56);
  ctx.textAlign = "left";
}

function drawCenterMessage(title, subtitle) {
  ctx.fillStyle = "rgba(11, 14, 26, 0.72)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = "#ffd54f";
  ctx.font = "bold 44px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(title, VIEW_W / 2, VIEW_H / 2 - 12);
  ctx.fillStyle = "#e8eaf6";
  ctx.font = "18px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(subtitle, VIEW_W / 2, VIEW_H / 2 + 24);
  ctx.textAlign = "left";
}

function render() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawBackground();
  drawGround();
  drawObstacles();
  drawRunner();
  drawHud();
  if (phase === "ready") {
    drawCenterMessage("SPRINT", "Press Space or click to start running");
  } else if (phase === "over") {
    drawCenterMessage(
      "WRECKED — " + scoreMeters() + " m",
      "Press Space or click to run again"
    );
  }
}

/* ---------------------------------------------------------------------
   8. Main loop
   requestAnimationFrame with a clamped delta so a backgrounded tab
   can't produce a physics-exploding step.
   --------------------------------------------------------------------- */

let lastTime = null;

function frame(timestamp) {
  if (lastTime === null) lastTime = timestamp;
  let dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  if (dt > 0.05) dt = 0.05;
  if (dt < 0) dt = 0;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
