/* ═══════════════════════════════════════════════════════════════
   SNAKE — Complete Game Logic
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────
  const GRID_SIZE    = 20;          // 20×20 grid
  const INITIAL_LEN  = 3;
  const BASE_TICK_MS = 150;         // starting speed (ms per tick)
  const MIN_TICK_MS  = 65;          // speed cap
  const SPEED_STEP   = 8;           // ms reduction per level
  const LEVEL_EVERY  = 5;           // foods per level-up

  const DIR = {
    UP:    { x:  0, y: -1 },
    DOWN:  { x:  0, y:  1 },
    LEFT:  { x: -1, y:  0 },
    RIGHT: { x:  1, y:  0 },
  };

  const STATE = { IDLE: 0, COUNTDOWN: 1, PLAYING: 2, PAUSED: 3, GAMEOVER: 4 };

  // ── DOM refs ───────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const canvas        = $('game-canvas');
  const ctx           = canvas.getContext('2d');

  const elCurrentScore = $('current-score');
  const elHighScore    = $('high-score');
  const elScoreBox     = $('score-box');
  const elLevelValue   = $('level-value');
  const elCountdown    = $('countdown-overlay');
  const elCountNum     = $('countdown-number');
  const elLevelToast   = $('levelup-toast');
  const elBtnPause     = $('btn-pause');
  const elBtnSound     = $('btn-sound');
  const elSoundIcon    = $('sound-icon');
  const elContainer    = $('game-container');
  const elFooterHint   = $('footer-hint');

  const screenStart    = $('screen-start');
  const screenPause    = $('screen-pause');
  const screenGameover = $('screen-gameover');

  // ── Game State ─────────────────────────────────────────────
  let state       = STATE.IDLE;
  let snake       = [];
  let food        = null;
  let direction   = DIR.RIGHT;
  let nextDir     = DIR.RIGHT;
  let dirQueue    = [];
  let score       = 0;
  let highScore   = 0;
  let level       = 1;
  let tickMs      = BASE_TICK_MS;
  let lastTick    = 0;
  let accumulator = 0;
  let rafId       = null;
  let foodEaten   = 0;

  // Particles
  let particles = [];

  // Food animation
  let foodPulse = 0;

  // Sound
  let soundEnabled = true;
  let audioCtx     = null;

  // Swipe
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  // Canvas pixel dimensions (device-pixel-aware)
  let cellPx = 0;
  let canvasW = 0;
  let canvasH = 0;

  // ══════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ══════════════════════════════════════════════════════════

  function init() {
    loadPreferences();
    sizeCanvas();
    renderBoard();
    bindEvents();
    updateScoreUI();
    updateSoundUI();

    // Show best score on start screen
    const bestEl = document.querySelector('#start-best strong');
    if (bestEl) bestEl.textContent = highScore;
  }

  // ── Canvas sizing ──────────────────────────────────────────
  function sizeCanvas() {
    const rect = elContainer.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    const size = Math.floor(rect.width);

    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    canvasW = size;
    canvasH = size;
    cellPx  = size / GRID_SIZE;
  }

  // ── Persistence ────────────────────────────────────────────
  function loadPreferences() {
    try {
      const hs = localStorage.getItem('snake_highscore');
      if (hs !== null) highScore = parseInt(hs, 10) || 0;
      const snd = localStorage.getItem('snake_sound');
      if (snd !== null) soundEnabled = snd === '1';
    } catch (_) { /* localStorage unavailable */ }
  }

  function saveHighScore() {
    try { localStorage.setItem('snake_highscore', String(highScore)); } catch (_) {}
  }

  function saveSoundPref() {
    try { localStorage.setItem('snake_sound', soundEnabled ? '1' : '0'); } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════
  //  EVENTS
  // ══════════════════════════════════════════════════════════

  function bindEvents() {
    // Buttons
    $('btn-start').addEventListener('click',        () => { playClickSound(); startCountdown(); });
    $('btn-resume').addEventListener('click',       () => { playClickSound(); resumeGame(); });
    $('btn-restart-pause').addEventListener('click', () => { playClickSound(); restartGame(); });
    $('btn-play-again').addEventListener('click',    () => { playClickSound(); restartGame(); });
    $('btn-main-menu').addEventListener('click',     () => { playClickSound(); showMainMenu(); });
    elBtnPause.addEventListener('click',             () => { playClickSound(); togglePause(); });
    elBtnSound.addEventListener('click',             () => { toggleSound(); });

    // Keyboard
    document.addEventListener('keydown', handleKeydown);

    // Touch / swipe
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });
    // Also on overlays so swipe works everywhere on the game area
    elContainer.addEventListener('touchstart', onTouchStart, { passive: false });
    elContainer.addEventListener('touchmove',  onTouchMove,  { passive: false });
    elContainer.addEventListener('touchend',   onTouchEnd,   { passive: false });

    // Resize
    window.addEventListener('resize', debounce(() => {
      sizeCanvas();
      if (state !== STATE.PLAYING && state !== STATE.COUNTDOWN) renderBoard();
    }, 150));
  }

  // ── Keyboard ───────────────────────────────────────────────
  function handleKeydown(e) {
    const key = e.key;

    // Pause / resume
    if (key === 'p' || key === 'P' || key === ' ') {
      if (state === STATE.PLAYING || state === STATE.PAUSED) {
        e.preventDefault();
        playClickSound();
        togglePause();
        return;
      }
    }

    // Direction
    if (state === STATE.PLAYING) {
      let newDir = null;
      if (key === 'ArrowUp'    || key === 'w' || key === 'W') newDir = DIR.UP;
      if (key === 'ArrowDown'  || key === 's' || key === 'S') newDir = DIR.DOWN;
      if (key === 'ArrowLeft'  || key === 'a' || key === 'A') newDir = DIR.LEFT;
      if (key === 'ArrowRight' || key === 'd' || key === 'D') newDir = DIR.RIGHT;

      if (newDir) {
        e.preventDefault();
        queueDirection(newDir);
      }
    }
  }

  // ── Direction queue (prevents 180° and allows rapid turns) ─
  function queueDirection(newDir) {
    if (dirQueue.length >= 3) return; // limit queue depth

    const lastQueued = dirQueue.length > 0 ? dirQueue[dirQueue.length - 1] : direction;
    // Prevent reverse
    if (lastQueued.x + newDir.x === 0 && lastQueued.y + newDir.y === 0) return;
    // Prevent duplicate
    if (lastQueued === newDir) return;

    dirQueue.push(newDir);
  }

  // ── Touch / Swipe ──────────────────────────────────────────
  function onTouchStart(e) {
    if (state !== STATE.PLAYING) return;
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartTime = performance.now();
    e.preventDefault(); // prevent scroll
  }

  function onTouchMove(e) {
    if (state === STATE.PLAYING) e.preventDefault();
  }

  function onTouchEnd(e) {
    if (state !== STATE.PLAYING) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const dt = performance.now() - touchStartTime;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 20 || dt > 800) return; // too short or too slow

    let newDir;
    if (Math.abs(dx) > Math.abs(dy)) {
      newDir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
    } else {
      newDir = dy > 0 ? DIR.DOWN : DIR.UP;
    }
    queueDirection(newDir);
  }

  // ══════════════════════════════════════════════════════════
  //  GAME FLOW
  // ══════════════════════════════════════════════════════════

  function startCountdown() {
    hideAllOverlays();
    resetGameState();
    renderBoard(); // draw initial board behind countdown
    elBtnPause.disabled = true;

    state = STATE.COUNTDOWN;
    let count = 3;
    elCountdown.classList.remove('hidden');
    elCountNum.textContent = count;
    triggerCountAnim();

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        elCountNum.textContent = count;
        triggerCountAnim();
        playClickSound();
      } else if (count === 0) {
        elCountNum.textContent = 'GO!';
        elCountNum.style.color = 'var(--success)';
        triggerCountAnim();
        playClickSound();
      } else {
        clearInterval(interval);
        elCountdown.classList.add('hidden');
        elCountNum.style.color = '';
        startGame();
      }
    }, 700);
  }

  function triggerCountAnim() {
    elCountNum.style.animation = 'none';
    // force reflow
    void elCountNum.offsetWidth;
    elCountNum.style.animation = 'countPop 0.6s ease';
  }

  function resetGameState() {
    const startX = Math.floor(GRID_SIZE / 2);
    const startY = Math.floor(GRID_SIZE / 2);
    snake = [];
    for (let i = INITIAL_LEN - 1; i >= 0; i--) {
      snake.push({ x: startX - i, y: startY });
    }
    direction = DIR.RIGHT;
    nextDir   = DIR.RIGHT;
    dirQueue  = [];
    score     = 0;
    level     = 1;
    foodEaten = 0;
    tickMs    = BASE_TICK_MS;
    particles = [];
    accumulator = 0;
    food = spawnFood();
    updateScoreUI();
    elLevelValue.textContent = level;
  }

  function startGame() {
    state = STATE.PLAYING;
    elBtnPause.disabled = false;
    lastTick = performance.now();
    accumulator = 0;
    scheduleLoop();
  }

  function restartGame() {
    cancelLoop();
    hideAllOverlays();
    startCountdown();
  }

  function showMainMenu() {
    cancelLoop();
    hideAllOverlays();
    state = STATE.IDLE;
    elBtnPause.disabled = true;
    screenStart.classList.remove('hidden');

    const bestEl = document.querySelector('#start-best strong');
    if (bestEl) bestEl.textContent = highScore;

    resetGameState();
    renderBoard();
  }

  function togglePause() {
    if (state === STATE.PLAYING) {
      pauseGame();
    } else if (state === STATE.PAUSED) {
      resumeGame();
    }
  }

  function pauseGame() {
    if (state !== STATE.PLAYING) return;
    state = STATE.PAUSED;
    cancelLoop();
    screenPause.classList.remove('hidden');
    elBtnPause.querySelector('span').textContent = '▶';
    playPauseSound();
  }

  function resumeGame() {
    if (state !== STATE.PAUSED) return;
    hideAllOverlays();
    state = STATE.PLAYING;
    elBtnPause.querySelector('span').textContent = '⏸';
    lastTick = performance.now();
    accumulator = 0;
    playPauseSound();
    scheduleLoop();
  }

  function endGame() {
    state = STATE.GAMEOVER;
    cancelLoop();
    elBtnPause.disabled = true;
    elBtnPause.querySelector('span').textContent = '⏸';

    // Update high score
    if (score > highScore) {
      highScore = score;
      saveHighScore();
    }
    updateScoreUI();

    // Screen shake
    elContainer.classList.add('shake');
    setTimeout(() => elContainer.classList.remove('shake'), 400);

    // Sound
    playGameOverSound();

    // Show game-over overlay after a short delay
    setTimeout(() => {
      $('go-score').textContent = score;
      $('go-best').textContent  = highScore;
      screenGameover.classList.remove('hidden');
    }, 500);
  }

  function hideAllOverlays() {
    screenStart.classList.add('hidden');
    screenPause.classList.add('hidden');
    screenGameover.classList.add('hidden');
    elCountdown.classList.add('hidden');
  }

  // ══════════════════════════════════════════════════════════
  //  GAME LOOP
  // ══════════════════════════════════════════════════════════

  function scheduleLoop() {
    rafId = requestAnimationFrame(gameLoop);
  }

  function cancelLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function gameLoop(now) {
    if (state !== STATE.PLAYING) return;

    const dt = now - lastTick;
    lastTick = now;
    accumulator += dt;

    // Fixed-timestep updates
    while (accumulator >= tickMs) {
      accumulator -= tickMs;
      update();
      if (state !== STATE.PLAYING) return; // game over during update
    }

    render(now);
    rafId = requestAnimationFrame(gameLoop);
  }

  // ══════════════════════════════════════════════════════════
  //  UPDATE
  // ══════════════════════════════════════════════════════════

  function update() {
    // Consume direction queue
    if (dirQueue.length > 0) {
      const next = dirQueue.shift();
      // Double-check reverse guard
      if (!(direction.x + next.x === 0 && direction.y + next.y === 0)) {
        direction = next;
      }
    }

    // Move head
    const head = snake[snake.length - 1];
    const newHead = {
      x: head.x + direction.x,
      y: head.y + direction.y,
    };

    // Wall collision
    if (newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE) {
      endGame();
      return;
    }

    // Self collision (check against all body except tail, which will move)
    for (let i = 1; i < snake.length; i++) {
      if (snake[i].x === newHead.x && snake[i].y === newHead.y) {
        endGame();
        return;
      }
    }

    snake.push(newHead);

    // Food collision
    if (food && newHead.x === food.x && newHead.y === food.y) {
      eatFood();
    } else {
      snake.shift(); // remove tail
    }
  }

  function eatFood() {
    score += 10;
    foodEaten++;
    updateScoreUI();
    popScore();

    // Particles at food position
    spawnParticles(food.x, food.y);

    // Respawn food
    food = spawnFood();

    // Sound
    playEatSound();

    // Difficulty progression
    if (foodEaten % LEVEL_EVERY === 0) {
      levelUp();
    }
  }

  function levelUp() {
    level++;
    tickMs = Math.max(MIN_TICK_MS, BASE_TICK_MS - (level - 1) * SPEED_STEP);
    elLevelValue.textContent = level;
    showLevelUpToast();
    playLevelUpSound();
  }

  function spawnFood() {
    const occupied = new Set(snake.map(s => s.x + ',' + s.y));
    const free = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let y = 0; y < GRID_SIZE; y++) {
        if (!occupied.has(x + ',' + y)) free.push({ x, y });
      }
    }
    if (free.length === 0) return null; // board full — win condition (extremely rare)
    return free[Math.floor(Math.random() * free.length)];
  }

  // ══════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════

  function render(now) {
    drawBoard();
    drawFood(now);
    drawSnake();
    drawParticles();
  }

  /** Also used for static (idle) board rendering */
  function renderBoard() {
    drawBoard();
    if (food) drawFood(performance.now());
    if (snake.length) drawSnake();
  }

  // ── Board background & grid ─────────────────────────
  function drawBoard() {
    // Background
    ctx.fillStyle = '#0f1623';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < GRID_SIZE; i++) {
      const p = i * cellPx;
      ctx.beginPath();
      ctx.moveTo(p, 0); ctx.lineTo(p, canvasH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p); ctx.lineTo(canvasW, p);
      ctx.stroke();
    }
  }

  // ── Snake ────────────────────────────────────────────
  function drawSnake() {
    const len = snake.length;
    const pad = cellPx * 0.1;
    const r   = cellPx * 0.22;

    for (let i = 0; i < len; i++) {
      const seg = snake[i];
      const isHead = (i === len - 1);
      const t = i / Math.max(len - 1, 1);         // 0 = tail, 1 = head

      const x = seg.x * cellPx + pad;
      const y = seg.y * cellPx + pad;
      const size = cellPx - pad * 2;

      // Gradient from tail (dim) to head (bright)
      const hue = 174;     // cyan
      const sat = 70 + t * 30;
      const light = 30 + t * 28;
      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;

      // Glow on head
      if (isHead) {
        ctx.shadowColor = 'rgba(34,211,238,0.5)';
        ctx.shadowBlur  = 10;
      }

      roundRect(ctx, x, y, size, size, r);
      ctx.fill();

      // Eyes on head
      if (isHead) {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur  = 0;
        drawEyes(seg);
      }
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
  }

  function drawEyes(head) {
    const cx = head.x * cellPx + cellPx * 0.5;
    const cy = head.y * cellPx + cellPx * 0.5;
    const eyeR = cellPx * 0.08;
    const offset = cellPx * 0.18;

    // Position eyes based on direction
    let e1, e2;
    if (direction === DIR.RIGHT) {
      e1 = { x: cx + offset, y: cy - offset };
      e2 = { x: cx + offset, y: cy + offset };
    } else if (direction === DIR.LEFT) {
      e1 = { x: cx - offset, y: cy - offset };
      e2 = { x: cx - offset, y: cy + offset };
    } else if (direction === DIR.UP) {
      e1 = { x: cx - offset, y: cy - offset };
      e2 = { x: cx + offset, y: cy - offset };
    } else {
      e1 = { x: cx - offset, y: cy + offset };
      e2 = { x: cx + offset, y: cy + offset };
    }

    ctx.fillStyle = '#0f1623';
    ctx.beginPath(); ctx.arc(e1.x, e1.y, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e2.x, e2.y, eyeR, 0, Math.PI * 2); ctx.fill();
  }

  // ── Food ─────────────────────────────────────────────
  function drawFood(now) {
    if (!food) return;

    foodPulse = (now || 0) * 0.003;
    const pulse = 1 + Math.sin(foodPulse) * 0.12;
    const base  = cellPx * 0.35;
    const r     = base * pulse;
    const cx    = food.x * cellPx + cellPx * 0.5;
    const cy    = food.y * cellPx + cellPx * 0.5;

    // Glow
    ctx.shadowColor = 'rgba(251,191,36,0.55)';
    ctx.shadowBlur  = 12;

    // Outer ring
    ctx.fillStyle = 'rgba(251,191,36,0.15)';
    ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.fill();

    // Food body
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.28, 0, Math.PI * 2); ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
  }

  // ── Particles ────────────────────────────────────────
  function spawnParticles(gx, gy) {
    const cx = gx * cellPx + cellPx * 0.5;
    const cy = gy * cellPx + cellPx * 0.5;
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2.5;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.02 + Math.random() * 0.025,
        radius: 1.5 + Math.random() * 2,
        hue: 40 + Math.random() * 20,
      });
    }
  }

  function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = `hsl(${p.hue}, 90%, 60%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── Rounded rect helper ─────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ══════════════════════════════════════════════════════════
  //  UI UPDATES
  // ══════════════════════════════════════════════════════════

  function updateScoreUI() {
    elCurrentScore.textContent = score;
    elHighScore.textContent    = highScore;
  }

  function popScore() {
    elCurrentScore.classList.add('pop');
    setTimeout(() => elCurrentScore.classList.remove('pop'), 220);
  }

  function showLevelUpToast() {
    elLevelToast.classList.remove('hidden');
    // Restart animation
    elLevelToast.style.animation = 'none';
    void elLevelToast.offsetWidth;
    elLevelToast.style.animation = 'toastIn 1.2s ease forwards';
    setTimeout(() => elLevelToast.classList.add('hidden'), 1300);
  }

  function updateSoundUI() {
    elSoundIcon.textContent = soundEnabled ? '🔊' : '🔇';
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    updateSoundUI();
    saveSoundPref();
    if (soundEnabled) playClickSound();
  }

  // ══════════════════════════════════════════════════════════
  //  SOUND — Web Audio API (generated, no files)
  // ══════════════════════════════════════════════════════════

  function getAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) { return null; }
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, duration, type, gainVal, rampDown) {
    if (!soundEnabled) return;
    const ac = getAudioCtx();
    if (!ac) return;
    try {
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      gain.gain.setValueAtTime(gainVal || 0.12, ac.currentTime);
      if (rampDown !== false) {
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
      }
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + duration);
    } catch (_) {}
  }

  function playEatSound() {
    playTone(600, 0.1, 'sine', 0.15);
    setTimeout(() => playTone(800, 0.1, 'sine', 0.1), 60);
  }

  function playGameOverSound() {
    playTone(300, 0.3, 'square', 0.08);
    setTimeout(() => playTone(200, 0.4, 'square', 0.06), 150);
  }

  function playClickSound() {
    playTone(500, 0.06, 'sine', 0.06);
  }

  function playLevelUpSound() {
    playTone(500, 0.12, 'sine', 0.1);
    setTimeout(() => playTone(700, 0.12, 'sine', 0.1), 80);
    setTimeout(() => playTone(900, 0.15, 'sine', 0.1), 160);
  }

  function playPauseSound() {
    playTone(400, 0.08, 'triangle', 0.06);
  }

  // ══════════════════════════════════════════════════════════
  //  UTILITY
  // ══════════════════════════════════════════════════════════

  function debounce(fn, ms) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

  // ══════════════════════════════════════════════════════════
  //  BOOT
  // ══════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
