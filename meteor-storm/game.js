'use strict';

/* ============================================================================
 * Meteor Storm — a tiny canvas arcade game.
 *
 * You pilot a lone ship in the middle of a meteor field. Blast the rocks
 * apart — big ones split into smaller, faster pieces — and clear each wave
 * before the next, bigger storm rolls in.
 *
 * Structure:
 *   1. Constants & canvas setup
 *   2. Input
 *   3. Entities (factory functions)
 *   4. Game state & wave control
 *   5. Update logic
 *   6. Rendering
 *   7. Main loop
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 1. Constants & canvas setup
 * ------------------------------------------------------------------------ */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const WIDTH = canvas.width;   // 720
const HEIGHT = canvas.height; // 480

const SHIP_RADIUS = 11;
const SHIP_START_LIVES = 3;
const ROTATION_SPEED = 4.4;   // radians per second
const THRUST_ACCEL = 280;     // px per second^2 while thrusting
const DRAG = 0.55;            // velocity damping per second (inertia)

const BULLET_SPEED = 430;     // px per second
const BULLET_RADIUS = 3;
const BULLET_LIFE = 0.85;     // seconds before a bullet fizzles out
const FIRE_COOLDOWN = 0.17;   // seconds between shots

const RESPAWN_DELAY = 1.1;    // seconds before a respawn is attempted
const RESPAWN_CLEAR_RADIUS = 95; // centre must be this clear of meteors
const INVULNERABLE_TIME = 2.2;   // seconds of blink after respawn

const WAVE_BREAK_TIME = 2.2;  // seconds of calm between waves

// Meteor sizes: radius, score value, and what each one splits into.
const METEOR_SIZES = {
  large:  { radius: 42, score: 20,  splitsInto: 'medium' },
  medium: { radius: 26, score: 50,  splitsInto: 'small' },
  small:  { radius: 14, score: 100, splitsInto: null },
};

const COLORS = {
  ship: '#ffd54f',
  shipFlame: '#ff9a3d',
  bullet: '#ffe9a3',
  meteor: '#c7cede',
  meteorDark: '#8d97b5',
  particle: '#ffc46b',
  text: '#dfe6f3',
  dimText: '#93a4c4',
};

/* --------------------------------------------------------------------------
 * 2. Input
 *
 * Keys are tracked in a Set so movement stays smooth while a key is held.
 * `pressed` records one-shot key presses (pause, restart) for a single frame.
 * ------------------------------------------------------------------------ */

const keysDown = new Set();
const keysPressed = new Set();

const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ',
]);

window.addEventListener('keydown', (event) => {
  if (GAME_KEYS.has(event.key)) {
    event.preventDefault(); // keep the page from scrolling on arrows/space
  }
  if (!event.repeat) {
    keysPressed.add(event.key);
  }
  keysDown.add(event.key);
});

window.addEventListener('keyup', (event) => {
  keysDown.delete(event.key);
});

function isDown(...keys) {
  return keys.some((key) => keysDown.has(key));
}

function wasPressed(...keys) {
  return keys.some((key) => keysPressed.has(key));
}

/* --------------------------------------------------------------------------
 * 3. Entities
 *
 * Entities are plain objects made by small factory functions. The game keeps
 * them in arrays on the state object and filters out dead ones each frame.
 * ------------------------------------------------------------------------ */

function createShip() {
  return {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2, // nose pointing up
    radius: SHIP_RADIUS,
    fireTimer: 0,
    invulnerableTimer: 0,
    thrusting: false,
    alive: true,
  };
}

function createBullet(ship) {
  const noseX = ship.x + Math.cos(ship.angle) * (ship.radius + 4);
  const noseY = ship.y + Math.sin(ship.angle) * (ship.radius + 4);
  return {
    x: noseX,
    y: noseY,
    // Bullets inherit a slice of the ship's momentum, like the classics.
    vx: Math.cos(ship.angle) * BULLET_SPEED + ship.vx * 0.35,
    vy: Math.sin(ship.angle) * BULLET_SPEED + ship.vy * 0.35,
    radius: BULLET_RADIUS,
    life: BULLET_LIFE,
    alive: true,
  };
}

// A meteor is an irregular polygon: a ring of vertices at randomised radii
// around its centre, generated once so the rock keeps its shape as it spins.
function createMeteor(x, y, size, wave) {
  const spec = METEOR_SIZES[size];
  const speed = 26 + Math.random() * 46 + wave * 4;
  const direction = Math.random() * Math.PI * 2;
  const vertexCount = 10 + Math.floor(Math.random() * 3);
  const vertices = [];
  for (let i = 0; i < vertexCount; i++) {
    vertices.push(0.74 + Math.random() * 0.42); // radius factor per vertex
  }
  return {
    x,
    y,
    vx: Math.cos(direction) * speed,
    vy: Math.sin(direction) * speed,
    size,
    radius: spec.radius,
    score: spec.score,
    angle: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 1.6,
    vertices,
    alive: true,
  };
}

// Spawn a large meteor just inside a random edge, drifting inward so it
// never spawns on top of the ship in the centre.
function spawnEdgeMeteor(wave) {
  const margin = METEOR_SIZES.large.radius + 4;
  const edge = Math.floor(Math.random() * 4);
  let x;
  let y;
  if (edge === 0) {        // top
    x = Math.random() * WIDTH;
    y = margin;
  } else if (edge === 1) { // right
    x = WIDTH - margin;
    y = Math.random() * HEIGHT;
  } else if (edge === 2) { // bottom
    x = Math.random() * WIDTH;
    y = HEIGHT - margin;
  } else {                 // left
    x = margin;
    y = Math.random() * HEIGHT;
  }
  const meteor = createMeteor(x, y, 'large', wave);
  // Bias the drift toward the middle of the field.
  const toCentre = Math.atan2(HEIGHT / 2 - y, WIDTH / 2 - x);
  const speed = Math.hypot(meteor.vx, meteor.vy);
  const drift = toCentre + (Math.random() - 0.5) * 1.1;
  meteor.vx = Math.cos(drift) * speed;
  meteor.vy = Math.sin(drift) * speed;
  return meteor;
}

function createParticles(x, y, count, color) {
  const particles = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 170;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.35,
      maxLife: 0.75,
      radius: 1.5 + Math.random() * 2,
      color,
    });
  }
  return particles;
}

// The starfield is generated once and drifts slowly downward.
function createStarfield(count) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * WIDTH,
      y: Math.random() * HEIGHT,
      speed: 6 + Math.random() * 20,
      radius: Math.random() < 0.85 ? 1 : 2,
      alpha: 0.25 + Math.random() * 0.65,
    });
  }
  return stars;
}

/* --------------------------------------------------------------------------
 * 4. Game state & wave control
 *
 * `phase` is one of:
 *   'playing'   — a wave is in progress
 *   'wavebreak' — short calm before the next wave spawns
 *   'gameover'  — waiting for the player to restart
 * Pausing is tracked separately so it can freeze any phase.
 * ------------------------------------------------------------------------ */

/* Persistent best score (localStorage). */
const BEST_SCORE_KEY = 'arcade-meteor-storm-best';
let bestScore = 0;
try {
  bestScore = parseInt(localStorage.getItem(BEST_SCORE_KEY), 10) || 0;
} catch (err) {
  bestScore = 0;
}

/* HUD elements (updated whenever the numbers change). */
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const waveEl = document.getElementById('wave');
const livesEl = document.getElementById('lives');
const overlayEl = document.getElementById('overlay');
const overlayTextEl = document.getElementById('overlay-text');
const restartBtn = document.getElementById('restart-btn');

function renderHud() {
  scoreEl.textContent = String(state.score);
  bestEl.textContent = String(bestScore);
  waveEl.textContent = String(Math.max(1, state.wave));
  livesEl.textContent = String(Math.max(0, state.lives));
}

function updateBestScore() {
  if (state.score > bestScore) {
    bestScore = state.score;
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
    } catch (err) {
      // Storage unavailable (e.g. private mode); best still shows this session.
    }
  }
}

const state = {
  phase: 'wavebreak',
  paused: false,
  score: 0,
  lives: SHIP_START_LIVES,
  wave: 0,
  waveTimer: 0.8, // short delay before wave 1
  respawnTimer: 0,
  ship: createShip(),
  bullets: [],
  meteors: [],
  particles: [],
  stars: createStarfield(110),
};

function startWave(waveNumber) {
  state.wave = waveNumber;
  const count = 3 + waveNumber; // wave N spawns 3 + N large meteors
  for (let i = 0; i < count; i++) {
    state.meteors.push(spawnEdgeMeteor(waveNumber));
  }
  state.phase = 'playing';
  renderHud();
}

function resetGame() {
  state.score = 0;
  state.lives = SHIP_START_LIVES;
  state.wave = 0;
  state.bullets = [];
  state.meteors = [];
  state.particles = [];
  state.ship = createShip();
  state.phase = 'wavebreak';
  state.waveTimer = 0.8;
  state.respawnTimer = 0;
  state.paused = false;
  overlayEl.classList.remove('show');
  renderHud();
}

function showGameOver() {
  state.phase = 'gameover';
  overlayTextEl.textContent =
    `Final score: ${state.score} · Reached wave ${state.wave}`;
  overlayEl.classList.add('show');
}

function loseLife() {
  state.lives -= 1;
  state.particles.push(
    ...createParticles(state.ship.x, state.ship.y, 28, COLORS.particle),
  );
  renderHud();
  if (state.lives <= 0) {
    state.ship.alive = false;
    showGameOver();
  } else {
    // The ship is gone until the centre is safe enough to respawn into.
    state.ship.alive = false;
    state.respawnTimer = RESPAWN_DELAY;
  }
}

restartBtn.addEventListener('click', () => {
  resetGame();
});

/* --------------------------------------------------------------------------
 * 5. Update logic
 * ------------------------------------------------------------------------ */

// Toroidal wrap: an entity leaving one edge re-enters from the opposite one.
function wrapPosition(entity) {
  const r = entity.radius;
  if (entity.x < -r) entity.x += WIDTH + r * 2;
  if (entity.x > WIDTH + r) entity.x -= WIDTH + r * 2;
  if (entity.y < -r) entity.y += HEIGHT + r * 2;
  if (entity.y > HEIGHT + r) entity.y -= HEIGHT + r * 2;
}

function circlesOverlap(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const radiusSum = a.radius + b.radius;
  return dx * dx + dy * dy < radiusSum * radiusSum;
}

function updateShip(dt) {
  const ship = state.ship;
  if (!ship.alive) return;

  if (isDown('ArrowLeft', 'a', 'A')) {
    ship.angle -= ROTATION_SPEED * dt;
  }
  if (isDown('ArrowRight', 'd', 'D')) {
    ship.angle += ROTATION_SPEED * dt;
  }

  ship.thrusting = isDown('ArrowUp', 'w', 'W');
  if (ship.thrusting) {
    ship.vx += Math.cos(ship.angle) * THRUST_ACCEL * dt;
    ship.vy += Math.sin(ship.angle) * THRUST_ACCEL * dt;
  }

  // Inertia with gentle damping, so the ship drifts but settles.
  const damping = Math.exp(-DRAG * dt);
  ship.vx *= damping;
  ship.vy *= damping;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  wrapPosition(ship);

  ship.fireTimer -= dt;
  ship.invulnerableTimer = Math.max(0, ship.invulnerableTimer - dt);

  if (isDown(' ') && ship.fireTimer <= 0) {
    state.bullets.push(createBullet(ship));
    ship.fireTimer = FIRE_COOLDOWN;
  }
}

function updateRespawn(dt) {
  if (state.ship.alive || state.lives <= 0) return;

  state.respawnTimer -= dt;
  if (state.respawnTimer > 0) return;

  // Only respawn once no meteor is hovering over the centre.
  const centreClear = state.meteors.every((meteor) => {
    const dx = meteor.x - WIDTH / 2;
    const dy = meteor.y - HEIGHT / 2;
    return dx * dx + dy * dy > RESPAWN_CLEAR_RADIUS * RESPAWN_CLEAR_RADIUS;
  });
  if (!centreClear) return;

  state.ship = createShip();
  state.ship.invulnerableTimer = INVULNERABLE_TIME;
}

function updateBullets(dt) {
  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    // Bullets do not wrap: they expire at the end of their lifetime or
    // as soon as they leave the field, whichever comes first.
    if (bullet.life <= 0 ||
        bullet.x < -bullet.radius || bullet.x > WIDTH + bullet.radius ||
        bullet.y < -bullet.radius || bullet.y > HEIGHT + bullet.radius) {
      bullet.alive = false;
    }
  }
}

function updateMeteors(dt) {
  for (const meteor of state.meteors) {
    meteor.x += meteor.vx * dt;
    meteor.y += meteor.vy * dt;
    meteor.angle += meteor.rotationSpeed * dt;
    wrapPosition(meteor);
  }
}

// Split a destroyed meteor into two of the next size down (if any) and
// award its score.
function breakMeteor(meteor) {
  state.score += meteor.score;
  updateBestScore();
  state.particles.push(
    ...createParticles(meteor.x, meteor.y, meteor.size === 'small' ? 8 : 14, COLORS.particle),
  );
  const childSize = METEOR_SIZES[meteor.size].splitsInto;
  if (childSize) {
    for (let i = 0; i < 2; i++) {
      const child = createMeteor(meteor.x, meteor.y, childSize, state.wave);
      // Children burst outward a little faster than the parent drifted.
      child.vx += meteor.vx * 0.4;
      child.vy += meteor.vy * 0.4;
      state.meteors.push(child);
    }
  }
  renderHud();
}

function updateCollisions() {
  // Bullet vs meteor.
  for (const bullet of state.bullets) {
    if (!bullet.alive) continue;
    for (const meteor of state.meteors) {
      if (!meteor.alive) continue;
      if (circlesOverlap(bullet, meteor)) {
        bullet.alive = false;
        meteor.alive = false;
        breakMeteor(meteor);
        break; // one bullet breaks at most one meteor
      }
    }
  }

  // Ship vs meteor (skipped while blinking invulnerable or awaiting respawn).
  const ship = state.ship;
  if (ship.alive && ship.invulnerableTimer <= 0 && state.phase === 'playing') {
    for (const meteor of state.meteors) {
      if (!meteor.alive) continue;
      if (circlesOverlap(ship, meteor)) {
        meteor.alive = false;
        breakMeteor(meteor);
        loseLife();
        break;
      }
    }
  }
}

function updateParticles(dt) {
  for (const particle of state.particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.life -= dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
}

function updateStarfield(dt) {
  for (const star of state.stars) {
    star.y += star.speed * dt;
    if (star.y > HEIGHT) {
      star.y = 0;
      star.x = Math.random() * WIDTH;
    }
  }
}

function pruneEntities() {
  state.bullets = state.bullets.filter((b) => b.alive);
  state.meteors = state.meteors.filter((m) => m.alive);
}

function update(dt) {
  updateStarfield(dt); // the background drifts even on the game-over screen

  if (state.phase === 'gameover') {
    updateParticles(dt);
    if (wasPressed('Enter', 'r', 'R')) {
      resetGame();
    }
    return;
  }

  if (wasPressed('p', 'P', 'Escape')) {
    state.paused = !state.paused;
  }
  if (state.paused) return;

  if (state.phase === 'wavebreak') {
    state.waveTimer -= dt;
    updateParticles(dt);
    updateMeteors(dt);
    if (state.waveTimer <= 0) {
      startWave(state.wave + 1);
    }
    return;
  }

  // phase === 'playing'
  updateShip(dt);
  updateRespawn(dt);
  updateBullets(dt);
  updateMeteors(dt);
  updateCollisions();
  updateParticles(dt);
  pruneEntities();

  // Wave cleared: every meteor has been broken down and destroyed.
  if (state.phase === 'playing' && state.meteors.length === 0) {
    state.phase = 'wavebreak';
    state.waveTimer = WAVE_BREAK_TIME;
  }
}

/* --------------------------------------------------------------------------
 * 6. Rendering
 * ------------------------------------------------------------------------ */

function drawStarfield() {
  ctx.fillStyle = '#ffffff';
  for (const star of state.stars) {
    ctx.globalAlpha = star.alpha;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawShip() {
  const ship = state.ship;
  if (!ship.alive) return;

  // Blink while invulnerable so the player can see the grace period.
  if (ship.invulnerableTimer > 0 && Math.floor(ship.invulnerableTimer * 12) % 2 === 0) {
    return;
  }

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  // Engine flame while thrusting.
  if (ship.thrusting) {
    ctx.fillStyle = COLORS.shipFlame;
    ctx.beginPath();
    ctx.moveTo(-ship.radius + 2, -5);
    ctx.lineTo(-ship.radius - 8 - Math.random() * 6, 0);
    ctx.lineTo(-ship.radius + 2, 5);
    ctx.closePath();
    ctx.fill();
  }

  // Hull: a simple gold triangle, nose on +x (the facing direction).
  ctx.fillStyle = COLORS.ship;
  ctx.beginPath();
  ctx.moveTo(ship.radius + 4, 0);
  ctx.lineTo(-ship.radius, -ship.radius + 2);
  ctx.lineTo(-ship.radius + 4, 0);
  ctx.lineTo(-ship.radius, ship.radius - 2);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawBullets() {
  ctx.fillStyle = COLORS.bullet;
  for (const bullet of state.bullets) {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMeteors() {
  ctx.lineWidth = 2;
  for (const meteor of state.meteors) {
    ctx.save();
    ctx.translate(meteor.x, meteor.y);
    ctx.rotate(meteor.angle);
    ctx.strokeStyle = COLORS.meteor;
    ctx.fillStyle = 'rgba(141, 151, 181, 0.18)';
    ctx.beginPath();
    const count = meteor.vertices.length;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = meteor.radius * meteor.vertices[i];
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawParticles() {
  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCenteredText(lines, startY, lineHeight) {
  ctx.textAlign = 'center';
  for (const [text, font, color] of lines) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(text, WIDTH / 2, startY);
    startY += lineHeight;
  }
}

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  drawStarfield();
  drawBullets();
  drawMeteors();
  drawParticles();
  drawShip();

  if (state.phase === 'wavebreak') {
    drawCenteredText(
      [[`Wave ${state.wave + 1} incoming`, '600 24px system-ui, sans-serif', COLORS.text]],
      HEIGHT / 2,
      30,
    );
  }

  if (state.paused && state.phase !== 'gameover') {
    drawCenteredText(
      [['Paused', '600 28px system-ui, sans-serif', COLORS.text]],
      HEIGHT / 2,
      30,
    );
  }
}

/* --------------------------------------------------------------------------
 * 7. Main loop
 *
 * requestAnimationFrame drives the loop; dt is clamped so a background tab
 * or a hiccup can't teleport entities across the screen.
 * ------------------------------------------------------------------------ */

renderHud();

let lastTimestamp = 0;

function frame(timestamp) {
  const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
  lastTimestamp = timestamp;

  update(dt);
  draw();

  keysPressed.clear(); // one-shot presses only live for a single frame
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
