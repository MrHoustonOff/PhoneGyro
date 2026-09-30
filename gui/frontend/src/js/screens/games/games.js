// Games Screen Coordinator (Aim Reticle & 3D Marble Platform)
// Seamless full-screen mode without header/footer, smooth transitions, real-time gyro motion.

import { $, setText, toggleClass } from '../../core/dom.js';
import { call, on, off } from '../../core/bridge.js';
import { onState } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { go, onScreen } from '../../shell/router.js';
import { AimGame } from './aim-game.js';
import { PlatformGame } from './platform-game.js';

let isActive = false;
let activeGameName = 'aim';
let aimGame = null;
let platformGame = null;
let initialized = false;

function initControllers() {
  if (initialized) return;
  initialized = true;

  aimGame = new AimGame({
    onScoreUpdate: (score, record) => {
      if (activeGameName === 'aim') {
        setText($('game-score'), String(score));
        setText($('game-record'), String(record));
      }
    },
    onTimerUpdate: (timeStr) => {
      if (activeGameName === 'aim') {
        setText($('game-label-timer'), t('ui.games_aim_time') || 'Время:');
        setText($('game-val-timer'), timeStr);
      }
    },
    onGameOver: () => {
      if (activeGameName === 'aim') {
        setText($('game-start-label'), t('ui.game_again') || 'Играть снова');
      }
    },
  });

  platformGame = new PlatformGame({
    onScoreUpdate: (score, record) => {
      if (activeGameName === 'platform') {
        setText($('game-score'), String(score));
        setText($('game-record'), String(record));
      }
    },
    onTiltUpdate: (tiltStr) => {
      if (activeGameName === 'platform') {
        setText($('game-label-timer'), t('ui.games_plat_tilt') || 'Наклон:');
        setText($('game-val-timer'), tiltStr);
      }
    },
  });

  // Back button
  const btnBack = $('btn-games-back');
  if (btnBack) {
    btnBack.onclick = () => go('settings');
  }

  // Segment picker
  const pickerSeg = $('game-picker-seg');
  if (pickerSeg) {
    pickerSeg.querySelectorAll('.pg-seg__btn').forEach((b) => {
      b.onclick = () => switchGame(b.dataset.game);
    });
  }

  // Start / Reset button
  const btnStart = $('btn-game-start');
  if (btnStart) {
    btnStart.onclick = () => {
      if (activeGameName === 'aim') {
        aimGame.start();
        setText($('game-start-label'), t('ui.game_reset') || 'Сброс');
      } else {
        platformGame.start();
      }
    };
  }

  // Recenter button
  const btnRecenter = $('btn-game-recenter');
  if (btnRecenter) {
    btnRecenter.onclick = recenterGames;
  }
}

function switchGame(gameName) {
  if (gameName !== 'aim' && gameName !== 'platform') gameName = 'aim';
  activeGameName = gameName;

  try {
    localStorage.setItem('pg_active_game', gameName);
  } catch (_) {}

  // Update seg buttons
  document.querySelectorAll('#game-picker-seg .pg-seg__btn').forEach((b) => {
    toggleClass(b, 'is-active', b.dataset.game === gameName);
  });

  const aimView = $('game-aim-view');
  const platView = $('game-platform-view');

  if (gameName === 'aim') {
    if (aimView) aimView.style.display = 'block';
    if (platView) platView.style.display = 'none';
    if (platformGame) platformGame.deactivate();
    if (isActive && aimGame) aimGame.activate();
    if (aimGame) {
      aimGame.updateHUD();
      setText($('game-label-timer'), t('ui.games_aim_time') || 'Время:');
      setText($('game-val-timer'), `${aimGame.timeLeft.toFixed(1)} с`);
      setText($('game-start-label'), t('ui.game_start') || 'Старт');
    }
  } else {
    if (aimView) aimView.style.display = 'none';
    if (platView) platView.style.display = 'block';
    if (aimGame) aimGame.deactivate();
    if (isActive && platformGame) platformGame.activate();
    if (platformGame) {
      platformGame.updateHUD();
      setText($('game-label-timer'), t('ui.games_plat_tilt') || 'Наклон:');
      setText($('game-val-timer'), 'P: +0.0° R: +0.0°');
      setText($('game-start-label'), t('ui.game_reset') || 'Сброс');
    }
  }
}

function recenterGames() {
  if (activeGameName === 'aim' && aimGame) {
    aimGame.recenter();
  } else if (platformGame) {
    platformGame.recenter();
  }
  call('ResetAHRS').catch(() => {});
}

// Hotkeys: Space (recenter), Escape (back to settings)
function onKeyDown(e) {
  if (!isActive) return;
  const activeTag = document.activeElement ? document.activeElement.tagName : '';
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    recenterGames();
  } else if (e.code === 'Escape') {
    e.preventDefault();
    go('settings');
  }
}

// Handle motion from 60Hz tuning frames
function handleTuningFrame(tf) {
  if (!isActive || !tf) return;
  if (activeGameName === 'aim') {
    const rx = tf.OutY ?? tf.out_gy ?? tf.raw_gy ?? tf.RawY ?? 0;
    const ry = tf.OutX ?? tf.out_gx ?? tf.raw_gx ?? tf.RawX ?? 0;
    const rawX = tf.RawY ?? tf.raw_gy ?? 0;
    const rawY = tf.RawX ?? tf.raw_gx ?? 0;
    aimGame?.updateMotion(rx, ry, rawX, rawY);
  } else {
    const pitch = tf.Pitch ?? tf.pitch ?? 0;
    const roll = tf.Roll ?? tf.roll ?? 0;
    platformGame?.updateOrientation(pitch, roll);
  }
}

// Handle 15Hz state change fallback
function handleState(state) {
  if (!isActive || !state) return;
  if (activeGameName === 'platform') {
    platformGame?.updateOrientation(state.pitch || 0, state.roll || 0);
  } else if (activeGameName === 'aim') {
    if (state.rawRotX != null || state.rawRotY != null) {
      aimGame?.updateMotion(state.rawRotY || 0, state.rawRotX || 0, state.rawRotY || 0, state.rawRotX || 0);
    }
  }
}

function activate() {
  if (isActive) return;
  isActive = true;
  initControllers();

  window.addEventListener('keydown', onKeyDown);
  on('tuning:frame', handleTuningFrame);
  call('SetTuningActive', true).catch(() => {});

  try {
    const saved = localStorage.getItem('pg_active_game');
    if (saved === 'aim' || saved === 'platform') {
      activeGameName = saved;
    }
  } catch (_) {}

  switchGame(activeGameName);
}

function deactivate() {
  if (!isActive) return;
  isActive = false;

  window.removeEventListener('keydown', onKeyDown);
  off('tuning:frame', handleTuningFrame);
  call('SetTuningActive', false).catch(() => {});

  if (aimGame) aimGame.deactivate();
  if (platformGame) platformGame.deactivate();
}

export function startGames() {
  initControllers();
  onState(handleState);
  onScreen((screen) => {
    if (screen === 'games') {
      activate();
    } else {
      deactivate();
    }
  });
}
