'use strict';

  // ── Real-Time Response Test Bench ──────────────────────────────────────────
  const TuningBench = {
    active: false,
    initialized: false,
    activeGame: localStorage.getItem('gb_bench_active_game') || 'aim', // 'aim' | 'platform'
    dataFeed: localStorage.getItem('gb_bench_data_feed') || 'dsu',     // 'dsu' | 'raw'
    activeAxis: 'x', // 'x' = Pitch, 'y' = Yaw, 'z' = Roll, 'all' = 3 Stacked Graphs
    reticleX: 0,
    reticleY: 0,
    invertX: localStorage.getItem('gb_bench_inv_x') === 'true',
    invertY: localStorage.getItem('gb_bench_inv_y') === 'true',
    maxHistory: 140,
    historyRaw: { x: [], y: [], z: [] },
    historyFilt: { x: [], y: [], z: [] },
    recentRawDev: [],
    recentFiltDev: [],
    lastFrameTs: 0,
    rafId: null,
    cachedCanvasW: 0,
    cachedCanvasH: 0,
    lastDomUpdateTs: 0,
    lastLiveHz: -1,
    reticleDotEl: null,
    hudAimXEl: null,
    hudAimYEl: null,
    stabilityTagEl: null,
    _lastStabilityMode: '',

    syncDimensions(force = false) {
      const canvas = document.getElementById('bench-oscilloscope-canvas');
      if (!canvas) return;
      const targetH = (this.activeAxis === 'all' ? 220 : 95);
      const w = Math.floor(canvas.clientWidth || 340);
      const h = targetH;
      if (force || w !== this.cachedCanvasW || h !== this.cachedCanvasH) {
        this.cachedCanvasW = w;
        this.cachedCanvasH = h;
      }
    },

    init() {
      if (this.initialized) return;
      this.initialized = true;

      // Initialize both Aim and Platform game modules
      AimGame.init();

      // Mini-Game tabs switching ('aim' vs 'platform')
      const gameTabs = document.querySelectorAll('#bench-game-tabs .bench-game-tab');
      gameTabs.forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-game') || 'aim';
          this.switchGame(target);
        });
      });

      // Data feed toggle buttons ('dsu' vs 'raw')
      const btnFeedAim = document.getElementById('btn-bench-feed-aim');
      const btnFeedPlatform = document.getElementById('btn-bench-feed-platform');
      const onToggleFeed = () => {
        this.dataFeed = (this.dataFeed === 'dsu') ? 'raw' : 'dsu';
        localStorage.setItem('gb_bench_data_feed', this.dataFeed);
        this.syncFeedButtons();
      };
      if (btnFeedAim) btnFeedAim.addEventListener('click', onToggleFeed);
      if (btnFeedPlatform) btnFeedPlatform.addEventListener('click', onToggleFeed);
      this.syncFeedButtons();

      // Axis tabs switching (Pitch, Yaw, Roll, All)
      const tabBtns = document.querySelectorAll('#bench-axis-tabs .bench-axis-tab');
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          tabBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.activeAxis = btn.getAttribute('data-axis') || 'x';

          const canvas = document.getElementById('bench-oscilloscope-canvas');
          if (canvas) {
            canvas.classList.toggle('mode-all', this.activeAxis === 'all');
          }
          this.syncDimensions(true);
        });
      });

      // Recenter buttons
      document.getElementById('btn-bench-recenter-aim')?.addEventListener('click', () => {
        this.recenter();
      });
      document.getElementById('btn-bench-recenter-platform')?.addEventListener('click', () => {
        PlatformGame.recenter();
      });

      // Window resize listener
      window.addEventListener('resize', () => {
        if (this.active) {
          this.syncDimensions(true);
          if (this.activeGame === 'platform') {
            PlatformGame.syncDimensions(true);
          } else if (this.activeGame === 'aim') {
            AimGame.syncState();
          }
        }
      });

      // Wails 60 Hz telemetry event
      if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('tuning:frame', (frame) => {
          if (typeof RecenterManager !== 'undefined') {
            RecenterManager.onFrame(frame);
          }
          if (this.active) {
            this.onFrame(frame);
          }
        });

        window.runtime.EventsOn('device:disconnected', () => {
          if (this.active) {
            this.setOfflineState();
          }
        });

        window.runtime.EventsOn('device:connected', () => {
          if (this.active) {
            this.setWaitingState();
          }
        });
      }
    },

    switchGame(target) {
      this.activeGame = target;
      localStorage.setItem('gb_bench_active_game', target);

      const gameTabs = document.querySelectorAll('#bench-game-tabs .bench-game-tab');
      gameTabs.forEach(b => b.classList.toggle('active', b.getAttribute('data-game') === target));

      const viewAim = document.getElementById('bench-game-aim');
      const viewPlatform = document.getElementById('bench-game-platform');
      if (viewAim) setShown(viewAim, target === 'aim');
      if (viewPlatform) setShown(viewPlatform, target === 'platform');

      this.syncDimensions(true);

      if (target === 'platform') {
        if (typeof AimGame !== 'undefined' && AimGame.isFullscreen) {
          AimGame.setFullscreen(false);
        }
        PlatformGame.init();
        PlatformGame.syncDimensions(true);
        PlatformGame.updateAndRender();
      } else if (target === 'aim') {
        if (typeof PlatformGame !== 'undefined' && PlatformGame.isFullscreen) {
          PlatformGame.setFullscreen(false);
        }
        AimGame.init();
        AimGame.syncState();
      }
    },

    syncFeedButtons() {
      const isRaw = (this.dataFeed === 'raw');
      const label = isRaw ? (I18n.t('settings_modal.bench_feed_raw') || 'Сырой') : (I18n.t('settings_modal.bench_feed_dsu') || 'DSU');
      const btns = [
        document.getElementById('btn-bench-feed-aim'),
        document.getElementById('btn-bench-feed-platform')
      ];
      btns.forEach(btn => {
        if (!btn) return;
        btn.textContent = label;
        btn.classList.toggle('raw', isRaw);
      });
    },

    setOfflineState() {
      const overlay = document.getElementById('bench-offline-overlay');
      if (overlay) overlay.classList.add('visible');

      const livePill = document.getElementById('bench-live-pill');
      if (livePill) livePill.classList.add('offline');

      const liveText = document.getElementById('bench-live-text');
      if (liveText) liveText.textContent = I18n.t('settings_modal.bench_offline') || 'Офлайн';

      const stabilityTag = document.getElementById('bench-stability-tag');
      if (stabilityTag) {
        stabilityTag.textContent = I18n.t('settings_modal.bench_status_offline') || 'Офлайн';
        stabilityTag.className = 'bench-status-tag offline';
      }

      const noiseStat = document.getElementById('bench-noise-stat');
      if (noiseStat) {
        const prefix = I18n.t('settings_modal.bench_noise_stat') || 'Подавление шума';
        noiseStat.textContent = `${prefix}: --%`;
      }

      const fpsStat = document.getElementById('bench-fps-stat');
      if (fpsStat) {
        fpsStat.textContent = '-- Hz';
      }

      if (typeof PlatformGame !== 'undefined' && PlatformGame.onDisconnect) {
        PlatformGame.onDisconnect();
      }
    },

    setWaitingState() {
      const overlay = document.getElementById('bench-offline-overlay');
      if (overlay) overlay.classList.remove('visible');

      const livePill = document.getElementById('bench-live-pill');
      if (livePill) livePill.classList.add('offline');

      const liveText = document.getElementById('bench-live-text');
      if (liveText) liveText.textContent = I18n.t('settings_modal.bench_device_waiting') || 'Ожидание...';

      const stabilityTag = document.getElementById('bench-stability-tag');
      if (stabilityTag) {
        stabilityTag.textContent = I18n.t('settings_modal.bench_status_still') || 'Покой';
        stabilityTag.className = 'bench-status-tag still';
      }

      if (typeof PlatformGame !== 'undefined' && PlatformGame.onDisconnect) {
        PlatformGame.onDisconnect();
      }
    },

    setLiveState(hz) {
      const roundedHz = Math.round(hz || 60);
      const overlay = document.getElementById('bench-offline-overlay');
      if (overlay && overlay.classList.contains('visible')) overlay.classList.remove('visible');

      const livePill = document.getElementById('bench-live-pill');
      if (livePill && livePill.classList.contains('offline')) livePill.classList.remove('offline');

      if (this.lastLiveHz !== roundedHz) {
        this.lastLiveHz = roundedHz;
        const liveText = document.getElementById('bench-live-text');
        if (liveText) {
          const label = I18n.t('settings_modal.bench_live') || 'В эфире';
          liveText.textContent = `${label} ${roundedHz} Hz`;
        }

        if (!this.fpsStatEl) this.fpsStatEl = document.getElementById('bench-fps-stat');
        if (this.fpsStatEl) {
          this.fpsStatEl.textContent = `${roundedHz} Hz`;
        }
      }

      if (typeof PlatformGame !== 'undefined') {
        PlatformGame.isOffline = false;
      }
    },

    start() {
      this.active = true;
      this.reticleX = 0;
      this.reticleY = 0;
      this.switchGame(this.activeGame);
      this.syncFeedButtons();
      this.syncDimensions(true);

      // Pre-fill history arrays with 120 zeroes so lines render continuously
      this.historyRaw = {
        x: new Array(120).fill(0),
        y: new Array(120).fill(0),
        z: new Array(120).fill(0)
      };
      this.historyFilt = {
        x: new Array(120).fill(0),
        y: new Array(120).fill(0),
        z: new Array(120).fill(0)
      };
      this.recentRawDev = [];
      this.recentFiltDev = [];
      this.lastFrameTs = 0;
      this.renderReticle();

      if (typeof NetSparkline !== 'undefined') {
        NetSparkline.render();
      }

      // Check current connection state
      const isOnline = (AppState.lastState && (AppState.lastState.status === 'online' || AppState.lastState.connected));
      if (!isOnline) {
        this.setOfflineState();
      } else {
        this.setWaitingState();
      }

      if (!this.rafId) {
        const loop = () => {
          if (!this.active) {
            this.rafId = null;
            return;
          }
          this.drawOscilloscope();
          if (this.activeGame === 'aim') {
            this.renderReticle();
            if (typeof AimGame !== 'undefined' && AimGame.isFullscreen) {
              AimGame.update(performance.now());
            }
          } else if (this.activeGame === 'platform') {
            PlatformGame.updateAndRender();
          }
          this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
      }
    },

    stop() {
      this.active = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (typeof AimGame !== 'undefined' && AimGame.isFullscreen) {
        AimGame.setFullscreen(false);
      }
      if (typeof PlatformGame !== 'undefined' && PlatformGame.onDisconnect) {
        PlatformGame.onDisconnect();
      }
      const canvas = document.getElementById('bench-oscilloscope-canvas');
      if (canvas) {
        canvas.classList.remove('mode-all');
      }
      this.activeAxis = 'x';
      const tabBtns = document.querySelectorAll('#bench-axis-tabs .bench-axis-tab');
      tabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-axis') === 'x'));
    },

    recenter() {
      this.reticleX = 0;
      this.reticleY = 0;
      this.renderReticle();
    },

    onFrame(frame) {
      if (!frame) return;

      // Extract properties safely handling both lowercase Wails JSON tags and uppercase
      const rawX = (frame.rawX !== undefined) ? frame.rawX : (frame.RawX || 0);
      const rawY = (frame.rawY !== undefined) ? frame.rawY : (frame.RawY || 0);
      const rawZ = (frame.rawZ !== undefined) ? frame.rawZ : (frame.RawZ || 0);
      const outX = (frame.outX !== undefined) ? frame.outX : (frame.OutX || 0);
      const outY = (frame.outY !== undefined) ? frame.outY : (frame.OutY || 0);
      const outZ = (frame.outZ !== undefined) ? frame.outZ : (frame.OutZ || 0);
      const hz = (frame.hz !== undefined) ? frame.hz : (frame.Hz || 60);

      const now = performance.now();
      const dt = this.lastFrameTs ? Math.min(0.05, Math.max(0.001, (now - this.lastFrameTs) / 1000)) : 0.016;
      this.lastFrameTs = now;

      // Active feed selection ('dsu' or 'raw')
      const curX = (this.dataFeed === 'raw') ? rawX : outX;
      const curY = (this.dataFeed === 'raw') ? rawY : outY;
      const curZ = (this.dataFeed === 'raw') ? rawZ : outZ;

      // 1. Numerical Aim Reticle Integration (Zelda mechanics: angular velocity integration)
      const aimSpeed = (typeof AimGame !== 'undefined' && AimGame.isFullscreen) ? Math.max(4.2, (window.innerWidth / 340) * 2.4) : 2.4; // px per degree
      this.reticleX += curY * dt * aimSpeed;
      this.reticleY -= curX * dt * aimSpeed;

      // Dynamic viewport bounds from AimGame
      const bounds = (typeof AimGame !== 'undefined' && AimGame.getBounds) ? AimGame.getBounds() : { maxReticleX: 150, maxReticleY: 52 };
      const maxW = bounds.maxReticleX;
      const maxH = bounds.maxReticleY;
      if (this.reticleX > maxW) this.reticleX = maxW;
      if (this.reticleX < -maxW) this.reticleX = -maxW;
      if (this.reticleY > maxH) this.reticleY = maxH;
      if (this.reticleY < -maxH) this.reticleY = -maxH;

      if (typeof AimGame !== 'undefined' && this.activeGame === 'aim') {
        AimGame.checkHit(this.reticleX, this.reticleY);
      }

      // 2. Absolute Drift-Free Platform Game Motion Tracking
      PlatformGame.onFrame(frame);

      // 3. Oscilloscope Multi-Axis Push (Always tracks Raw vs DSU for direct comparison)
      this.historyRaw.x.push(rawX);
      this.historyRaw.y.push(rawY);
      this.historyRaw.z.push(rawZ);
      this.historyFilt.x.push(outX);
      this.historyFilt.y.push(outY);
      this.historyFilt.z.push(outZ);

      if (this.historyRaw.x.length > this.maxHistory) {
        this.historyRaw.x.shift();
        this.historyRaw.y.shift();
        this.historyRaw.z.shift();
        this.historyFilt.x.shift();
        this.historyFilt.y.shift();
        this.historyFilt.z.shift();
      }

      // 4. Noise Reduction Calculation (RMS deviation comparison in resting/slow window)
      const currentRaw = (this.activeAxis === 'y') ? rawY : (this.activeAxis === 'z') ? rawZ : rawX;
      const currentFilt = (this.activeAxis === 'y') ? outY : (this.activeAxis === 'z') ? outZ : outX;

      this.recentRawDev.push(Math.abs(currentRaw));
      this.recentFiltDev.push(Math.abs(currentFilt));
      if (this.recentRawDev.length > 50) this.recentRawDev.shift();
      if (this.recentFiltDev.length > 50) this.recentFiltDev.shift();

      // 5. Throttled DOM updates (~10 Hz, 100ms) to eliminate layout thrashing
      const speed = Math.sqrt(outX * outX + outY * outY + outZ * outZ);
      if (now - this.lastDomUpdateTs >= 100) {
        this.lastDomUpdateTs = now;
        this.setLiveState(hz);
        this.updateStabilityTag(speed);
        this.updateNoiseReadout(speed);
        if (this.activeGame === 'platform') {
          PlatformGame.updateHud();
        }
      }
    },

    updateStabilityTag(speed) {
      if (!this.stabilityTagEl) this.stabilityTagEl = document.getElementById('bench-stability-tag');
      if (!this.stabilityTagEl) return;

      let mode = 'active';
      let i18nKey = 'settings_modal.bench_status_active';
      let fallback = 'Движение';
      if (speed < 0.12) {
        mode = 'still';
        i18nKey = 'settings_modal.bench_status_still';
        fallback = 'Покой';
      } else if (speed < 3.2) {
        mode = 'aim';
        i18nKey = 'settings_modal.bench_status_aim';
        fallback = 'Прицел';
      }

      if (this._lastStabilityMode !== mode) {
        this._lastStabilityMode = mode;
        this.stabilityTagEl.textContent = I18n.t(i18nKey) || fallback;
        this.stabilityTagEl.className = `bench-status-tag ${mode}`;
      }
    },

    renderReticle() {
      if (!this.reticleDotEl) this.reticleDotEl = document.getElementById('bench-reticle-dot');
      if (!this.hudAimXEl) this.hudAimXEl = document.getElementById('bench-hud-aim-x');
      if (!this.hudAimYEl) this.hudAimYEl = document.getElementById('bench-hud-aim-y');

      if (this.reticleDotEl) {
        this.reticleDotEl.style.transform = `translate(${Math.round(this.reticleX)}px, ${Math.round(this.reticleY)}px)`;
      }
      const aimSpeed = (typeof AimGame !== 'undefined' && AimGame.isFullscreen) ? Math.max(4.2, (window.innerWidth / 340) * 2.4) : 2.4;
      if (this.hudAimXEl) {
        const degX = (this.reticleX / aimSpeed);
        this.hudAimXEl.textContent = `X: ${(degX >= 0 ? '+' : '')}${degX.toFixed(1)}°`;
      }
      if (this.hudAimYEl) {
        const degY = (-this.reticleY / aimSpeed);
        this.hudAimYEl.textContent = `Y: ${(degY >= 0 ? '+' : '')}${degY.toFixed(1)}°`;
      }
    },

    updateNoiseReadout(speed) {
      const noiseEl = document.getElementById('bench-noise-stat');
      if (!noiseEl) return;

      const prefix = I18n.t('settings_modal.bench_noise_reduction') || 'Подавление шума';

      if (this.recentRawDev.length < 20) {
        noiseEl.textContent = `${prefix}: --%`;
        return;
      }

      const avgRaw = this.recentRawDev.reduce((a, b) => a + b, 0) / this.recentRawDev.length;
      const avgFilt = this.recentFiltDev.reduce((a, b) => a + b, 0) / this.recentFiltDev.length;

      if (avgRaw < 0.05 && avgFilt === 0) {
        noiseEl.textContent = `${prefix}: -99%`;
        return;
      }

      if (speed < 2.5 && avgRaw > 0.03) {
        const ratio = Math.max(0, Math.min(0.99, (avgRaw - avgFilt) / avgRaw));
        const pct = Math.round(ratio * 100);
        if (pct > 0) {
          noiseEl.textContent = `${prefix}: -${pct}%`;
        } else {
          noiseEl.textContent = `${prefix}: 0%`;
        }
      } else {
        const zeroLag = I18n.t('settings_modal.bench_zero_lag') || '0-задержка';
        noiseEl.textContent = `${prefix}: ${zeroLag}`;
      }
    },

    drawOscilloscope() {
      const canvas = document.getElementById('bench-oscilloscope-canvas');
      if (!canvas) return;

      // Watchdog: detect if telemetry packets stopped arriving
      const now = performance.now();
      if (this.lastFrameTs && (now - this.lastFrameTs > 1400)) {
        this.setOfflineState();
      }

      const targetH = (this.activeAxis === 'all' ? 220 : 95);
      const w = Math.floor(canvas.clientWidth || 340);
      const h = targetH;
      this.cachedCanvasW = w;
      this.cachedCanvasH = h;

      const dpr = window.devicePixelRatio || 1;
      const pixelW = Math.round(w * dpr);
      const pixelH = Math.round(h * dpr);

      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }

      const ctx = canvas.getContext('2d');
      ctx.save();
      // Complete physical canvas buffer clear to eliminate subpixel ghosting and stretching
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Theme-aware high contrast stroke colors for canvas elements
      const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');
      const gridSeparator = isLight ? CssVars.rgba('--palette-black', 0.12) : CssVars.rgba('--palette-white', 0.08);
      const gridCenter = isLight ? CssVars.rgba('--palette-black', 0.32) : CssVars.rgba('--palette-white', 0.18);
      const gridBounds = isLight ? CssVars.rgba('--palette-black', 0.12) : CssVars.rgba('--palette-white', 0.06);

      if (this.activeAxis === 'all') {
        // Stacked 3-Axis Oscilloscope Mode
        const trackH = h / 3;
        const axes = ['x', 'y', 'z'];
        const isRu = (typeof I18n !== 'undefined' && I18n.currentLang === 'ru');
        const titles = isRu
          ? ['Pitch (Тангаж · X)', 'Yaw (Рыскание · Y)', 'Roll (Крен · Z)']
          : ['Pitch (X)', 'Yaw (Y)', 'Roll (Z)'];

        for (let k = 0; k < 3; k++) {
          const axis = axes[k];
          const topY = k * trackH;
          const centerY = topY + trackH / 2;

          // Track separator line
          if (k > 0) {
            ctx.beginPath();
            ctx.strokeStyle = gridSeparator;
            ctx.setLineDash([]);
            ctx.lineWidth = 1;
            ctx.moveTo(0, topY);
            ctx.lineTo(w, topY);
            ctx.stroke();
          }

          // Track center zero dashed line
          ctx.beginPath();
          ctx.strokeStyle = gridCenter;
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.moveTo(0, centerY);
          ctx.lineTo(w, centerY);
          ctx.stroke();
          ctx.setLineDash([]);

          const rawArr = this.historyRaw[axis] || [];
          const filtArr = this.historyFilt[axis] || [];
          const n = rawArr.length;

          // Prominent high-contrast Pill Badge for Axis Title
          const title = titles[k];
          ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
          const textMetrics = ctx.measureText(title);
          const badgeW = textMetrics.width + 12;
          const badgeH = 17;
          const badgeX = 8;
          const badgeY = topY + 4;

          ctx.fillStyle = isLight ? CssVars.rgba('--palette-black', 0.08) : CssVars.rgba('--palette-white', 0.12);
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            if (isLight) {
              ctx.strokeStyle = CssVars.rgba('--palette-black', 0.16);
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          } else {
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
          }

          ctx.fillStyle = isLight ? CssVars.get('--palette-black') : CssVars.get('--palette-white');
          ctx.fillText(title, badgeX + 6, badgeY + 12);

          // Numeric DSU rate readout on right of track
          const curFilt = filtArr.length ? filtArr[filtArr.length - 1] : 0;
          const liveText = `DSU: ${(curFilt >= 0 ? '+' : '')}${curFilt.toFixed(1)}°/s`;
          ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillStyle = isLight ? CssVars.get('--palette-blue-strong') : CssVars.get('--palette-blue-dark');
          const liveMetrics = ctx.measureText(liveText);
          ctx.fillText(liveText, w - liveMetrics.width - 8, badgeY + 12);

          if (n < 2) continue;

          let maxAmp = 8.0;
          for (let i = 0; i < n; i++) {
            const ar = Math.abs(rawArr[i]);
            const af = Math.abs(filtArr[i]);
            if (ar > maxAmp) maxAmp = ar;
            if (af > maxAmp) maxAmp = af;
          }
          const scale = (trackH * 0.38) / maxAmp;
          const dx = w / (this.maxHistory - 1);
          const startX = w - (n - 1) * dx;

          // 1. Filtered DSU trace (Electric Cyan/Blue, drawn first)
          ctx.beginPath();
          ctx.strokeStyle = isLight ? CssVars.get('--palette-blue-web') : CssVars.get('--palette-blue-dark');
          ctx.lineWidth = 2.2;
          for (let i = 0; i < n; i++) {
            const x = startX + i * dx;
            const y = centerY - filtArr[i] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // 2. Raw trace (Apple Orange, drawn on top so sensor noise spikes are clearly visible)
          ctx.beginPath();
          ctx.strokeStyle = isLight ? CssVars.get('--palette-orange') : CssVars.get('--palette-orange-dark');
          ctx.lineWidth = isLight ? 1.6 : 1.4;
          for (let i = 0; i < n; i++) {
            const x = startX + i * dx;
            const y = centerY - rawArr[i] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else {
        // Single Axis Mode (Pitch, Yaw, or Roll)
        const centerY = h / 2;

        // Center reference zero line
        ctx.beginPath();
        ctx.strokeStyle = gridCenter;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();

        // Top and bottom boundary guides
        ctx.beginPath();
        ctx.strokeStyle = gridBounds;
        ctx.setLineDash([2, 4]);
        ctx.moveTo(0, centerY - h * 0.35);
        ctx.lineTo(w, centerY - h * 0.35);
        ctx.moveTo(0, centerY + h * 0.35);
        ctx.lineTo(w, centerY + h * 0.35);
        ctx.stroke();
        ctx.setLineDash([]);

        const rawArr = this.historyRaw[this.activeAxis] || [];
        const filtArr = this.historyFilt[this.activeAxis] || [];
        const n = rawArr.length;

        const isRu = (typeof I18n !== 'undefined' && I18n.currentLang === 'ru');
        let axisTitle = (this.activeAxis === 'y')
          ? (isRu ? 'Yaw (Рыскание · Y)' : 'Yaw (Y)')
          : (this.activeAxis === 'z')
            ? (isRu ? 'Roll (Крен · Z)' : 'Roll (Z)')
            : (isRu ? 'Pitch (Тангаж · X)' : 'Pitch (X)');

        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
        const textMetrics = ctx.measureText(axisTitle);
        const badgeW = textMetrics.width + 12;
        const badgeH = 18;
        const badgeX = 8;
        const badgeY = 6;

        ctx.fillStyle = isLight ? CssVars.rgba('--palette-black', 0.08) : CssVars.rgba('--palette-white', 0.12);
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
          ctx.fill();
          if (isLight) {
            ctx.strokeStyle = CssVars.rgba('--palette-black', 0.16);
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        } else {
          ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        }

        ctx.fillStyle = isLight ? CssVars.get('--palette-black') : CssVars.get('--palette-white');
        ctx.fillText(axisTitle, badgeX + 6, badgeY + 13);

        const curFilt = (filtArr && filtArr.length) ? filtArr[filtArr.length - 1] : 0;
        const liveText = `DSU: ${(curFilt >= 0 ? '+' : '')}${curFilt.toFixed(1)}°/s`;
        ctx.font = '600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = isLight ? CssVars.get('--palette-blue-strong') : CssVars.get('--palette-blue-dark');
        const liveMetrics = ctx.measureText(liveText);
        ctx.fillText(liveText, w - liveMetrics.width - 8, badgeY + 13);

        if (n >= 2) {
          let maxAmp = 8.0;
          for (let i = 0; i < n; i++) {
            const ar = Math.abs(rawArr[i]);
            const af = Math.abs(filtArr[i]);
            if (ar > maxAmp) maxAmp = ar;
            if (af > maxAmp) maxAmp = af;
          }
          const scale = (h * 0.42) / maxAmp;
          const dx = w / (this.maxHistory - 1);
          const startX = w - (n - 1) * dx;

          // 1. Draw Filtered DSU trace (Apple Cyan/Blue, drawn first)
          ctx.beginPath();
          ctx.strokeStyle = isLight ? CssVars.get('--palette-blue-web') : CssVars.get('--palette-blue-dark');
          ctx.lineWidth = 2.2;
          for (let i = 0; i < n; i++) {
            const x = startX + i * dx;
            const y = centerY - filtArr[i] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // 2. Draw Raw trace (Apple Orange, drawn on top so sensor noise spikes are clearly visible)
          ctx.beginPath();
          ctx.strokeStyle = isLight ? CssVars.get('--palette-orange') : CssVars.get('--palette-orange-dark');
          ctx.lineWidth = isLight ? 1.8 : 1.6;
          for (let i = 0; i < n; i++) {
            const x = startX + i * dx;
            const y = centerY - rawArr[i] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  };
