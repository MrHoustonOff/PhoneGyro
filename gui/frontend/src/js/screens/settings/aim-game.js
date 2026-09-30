// Zelda Aim Reticle Mini-Game (30-Sec Target Shoot)
// No distracting clutter: compact HUD, center-anchored targets, sheikah reticle.

import { $, setText, setVar, toggleClass } from '../../core/dom.js';

export class AimGame {
  constructor(options = {}) {
    this.options = options;
    this.isActive = false;
    this.gameState = 'idle'; // 'idle' | 'playing' | 'gameover'
    this.score = 0;
    this.record = parseInt(localStorage.getItem('pg_game_aim_record') || '0', 10);
    this.timeLeft = 30.0;
    this.timerStartTs = 0;
    this.timerId = null;
    this.rafId = null;

    this.reticleX = 0;
    this.reticleY = 0;
    this.activeTarget = null;

    // Parameter defaults
    this.sensitivity = 1.0;
    this.invertX = false;
    this.invertY = false;
    this.source = 'dsu';

    this.onScoreUpdate = options.onScoreUpdate || (() => {});
    this.onTimerUpdate = options.onTimerUpdate || (() => {});
    this.onGameOver = options.onGameOver || (() => {});
  }

  init() {
    this.vpEl = $('game-aim-view');
    this.targetsLayerEl = $('game-aim-targets');
    this.reticleEl = $('game-aim-reticle');
    this.fxLayerEl = $('game-aim-fx');
    this.gameoverEl = $('game-aim-gameover');

    $('btn-aim-restart')?.addEventListener('click', () => {
      this.start();
    });

    this.updateHUD();
  }

  start() {
    this.cleanupTargets();
    this.score = 0;
    this.timeLeft = 30.0;
    this.timerStartTs = performance.now();
    this.gameState = 'playing';

    if (this.gameoverEl) this.gameoverEl.style.display = 'none';

    this.updateHUD();
    this.spawnTarget();

    if (this.timerId) clearInterval(this.timerId);
    this.timerId = setInterval(() => {
      if (!this.isActive || this.gameState !== 'playing') return;
      const elapsed = (performance.now() - this.timerStartTs) / 1000;
      this.timeLeft = Math.max(0, 30.0 - elapsed);
      this.onTimerUpdate(this.timeLeft.toFixed(1) + ' с');
      if (this.timeLeft <= 0) {
        this.gameOver();
      }
    }, 100);
  }

  stop() {
    this.gameState = 'idle';
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.cleanupTargets();
  }

  gameOver() {
    this.gameState = 'gameover';
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    // TODO: sound - sound_bench_defeat

    if (this.gameoverEl) {
      setText($('game-aim-final-score'), this.score);
      setText($('game-aim-final-record'), this.record);
      this.gameoverEl.style.display = 'flex';
    }
    this.onGameOver(this.score, this.record);
  }

  recenter() {
    this.reticleX = 0;
    this.reticleY = 0;
    this.updateReticleDOM();
  }

  cleanupTargets() {
    if (this.targetsLayerEl) this.targetsLayerEl.innerHTML = '';
    if (this.fxLayerEl) this.fxLayerEl.innerHTML = '';
    this.activeTarget = null;
  }

  getBounds() {
    const vp = this.vpEl || $('game-stage');
    const w = vp ? (vp.clientWidth || 600) : 600;
    const h = vp ? (vp.clientHeight || 400) : 400;
    const halfW = Math.floor(w / 2);
    const halfH = Math.floor(h / 2);
    return {
      boundX: Math.max(80, halfW - 60),
      boundY: Math.max(60, halfH - 60),
      maxReticleX: Math.max(100, halfW - 30),
      maxReticleY: Math.max(70, halfH - 30),
    };
  }

  spawnTarget() {
    if (!this.targetsLayerEl) return;
    this.cleanupTargets();

    const bounds = this.getBounds();
    let rx = 0;
    let ry = 0;

    for (let attempt = 0; attempt < 20; attempt++) {
      rx = Math.floor((Math.random() * 2 - 1) * bounds.boundX);
      ry = Math.floor((Math.random() * 2 - 1) * bounds.boundY);
      const dist = Math.hypot(rx - this.reticleX, ry - this.reticleY);
      if (dist > 70) break;
    }

    const el = document.createElement('div');
    el.className = 'bench-aim-target';
    el.style.left = '50%';
    el.style.top = '50%';
    el.style.marginLeft = `${rx - 30}px`;
    el.style.marginTop = `${ry - 30}px`;
    el.innerHTML = `
      <div class="target-ring outer"></div>
      <div class="target-ring middle"></div>
      <div class="target-ring inner"></div>
      <div class="target-bullseye"></div>
    `;

    this.targetsLayerEl.appendChild(el);
    this.activeTarget = {
      x: rx,
      y: ry,
      el,
      hitRadius: 36,
    };
  }

  checkHit() {
    if (!this.activeTarget || !this.activeTarget.el || this.gameState !== 'playing') return;
    const dist = Math.hypot(this.reticleX - this.activeTarget.x, this.reticleY - this.activeTarget.y);
    if (dist <= this.activeTarget.hitRadius) {
      this.onHit();
    }
  }

  onHit() {
    const target = this.activeTarget;
    if (!target) return;
    this.activeTarget = null;

    // TODO: sound - sound_bench_goal

    this.score++;
    if (this.score > this.record) {
      this.record = this.score;
      try {
        localStorage.setItem('pg_game_aim_record', String(this.record));
      } catch (_) {}
    }
    this.updateHUD();

    // Target explosion
    if (target.el) {
      target.el.classList.add('hit');
      setTimeout(() => {
        if (target.el?.parentNode) target.el.parentNode.removeChild(target.el);
      }, 200);
    }

    // Floating +1 Popup
    if (this.fxLayerEl) {
      const pop = document.createElement('div');
      pop.className = 'aim-score-popup';
      pop.textContent = '+1';
      pop.style.left = '50%';
      pop.style.top = '50%';
      pop.style.marginLeft = `${target.x - 10}px`;
      pop.style.marginTop = `${target.y - 20}px`;
      this.fxLayerEl.appendChild(pop);
      setTimeout(() => {
        if (pop.parentNode) pop.parentNode.removeChild(pop);
      }, 600);
    }

    // Spawn next target
    setTimeout(() => {
      if (this.gameState === 'playing') this.spawnTarget();
    }, 150);
  }

  updateMotion(dsuRateX, dsuRateY, rawRateX, rawRateY, dt = 0.016) {
    if (!this.isActive) return;

    let rx = this.source === 'raw' ? rawRateX : dsuRateX;
    let ry = this.source === 'raw' ? rawRateY : dsuRateY;

    if (this.invertX) rx = -rx;
    if (this.invertY) ry = -ry;

    // Velocity integration with sensitivity scaling
    const speed = 280 * this.sensitivity;
    this.reticleX += rx * speed * dt;
    this.reticleY += ry * speed * dt;

    const bounds = this.getBounds();
    this.reticleX = Math.max(-bounds.maxReticleX, Math.min(bounds.maxReticleX, this.reticleX));
    this.reticleY = Math.max(-bounds.maxReticleY, Math.min(bounds.maxReticleY, this.reticleY));

    this.updateReticleDOM();
    this.checkHit();
  }

  updateReticleDOM() {
    if (!this.reticleEl) return;
    this.reticleEl.style.transform = `translate(${this.reticleX.toFixed(1)}px, ${this.reticleY.toFixed(1)}px)`;
  }

  updateHUD() {
    setText($('game-score'), this.score);
    setText($('game-record'), this.record);
    this.onScoreUpdate(this.score, this.record);
  }

  activate() {
    this.isActive = true;
    this.init();
    if (this.gameState === 'idle') {
      this.spawnTarget();
    }
  }

  deactivate() {
    this.isActive = false;
    this.stop();
  }
}
