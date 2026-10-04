// Launch animation (design: Splash) and its on/off setting.
// Plays once per launch while the backend starts: a small window with our logo,
// rings unroll, the name writes itself, then the window grows into the app and
// the app's islands drop in (css/app.css, "Launch animation"). The <head> script
// decides from localStorage whether it plays (no wait for Go); Go's setting is
// the truth and is mirrored back here.

import { $, setText } from './core/dom.js';
import { call } from './core/bridge.js';
import { t } from './core/i18n.js';
import { debugPhase } from './debug/collect.js';
import { startRings } from './splash-rings.js';

const MIN_MS = 2250;   // design: never hand over before 2.25 s
const MAX_MS = 6000;   // design: never wait longer for the backend
const CLEANUP_MS = 1150; // design: wait until splash vanishes, wallpaper reveals, and islands settle
const WARM_MS = 1900;    // paint the app under the splash once the intro has played (css/app.css is-warm)

const html = document.documentElement;

function uiReady() { call('UIReady'); }

function remember(on) {
  try { localStorage.setItem('pg-splash', on ? '1' : '0'); } catch (e) { /* next launch uses the default */ }
}

let splashActive = false;

export const isSplashActive = () => splashActive;

/** Starts the animation if this launch plays it; finish(backendReady) hands over to the app. */
export function startSplash() {
  const el = $('splash');
  if (!html.classList.contains('is-splash')) {
    el.remove();
    splashActive = false;
    // No animation: the window is ready as soon as the backend answers.
    return {
      active: false,
      setStatus() {},
      finish(backendReady) { Promise.resolve(backendReady).then(uiReady); },
    };
  }
  splashActive = true;
  el.classList.add('is-run');
  const stopRings = startRings(el.querySelector('.pg-splash__rings'), el.querySelector('.app-splash__bg'));
  const warm = () => html.classList.add('is-warm');
  const warmTimer = setTimeout(warm, WARM_MS);

  // Status element: updated by setStatus() calls from boot() in main.js.
  // Instead of jumping immediately to "Ready", real performed steps are queued
  // and dropped sequentially from top to bottom with checkmarks.
  const statusEl = $('splash-status');
  const stepsEl = $('splash-steps');
  const CHECK_SVG = '<svg class="pg-splash__check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6"/></svg>';

  const stepQueue = [];
  const addedKeys = new Set();
  let pumpTimer = null;
  let queueStarted = false;
  const START_DELAY_MS = 1000;  // Synchronise with progress bar entrance (pg.css: 1.0s)
  const STEP_INTERVAL_MS = 340; // Rhythmic top-to-bottom drop interval

  function renderStep(step) {
    if (!stepsEl) return;
    const text = (typeof step === 'object' && step.key) ? (t(step.key) || step.fallback) : step;
    const item = document.createElement('div');
    item.className = 'pg-splash__step';
    item.innerHTML = `${CHECK_SVG}<span></span>`;
    setText(item.querySelector('span'), text);
    stepsEl.appendChild(item);
  }

  function pumpQueue() {
    if (!stepQueue.length) {
      pumpTimer = null;
      return;
    }
    const nextStep = stepQueue.shift();
    renderStep(nextStep);
    pumpTimer = setTimeout(pumpQueue, STEP_INTERVAL_MS);
  }

  function schedulePump() {
    if (queueStarted) {
      if (!pumpTimer) pumpQueue();
      return;
    }
    queueStarted = true;
    setTimeout(pumpQueue, START_DELAY_MS);
  }

  const minTime = new Promise((r) => setTimeout(r, MIN_MS));
  const maxTime = new Promise((r) => setTimeout(r, MAX_MS));

  return {
    active: true,

    /** Called by boot() at each real milestone to show genuine progress. */
    setStatus(key, fallback) {
      const text = t(key) || fallback;
      if (statusEl) setText(statusEl, text);
      if (!addedKeys.has(key)) {
        addedKeys.add(key);
        stepQueue.push({ key, fallback });
        schedulePump();
      }
    },

    finish(backendReady) {
      // Reveal when min duration (2.25 s) elapsed and backend is ready.
      // Staggered two-stage handover to prevent simultaneous GPU compositor overload:
      Promise.all([minTime, Promise.race([backendReady, maxTime])]).then(() => {
        clearTimeout(warmTimer);
        warm();
        // Phase 1: Splash elements bloom and dissolve into the noisy dark background (0 - 450ms)
        el.classList.add('is-grown');

        // Phase 2: Now that splash is completely gone, reveal the patterned wallpaper and drop islands in
        setTimeout(() => {
          debugPhase('reveal');
          html.classList.add('is-enter');
          el.classList.add('is-app');
        }, 450);

        // Safe cleanup: wait until all islands have settled and splash opacity has reached 0.
        setTimeout(() => {
          clearTimeout(pumpTimer);
          stopRings();
          stepQueue.length = 0;
          el.hidden = true;
          el.remove();
          html.classList.remove('is-splash', 'is-enter', 'is-warm');
          splashActive = false;
          window.dispatchEvent(new Event('resize'));
          uiReady();
        }, CLEANUP_MS);
      });
    },
  };
}

/** Mirrors Go's setting for the next launch's first paint (the toggle is in Settings). */
export function syncSplashSetting() {
  call('GetSplash').then((on) => remember(!!on));
}
