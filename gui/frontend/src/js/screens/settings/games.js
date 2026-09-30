// Mini-Games Coordinator (Aim & Platform)
// Minimal HUD, high-contrast clean gameplay, collapsible test parameters.

import { $, setText, toggleClass } from '../../core/dom.js';
import { call, on, off } from '../../core/bridge.js';
import { onState, getState } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { AimGame } from './aim-game.js';
import { PlatformGame } from './platform-game.js';

export function initGames(paneEl) {
  if (!paneEl) return null;

  let isActive = false;
  let activeGameName = 'aim';
  let isFullscreen = false;

  const aimGame = new AimGame({
    onScoreUpdate: (score, record) => {
      if (activeGameName === 'aim') {
        setText($('game-score'), score);
        setText($('game-record'), record);
      }
    },
    onTimerUpdate: (timeStr) => {
      if (activeGameName === 'aim') {
        setText($('game-label-timer'), t('settings_modal.bench_aim_time') || 'Время:');
        setText($('game-val-timer'), timeStr);
      }
    },
    onGameOver: () => {
      if (activeGameName === 'aim') {
        setText($('game-start-label'), t('settings_modal.bench_aim_play_again') || 'Играть снова');
      }
    },
  });

  const platformGame = new PlatformGame({
    onScoreUpdate: (score, record) => {
      if (activeGameName === 'platform') {
        setText($('game-score'), score);
        setText($('game-record'), record);
      }
    },
    onTiltUpdate: (tiltStr) => {
      if (activeGameName === 'platform') {
        setText($('game-label-timer'), 'Наклон:');
        setText($('game-val-timer'), tiltStr);
      }
    },
  });

  function switchGame(gameName) {
    if (gameName !== 'aim' && gameName !== 'platform') gameName = 'aim';
    activeGameName = gameName;

    try {
      localStorage.setItem('pg_active_game', gameName);
    } catch (_) {}

    // Seg buttons
    paneEl.querySelectorAll('#game-picker-seg .pg-seg__btn').forEach((b) => {
      toggleClass(b, 'is-active', b.dataset.game === gameName);
    });

    const aimView = $('game-aim-view');
    const platView = $('game-platform-view');

    if (gameName === 'aim') {
      if (aimView) aimView.style.display = 'block';
      if (platView) platView.style.display = 'none';
      platformGame.deactivate();
      if (isActive) aimGame.activate();
      aimGame.updateHUD();
      setText($('game-label-timer'), t('settings_modal.bench_aim_time') || 'Время:');
      setText($('game-val-timer'), `${aimGame.timeLeft.toFixed(1)} с`);
      setText($('game-start-label'), t('ui.game_start') || 'Старт');
    } else {
      if (aimView) aimView.style.display = 'none';
      if (platView) platView.style.display = 'block';
      aimGame.deactivate();
      if (isActive) platformGame.activate();
      platformGame.updateHUD();
      setText($('game-label-timer'), 'Наклон:');
      setText($('game-val-timer'), 'P: +0.0° R: +0.0°');
      setText($('game-start-label'), t('ui.game_reset') || 'Сброс');
    }
  }

  // Segment picker
  paneEl.querySelectorAll('#game-picker-seg .pg-seg__btn').forEach((b) => {
    b.onclick = () => switchGame(b.dataset.game);
  });
  try {
    const saved = localStorage.getItem('pg_active_game');
    if (saved) activeGameName = saved;
  } catch (_) {}

  // Action buttons
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

  const recenterGames = () => {
    if (activeGameName === 'aim') {
      aimGame.recenter();
    } else {
      platformGame.recenter();
    }
    call('ResetAHRS').catch(() => {});
  };

  const btnRecenter = $('btn-game-recenter');
  if (btnRecenter) {
    btnRecenter.onclick = recenterGames;
  }

  // Fullscreen button
  const stage = $('game-stage');
  const btnFullscreen = $('btn-game-fullscreen');
  const toggleFullscreen = () => {
    isFullscreen = !isFullscreen;
    if (stage) {
      toggleClass(stage, 'is-fullscreen', isFullscreen);
      if (activeGameName === 'platform') {
        setTimeout(() => platformGame.resize(), 50);
      }
    }
  };
  if (btnFullscreen) {
    btnFullscreen.onclick = toggleFullscreen;
  }

  // Hotkeys: Space (recenter), Esc (exit fullscreen)
  const onKeyDown = (e) => {
    if (!isActive) return;
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      recenterGames();
    } else if (e.code === 'Escape' && isFullscreen) {
      e.preventDefault();
      toggleFullscreen();
    }
  };

  // Technical Parameters
  const sourceBtns = paneEl.querySelectorAll('#game-source-seg .pg-seg__btn');
  sourceBtns.forEach((btn) => {
    btn.onclick = () => {
      const src = btn.dataset.source || 'dsu';
      sourceBtns.forEach((b) => toggleClass(b, 'is-active', b === btn));
      aimGame.source = src;
      platformGame.source = src;
    };
  });

  const checkInvX = $('game-invert-x');
  if (checkInvX) {
    checkInvX.onchange = () => {
      aimGame.invertX = checkInvX.checked;
      platformGame.invertX = checkInvX.checked;
    };
  }

  const checkInvY = $('game-invert-y');
  if (checkInvY) {
    checkInvY.onchange = () => {
      aimGame.invertY = checkInvY.checked;
      platformGame.invertY = checkInvY.checked;
    };
  }

  const sensSlider = $('game-sens-slider');
  if (sensSlider) {
    sensSlider.oninput = () => {
      const val = parseFloat(sensSlider.value) || 1.0;
      setText($('game-sens-val'), `${val.toFixed(1)}x`);
      aimGame.sensitivity = val;
      platformGame.sensitivity = val;
    };
  }

  // Handle tuning frames (60Hz)
  const handleTuningFrame = (tf) => {
    if (!isActive || !tf) return;
    if (activeGameName === 'aim') {
      aimGame.updateMotion(tf.OutY || 0, tf.OutX || 0, tf.RawY || 0, tf.RawX || 0);
    } else {
      platformGame.updateOrientation(tf.Pitch || 0, tf.Roll || 0);
    }
  };

  // Handle state updates (15Hz fallback)
  const renderState = (state) => {
    if (!isActive || !state) return;
    if (activeGameName === 'platform') {
      platformGame.updateOrientation(state.pitch || 0, state.roll || 0);
    }
  };
  onState(renderState);

  return {
    activate: () => {
      if (isActive) return;
      isActive = true;
      window.addEventListener('keydown', onKeyDown);
      on('tuning:frame', handleTuningFrame);
      call('SetTuningActive', true).catch(() => {});
      switchGame(activeGameName);
    },
    deactivate: () => {
      if (!isActive) return;
      isActive = false;
      window.removeEventListener('keydown', onKeyDown);
      off('tuning:frame', handleTuningFrame);
      call('SetTuningActive', false).catch(() => {});
      aimGame.deactivate();
      platformGame.deactivate();
      if (isFullscreen) toggleFullscreen();
    },
    getAimGame: () => aimGame,
    getPlatformGame: () => platformGame,
  };
}
