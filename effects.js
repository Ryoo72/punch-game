const MAX_PARTICLES = 200;

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    const angle = Math.random() * Math.PI * 2;
    const speed = 100 + Math.random() * 300;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.life = 0.4 + Math.random() * 0.4;
    this.maxLife = this.life;
    this.size = 3 + Math.random() * 5;
    this.color = color;
    this.gravity = 400;
  }

  update(dt) {
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
  }

  draw(ctx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
    ctx.globalAlpha = 1;
  }
}

class FloatingText {
  constructor(x, y, text, color) {
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.life = 1.0;
    this.maxLife = 1.0;
    this.vy = -120;
  }

  update(dt) {
    this.y += this.vy * dt;
    this.vy *= 0.98;
    this.life -= dt;
  }

  draw(ctx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    const scale = 1 + (1 - this.life / this.maxLife) * 0.3;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x, this.y);
    ctx.scale(scale, scale);
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeText(this.text, 0, 0);
    ctx.fillText(this.text, 0, 0);
    ctx.restore();
  }
}

class MissIndicator {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.life = 0.6;
    this.maxLife = 0.6;
  }

  update(dt) {
    this.life -= dt;
  }

  draw(ctx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    const size = 30;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 4;
    ctx.translate(this.x, this.y);
    ctx.beginPath();
    ctx.moveTo(-size, -size);
    ctx.lineTo(size, size);
    ctx.moveTo(size, -size);
    ctx.lineTo(-size, size);
    ctx.stroke();
    ctx.restore();
  }
}

export class Effects {
  constructor(ctx, canvas) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.particles = [];
    this.floatingTexts = [];
    this.missIndicators = [];
    this.shakeAmount = 0;
    this.shakeDuration = 0;
  }

  spawnHit(x, y, color, points, comboMultiplier) {
    // Particles
    const count = 15 + Math.floor(Math.random() * 10);
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push(new Particle(x, y, color));
    }

    // Floating text
    const totalPoints = points * comboMultiplier;
    let text = `+${totalPoints}`;
    if (comboMultiplier > 1) text += ` x${comboMultiplier}`;
    this.floatingTexts.push(new FloatingText(x, y - 30, text, color));

    // Screen shake
    this.shakeAmount = 5 + comboMultiplier * 2;
    this.shakeDuration = 0.15;

    // White flash
    const flash = document.getElementById('hit-flash');
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 80);
  }

  spawnMiss(x, y) {
    this.missIndicators.push(new MissIndicator(x, y));

    // Red border flash
    const flash = document.getElementById('miss-flash');
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 150);
  }

  update(dt) {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update(dt);
      if (this.particles[i].life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      this.floatingTexts[i].update(dt);
      if (this.floatingTexts[i].life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    // Update miss indicators
    for (let i = this.missIndicators.length - 1; i >= 0; i--) {
      this.missIndicators[i].update(dt);
      if (this.missIndicators[i].life <= 0) {
        this.missIndicators.splice(i, 1);
      }
    }

    // Update screen shake
    if (this.shakeDuration > 0) {
      this.shakeDuration -= dt;
      if (this.shakeDuration <= 0) {
        this.shakeAmount = 0;
      }
    }
  }

  draw() {
    const ctx = this.ctx;

    // Apply screen shake
    if (this.shakeAmount > 0) {
      const sx = (Math.random() - 0.5) * this.shakeAmount * 2;
      const sy = (Math.random() - 0.5) * this.shakeAmount * 2;
      ctx.save();
      ctx.translate(sx, sy);
    }

    for (const p of this.particles) p.draw(ctx);
    for (const ft of this.floatingTexts) ft.draw(ctx);
    for (const mi of this.missIndicators) mi.draw(ctx);

    if (this.shakeAmount > 0) {
      ctx.restore();
    }
  }

  clear() {
    this.particles = [];
    this.floatingTexts = [];
    this.missIndicators = [];
    this.shakeAmount = 0;
    this.shakeDuration = 0;
  }
}
