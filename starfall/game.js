'use strict';

/* ============================================================================
 * Starfall — a tiny canvas arcade game.
 *
 * You pilot the last ship in orbit. Waves of husks fall from the top of the
 * screen; shoot them down before they reach the bottom or hit your ship.
 * Survive the wave, and the next one falls faster.
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

const WIDTH = canvas.width;   // 480
const HEIGHT = canvas.height; // 640

const PLAYER_SPEED = 320;     // px per second
const PLAYER_RADIUS = 12;
const PLAYER_START_LIVES = 3;

const BULLET_SPEED = 520;     // px per second
const BULLET_RADIUS = 3;
const FIRE_COOLDOWN = 0.16;   // seconds between shots

const ENEMY_RADIUS = 14;
const ENEMY_BASE_SCORE = 100;

const WAVE_BREAK_TIME = 2.2;  // seconds of calm between waves

const COLORS = {
  ship: '#7fd4ff',
  shipAccent: '#ffd75e',
  bullet: '#ffe9a3',
  enemy: '#ff7a7a',
  enemyCore: '#ffb3b3',
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

function createPlayer() {
  return {
    x: WIDTH / 2,
    y: HEIGHT - 48,
    radius: PLAYER_RADIUS,
    fireTimer: 0,
    invulnerableTimer: 0, // brief grace period after losing a life
  };
}

function createBullet(x, y) {
  return { x, y, radius: BULLET_RADIUS, alive: true };
}

function createEnemy(x, wave) {
  // Later waves fall faster and wobble wider.
  const fallSpeed = 90 + wave * 18 + Math.random() * 40;
  return {
    x,
    y: -ENEMY_RADIUS,
    radius: ENEMY_RADIUS,
    speed: fallSpeed,
    swayPhase: Math.random() * Math.PI * 2,
    swayAmount: 12 + Math.random() * 22,
    baseX: x,
    alive: true,
  };
}

function createParticles(x, y, count, color) {
  const particles = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 160;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.45 + Math.random() * 0.3,
      maxLife: 0.75,
      radius: 1.5 + Math.random() * 2,
      color,
    });
  }
  return particles;
}

// The starfield is generated once and scrolled by offsetting each star's y.
function createStarfield(count) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * WIDTH,
      y: Math.random() * HEIGHT,
      speed: 18 + Math.random() * 55,
      radius: Math.random() < 0.85 ? 1 : 2,
      alpha: 0.3 + Math.random() * 0.7,
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

const state = {
  phase: 'wavebreak',
  paused: false,
  score: 0,
  lives: PLAYER_START_LIVES,
  wave: 0,
  waveTimer: 0.8, // short delay before wave 1
  enemiesToSpawn: 0,
  spawnTimer: 0,
  player: createPlayer(),
  bullets: [],
  enemies: [],
  particles: [],
  stars: createStarfield(90),
};

function startWave(waveNumber) {
  state.wave = waveNumber;
  state.enemiesToSpawn = 5 + waveNumber * 3;
  state.spawnTimer = 0;
  state.phase = 'playing';
}

function resetGame() {
  state.score = 0;
  state.lives = PLAYER_START_LIVES;
  state.wave = 0;
  state.bullets = [];
  state.enemies = [];
  state.particles = [];
  state.player = createPlayer();
  state.phase = 'wavebreak';
  state.waveTimer = 0.8;
  state.paused = false;
}

function loseLife() {
  state.lives -= 1;
  state.particles.push(
    ...createParticles(state.player.x, state.player.y, 26, COLORS.particle),
  );
  if (state.lives <= 0) {
    state.phase = 'gameover';
  } else {
    state.player.invulnerableTimer = 1.6;
  }
}

/* --------------------------------------------------------------------------
 * 5. Update logic
 * ------------------------------------------------------------------------ */

function updatePlayer(dt) {
  const player = state.player;

  if (isDown('ArrowLeft', 'a', 'A')) {
    player.x -= PLAYER_SPEED * dt;
  }
  if (isDown('ArrowRight', 'd', 'D')) {
    player.x += PLAYER_SPEED * dt;
  }
  // Keep the ship fully on screen.
  player.x = Math.max(player.radius, Math.min(WIDTH - player.radius, player.x));

  player.fireTimer -= dt;
  player.invulnerableTimer = Math.max(0, player.invulnerableTimer - dt);

  if (isDown(' ') && player.fireTimer <= 0) {
    state.bullets.push(createBullet(player.x, player.y - player.radius - 4));
    player.fireTimer = FIRE_COOLDOWN;
  }
}

function updateSpawning(dt) {
  if (state.enemiesToSpawn <= 0) return;

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    const margin = ENEMY_RADIUS + 6;
    const x = margin + Math.random() * (WIDTH - margin * 2);
    state.enemies.push(createEnemy(x, state.wave));
    state.enemiesToSpawn -= 1;
    // Spawn interval shrinks slightly as waves progress.
    state.spawnTimer = Math.max(0.35, 0.9 - state.wave * 0.05);
  }
}

function updateBullets(dt) {
  for (const bullet of state.bullets) {
    bullet.y -= BULLET_SPEED * dt;
    if (bullet.y < -bullet.radius) {
      bullet.alive = false;
    }
  }
}

function updateEnemies(dt, elapsed) {
  const player = state.player;

  for (const enemy of state.enemies) {
    enemy.y += enemy.speed * dt;
    enemy.x = enemy.baseX + Math.sin(elapsed * 2 + enemy.swayPhase) * enemy.swayAmount;

    // An enemy that slips past the bottom costs a life.
    if (enemy.y - enemy.radius > HEIGHT) {
      enemy.alive = false;
      loseLife();
      if (state.phase === 'gameover') return;
      continue;
    }

    // Collision with the ship (skipped during the post-hit grace period).
    if (player.invulnerableTimer <= 0 && circlesOverlap(enemy, player)) {
      enemy.alive = false;
      loseLife();
      if (state.phase === 'gameover') return;
    }
  }
}

function updateCollisions() {
  for (const bullet of state.bullets) {
    if (!bullet.alive) continue;
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      if (circlesOverlap(bullet, enemy)) {
        bullet.alive = false;
        enemy.alive = false;
        state.score += ENEMY_BASE_SCORE + state.wave * 10;
        state.particles.push(
          ...createParticles(enemy.x, enemy.y, 14, COLORS.particle),
        );
        break; // one bullet kills at most one enemy
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
  state.enemies = state.enemies.filter((e) => e.alive);
}

function circlesOverlap(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const radiusSum = a.radius + b.radius;
  return dx * dx + dy * dy < radiusSum * radiusSum;
}

function update(dt, elapsed) {
  updateStarfield(dt); // the background scrolls even on the game-over screen

  if (state.phase === 'gameover') {
    updateParticles(dt);
    if (wasPressed('Enter', 'r', 'R')) {
      resetGame();
    }
    return;
  }

  if (wasPressed('p', 'P')) {
    state.paused = !state.paused;
  }
  if (state.paused) return;

  if (state.phase === 'wavebreak') {
    state.waveTimer -= dt;
    updateParticles(dt);
    if (state.waveTimer <= 0) {
      startWave(state.wave + 1);
    }
    return;
  }

  // phase === 'playing'
  updatePlayer(dt);
  updateSpawning(dt);
  updateBullets(dt);
  updateEnemies(dt, elapsed);
  updateCollisions();
  updateParticles(dt);
  pruneEntities();

  // Wave cleared: everything spawned and destroyed (or slipped past).
  if (state.phase === 'playing' && state.enemiesToSpawn === 0 && state.enemies.length === 0) {
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

function drawPlayer() {
  const { x, y } = state.player;

  // Blink while invulnerable so the player can see the grace period.
  if (state.player.invulnerableTimer > 0 && Math.floor(state.player.invulnerableTimer * 12) % 2 === 0) {
    return;
  }

  // Engine flame.
  ctx.fillStyle = COLORS.shipAccent;
  ctx.beginPath();
  ctx.moveTo(x - 5, y + 10);
  ctx.lineTo(x, y + 20 + Math.random() * 6);
  ctx.lineTo(x + 5, y + 10);
  ctx.closePath();
  ctx.fill();

  // Hull: a simple upward arrow shape.
  ctx.fillStyle = COLORS.ship;
  ctx.beginPath();
  ctx.moveTo(x, y - 16);
  ctx.lineTo(x + 12, y + 10);
  ctx.lineTo(x + 4, y + 6);
  ctx.lineTo(x - 4, y + 6);
  ctx.lineTo(x - 12, y + 10);
  ctx.closePath();
  ctx.fill();

  // Cockpit.
  ctx.fillStyle = COLORS.shipAccent;
  ctx.beginPath();
  ctx.arc(x, y - 4, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawBullets() {
  ctx.fillStyle = COLORS.bullet;
  for (const bullet of state.bullets) {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    // Jagged husk: a rough circle drawn with a wobbling radius.
    ctx.fillStyle = COLORS.enemy;
    ctx.beginPath();
    const points = 9;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const r = enemy.radius * (0.82 + ((i * 37) % 5) * 0.07);
      const px = enemy.x + Math.cos(angle) * r;
      const py = enemy.y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COLORS.enemyCore;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, 4, 0, Math.PI * 2);
    ctx.fill();
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

function drawHud() {
  ctx.fillStyle = COLORS.text;
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Score  ${state.score}`, 14, 26);

  ctx.textAlign = 'center';
  ctx.fillText(`Wave ${Math.max(1, state.wave)}`, WIDTH / 2, 26);

  // Lives as small ship triangles in the top-right corner.
  ctx.fillStyle = COLORS.ship;
  for (let i = 0; i < state.lives; i++) {
    const x = WIDTH - 20 - i * 22;
    const y = 20;
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 7, y + 7);
    ctx.lineTo(x - 7, y + 7);
    ctx.closePath();
    ctx.fill();
  }
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
  drawEnemies();
  drawParticles();
  if (state.phase !== 'gameover') {
    drawPlayer();
  }
  drawHud();

  if (state.phase === 'wavebreak' && state.wave > 0) {
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

  if (state.phase === 'gameover') {
    drawCenteredText(
      [
        ['Game Over', '700 40px system-ui, sans-serif', COLORS.text],
        [`Final score  ${state.score}`, '600 18px system-ui, sans-serif', COLORS.dimText],
        [`Reached wave ${state.wave}`, '600 18px system-ui, sans-serif', COLORS.dimText],
        ['Press Enter to play again', '600 16px system-ui, sans-serif', COLORS.text],
      ],
      HEIGHT / 2 - 50,
      34,
    );
  }
}

/* --------------------------------------------------------------------------
 * 7. Main loop
 *
 * requestAnimationFrame drives the loop; dt is clamped so a background tab
 * or a hiccup can't teleport entities across the screen.
 * ------------------------------------------------------------------------ */

let lastTimestamp = 0;
let elapsedTime = 0;

function frame(timestamp) {
  const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
  lastTimestamp = timestamp;
  elapsedTime += dt;

  update(dt, elapsedTime);
  draw();

  keysPressed.clear(); // one-shot presses only live for a single frame
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
