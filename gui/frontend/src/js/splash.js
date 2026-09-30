// Launch animation (design: Splash) and its on/off setting.
// Plays once per launch while the backend starts: rings unroll around the logo,
// the name writes itself, then the card flies out and the app's islands drop in.
// Everything that moves is transform or opacity. The <head> script decides from
// localStorage whether it plays (no wait for Go); Go's setting is the truth and
// is mirrored back here.

import { $, setText } from './core/dom.js';
import { call } from './core/bridge.js';
import { t } from './core/i18n.js';

const MIN_MS = 2250;   // design: never hand over before 2.25 s
const MAX_MS = 6000;   // design: never wait longer for the backend
const STATUS = [[0, 'splash.starting', 'Запуск…'], [1000, 'splash.profiles', 'Загрузка профилей'], [1500, 'splash.server', 'Запуск DSU-сервера'], [1950, 'splash.ready', 'Готово']];

const html = document.documentElement;

function remember(on) {
  try { localStorage.setItem('pg-splash', on ? '1' : '0'); } catch (e) { /* next launch uses the default */ }
}

/** Starts the animation if this launch plays it; finish(backendReady) hands over to the app. */
export function startSplash() {
  const el = $('splash');
  if (!html.classList.contains('is-splash')) {
    el.remove();
    return { finish() {} };
  }
  el.classList.add('is-run');
  const status = $('splash-status');
  STATUS.forEach(([ms, key, fallback]) => setTimeout(() => setText(status, t(key) || fallback), ms));
  const minTime = new Promise((r) => setTimeout(r, MIN_MS));
  const maxTime = new Promise((r) => setTimeout(r, MAX_MS));
  return {
    finish(backendReady) {
      Promise.all([minTime, Promise.race([backendReady, maxTime])]).then(() => {
        html.classList.add('is-enter');
        el.classList.add('is-out');
        setTimeout(() => { el.remove(); html.classList.remove('is-splash'); }, 1100);
        setTimeout(() => html.classList.remove('is-enter'), 1700);
      });
    },
  };
}

/** Mirrors Go's setting for the next launch's first paint (the toggle is in Settings). */
export function syncSplashSetting() {
  call('GetSplash').then((on) => remember(!!on));
}
