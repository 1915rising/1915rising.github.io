'use strict';

/*
 * Pong — a small original implementation of the classic arcade tennis game.
 * Vanilla JavaScript + Canvas 2D. No libraries, no assets.
 *
 * Modes:
 *   'ai' — you play the left paddle against a computer-controlled right paddle.
 *   '2p' — two players share one keyboard (W/S vs arrow keys).
 *
 * First to WIN_SCORE points wins the match.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WIDTH = 800;
const HEIGHT = 500;

const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 84;
const PADDLE_MARGIN = 18;          // distance from each paddle to its wall
const PLAYER_SPEED = 430;          // px per second, human paddles
const AI_SPEED = 335;              // px per second, computer paddle
const AI_DEAD_ZONE = 6;            // px the AI ignores, keeps it beatable

const BALL_RADIUS = 8;
const BALL_START_SPEED = 340;      // px per second when served
const BALL_MAX_SPEED = 840;
const BALL_SPEED_UP = 1.045;       // speed multiplier on every paddle hit
const MAX_BOUNCE_ANGLE = Math.PI / 3; // 60 degrees off the paddle face

const WIN_SCORE = 7;
const SERVE_DELAY = 0.9;           // seconds the ball waits before a serve

const COLOR_BG = '#0e1230';
const COLOR_LINE = 'rgba(232, 234, 246, 0.25)';
const COLOR_PADDLE = '#e8eaf6';
const COLOR_PADDLE_AI = '#9fc3ff';
const COLOR_BALL = '#ffd54f';
const COLOR_TEXT = '#e8eaf6';
const COLOR_GOLD = '#ffd54f';
const COLOR_DIM = '#9fa8c9';

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game');
canvas.width = WIDTH;
canvas.height = HEIGHT;
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

function makePaddle(x) {
  return { x: x, y: HEIGHT / 2, width: PADDLE_WIDTH, height: PADDLE_HEIGHT };
}

const leftPaddle = makePaddle(PADDLE_MARGIN);
const rightPaddle = makePaddle(WIDTH - PADDLE_MARGIN - PADDLE_WIDTH);
const ball = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, speed: BALL_START_SPEED };

const state = {
  phase: 'menu',        // 'menu' | 'serve' | 'play' | 'over'
  mode: 'ai',           // 'ai' | '2p'
  paused: false,        // true freezes a live match (serve timer included)
  leftScore: 0,
  rightScore: 0,
  winner: null,         // 'left' | 'right' once phase === 'over'
  serveTimer: 0,
  serveDirection: 1,    // 1 = serve toward the right, -1 = toward the left
};

// ---------------------------------------------------------------------------
// Persistence — running tally of match wins against the computer, kept in
// localStorage so it survives page reloads. Two-player matches never count.
// ---------------------------------------------------------------------------

const WINS_KEY = 'arcade-pong-wins';

function loadAiWins() {
  const empty = { player: 0, ai: 0 };
  try {
    if (typeof localStorage === 'undefined') return empty;
    const parsed = JSON.parse(localStorage.getItem(WINS_KEY) || 'null');
    if (!parsed) return empty;
    return {
      player: Math.max(0, parseInt(parsed.player, 10) || 0),
      ai: Math.max(0, parseInt(parsed.ai, 10) || 0),
    };
  } catch (err) {
    return empty; // storage blocked or corrupt — play on without a tally
  }
}

const aiWins = loadAiWins();

function saveAiWins() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WINS_KEY, JSON.stringify(aiWins));
    }
  } catch (err) { /* storage unavailable; the tally just won't persist */ }
}

function updateWinsDisplay() {
  const el = document.getElementById('wins-tally');
  if (el) {
    el.textContent = 'Wins vs Computer — You: ' + aiWins.player +
                     ' · Computer: ' + aiWins.ai;
  }
}

// ---------------------------------------------------------------------------
// Input — a Set of currently held keys, matched case-insensitively
// ---------------------------------------------------------------------------

const heldKeys = new Set();

function onKeyDown(event) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === 'ArrowUp' || key === 'ArrowDown' || key === ' ') {
    event.preventDefault(); // keep the page from scrolling mid-game
  }
  heldKeys.add(key);

  if (key === 'p' || key === 'Escape') togglePause();
  if (key === '1') startMatch('ai');
  if (key === '2') startMatch('2p');
  if (key === 'r' || key === 'R') restart();
}

function togglePause() {
  // Only a live match can pause; the menu and game-over screens are static.
  // Pausing mid-serve is safe: update() stops, so the serve timer, ball and
  // paddles all hold exactly where they were until play resumes.
  if (state.phase !== 'serve' && state.phase !== 'play') return;
  state.paused = !state.paused;
}

function onKeyUp(event) {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  heldKeys.delete(key);
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

function bindButton(id, action) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', action);
}
bindButton('btn-ai', function () { startMatch('ai'); });
bindButton('btn-2p', function () { startMatch('2p'); });
bindButton('btn-restart', function () { restart(); });

// ---------------------------------------------------------------------------
// Touch input — dragging on the court moves a paddle to the finger's height.
// In 1P mode every touch drives the left (player) paddle; in 2P mode touches
// on the left half drive the left paddle and touches on the right half drive
// the right one, so two fingers can play at once.
// ---------------------------------------------------------------------------

function touchToCanvas(touch) {
  // The canvas is CSS-scaled to fit the page, so map client coordinates
  // back into court coordinates.
  const rect = canvas.getBoundingClientRect();
  return {
    x: (touch.clientX - rect.left) * (WIDTH / rect.width),
    y: (touch.clientY - rect.top) * (HEIGHT / rect.height),
  };
}

function onTouch(event) {
  event.preventDefault(); // keep the page from scrolling while playing
  for (let i = 0; i < event.touches.length; i++) {
    const pos = touchToCanvas(event.touches[i]);
    if (state.mode === '2p' && pos.x >= WIDTH / 2) {
      rightPaddle.y = pos.y;
      clampPaddle(rightPaddle);
    } else {
      leftPaddle.y = pos.y;
      clampPaddle(leftPaddle);
    }
  }
}

canvas.addEventListener('touchstart', onTouch, { passive: false });
canvas.addEventListener('touchmove', onTouch, { passive: false });
canvas.addEventListener('touchend', function (event) {
  event.preventDefault();
}, { passive: false });

// ---------------------------------------------------------------------------
// Match flow
// ---------------------------------------------------------------------------

function startMatch(mode) {
  state.mode = mode;
  state.paused = false;
  state.leftScore = 0;
  state.rightScore = 0;
  state.winner = null;
  leftPaddle.y = HEIGHT / 2;
  rightPaddle.y = HEIGHT / 2;
  // Opening serve goes to a random side so neither player is favoured.
  state.serveDirection = Math.random() < 0.5 ? -1 : 1;
  beginServe();
}

function restart() {
  // Restart keeps the current mode; from the menu it starts a fresh match.
  startMatch(state.mode);
}

function beginServe() {
  ball.x = WIDTH / 2;
  ball.y = HEIGHT / 2;
  ball.vx = 0;
  ball.vy = 0;
  ball.speed = BALL_START_SPEED;
  state.serveTimer = SERVE_DELAY;
  state.phase = 'serve';
}

function launchBall() {
  // Serve at a shallow random angle toward serveDirection's side.
  const angle = (Math.random() * 0.6 - 0.3); // between -0.3 and +0.3 radians
  ball.speed = BALL_START_SPEED;
  ball.vx = Math.cos(angle) * ball.speed * state.serveDirection;
  ball.vy = Math.sin(angle) * ball.speed;
  state.phase = 'play';
}

function awardPoint(side) {
  if (side === 'left') state.leftScore += 1;
  else state.rightScore += 1;

  if (state.leftScore >= WIN_SCORE || state.rightScore >= WIN_SCORE) {
    state.winner = state.leftScore >= WIN_SCORE ? 'left' : 'right';
    state.phase = 'over';
    ball.vx = 0;
    ball.vy = 0;
    // Only matches against the computer feed the persistent win tally.
    if (state.mode === 'ai') {
      if (state.winner === 'left') aiWins.player += 1;
      else aiWins.ai += 1;
      saveAiWins();
      updateWinsDisplay();
    }
    return;
  }

  // Next serve travels toward the player who just conceded the point,
  // so they get the first touch of the new rally.
  state.serveDirection = side === 'left' ? 1 : -1;
  beginServe();
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

function clampPaddle(paddle) {
  const half = paddle.height / 2;
  if (paddle.y < half) paddle.y = half;
  if (paddle.y > HEIGHT - half) paddle.y = HEIGHT - half;
}

function moveHumanPaddle(paddle, upKey, downKey, dt) {
  if (heldKeys.has(upKey)) paddle.y -= PLAYER_SPEED * dt;
  if (heldKeys.has(downKey)) paddle.y += PLAYER_SPEED * dt;
  clampPaddle(paddle);
}

function moveAiPaddle(dt) {
  // The computer only reacts while the ball is heading its way; otherwise it
  // drifts back toward the centre. A dead zone keeps its aim imperfect.
  const target = ball.vx > 0 ? ball.y : HEIGHT / 2;
  const diff = target - rightPaddle.y;
  if (Math.abs(diff) > AI_DEAD_ZONE) {
    const step = Math.sign(diff) * AI_SPEED * dt;
    rightPaddle.y += Math.abs(step) < Math.abs(diff) ? step : diff;
  }
  clampPaddle(rightPaddle);
}

function updatePaddles(dt) {
  moveHumanPaddle(leftPaddle, 'w', 's', dt);
  if (state.mode === '2p') {
    moveHumanPaddle(rightPaddle, 'ArrowUp', 'ArrowDown', dt);
  } else {
    moveAiPaddle(dt);
  }
}

function bounceOffPaddle(paddle, direction) {
  // Where the ball struck the paddle face decides the rebound angle:
  // dead centre goes straight, edges leave at up to MAX_BOUNCE_ANGLE.
  const relative = (ball.y - paddle.y) / (paddle.height / 2);
  const clamped = Math.max(-1, Math.min(1, relative));
  const angle = clamped * MAX_BOUNCE_ANGLE;
  ball.speed = Math.min(ball.speed * BALL_SPEED_UP, BALL_MAX_SPEED);
  ball.vx = Math.cos(angle) * ball.speed * direction;
  ball.vy = Math.sin(angle) * ball.speed;
  // Park the ball just outside the paddle so it cannot stick inside it.
  ball.x = direction > 0
    ? paddle.x + paddle.width + BALL_RADIUS
    : paddle.x - BALL_RADIUS;
}

function updateBall(dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Top and bottom walls.
  if (ball.y < BALL_RADIUS) {
    ball.y = BALL_RADIUS;
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y > HEIGHT - BALL_RADIUS) {
    ball.y = HEIGHT - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy);
  }

  // Paddle collisions — only when the ball is moving toward that paddle.
  if (ball.vx < 0 &&
      ball.x - BALL_RADIUS <= leftPaddle.x + leftPaddle.width &&
      ball.x - BALL_RADIUS >= leftPaddle.x - BALL_RADIUS &&
      Math.abs(ball.y - leftPaddle.y) <= leftPaddle.height / 2 + BALL_RADIUS) {
    bounceOffPaddle(leftPaddle, 1);
  } else if (ball.vx > 0 &&
             ball.x + BALL_RADIUS >= rightPaddle.x &&
             ball.x + BALL_RADIUS <= rightPaddle.x + rightPaddle.width + BALL_RADIUS &&
             Math.abs(ball.y - rightPaddle.y) <= rightPaddle.height / 2 + BALL_RADIUS) {
    bounceOffPaddle(rightPaddle, -1);
  }

  // Scoring — the ball has fully crossed a goal line.
  if (ball.x < -BALL_RADIUS) awardPoint('right');
  else if (ball.x > WIDTH + BALL_RADIUS) awardPoint('left');
}

function update(dt) {
  if (state.paused) return; // frozen: ball, paddles and serve timer all hold
  if (state.phase === 'menu' || state.phase === 'over') return;
  updatePaddles(dt);
  if (state.phase === 'serve') {
    state.serveTimer -= dt;
    if (state.serveTimer <= 0) launchBall();
  } else if (state.phase === 'play') {
    updateBall(dt);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawText(text, x, y, size, color, align) {
  ctx.font = '700 ' + size + 'px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function render() {
  // Court.
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Centre line.
  ctx.strokeStyle = COLOR_LINE;
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 14]);
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2, 0);
  ctx.lineTo(WIDTH / 2, HEIGHT);
  ctx.stroke();
  ctx.setLineDash([]);

  // Scores.
  drawText(String(state.leftScore), WIDTH / 2 - 60, 48, 44, COLOR_TEXT);
  drawText(String(state.rightScore), WIDTH / 2 + 60, 48, COLOR_TEXT);

  // Paddles.
  ctx.fillStyle = COLOR_PADDLE;
  ctx.fillRect(leftPaddle.x, leftPaddle.y - leftPaddle.height / 2,
               leftPaddle.width, leftPaddle.height);
  ctx.fillStyle = state.mode === 'ai' ? COLOR_PADDLE_AI : COLOR_PADDLE;
  ctx.fillRect(rightPaddle.x, rightPaddle.y - rightPaddle.height / 2,
               rightPaddle.width, rightPaddle.height);

  // Ball (hidden on the menu, parked at centre during a serve).
  if (state.phase !== 'menu') {
    ctx.fillStyle = COLOR_BALL;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  // Phase messages.
  if (state.phase === 'menu') {
    drawText('PONG', WIDTH / 2, HEIGHT / 2 - 70, 54, COLOR_GOLD);
    drawText('Press 1 to play the computer, or 2 for two players',
             WIDTH / 2, HEIGHT / 2, 20, COLOR_TEXT);
    drawText('First to ' + WIN_SCORE + ' wins',
             WIDTH / 2, HEIGHT / 2 + 34, 16, COLOR_DIM);
  } else if (state.phase === 'serve') {
    drawText('Ready…', WIDTH / 2, HEIGHT - 36, 18, COLOR_DIM);
  } else if (state.phase === 'over') {
    const label = state.mode === 'ai'
      ? (state.winner === 'left' ? 'You win!' : 'Computer wins')
      : (state.winner === 'left' ? 'Left player wins!' : 'Right player wins!');
    drawText(label, WIDTH / 2, HEIGHT / 2 - 16, 40, COLOR_GOLD);
    drawText('Press R or Restart to play again',
             WIDTH / 2, HEIGHT / 2 + 30, 18, COLOR_TEXT);
  }

  // Paused overlay — drawn last so it sits over the frozen court.
  if (state.paused) {
    ctx.fillStyle = 'rgba(11, 14, 26, 0.55)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawText('PAUSED', WIDTH / 2, HEIGHT / 2 - 14, 44, COLOR_GOLD);
    drawText('Press P or Esc to resume', WIDTH / 2, HEIGHT / 2 + 30, 18, COLOR_TEXT);
  }
}

// ---------------------------------------------------------------------------
// Main loop — requestAnimationFrame with a clamped delta time
// ---------------------------------------------------------------------------

let lastTimestamp = null;

function frame(timestamp) {
  if (lastTimestamp === null) lastTimestamp = timestamp;
  let dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  if (dt > 1 / 30) dt = 1 / 30; // tab-switch hiccups must not teleport the ball
  if (dt < 0) dt = 0;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

updateWinsDisplay(); // show the saved win tally as soon as the page loads
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Test hooks — a small handle on the internals, used by the headless smoke
// test (and handy in a browser console). Not part of the game itself.
// ---------------------------------------------------------------------------

const root = typeof window !== 'undefined' ? window : globalThis;
root.PongGame = {
  state: state,
  ball: ball,
  leftPaddle: leftPaddle,
  rightPaddle: rightPaddle,
  startMatch: startMatch,
  restart: restart,
  constants: { WIDTH: WIDTH, HEIGHT: HEIGHT, WIN_SCORE: WIN_SCORE, BALL_RADIUS: BALL_RADIUS },
  setBall: function (x, y, vx, vy) {
    ball.x = x; ball.y = y; ball.vx = vx; ball.vy = vy;
    ball.speed = Math.hypot(vx, vy) || BALL_START_SPEED;
    state.phase = 'play';
  },
  setScores: function (left, right) {
    state.leftScore = left;
    state.rightScore = right;
  },
};
