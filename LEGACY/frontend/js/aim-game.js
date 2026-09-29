'use strict';

  // ── Zelda Target Aim Reticle Mini-Game (30-Sec Target Shoot) ────────────────
  const AimGame = {
    initialized: false,
    isFullscreen: false,
    _placeholder: null,
    gameState: 'idle', // 'idle' | 'ready' | 'playing' | 'gameover'
    score: 0,
    record: parseInt(localStorage.getItem('gb_aim_record') || '0', 10),
    timeLeft: 30.0,
    timerStartTs: 0,
    cachedW: 0,
    cachedH: 0,
    activeTarget: null,
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

      // Escape, Spacebar, and Enter key handling
      document.addEventListener('keydown', (e) => {
        if (!this.isFullscreen) return;
        if (e.key === 'Escape') {
          this.setFullscreen(false);
        } else if (e.code === 'Space' || e.key === ' ') {
          if (this.gameState === 'gameover') {
            e.preventDefault();
            this.resetGame();
          } else {
            e.preventDefault();
            TuningBench.recenter();
          }
        } else if (e.key === 'Enter' && this.gameState === 'gameover') {
          e.preventDefault();
          this.resetGame();
        }
      });

      // Play again and exit buttons
      document.getElementById('btn-aim-play-again')?.addEventListener('click', () => {
        this.resetGame();
      });

      document.getElementById('btn-aim-exit')?.addEventListener('click', () => {
        this.setFullscreen(false);
      });

      // Window resize and visibility listeners: guarantee target never disappears
      window.addEventListener('resize', () => {
        this.syncState();
      });

      // Initial target spawn (works both in windowed and fullscreen)
      this.resetGame();
    },

    getBounds() {
      if (this.isFullscreen) {
        const halfW = Math.floor((window.innerWidth || 1280) / 2);
        const halfH = Math.floor((window.innerHeight || 720) / 2);
        return {
          boundX: Math.max(100, halfW - 140),
          boundYTop: Math.max(60, halfH - 160),     // Clearance for top HUD
          boundYBottom: Math.max(60, halfH - 100),
          maxReticleX: Math.max(160, halfW - 50),
          maxReticleY: Math.max(100, halfH - 50)
        };
      } else {
        const vp = this.vpEl || document.getElementById('bench-aim-viewport');
        const w = vp ? (vp.clientWidth || 600) : 600;
        const halfW = Math.floor(w / 2);
        return {
          boundX: Math.max(60, halfW - 80),
          boundYTop: 36,
          boundYBottom: 36,
          maxReticleX: Math.max(100, halfW - 40),
          maxReticleY: 52
        };
      }
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
      const btn = document.getElementById('btn-bench-aim-fullscreen');
      if (!vp) return;

      if (this.isFullscreen) {
        if (!this._placeholder) {
          this._placeholder = document.createElement('div');
          this._placeholder.id = 'bench-aim-placeholder';
          setShown(this._placeholder, false);
        }
        if (vp.parentNode && vp.parentNode !== document.body) {
          vp.parentNode.insertBefore(this._placeholder, vp);
          document.body.appendChild(vp);
        }
        vp.classList.add('fullscreen');
        this.startLoop();
        this.resetGame();
      } else {
        vp.classList.remove('fullscreen');
        if (this._placeholder && this._placeholder.parentNode) {
          this._placeholder.parentNode.insertBefore(vp, this._placeholder);
          this._placeholder.parentNode.removeChild(this._placeholder);
          this._placeholder = null;
        }
        this.stopLoop();
        this.resetGame();
      }

      if (btn) {
        const iconExpand = btn.querySelector('.icon-expand');
        const iconCollapse = btn.querySelector('.icon-collapse');
        if (iconExpand) setShown(iconExpand, !(this.isFullscreen));
        if (iconCollapse) setShown(iconCollapse, this.isFullscreen);
        btn.title = this.isFullscreen ? (I18n.t('settings_modal.bench_exit_fullscreen') || 'Свернуть') : (I18n.t('settings_modal.bench_fullscreen') || 'На весь экран');
      }

      TuningBench.recenter();
    },

    startLoop() {
      if (this.rafId) return;
      const loop = (now) => {
        if (!this.isFullscreen) {
          this.rafId = null;
          return;
        }
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
      this.gameState = this.isFullscreen ? 'ready' : 'idle';
      this.score = 0;
      this.timeLeft = 30.0;
      this.timerStartTs = 0;

      if (this.gameoverEl) setShown(this.gameoverEl, false);
      if (this.timePillEl) this.timePillEl.classList.remove('urgent');
      if (this.timerEl) this.timerEl.textContent = '30.0';
      if (this.scoreEl) this.scoreEl.textContent = '0';
      if (this.recordEl) this.recordEl.textContent = this.record.toString();
      if (this.hintEl) {
        this.hintEl.textContent = I18n.t('settings_modal.bench_aim_start_hint') || 'Сбейте 1-ю мишень для старта! • [Esc] Выход';
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
      if (this.gameoverEl) setShown(this.gameoverEl, false);
      if (this.timePillEl) this.timePillEl.classList.remove('urgent');
    },

    spawnTarget() {
      if (!this.targetsLayerEl || !this.targetsLayerEl.isConnected) {
        this.targetsLayerEl = document.getElementById('bench-aim-targets-layer');
      }
      if (!this.targetsLayerEl) return;

      const bounds = this.getBounds();

      // Clean up any lingering un-hit targets so strictly 1 active target exists
      const lingering = this.targetsLayerEl.querySelectorAll('.bench-aim-target:not(.hit)');
      lingering.forEach(t => t.remove());

      // Pick a random position not too close to current reticle
      let rx = 0;
      let ry = 0;
      for (let attempt = 0; attempt < 24; attempt++) {
        rx = Math.floor((Math.random() * 2 - 1) * bounds.boundX);
        ry = Math.floor(-bounds.boundYTop + Math.random() * (bounds.boundYTop + bounds.boundYBottom));
        const dist = Math.hypot(rx - TuningBench.reticleX, ry - TuningBench.reticleY);
        if (dist > (this.isFullscreen ? 130 : 60)) break;
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

      // In fullscreen ready state, 1st target hit triggers the 30-sec arcade countdown!
      if (this.isFullscreen && this.gameState === 'ready') {
        this.gameState = 'playing';
        this.timerStartTs = performance.now();
        this.timeLeft = 30.0;
        if (this.hintEl) {
          this.hintEl.textContent = I18n.t('settings_modal.bench_aim_playing_hint') || '30 секунд! Сбивайте мишени • [Пробел] Центр • [Esc] Выход';
        }
      }

      this.score++;
      if (this.scoreEl) this.scoreEl.textContent = this.score.toString();

      if (this.score > this.record) {
        this.record = this.score;
        try {
          localStorage.setItem('gb_aim_record', this.record.toString());
        } catch (e) {}
        if (this.recordEl) this.recordEl.textContent = this.record.toString();
      }

      // Visual and Sound Shot Feedback
      this.playHitSound();

      // Flash reticle
      const reticleEl = TuningBench.reticleDotEl || document.getElementById('bench-reticle-dot');
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
      if (!this.isFullscreen) return;

      if (this.gameState === 'playing') {
        const elapsed = (now - this.timerStartTs) / 1000;
        this.timeLeft = Math.max(0, 30.0 - elapsed);

        if (this.timerEl) {
          this.timerEl.textContent = this.timeLeft.toFixed(1);
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

      const isNewRecord = (this.score >= this.record && this.score > 0);

      if (this.recordBadgeEl) {
        setShown(this.recordBadgeEl, isNewRecord);
      }
      if (this.finalScoreEl) {
        this.finalScoreEl.textContent = this.score.toString();
      }
      if (this.finalRecordEl) {
        this.finalRecordEl.textContent = this.record.toString();
      }
      if (this.gameoverEl) {
        setShown(this.gameoverEl, true);
      }
    },

    playHitSound() {
      try {
        if (typeof SoundManager !== 'undefined') {
          if (SoundManager.getMode() === 'off') return;
          const vol = SoundManager.getEffectiveVolume('goal');
          if (vol <= 0) return;
        }
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
        const effVol = (typeof SoundManager !== 'undefined' && SoundManager.getEffectiveVolume) ? SoundManager.getEffectiveVolume('goal') : 1;
        gain.gain.setValueAtTime(0.25 * effVol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.13);
      } catch (e) {}
    }
  };
