// ── Games Screen Coordinator (Aim Reticle & 3D Marble Platform) ─────────────
// Direct transfer of the interactive gaming logic from LEGACY/frontend/js/tuning-bench.js.

import { call, on, off } from '../../core/bridge.js';
import { go, onScreen, getCurrentScreen } from '../../shell/router.js';
import { onState } from '../../core/state.js';
import { t, onLang } from '../../core/i18n.js';
import { AimGame } from './aim-game.js';
import { PlatformGame } from './platform-game.js';

export const TuningBench = {
  active: false,
  initialized: false,
  activeGame: localStorage.getItem('gb_bench_active_game') || 'aim', // 'aim' | 'platform'
  dataFeed: localStorage.getItem('gb_bench_data_feed') || 'dsu',     // 'dsu' | 'raw'
  invertX: localStorage.getItem('gb_bench_inv_x') === 'true',
  invertY: localStorage.getItem('gb_bench_inv_y') === 'true',
  reticleX: 0,
  reticleY: 0,
  lastFrameTs: 0,
  rafId: null,
  lastDomUpdateTs: 0,
  reticleDotEl: null,
  hudAimXEl: null,
  hudAimYEl: null,

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.reticleDotEl = document.getElementById('bench-reticle-dot');
    this.hudAimXEl = document.getElementById('bench-hud-aim-x');
    this.hudAimYEl = document.getElementById('bench-hud-aim-y');

    // Back button
    const btnBack = document.getElementById('btn-games-back');
    if (btnBack) {
      btnBack.onclick = () => go('settings');
    }

    // Mini-Game tabs switching ('aim' vs 'platform')
    const gameTabs = document.querySelectorAll('#bench-game-tabs .bench-game-tab');
    gameTabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-game') || 'aim';
        this.switchGame(target);
      });
    });

    // Data feed toggle button ('dsu' vs 'raw')
    const btnFeed = document.getElementById('btn-bench-feed');
    if (btnFeed) {
      btnFeed.addEventListener('click', () => {
        this.dataFeed = (this.dataFeed === 'dsu') ? 'raw' : 'dsu';
        try {
          localStorage.setItem('gb_bench_data_feed', this.dataFeed);
        } catch (_) {}
        this.syncFeedButton();
      });
      this.syncFeedButton();
    }

    // Invert X toggle button
    const btnInvX = document.getElementById('btn-bench-inv-x');
    if (btnInvX) {
      btnInvX.addEventListener('click', () => {
        this.invertX = !this.invertX;
        try {
          localStorage.setItem('gb_bench_inv_x', String(this.invertX));
        } catch (_) {}
        btnInvX.classList.toggle('active', this.invertX);
      });
      btnInvX.classList.toggle('active', this.invertX);
    }

    // Invert Y toggle button
    const btnInvY = document.getElementById('btn-bench-inv-y');
    if (btnInvY) {
      btnInvY.addEventListener('click', () => {
        this.invertY = !this.invertY;
        try {
          localStorage.setItem('gb_bench_inv_y', String(this.invertY));
        } catch (_) {}
        btnInvY.classList.toggle('active', this.invertY);
      });
      btnInvY.classList.toggle('active', this.invertY);
    }

    // Recenter buttons
    document.getElementById('btn-game-recenter')?.addEventListener('click', () => {
      this.recenter();
    });

    // Start / Reset button
    const btnStart = document.getElementById('btn-game-start');
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        if (this.activeGame === 'aim') {
          AimGame.resetGame();
        } else {
          PlatformGame.recenter();
        }
      });
    }

    // Theme observer for platform materials
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.dataset.theme || 'dark';
      PlatformGame.updateTheme(theme);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    onLang(() => {
      this.syncFeedButton();
      this.switchGame(this.activeGame);
    });
  },

  syncFeedButton() {
    const btnFeed = document.getElementById('btn-bench-feed');
    if (!btnFeed) return;
    const isRaw = (this.dataFeed === 'raw');
    btnFeed.textContent = isRaw ? (t('settings_modal.bench_feed_raw') || 'Сырой') : (t('settings_modal.bench_feed_dsu') || 'DSU');
    btnFeed.classList.toggle('raw', isRaw);
  },

  switchGame(target) {
    if (target !== 'aim' && target !== 'platform') target = 'aim';
    this.activeGame = target;
    try {
      localStorage.setItem('gb_bench_active_game', target);
    } catch (_) {}

    const gameTabs = document.querySelectorAll('#bench-game-tabs .bench-game-tab');
    gameTabs.forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-game') === target));

    const viewAim = document.getElementById('bench-game-aim');
    const viewPlatform = document.getElementById('bench-game-platform');
    if (viewAim) viewAim.hidden = (target !== 'aim');
    if (viewPlatform) viewPlatform.hidden = (target !== 'platform');

    const metricLabel = document.getElementById('game-label-timer');
    const startBtn = document.getElementById('bench-start-label');

    if (target === 'platform') {
      if (AimGame.isFullscreen) {
        AimGame.setFullscreen(false);
      }
      PlatformGame.init();
      PlatformGame.syncDimensions(true);
      PlatformGame.updateHud(true);
      if (metricLabel) metricLabel.textContent = t('ui.games_plat_tilt') || 'Наклон:';
      if (startBtn) startBtn.textContent = t('ui.game_reset') || 'Сброс';
    } else if (target === 'aim') {
      if (PlatformGame.isFullscreen && document.querySelector('.app-games-card')?.classList.contains('is-fs')) {
        PlatformGame.setFullscreen(false);
      }
      AimGame.init();
      AimGame.syncState();
      if (metricLabel) metricLabel.textContent = t('ui.games_aim_time') || 'Время:';
      if (startBtn) startBtn.textContent = (AimGame.gameState === 'playing' ? (t('ui.game_reset') || 'Сброс') : (t('ui.game_start') || 'Старт'));
    }
  },

  recenter() {
    this.reticleX = 0;
    this.reticleY = 0;
    this.renderReticle();
    if (this.activeGame === 'platform') {
      PlatformGame.recenter();
    }
    call('ResetAHRS').catch(() => {});
  },

  onFrame(frame) {
    if (!this.active || !frame) return;

    const rawX = (frame.rawX !== undefined) ? frame.rawX : (frame.RawX || 0);
    const rawY = (frame.rawY !== undefined) ? frame.rawY : (frame.RawY || 0);
    const rawZ = (frame.rawZ !== undefined) ? frame.rawZ : (frame.RawZ || 0);
    const outX = (frame.outX !== undefined) ? frame.outX : (frame.OutX || 0);
    const outY = (frame.outY !== undefined) ? frame.outY : (frame.OutY || 0);
    const outZ = (frame.outZ !== undefined) ? frame.outZ : (frame.OutZ || 0);

    const now = performance.now();
    const dt = this.lastFrameTs ? Math.min(0.05, Math.max(0.001, (now - this.lastFrameTs) / 1000)) : 0.016;
    this.lastFrameTs = now;

    // Active feed selection ('dsu' or 'raw')
    const curX = (this.dataFeed === 'raw') ? rawX : outX;
    const curY = (this.dataFeed === 'raw') ? rawY : outY;

    // 1. Numerical Aim Reticle Integration (Zelda mechanics: angular velocity integration)
    const vp = document.getElementById('bench-aim-viewport');
    const aimSpeed = Math.max(4.2, ((vp ? vp.clientWidth : (window.innerWidth || 800)) / 340) * 2.4); // px per degree
    const multX = this.invertX ? -1 : 1;
    const multY = this.invertY ? -1 : 1;

    this.reticleX += curY * dt * aimSpeed * multX;
    this.reticleY -= curX * dt * aimSpeed * multY;

    // Dynamic viewport bounds from AimGame
    const bounds = AimGame.getBounds();
    const maxW = bounds.maxReticleX;
    const maxH = bounds.maxReticleY;
    if (this.reticleX > maxW) this.reticleX = maxW;
    if (this.reticleX < -maxW) this.reticleX = -maxW;
    if (this.reticleY > maxH) this.reticleY = maxH;
    if (this.reticleY < -maxH) this.reticleY = -maxH;

    if (this.activeGame === 'aim') {
      AimGame.checkHit(this.reticleX, this.reticleY);
    }

    // 2. Absolute Drift-Free Platform Game Motion Tracking
    PlatformGame.onFrame(frame);

    // 3. Throttled DOM updates (~10 Hz, 100ms)
    if (now - this.lastDomUpdateTs >= 100) {
      this.lastDomUpdateTs = now;
      if (this.activeGame === 'platform') {
        PlatformGame.updateHud();
      }
    }
  },

  renderReticle() {
    if (!this.reticleDotEl || !this.reticleDotEl.isConnected) {
      this.reticleDotEl = document.getElementById('bench-reticle-dot');
    }
    if (!this.hudAimXEl || !this.hudAimXEl.isConnected) {
      this.hudAimXEl = document.getElementById('bench-hud-aim-x');
    }
    if (!this.hudAimYEl || !this.hudAimYEl.isConnected) {
      this.hudAimYEl = document.getElementById('bench-hud-aim-y');
    }

    if (this.reticleDotEl) {
      this.reticleDotEl.style.transform = `translate(${Math.round(this.reticleX)}px, ${Math.round(this.reticleY)}px)`;
    }

    const vp = document.getElementById('bench-aim-viewport');
    const aimSpeed = Math.max(4.2, ((vp ? vp.clientWidth : (window.innerWidth || 800)) / 340) * 2.4);

    if (this.hudAimXEl) {
      const degX = (this.reticleX / aimSpeed);
      this.hudAimXEl.textContent = `X: ${(degX >= 0 ? '+' : '')}${degX.toFixed(1)}°`;
    }
    if (this.hudAimYEl) {
      const degY = (-this.reticleY / aimSpeed);
      this.hudAimYEl.textContent = `Y: ${(degY >= 0 ? '+' : '')}${degY.toFixed(1)}°`;
    }
  },

  startLoop() {
    if (this.rafId) return;
    const loop = (now) => {
      if (!this.active) {
        this.rafId = null;
        return;
      }
      if (this.activeGame === 'aim') {
        this.renderReticle();
        AimGame.update(now);
      } else if (this.activeGame === 'platform') {
        PlatformGame.updateAndRender();
      }
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

  onKeyDown(e) {
    if (!this.active) return;
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (AimGame.isFullscreen) {
        AimGame.setFullscreen(false);
      } else if (PlatformGame.isFullscreen && document.querySelector('.app-games-card')?.classList.contains('is-fs')) {
        PlatformGame.setFullscreen(false);
      } else {
        go('settings');
      }
    } else if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (this.activeGame === 'aim' && AimGame.gameState === 'gameover') {
        AimGame.resetGame();
      } else {
        this.recenter();
      }
    } else if (e.key === 'Enter' && this.activeGame === 'aim' && AimGame.gameState === 'gameover') {
      e.preventDefault();
      AimGame.resetGame();
    } else if (e.key === 'f' || e.key === 'F') {
      if (this.activeGame === 'aim') {
        AimGame.toggleFullscreen();
      } else if (this.activeGame === 'platform') {
        PlatformGame.toggleFullscreen();
      }
    }
  }
};

const boundOnFrame = (frame) => TuningBench.onFrame(frame);
const boundOnKeyDown = (e) => TuningBench.onKeyDown(e);

function activate() {
  if (TuningBench.active) return;
  TuningBench.active = true;
  TuningBench.init();

  window.addEventListener('keydown', boundOnKeyDown);
  on('tuning:frame', boundOnFrame);
  call('SetTuningActive', true).catch(() => {});

  let saved = 'aim';
  try {
    saved = localStorage.getItem('gb_bench_active_game') || 'aim';
  } catch (_) {}
  TuningBench.switchGame(saved);
  TuningBench.recenter();
  TuningBench.startLoop();
}

function deactivate() {
  if (!TuningBench.active) return;
  TuningBench.active = false;

  TuningBench.stopLoop();
  window.removeEventListener('keydown', boundOnKeyDown);
  off('tuning:frame', boundOnFrame);
  call('SetTuningActive', false).catch(() => {});

  AimGame.dispose();
  PlatformGame.dispose();
}

function syncActive() {
  const isGames = (getCurrentScreen() === 'games');
  const shouldBeActive = (isGames && !document.hidden);
  if (shouldBeActive && !TuningBench.active) {
    activate();
  } else if (!shouldBeActive && TuningBench.active) {
    deactivate();
  }
}

export function startGames() {
  TuningBench.init();
  onScreen(() => syncActive());
  document.addEventListener('visibilitychange', () => syncActive());
  window.addEventListener('beforeunload', () => deactivate());

  // 15Hz state change fallback (if tuning:frame is delayed)
  onState((state) => {
    if (!TuningBench.active || !state) return;
    if (TuningBench.activeGame === 'platform') {
      PlatformGame.onFrame({
        pitch: state.pitch || 0,
        roll: state.roll || 0,
        yaw: state.yaw || 0
      });
    }
  });
}
