"use strict";

/*
 * Breakout — an original implementation for 1915 Arcade.
 * Vanilla JavaScript + Canvas 2D. No libraries, no assets.
 *
 * Layout of this file:
 *   1. Constants & canvas setup
 *   2. Input (keyboard + mouse)
 *   3. Game state & level construction
 *   4. Physics & collision
 *   5. Update loop
 *   6. Rendering
 *   7. Main loop & boot
 */

/* ------------------------------------------------------------------ */
/* 1. Constants & canvas setup                                        */
/* ------------------------------------------------------------------ */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;    // 480
const HEIGHT = canvas.height;  // 600

const PADDLE_WIDTH = 84;
const PADDLE_HEIGHT = 12;
const PADDLE_Y = HEIGHT - 32;          // top edge of the paddle
const PADDLE_KEY_SPEED = 460;          // px per second with arrow keys

const BALL_RADIUS = 7;
const BALL_BASE_SPEED = 320;           // px per second on level 1
const BALL_SPEED_PER_LEVEL = 45;       // extra speed each new level
const BALL_MAX_BOUNCE_ANGLE = Math.PI / 3; // 60 degrees from vertical

const BRICK_ROWS = 6;
const BRICK_COLS = 8;
const BRICK_GAP = 4;
const BRICK_TOP = 64;
const BRICK_SIDE = 16;
const BRICK_HEIGHT = 18;
const BRICK_WIDTH =
  (WIDTH - BRICK_SIDE * 2 - BRICK_GAP * (BRICK_COLS - 1)) / BRICK_COLS;

// One colour (and one point value) per row, top row worth the most.
const ROW_STYLES = [
  { color: "#ef5350", points: 60 },
  { color: "#ff9800", points: 50 },
  { color: "#ffd54f", points: 40 },
  { color: "#66bb6a", points: 30 },
  { color: "#42a5f5", points: 20 },
  { color: "#ab7be8", points: 10 },
];

const START_LIVES = 3;

/* ------------------------------------------------------------------ */
/* 2. Input                                                           */
/* ------------------------------------------------------------------ */

const keys = { left: false, right: false };
let mouseX = null; // paddle target from the mouse, in canvas coordinates

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "a") keys.left = true;
  if (event.key === "ArrowRight" || event.key === "d") keys.right = true;
  if (event.key === " ") {
    event.preventDefault();
    onActionButton();
  }
  if (event.key === "Enter") onActionButton();
});

document.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft" || event.key === "a") keys.left = false;
  if (event.key === "ArrowRight" || event.key === "d") keys.right = false;
});

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  // Scale from CSS pixels to canvas pixels (canvas may be shrunk on mobile).
  mouseX = ((event.clientX - rect.left) / rect.width) * WIDTH;
});

canvas.addEventListener("mousedown", () => onActionButton());

canvas.addEventListener("touchmove", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const touch = event.touches[0];
  mouseX = ((touch.clientX - rect.left) / rect.width) * WIDTH;
}, { passive: false });

canvas.addEventListener("touchstart", () => onActionButton());

// Space / click means "launch the ball" while waiting, and "restart"
// once the game is over.
function onActionButton() {
  if (game.state === "ready") {
    launchBall();
  } else if (game.state === "gameover" || game.state === "win") {
    resetGame();
  }
}

/* ------------------------------------------------------------------ */
/* 3. Game state & level construction                                 */
/* ------------------------------------------------------------------ */

const game = {
  state: "ready", // "ready" | "playing" | "gameover" | "win"
  score: 0,
  lives: START_LIVES,
  level: 1,
  paddle: { x: WIDTH / 2 - PADDLE_WIDTH / 2 },
  ball: { x: 0, y: 0, vx: 0, vy: 0, speed: BALL_BASE_SPEED },
  bricks: [],
};

function buildLevel() {
  game.bricks = [];
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      game.bricks.push({
        x: BRICK_SIDE + col * (BRICK_WIDTH + BRICK_GAP),
        y: BRICK_TOP + row * (BRICK_HEIGHT + BRICK_GAP),
        width: BRICK_WIDTH,
        height: BRICK_HEIGHT,
        color: ROW_STYLES[row].color,
        points: ROW_STYLES[row].points,
        alive: true,
      });
    }
  }
}

function ballSpeedForLevel(level) {
  return BALL_BASE_SPEED + (level - 1) * BALL_SPEED_PER_LEVEL;
}

// Park the ball on the paddle, waiting for a launch.
function resetBall() {
  game.ball.speed = ballSpeedForLevel(game.level);
  game.ball.x = game.paddle.x + PADDLE_WIDTH / 2;
  game.ball.y = PADDLE_Y - BALL_RADIUS - 1;
  game.ball.vx = 0;
  game.ball.vy = 0;
  game.state = "ready";
}

function launchBall() {
  // Launch upward at a slight random angle so no two serves are alike.
  const angle = (Math.random() * 0.5 - 0.25) * BALL_MAX_BOUNCE_ANGLE;
  game.ball.vx = game.ball.speed * Math.sin(angle);
  game.ball.vy = -game.ball.speed * Math.cos(angle);
  game.state = "playing";
}

function resetGame() {
  game.score = 0;
  game.lives = START_LIVES;
  game.level = 1;
  game.paddle.x = WIDTH / 2 - PADDLE_WIDTH / 2;
  buildLevel();
  resetBall();
  syncHud();
}

function nextLevel() {
  game.level += 1;
  buildLevel();
  resetBall();
  syncHud();
}

/* ------------------------------------------------------------------ */
/* 4. Physics & collision                                             */
/* ------------------------------------------------------------------ */

function movePaddle(dt) {
  if (keys.left) game.paddle.x -= PADDLE_KEY_SPEED * dt;
  if (keys.right) game.paddle.x += PADDLE_KEY_SPEED * dt;

  if (mouseX !== null) {
    // Ease the paddle centre toward the mouse for a smooth feel.
    const target = mouseX - PADDLE_WIDTH / 2;
    game.paddle.x += (target - game.paddle.x) * Math.min(1, dt * 22);
  }

  // Keep the paddle inside the arena.
  if (game.paddle.x < 0) game.paddle.x = 0;
  if (game.paddle.x > WIDTH - PADDLE_WIDTH) {
    game.paddle.x = WIDTH - PADDLE_WIDTH;
  }
}

function bounceOffWalls() {
  const ball = game.ball;
  if (ball.x - BALL_RADIUS < 0) {
    ball.x = BALL_RADIUS;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x + BALL_RADIUS > WIDTH) {
    ball.x = WIDTH - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx);
  }
  if (ball.y - BALL_RADIUS < 0) {
    ball.y = BALL_RADIUS;
    ball.vy = Math.abs(ball.vy);
  }
}

// The paddle bounce is the heart of Breakout: where the ball lands on
// the paddle decides the rebound angle, from straight up (dead centre)
// to 60 degrees off vertical (the very edge).
function bounceOffPaddle() {
  const ball = game.ball;
  const paddle = game.paddle;
  if (ball.vy <= 0) return; // only when travelling downward

  const overPaddle =
    ball.x + BALL_RADIUS > paddle.x &&
    ball.x - BALL_RADIUS < paddle.x + PADDLE_WIDTH &&
    ball.y + BALL_RADIUS >= PADDLE_Y &&
    ball.y + BALL_RADIUS <= PADDLE_Y + PADDLE_HEIGHT + ball.vy * 0.05 + 4;

  if (!overPaddle) return;

  const centre = paddle.x + PADDLE_WIDTH / 2;
  let offset = (ball.x - centre) / (PADDLE_WIDTH / 2);
  offset = Math.max(-1, Math.min(1, offset));

  const angle = offset * BALL_MAX_BOUNCE_ANGLE;
  ball.vx = ball.speed * Math.sin(angle);
  ball.vy = -ball.speed * Math.cos(angle);
  ball.y = PADDLE_Y - BALL_RADIUS - 0.5; // rest it exactly on the paddle
}

// Circle-vs-rectangle test for each live brick. On a hit the brick dies,
// the score grows, and the ball reflects along the shallower overlap
// axis so corner hits behave sensibly.
function collideBricks() {
  const ball = game.ball;
  for (const brick of game.bricks) {
    if (!brick.alive) continue;

    const nearestX = Math.max(brick.x, Math.min(ball.x, brick.x + brick.width));
    const nearestY = Math.max(brick.y, Math.min(ball.y, brick.y + brick.height));
    const dx = ball.x - nearestX;
    const dy = ball.y - nearestY;
    if (dx * dx + dy * dy > BALL_RADIUS * BALL_RADIUS) continue;

    brick.alive = false;
    game.score += brick.points;
    syncHud();

    if (Math.abs(dx) > Math.abs(dy)) {
      ball.vx = dx > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
    } else {
      ball.vy = dy > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
    }

    if (game.bricks.every((b) => !b.alive)) {
      nextLevel();
    }
    return; // one brick per frame keeps the physics stable
  }
}

function loseBallIfOut() {
  const ball = game.ball;
  if (ball.y - BALL_RADIUS <= HEIGHT) return;

  game.lives -= 1;
  syncHud();
  if (game.lives <= 0) {
    game.state = "gameover";
  } else {
    resetBall();
  }
}

/* ------------------------------------------------------------------ */
/* 5. Update loop                                                     */
/* ------------------------------------------------------------------ */

function update(dt) {
  movePaddle(dt);

  if (game.state === "ready") {
    // The ball rides the paddle until launched.
    game.ball.x = game.paddle.x + PADDLE_WIDTH / 2;
    game.ball.y = PADDLE_Y - BALL_RADIUS - 1;
    return;
  }
  if (game.state !== "playing") return;

  game.ball.x += game.ball.vx * dt;
  game.ball.y += game.ball.vy * dt;

  bounceOffWalls();
  bounceOffPaddle();
  collideBricks();
  loseBallIfOut();
}

/* ------------------------------------------------------------------ */
/* 6. Rendering                                                       */
/* ------------------------------------------------------------------ */

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // Bricks
  for (const brick of game.bricks) {
    if (!brick.alive) continue;
    ctx.fillStyle = brick.color;
    ctx.fillRect(brick.x, brick.y, brick.width, brick.height);
  }

  // Paddle
  ctx.fillStyle = "#ffd54f";
  ctx.fillRect(game.paddle.x, PADDLE_Y, PADDLE_WIDTH, PADDLE_HEIGHT);

  // Ball
  ctx.beginPath();
  ctx.arc(game.ball.x, game.ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "#e8eaf6";
  ctx.fill();
  ctx.closePath();

  // State overlays
  ctx.textAlign = "center";
  if (game.state === "ready") {
    ctx.fillStyle = "#e8eaf6";
    ctx.font = "20px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Press Space or click to launch", WIDTH / 2, HEIGHT / 2 + 60);
  } else if (game.state === "gameover") {
    ctx.fillStyle = "#ffd54f";
    ctx.font = "bold 40px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("GAME OVER", WIDTH / 2, HEIGHT / 2 - 10);
    ctx.fillStyle = "#e8eaf6";
    ctx.font = "20px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Score: " + game.score, WIDTH / 2, HEIGHT / 2 + 28);
    ctx.fillText("Press Space to play again", WIDTH / 2, HEIGHT / 2 + 60);
  }
}

function syncHud() {
  document.getElementById("score").textContent = String(game.score);
  document.getElementById("level").textContent = String(game.level);
  document.getElementById("lives").textContent = String(game.lives);
}

/* ------------------------------------------------------------------ */
/* 7. Main loop & boot                                                */
/* ------------------------------------------------------------------ */

let lastTime = 0;

function frame(timestamp) {
  // Clamp the step so a background tab can't teleport the ball.
  const dt = Math.min((timestamp - lastTime) / 1000, 0.033) || 0;
  lastTime = timestamp;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

buildLevel();
resetBall();
syncHud();
requestAnimationFrame(frame);

// Exposed for automated smoke tests (and curious players in devtools).
window.BreakoutGame = game;
