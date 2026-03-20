// Game states: LOADING, READY, COUNTDOWN, PLAYING, GAME_OVER

const GAME_DURATION = 60;

// Difficulty progression
const DIFFICULTY = [
  { time: 0,  spawnInterval: 1.5, speed: 0.15, maxTargets: 3 },
  { time: 15, spawnInterval: 1.3, speed: 0.18, maxTargets: 4 },
  { time: 30, spawnInterval: 1.1, speed: 0.21, maxTargets: 4 },
  { time: 45, spawnInterval: 0.8, speed: 0.25, maxTargets: 5 },
];

// Target types
const TARGET_PUNCH = 'punch';
const TARGET_KICK = 'kick';

// Hit radius (in normalized coordinates)
const PUNCH_HIT_RADIUS = 0.09;
const KICK_HIT_RADIUS = 0.095;

class Target {
  constructor(type) {
    this.type = type;
    this.radius = type === TARGET_PUNCH ? 40 : 50;
    this.points = type === TARGET_PUNCH ? 100 : 200;
    this.color = type === TARGET_PUNCH ? '#ff3333' : '#3388ff';
    this.glowColor = type === TARGET_PUNCH ? 'rgba(255,50,50,0.4)' : 'rgba(50,130,255,0.4)';
    this.alive = true;
    this.wasHit = false;

    // Spawn from edges, move toward center area
    const edge = Math.floor(Math.random() * 4);
    const centerX = 0.3 + Math.random() * 0.4;
    const centerY = 0.3 + Math.random() * 0.4;

    switch (edge) {
      case 0: this.x = Math.random(); this.y = -0.05; break;
      case 1: this.x = Math.random(); this.y = 1.05; break;
      case 2: this.x = -0.05; this.y = Math.random(); break;
      case 3: this.x = 1.05; this.y = Math.random(); break;
    }

    const dx = centerX - this.x;
    const dy = centerY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.vx = dx / dist;
    this.vy = dy / dist;
    this.lifetime = 0;
  }

  update(dt, speed) {
    this.x += this.vx * speed * dt;
    this.y += this.vy * speed * dt;
    this.lifetime += dt;

    // Mark as dead if off-screen after entering
    if (this.lifetime > 1 &&
        (this.x < -0.15 || this.x > 1.15 || this.y < -0.15 || this.y > 1.15)) {
      this.alive = false;
    }
  }

  draw(ctx, w, h) {
    const px = this.x * w;
    const py = this.y * h;
    const r = this.radius;

    const pulse = 1 + Math.sin(this.lifetime * 5) * 0.15;
    const glowR = r * 1.5 * pulse;

    ctx.save();

    // Glow
    const gradient = ctx.createRadialGradient(px, py, r * 0.3, px, py, glowR);
    gradient.addColorStop(0, this.glowColor);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(px, py, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Main circle
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner highlight
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(px - r * 0.2, py - r * 0.2, r * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${r * 0.7}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.type === TARGET_PUNCH ? 'P' : 'K', px, py);

    ctx.restore();
  }
}

export class Game {
  constructor(canvas, ctx, effects, sound) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.effects = effects;
    this.sound = sound;

    this.state = 'LOADING';
    this.score = 0;
    this.timeRemaining = GAME_DURATION;
    this.combo = 0;
    this.maxCombo = 0;
    this.totalHits = 0;
    this.totalTargets = 0;

    this.targets = [];
    this.spawnTimer = 0;
    this.countdownValue = 3;
    this.countdownTimer = 0;
    this.elapsedTime = 0;
    this._lastPoseState = null;
    this._allowPunchRestart = false;

    this._setupInput();
  }

  _setupInput() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.state === 'READY') {
        this._startCountdown();
      }
      if (e.code === 'KeyR' && this.state === 'GAME_OVER') {
        this._restart();
      }
    });
  }

  setState(newState) {
    this.state = newState;
    this._updateOverlays();
  }

  _updateOverlays() {
    document.getElementById('loading-overlay').classList.toggle('hidden', this.state !== 'LOADING');
    document.getElementById('ready-overlay').classList.toggle('hidden', this.state !== 'READY');
    document.getElementById('countdown-overlay').classList.toggle('hidden', this.state !== 'COUNTDOWN');
    document.getElementById('gameover-overlay').classList.toggle('hidden', this.state !== 'GAME_OVER');
  }

  _startCountdown() {
    this.countdownValue = 3;
    this.countdownTimer = 0;
    this.setState('COUNTDOWN');
    document.getElementById('countdown-number').textContent = '3';
    this.sound.playCountdown();
  }

  _startGame() {
    this.score = 0;
    this.timeRemaining = GAME_DURATION;
    this.combo = 0;
    this.maxCombo = 0;
    this.totalHits = 0;
    this.totalTargets = 0;
    this.targets = [];
    this.spawnTimer = 0;
    this.elapsedTime = 0;
    this.effects.clear();
    this._updateHUD();
    this.setState('PLAYING');
    this.sound.playGo();
  }

  _restart() {
    this._startCountdown();
  }

  _getDifficulty() {
    let diff = DIFFICULTY[0];
    for (const d of DIFFICULTY) {
      if (this.elapsedTime >= d.time) diff = d;
    }
    return diff;
  }

  _spawnTarget() {
    const diff = this._getDifficulty();
    if (this.targets.length >= diff.maxTargets) return;

    const type = Math.random() < 0.7 ? TARGET_PUNCH : TARGET_KICK;
    this.targets.push(new Target(type));
    this.totalTargets++;
  }

  _updateHUD() {
    document.getElementById('score').textContent = this.score;
    document.getElementById('timer').textContent = Math.ceil(this.timeRemaining);

    const comboEl = document.getElementById('combo');
    if (this.combo >= 2) {
      const multiplier = this._getComboMultiplier();
      comboEl.textContent = `COMBO x${this.combo} (${multiplier}x)`;
      comboEl.style.transform = 'scale(1.2)';
      setTimeout(() => { comboEl.style.transform = 'scale(1)'; }, 100);
    } else {
      comboEl.textContent = '';
    }
  }

  _getComboMultiplier() {
    return Math.min(3, 1 + Math.floor(this.combo / 3));
  }

  _checkCollisions(poseState) {
    if (!poseState.landmarks) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    for (const punch of poseState.punches) {
      for (const target of this.targets) {
        if (!target.alive || target.wasHit || target.type !== TARGET_PUNCH) continue;
        const dx = punch.x - target.x;
        const dy = punch.y - target.y;
        if (Math.sqrt(dx * dx + dy * dy) < PUNCH_HIT_RADIUS) {
          this._hitTarget(target, punch.x * w, punch.y * h, TARGET_PUNCH);
        }
      }
    }

    for (const kick of poseState.kicks) {
      for (const target of this.targets) {
        if (!target.alive || target.wasHit) continue;
        const dx = kick.x - target.x;
        const dy = kick.y - target.y;
        if (Math.sqrt(dx * dx + dy * dy) < KICK_HIT_RADIUS) {
          this._hitTarget(target, kick.x * w, kick.y * h, TARGET_KICK);
        }
      }
    }
  }

  _getAwardedPoints(target, attackType) {
    if (target.type === TARGET_PUNCH && attackType === TARGET_KICK) return 200;
    return target.points;
  }

  _hitTarget(target, screenX, screenY, attackType) {
    target.alive = false;
    target.wasHit = true;
    this.combo++;
    this.totalHits++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    const awardedPoints = this._getAwardedPoints(target, attackType);
    const multiplier = this._getComboMultiplier();
    this.score += awardedPoints * multiplier;

    this.effects.spawnHit(screenX, screenY, target.color, awardedPoints, multiplier);
    this.sound.playHit(this.combo);

    if (this.combo >= 2) {
      this.sound.playCombo(this.combo);
    }
  }

  _missTarget(target) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.effects.spawnMiss(target.x * w, target.y * h);
    this.sound.playMiss();
    this.combo = 0;
  }

  update(dt, poseState) {
    this._lastPoseState = poseState;

    if (this.state === 'COUNTDOWN') {
      this.countdownTimer += dt;
      if (this.countdownTimer >= 1) {
        this.countdownTimer = 0;
        this.countdownValue--;
        if (this.countdownValue <= 0) {
          this._startGame();
        } else {
          document.getElementById('countdown-number').textContent = this.countdownValue;
          this.sound.playCountdown();
        }
      }
      return;
    }

    if (this.state === 'READY') {
      if (poseState.punches.length > 0) {
        this._startCountdown();
      }
      return;
    }

    if (this.state === 'GAME_OVER') {
      if (this._allowPunchRestart && poseState.punches.length > 0) {
        this._allowPunchRestart = false;
        this._restart();
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    this.elapsedTime += dt;
    this.timeRemaining -= dt;

    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this._gameOver();
      return;
    }

    // Spawn targets
    const diff = this._getDifficulty();
    this.spawnTimer += dt;
    if (this.spawnTimer >= diff.spawnInterval) {
      this.spawnTimer = 0;
      this._spawnTarget();
    }

    // Check collisions BEFORE removing dead targets
    this._checkCollisions(poseState);

    // Update and remove dead targets
    for (let i = this.targets.length - 1; i >= 0; i--) {
      this.targets[i].update(dt, diff.speed);
      if (!this.targets[i].alive) {
        if (!this.targets[i].wasHit) {
          this._missTarget(this.targets[i]);
        }
        this.targets.splice(i, 1);
      }
    }

    // Update effects
    this.effects.update(dt);

    // Update HUD
    this._updateHUD();
  }

  _gameOver() {
    this.setState('GAME_OVER');
    this.sound.playGameOver();

    document.getElementById('final-score').textContent = this.score;
    document.getElementById('max-combo').textContent = this.maxCombo;
    const accuracy = this.totalTargets > 0
      ? Math.round((this.totalHits / this.totalTargets) * 100)
      : 0;
    document.getElementById('accuracy').textContent = accuracy;

    setTimeout(() => { this._allowPunchRestart = true; }, 1500);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (this.state === 'PLAYING' || this.state === 'GAME_OVER') {
      for (const target of this.targets) {
        target.draw(ctx, w, h);
      }
      this.effects.draw();
    }

    if (this.state === 'PLAYING' || this.state === 'READY') {
      this._drawSkeleton();
    }
  }

  _drawSkeleton() {
    if (!this._lastPoseState || !this._lastPoseState.landmarks) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const lm = this._lastPoseState.landmarks;
    const leftFist = this._lastPoseState.fists?.left;
    const rightFist = this._lastPoseState.fists?.right;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 128, 0.5)';
    ctx.lineWidth = 2;

    const connections = [
      [11, 12], [11, 13], [12, 14],
      [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
      [24, 26], [26, 28],
    ];

    for (const [a, b] of connections) {
      if (lm[a] && lm[b]) {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
        ctx.stroke();
      }
    }

    const fistConnections = [
      [13, leftFist],
      [14, rightFist],
    ];

    for (const [joint, point] of fistConnections) {
      if (lm[joint] && point) {
        ctx.beginPath();
        ctx.moveTo(lm[joint].x * w, lm[joint].y * h);
        ctx.lineTo(point.x * w, point.y * h);
        ctx.stroke();
      }
    }

    const keyJoints = [27, 28];
    for (const idx of keyJoints) {
      if (lm[idx]) {
        ctx.fillStyle = 'rgba(0, 255, 128, 0.8)';
        ctx.beginPath();
        ctx.arc(lm[idx].x * w, lm[idx].y * h, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = 'rgba(255, 220, 0, 0.9)';
    for (const fist of [leftFist, rightFist]) {
      if (!fist) continue;
      ctx.beginPath();
      ctx.arc(fist.x * w, fist.y * h, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
