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
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;

// Hit radius (in normalized coordinates)
const PUNCH_HIT_RADIUS = 0.09;
const KICK_HIT_RADIUS = 0.095;
const KICK_PUNCH_TARGET_HIT_RADIUS = 0.115;
const AVATAR_SMOOTH_SPEED = 16;
const AVATAR_MISSING_FRAME_TOLERANCE = 8;

const AVATAR_COLORS = {
  outline: '#4b345c',
  hoodie: '#ff9fc8',
  hoodieDark: '#ff7db1',
  sleeves: '#ffc8dd',
  gloves: '#fff1f7',
  mittens: '#ffedf5',
  boots: '#9f86ff',
  face: '#ffe8cf',
  hoodInner: '#fff7fb',
  hair: '#5f4b8b',
  eyes: '#2b2144',
  blush: '#ff8db3',
  mouth: '#ff6f91',
  heart: '#fff7fb',
};

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalize(vec, fallback = { x: 0, y: -1 }) {
  const length = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
  if (length === 0) return fallback;
  return {
    x: vec.x / length,
    y: vec.y / length,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPoint(a, b, t) {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  };
}

function toScreen(point, w, h) {
  return {
    x: point.x * w,
    y: point.y * h,
  };
}

function extendPoint(a, b, amount) {
  return {
    x: b.x + (b.x - a.x) * amount,
    y: b.y + (b.y - a.y) * amount,
  };
}

class AvatarRenderer {
  constructor() {
    this._rig = null;
    this._missingFrames = AVATAR_MISSING_FRAME_TOLERANCE + 1;
  }

  update(poseState, dt) {
    const nextRig = this._buildRig(poseState);
    if (!nextRig) {
      this._missingFrames++;
      if (this._missingFrames > AVATAR_MISSING_FRAME_TOLERANCE) {
        this._rig = null;
      }
      return;
    }

    const alpha = this._rig
      ? 1 - Math.exp(-Math.max(dt, 1 / 60) * AVATAR_SMOOTH_SPEED)
      : 1;

    this._rig = this._rig ? this._smoothRig(this._rig, nextRig, alpha) : nextRig;
    this._missingFrames = 0;
  }

  draw(ctx, w, h) {
    if (!this._rig || this._missingFrames > AVATAR_MISSING_FRAME_TOLERANCE) return;

    const rig = {};
    for (const [key, point] of Object.entries(this._rig)) {
      rig[key] = toScreen(point, w, h);
    }

    const shoulderWidth = dist(rig.leftShoulder, rig.rightShoulder);
    const hipWidth = dist(rig.leftHip, rig.rightHip);
    const torsoLength = dist(rig.neck, rig.hipCenter);

    const torsoWidth = Math.max(58, shoulderWidth * 0.66);
    const shoulderBarWidth = Math.max(30, shoulderWidth * 0.24);
    const upperArmWidth = Math.max(18, shoulderWidth * 0.17);
    const lowerArmWidth = upperArmWidth * 0.92;
    const upperLegWidth = Math.max(24, hipWidth * 0.36);
    const lowerLegWidth = upperLegWidth * 0.96;
    const headRadius = Math.max(36, shoulderWidth * 0.46);
    const hoodRadius = headRadius * 1.13;
    const gloveRadius = Math.max(18, upperArmWidth * 0.9);
    const bootRadius = Math.max(20, lowerLegWidth * 0.88);
    const cuffRadius = upperArmWidth * 0.68;
    const torsoTop = rig.neck;
    const torsoBottom = rig.hipCenter;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    this._drawCapsule(ctx, rig.leftHip, rig.leftKnee, upperLegWidth, AVATAR_COLORS.hoodieDark);
    this._drawCapsule(ctx, rig.leftKnee, rig.leftFoot, lowerLegWidth, AVATAR_COLORS.boots);
    this._drawCapsule(ctx, rig.rightHip, rig.rightKnee, upperLegWidth, AVATAR_COLORS.hoodieDark);
    this._drawCapsule(ctx, rig.rightKnee, rig.rightFoot, lowerLegWidth, AVATAR_COLORS.boots);

    this._drawCapsule(ctx, torsoTop, torsoBottom, torsoWidth, AVATAR_COLORS.hoodie);
    this._drawCapsule(ctx, rig.leftShoulder, rig.rightShoulder, shoulderBarWidth, AVATAR_COLORS.hoodieDark);
    this._drawCapsule(ctx, rig.leftHip, rig.rightHip, upperLegWidth * 0.8, AVATAR_COLORS.hoodieDark);

    this._drawCapsule(ctx, rig.leftShoulder, rig.leftElbow, upperArmWidth, AVATAR_COLORS.sleeves);
    this._drawCapsule(ctx, rig.rightShoulder, rig.rightElbow, upperArmWidth, AVATAR_COLORS.sleeves);
    this._drawCircle(ctx, rig.leftFoot, bootRadius, AVATAR_COLORS.boots);
    this._drawCircle(ctx, rig.rightFoot, bootRadius, AVATAR_COLORS.boots);

    this._drawHood(ctx, rig.headCenter, hoodRadius);
    this._drawCircle(ctx, rig.headCenter, headRadius, AVATAR_COLORS.face);
    this._drawHair(ctx, rig.headCenter, headRadius);
    this._drawFace(ctx, rig.headCenter, headRadius);
    this._drawChestMark(ctx, rig.neck, rig.hipCenter, torsoLength);

    this._drawCapsule(ctx, rig.leftElbow, rig.leftHand, lowerArmWidth, AVATAR_COLORS.mittens);
    this._drawCapsule(ctx, rig.rightElbow, rig.rightHand, lowerArmWidth, AVATAR_COLORS.mittens);
    this._drawCircle(ctx, rig.leftElbow, cuffRadius, AVATAR_COLORS.hoodieDark);
    this._drawCircle(ctx, rig.rightElbow, cuffRadius, AVATAR_COLORS.hoodieDark);
    this._drawCircle(ctx, rig.leftHand, gloveRadius, AVATAR_COLORS.gloves);
    this._drawCircle(ctx, rig.rightHand, gloveRadius, AVATAR_COLORS.gloves);

    ctx.restore();
  }

  _buildRig(poseState) {
    if (!poseState?.landmarks) return null;

    const lm = poseState.landmarks;
    const leftShoulder = lm[LEFT_SHOULDER];
    const rightShoulder = lm[RIGHT_SHOULDER];
    const leftElbow = lm[LEFT_ELBOW];
    const rightElbow = lm[RIGHT_ELBOW];
    const leftHip = lm[LEFT_HIP];
    const rightHip = lm[RIGHT_HIP];
    const leftKnee = lm[LEFT_KNEE];
    const rightKnee = lm[RIGHT_KNEE];
    const leftAnkle = lm[LEFT_ANKLE];
    const rightAnkle = lm[RIGHT_ANKLE];

    if (!leftShoulder || !rightShoulder || !leftElbow || !rightElbow ||
        !leftHip || !rightHip || !leftKnee || !rightKnee || !leftAnkle || !rightAnkle) {
      return null;
    }

    const leftHand = poseState.fists?.left ?? lm[LEFT_WRIST];
    const rightHand = poseState.fists?.right ?? lm[RIGHT_WRIST];
    if (!leftHand || !rightHand) return null;

    const shoulderCenter = midpoint(leftShoulder, rightShoulder);
    const hipCenter = midpoint(leftHip, rightHip);
    const spineDir = normalize({
      x: shoulderCenter.x - hipCenter.x,
      y: shoulderCenter.y - hipCenter.y,
    });
    const torsoLength = dist(shoulderCenter, hipCenter);

    return {
      leftShoulder,
      rightShoulder,
      leftElbow,
      rightElbow,
      leftHand,
      rightHand,
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      leftFoot: extendPoint(leftKnee, leftAnkle, 0.18),
      rightFoot: extendPoint(rightKnee, rightAnkle, 0.18),
      neck: {
        x: shoulderCenter.x + spineDir.x * torsoLength * 0.08,
        y: shoulderCenter.y + spineDir.y * torsoLength * 0.08,
      },
      hipCenter,
      headCenter: {
        x: shoulderCenter.x + spineDir.x * torsoLength * 0.48,
        y: shoulderCenter.y + spineDir.y * torsoLength * 0.48,
      },
    };
  }

  _smoothRig(current, next, alpha) {
    const smoothed = {};
    for (const key of Object.keys(next)) {
      smoothed[key] = current[key] ? lerpPoint(current[key], next[key], alpha) : next[key];
    }
    return smoothed;
  }

  _drawCapsule(ctx, start, end, width, fill) {
    ctx.strokeStyle = AVATAR_COLORS.outline;
    ctx.lineWidth = width + 12;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    ctx.strokeStyle = fill;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  _drawCircle(ctx, center, radius, fill) {
    ctx.fillStyle = AVATAR_COLORS.outline;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius + 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawHood(ctx, headCenter, hoodRadius) {
    this._drawCircle(ctx, {
      x: headCenter.x,
      y: headCenter.y - hoodRadius * 0.02,
    }, hoodRadius, AVATAR_COLORS.hoodie);

    this._drawEar(ctx, {
      x: headCenter.x - hoodRadius * 0.58,
      y: headCenter.y - hoodRadius * 0.78,
    }, hoodRadius * 0.34, -1);
    this._drawEar(ctx, {
      x: headCenter.x + hoodRadius * 0.58,
      y: headCenter.y - hoodRadius * 0.78,
    }, hoodRadius * 0.34, 1);

    ctx.fillStyle = AVATAR_COLORS.hoodInner;
    ctx.beginPath();
    ctx.ellipse(headCenter.x, headCenter.y + hoodRadius * 0.06, hoodRadius * 0.7, hoodRadius * 0.74, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawEar(ctx, center, size, direction) {
    ctx.fillStyle = AVATAR_COLORS.outline;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y - size);
    ctx.lineTo(center.x + size * direction, center.y + size * 0.9);
    ctx.lineTo(center.x - size * 0.2 * direction, center.y + size * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = AVATAR_COLORS.hoodie;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y - size * 0.72);
    ctx.lineTo(center.x + size * 0.78 * direction, center.y + size * 0.66);
    ctx.lineTo(center.x - size * 0.12 * direction, center.y + size * 0.48);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = AVATAR_COLORS.blush;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y - size * 0.35);
    ctx.lineTo(center.x + size * 0.38 * direction, center.y + size * 0.33);
    ctx.lineTo(center.x, center.y + size * 0.22);
    ctx.closePath();
    ctx.fill();
  }

  _drawHair(ctx, headCenter, headRadius) {
    ctx.fillStyle = AVATAR_COLORS.hair;
    ctx.beginPath();
    ctx.arc(headCenter.x, headCenter.y - headRadius * 0.08, headRadius * 0.92, Math.PI, Math.PI * 2);
    ctx.lineTo(headCenter.x + headRadius * 0.8, headCenter.y - headRadius * 0.05);
    ctx.quadraticCurveTo(headCenter.x, headCenter.y + headRadius * 0.24, headCenter.x - headRadius * 0.8, headCenter.y - headRadius * 0.05);
    ctx.closePath();
    ctx.fill();
  }

  _drawFace(ctx, headCenter, headRadius) {
    const eyeY = headCenter.y - headRadius * 0.02;
    const eyeOffset = headRadius * 0.24;
    const blushY = headCenter.y + headRadius * 0.18;
    const cheekOffset = headRadius * 0.34;

    ctx.strokeStyle = AVATAR_COLORS.eyes;
    ctx.lineWidth = Math.max(3, headRadius * 0.08);
    ctx.beginPath();
    ctx.moveTo(headCenter.x - eyeOffset - headRadius * 0.08, eyeY);
    ctx.lineTo(headCenter.x - eyeOffset + headRadius * 0.08, eyeY);
    ctx.moveTo(headCenter.x + eyeOffset - headRadius * 0.08, eyeY);
    ctx.lineTo(headCenter.x + eyeOffset + headRadius * 0.08, eyeY);
    ctx.stroke();

    ctx.fillStyle = AVATAR_COLORS.blush;
    ctx.beginPath();
    ctx.ellipse(headCenter.x - cheekOffset, blushY, headRadius * 0.16, headRadius * 0.1, -0.2, 0, Math.PI * 2);
    ctx.ellipse(headCenter.x + cheekOffset, blushY, headRadius * 0.16, headRadius * 0.1, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = AVATAR_COLORS.mouth;
    ctx.lineWidth = Math.max(2, headRadius * 0.05);
    ctx.beginPath();
    ctx.arc(headCenter.x, headCenter.y + headRadius * 0.16, headRadius * 0.14, 0, Math.PI);
    ctx.stroke();
  }

  _drawChestMark(ctx, neck, hipCenter, torsoLength) {
    const chestY = lerp(neck.y, hipCenter.y, 0.38);
    const size = Math.max(10, torsoLength * 0.08);

    ctx.fillStyle = AVATAR_COLORS.heart;
    ctx.beginPath();
    ctx.moveTo(neck.x, chestY + size * 0.95);
    ctx.bezierCurveTo(
      neck.x - size * 1.2, chestY + size * 0.2,
      neck.x - size * 1.15, chestY - size * 0.95,
      neck.x, chestY - size * 0.2
    );
    ctx.bezierCurveTo(
      neck.x + size * 1.15, chestY - size * 0.95,
      neck.x + size * 1.2, chestY + size * 0.2,
      neck.x, chestY + size * 0.95
    );
    ctx.closePath();
    ctx.fill();
  }
}

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
    this.avatar = new AvatarRenderer();

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
        if (Math.sqrt(dx * dx + dy * dy) < this._getHitRadius(target, TARGET_PUNCH)) {
          this._hitTarget(target, punch.x * w, punch.y * h, TARGET_PUNCH);
        }
      }
    }

    for (const kick of poseState.kicks) {
      for (const target of this.targets) {
        if (!target.alive || target.wasHit) continue;
        const dx = kick.x - target.x;
        const dy = kick.y - target.y;
        if (Math.sqrt(dx * dx + dy * dy) < this._getHitRadius(target, TARGET_KICK)) {
          this._hitTarget(target, kick.x * w, kick.y * h, TARGET_KICK);
        }
      }
    }
  }

  _getHitRadius(target, attackType) {
    if (attackType === TARGET_PUNCH) return PUNCH_HIT_RADIUS;
    if (target.type === TARGET_PUNCH) return KICK_PUNCH_TARGET_HIT_RADIUS;
    return KICK_HIT_RADIUS;
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
    this.avatar.update(poseState, dt);

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

    if (this.state === 'PLAYING' || this.state === 'READY' || this.state === 'GAME_OVER') {
      this._drawAvatar();
    }

    if (this.state === 'PLAYING' || this.state === 'GAME_OVER') {
      for (const target of this.targets) {
        target.draw(ctx, w, h);
      }
      this.effects.draw();
    }
  }

  _drawAvatar() {
    this.avatar.draw(this.ctx, this.canvas.width, this.canvas.height);
  }
}
