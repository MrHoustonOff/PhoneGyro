// Launch animation (design: Splash) and its on/off setting.
// Plays once per launch while the backend starts: a small window with our logo,
// rings unroll, the name writes itself, then the window grows into the app and
// the app's islands drop in (css/app.css, "Launch animation"). The <head> script
// decides from localStorage whether it plays (no wait for Go); Go's setting is
// the truth and is mirrored back here.

import { $, setText } from './core/dom.js';
import { call } from './core/bridge.js';
import { t } from './core/i18n.js';

const MIN_MS = 2250;   // design: never hand over before 2.25 s
const MAX_MS = 6000;   // design: never wait longer for the backend
const GROW_MS = 850;   // design: the window grows into the app in 0.85 s
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
      // Design timeline: grow at 2.25 s (or when the backend is up, if later).
      // The grown window already looks like the app's ground, so the layer hands
      // over once the growth ends (0.85 s) and the islands drop in right then.
      Promise.all([minTime, Promise.race([backendReady, maxTime])]).then(() => {
        el.classList.add('is-grown');
        setTimeout(() => { html.classList.add('is-enter'); el.classList.add('is-app'); }, GROW_MS - 80);
        setTimeout(() => { el.remove(); html.classList.remove('is-splash'); }, GROW_MS + 500);
        setTimeout(() => html.classList.remove('is-enter'), GROW_MS + 1300);
      });
    },
  };
}

/** Mirrors Go's setting for the next launch's first paint (the toggle is in Settings). */
export function syncSplashSetting() {
  call('GetSplash').then((on) => remember(!!on));
}
