// ── Zelda Target Aim Reticle Mini-Game (30-Sec Target Shoot) ────────────────
// Direct transfer from LEGACY/frontend/js/aim-game.js adapted to ES module.

import { t } from '../../core/i18n.js';

export const AimGame = {
  initialized: false,
  isFullscreen: false,
  _placeholder: null,
  gameState: 'ready', // 'idle' | 'ready' | 'playing' | 'gameover'
  score: 0,
  record: parseInt(localStorage.getItem('gb_aim_record') || '0', 10),
  timeLeft: 30.0,
  timerStartTs: 0,
  cachedW: 0,
  cachedH: 0,
  activeTarget: null,
  lastReticleX: 0,
  lastReticleY: 0,
  audioCtx: null,
  vpEl: null,
  targetsLayerEl: null,
  fxLayerEl: null,
  timePillEl: null,
  timerEl: null,
  scoreEl: null,
  recordEl: null,
  hintEl: null,
  gameoverEl: null,
  finalScoreEl: null,
  finalRecordEl: null,
  recordBadgeEl: null,
  rafId: null,

  init() {
    this.vpEl = document.getElementById('bench-aim-viewport');
    this.targetsLayerEl = document.getElementById('bench-aim-targets-layer');
    this.fxLayerEl = document.getElementById('bench-aim-fx-layer');
    this.timePillEl = document.getElementById('bench-aim-time-pill');
    this.timerEl = document.getElementById('bench-aim-timer');
    this.scoreEl = document.getElementById('bench-aim-score');
    this.recordEl = document.getElementById('bench-aim-record');
    this.hintEl = document.getElementById('bench-aim-fs-hint');
    this.gameoverEl = document.getElementById('bench-aim-gameover');
    this.finalScoreEl = document.getElementById('bench-aim-final-score');
    this.finalRecordEl = document.getElementById('bench-aim-final-record');
    this.recordBadgeEl = document.getElementById('bench-aim-record-badge');

    if (this.recordEl) this.recordEl.textContent = this.record.toString();
    const barRecord = document.getElementById('game-record');
    if (barRecord) barRecord.textContent = this.record.toString();

    if (this.initialized) {
      this.syncState();
      return;
    }
    this.initialized = true;

    // Fullscreen toggle button
    document.getElementById('btn-bench-aim-fullscreen')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFullscreen();
    });

    // Double-click on viewport to toggle fullscreen
    this.vpEl?.addEventListener('dblclick', (e) => {
      if (e.target.closest('button') || e.target.closest('.bench-aim-gameover-card')) return;
      this.toggleFullscreen();
    });

    // Play again and exit buttons
    document.getElementById('btn-aim-play-again')?.addEventListener('click', () => {
      this.resetGame();
    });

    document.getElementById('btn-aim-exit')?.addEventListener('click', () => {
      if (this.isFullscreen) {
        this.setFullscreen(false);
      }
      this.resetGame();
    });

    // Window resize and visibility listeners: guarantee target never disappears
    window.addEventListener('resize', () => {
      this.syncState();
    });

    // Initial target spawn
    this.resetGame();
  },

  getBounds() {
    const vp = this.vpEl || document.getElementById('bench-aim-viewport');
    const w = vp ? (vp.clientWidth || 800) : (window.innerWidth || 800);
    const h = vp ? (vp.clientHeight || 500) : (window.innerHeight || 500);
    const halfW = Math.floor(w / 2);
    const halfH = Math.floor(h / 2);
    // HUD clearances:
    //   top      = fullscreen score bar when is-fs; also the fullscreen-toggle button (top:1rem right:1rem ~40px)
    //   right    = telemetry badge (right:1rem bottom:0.75rem, ~90px wide)
    //   bottom   = bottom telemetry badge height
    // Reserve 100px on the right edge and 60px extra top so targets never overlap the toggle btn or badge.
    const rightMargin = Math.min(100, Math.floor(w * 0.12));
    return {
      boundX: Math.max(100, halfW - 140 - Math.floor(rightMargin / 2)),
      boundYTop: Math.max(80, halfH - 140),      // Clearance for top FS-HUD + fullscreen btn
      boundYBottom: Math.max(60, halfH - 100),   // Clearance for bottom telemetry
      maxReticleX: Math.max(160, halfW - 50 - Math.floor(rightMargin / 2)),
      maxReticleY: Math.max(100, halfH - 50)
    };
  },

  syncState() {
    // Re-bind DOM elements if disconnected
    if (!this.targetsLayerEl || !this.targetsLayerEl.isConnected) {
      this.targetsLayerEl = document.getElementById('bench-aim-targets-layer');
    }
    if (!this.fxLayerEl || !this.fxLayerEl.isConnected) {
      this.fxLayerEl = document.getElementById('bench-aim-fx-layer');
    }
    // If there is no active target or it was lost, spawn one immediately
    if (!this.activeTarget || !this.activeTarget.el || !this.activeTarget.el.isConnected) {
      this.spawnTarget();
    }
  },

  toggleFullscreen() {
    this.setFullscreen(!this.isFullscreen);
  },

  setFullscreen(enable) {
    this.isFullscreen = !!enable;
    const vp = this.vpEl || document.getElementById('bench-aim-viewport');
    const card = document.querySelector('.app-games-card');
    const btn = document.getElementById('btn-bench-aim-fullscreen');
    const fsHud = document.getElementById('bench-aim-fs-hud');
    if (!vp) return;

    if (this.isFullscreen) {
      vp.classList.add('fullscreen');
      card?.classList.add('is-fs');
      if (fsHud) fsHud.hidden = false;
    } else {
      vp.classList.remove('fullscreen');
      card?.classList.remove('is-fs');
      if (fsHud) fsHud.hidden = true;
    }

    if (btn) {
      const iconExpand = btn.querySelector('.icon-expand');
      const iconCollapse = btn.querySelector('.icon-collapse');
      if (iconExpand) iconExpand.hidden = this.isFullscreen;
      if (iconCollapse) iconCollapse.hidden = !this.isFullscreen;
      btn.title = this.isFullscreen
        ? (t('settings_modal.bench_exit_fullscreen') || 'Свернуть')
        : (t('settings_modal.bench_fullscreen') || 'На весь экран');
    }
  },

  startLoop() {
    if (this.rafId) return;
    const loop = (now) => {
      this.update(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  },

  stopLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  },

  resetGame() {
    this.cleanupTargets();
    this.gameState = 'ready';
    this.score = 0;
    this.timeLeft = 30.0;
    this.timerStartTs = 0;

    if (this.gameoverEl) this.gameoverEl.hidden = true;
    if (this.timePillEl) this.timePillEl.classList.remove('urgent');
    if (this.timerEl) this.timerEl.textContent = '30.0';
    if (this.scoreEl) this.scoreEl.textContent = '0';
    if (this.recordEl) this.recordEl.textContent = this.record.toString();

    const barScore = document.getElementById('game-score');
    if (barScore) barScore.textContent = '0';
    const barRecord = document.getElementById('game-record');
    if (barRecord) barRecord.textContent = this.record.toString();
    const barTimer = document.getElementById('game-val-timer');
    if (barTimer) barTimer.textContent = '30.0 с';
    const startBtn = document.getElementById('bench-start-label');
    if (startBtn) startBtn.textContent = t('ui.game_start') || 'Старт';

    if (this.hintEl) {
      this.hintEl.textContent = t('settings_modal.bench_aim_start_hint') || 'Сбейте 1-ю мишень для старта! • [Esc] Выход';
    }

    this.spawnTarget();
  },

  cleanupTargets() {
    if (!this.targetsLayerEl || !this.targetsLayerEl.isConnected) {
      this.targetsLayerEl = document.getElementById('bench-aim-targets-layer');
    }
    if (this.targetsLayerEl) this.targetsLayerEl.innerHTML = '';
    if (!this.fxLayerEl || !this.fxLayerEl.isConnected) {
      this.fxLayerEl = document.getElementById('bench-aim-fx-layer');
    }
    if (this.fxLayerEl) this.fxLayerEl.innerHTML = '';
    this.activeTarget = null;
  },

  cleanupGame() {
    this.cleanupTargets();
    this.gameState = 'idle';
    if (this.gameoverEl) this.gameoverEl.hidden = true;
    if (this.timePillEl) this.timePillEl.classList.remove('urgent');
    this.stopLoop();
  },

  spawnTarget() {
    if (!this.targetsLayerEl || !this.targetsLayerEl.isConnected) {
      this.targetsLayerEl = document.getElementById('bench-aim-targets-layer');
    }
    if (!this.targetsLayerEl) return;

    const bounds = this.getBounds();

    // Clean up any lingering un-hit targets so strictly 1 active target exists
    const lingering = this.targetsLayerEl.querySelectorAll('.bench-aim-target:not(.hit)');
    lingering.forEach(el => el.remove());

    // Pick a random position not too close to current reticle
    let rx = 0;
    let ry = 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      rx = Math.floor((Math.random() * 2 - 1) * bounds.boundX);
      ry = Math.floor(-bounds.boundYTop + Math.random() * (bounds.boundYTop + bounds.boundYBottom));
      const dist = Math.hypot(rx - this.lastReticleX, ry - this.lastReticleY);
      if (dist > 130) break;
    }

    const el = document.createElement('div');
    el.className = 'bench-aim-target';
    // Center-anchored CSS positioning: 100% immune to layout delay, window resizing or CSS zoom
    el.style.left = '50%';
    el.style.top = '50%';
    el.style.marginLeft = (rx - 30) + 'px';
    el.style.marginTop = (ry - 30) + 'px';
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
      el: el,
      hitRadius: 36
    };
  },

  checkHit(reticleX, reticleY) {
    this.lastReticleX = reticleX;
    this.lastReticleY = reticleY;

    if (!this.activeTarget || !this.activeTarget.el || !this.activeTarget.el.isConnected) {
      this.spawnTarget();
      return;
    }
    if (this.gameState === 'gameover') return;

    const dist = Math.hypot(reticleX - this.activeTarget.x, reticleY - this.activeTarget.y);
    if (dist <= this.activeTarget.hitRadius) {
      this.onHit();
    }
  },

  onHit() {
    const target = this.activeTarget;
    if (!target) return;
    this.activeTarget = null;

    // 1st target hit triggers the 30-sec arcade countdown!
    if (this.gameState === 'ready' || this.gameState === 'idle') {
      this.gameState = 'playing';
      this.timerStartTs = performance.now();
      this.timeLeft = 30.0;
      if (this.hintEl) {
        this.hintEl.textContent = t('settings_modal.bench_aim_playing_hint') || '30 секунд! Сбивайте мишени • [Пробел] Центр • [Esc] Выход';
      }
      const startBtn = document.getElementById('bench-start-label');
      if (startBtn) startBtn.textContent = t('ui.game_reset') || 'Сброс';
    }

    this.score++;
    if (this.scoreEl) this.scoreEl.textContent = this.score.toString();
    const barScore = document.getElementById('game-score');
    if (barScore) barScore.textContent = this.score.toString();

    if (this.score > this.record) {
      this.record = this.score;
      try {
        localStorage.setItem('gb_aim_record', this.record.toString());
      } catch (e) {}
      if (this.recordEl) this.recordEl.textContent = this.record.toString();
      const barRecord = document.getElementById('game-record');
      if (barRecord) barRecord.textContent = this.record.toString();
    }

    // Visual and Sound Shot Feedback
    this.playHitSound();

    // Flash reticle
    const reticleEl = document.getElementById('bench-reticle-dot');
    if (reticleEl) {
      reticleEl.classList.remove('shot-flash');
      void reticleEl.offsetWidth; // trigger reflow
      reticleEl.classList.add('shot-flash');
      setTimeout(() => reticleEl.classList.remove('shot-flash'), 140);
    }

    // Explode hit target
    if (target.el) {
      target.el.classList.add('hit');
      setTimeout(() => {
        if (target.el && target.el.parentNode) {
          target.el.parentNode.removeChild(target.el);
        }
      }, 220);
    }

    // Center-anchored Floating +1 Popup
    if (!this.fxLayerEl || !this.fxLayerEl.isConnected) {
      this.fxLayerEl = document.getElementById('bench-aim-fx-layer');
    }
    if (this.fxLayerEl) {
      const popup = document.createElement('div');
      popup.className = 'target-floating-score';
      popup.style.left = '50%';
      popup.style.top = '50%';
      popup.style.marginLeft = (target.x - 16) + 'px';
      popup.style.marginTop = (target.y - 16) + 'px';
      popup.textContent = '+1';
      this.fxLayerEl.appendChild(popup);
      setTimeout(() => {
        if (popup.parentNode) popup.parentNode.removeChild(popup);
      }, 500);
    }

    // Immediately spawn next target so user always has a target to shoot
    if (this.gameState !== 'gameover') {
      this.spawnTarget();
    }
  },

  update(now) {
    if (this.gameState === 'playing') {
      const elapsed = (now - this.timerStartTs) / 1000;
      this.timeLeft = Math.max(0, 30.0 - elapsed);

      if (this.timerEl) {
        this.timerEl.textContent = this.timeLeft.toFixed(1);
      }
      const barTimer = document.getElementById('game-val-timer');
      if (barTimer) {
        barTimer.textContent = `${this.timeLeft.toFixed(1)} с`;
      }

      if (this.timePillEl) {
        this.timePillEl.classList.toggle('urgent', this.timeLeft <= 5.0);
      }

      if (this.timeLeft <= 0) {
        this.endGame();
      }
    }
  },

  endGame() {
    this.gameState = 'gameover';
    this.cleanupTargets();

    if (this.timePillEl) this.timePillEl.classList.remove('urgent');
    if (this.timerEl) this.timerEl.textContent = '0.0';
    const barTimer = document.getElementById('game-val-timer');
    if (barTimer) barTimer.textContent = '0.0 с';

    const isNewRecord = (this.score >= this.record && this.score > 0);

    if (this.recordBadgeEl) {
      this.recordBadgeEl.hidden = !isNewRecord;
    }
    if (this.finalScoreEl) {
      this.finalScoreEl.textContent = this.score.toString();
    }
    if (this.finalRecordEl) {
      this.finalRecordEl.textContent = this.record.toString();
    }
    if (this.gameoverEl) {
      this.gameoverEl.hidden = false;
    }
    const startBtn = document.getElementById('bench-start-label');
    if (startBtn) {
      startBtn.textContent = t('ui.game_again') || 'Играть снова';
    }
  },

  playHitSound() {
    try {
      // TODO: sound
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.audioCtx) this.audioCtx = new AudioContext();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.07);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    } catch (e) {}
  },

  dispose() {
    this.cleanupGame();
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch (_) {}
      this.audioCtx = null;
    }
    this.initialized = false;
  }
};
