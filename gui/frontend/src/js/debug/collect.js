// The main window's side of debugging: it only measures (it draws nothing) and
// sends to Go's debug hub, which shows it in the debug window and writes the
// debug log. Runs while the hub is active; starts before the launch animation
// when the localStorage mirror says debugging is on.
//   ui sample every 500 ms: FPS, frame p50/p95/p99/max, long tasks, longest wait
//   between two states, JS heap, DOM size, IPC round trip
//   events: long tasks ≥ 100 ms, JS errors and unhandled promises, screen
//   changes, UI start phases

import { call } from '../core/bridge.js';
import { stateStats } from '../core/state.js';

const TICK_MS = 500;
let on = false, raf = 0, tick = 0, observer = null;
let deltas = [], lastFrame = 0, longTasks = 0, worstTask = 0, lastAt = 0, lastCount = 0;
const early = [];   // events before the bridge is up

function push(kind, data) {
  if (!on) return;
  if (!window.go) { early.push([kind, data]); return; }
  call('PushDebug', kind, data);
}
export const debugLog = (level, msg) => push('log', { level, msg });
export const debugPhase = (name) => push('phase', { name });

function frame(now) {
  if (lastFrame) deltas.push(now - lastFrame);
  lastFrame = now;
  raf = requestAnimationFrame(frame);
}

async function sample() {
  const now = performance.now();
  const dt = (now - (lastAt || now - TICK_MS)) / 1000;
  lastAt = now;
  const s = deltas.slice().sort((a, b) => a - b);
  const pct = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
  const shell = document.getElementById('shell');
  const w = shell ? shell.clientWidth : innerWidth;
  const t0 = performance.now();
  await call('IsDebugActive');
  const data = {
    fps: deltas.length / dt, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), worst: s[s.length - 1] || 0,
    longTasks, worstTask, maxGap: stateStats.maxGap, statePerSec: (stateStats.count - lastCount) / dt,
    heapJs: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    dom: document.getElementsByTagName('*').length, ipcMs: performance.now() - t0,
    w, h: shell ? shell.clientHeight : innerHeight, mode: w >= 860 ? 'wide' : w >= 560 ? 'compact' : w >= 400 ? 'sm' : 'xs',
    zoom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pg-zoom')) || 1,
    visible: document.visibilityState === 'visible',
  };
  deltas = []; longTasks = 0; worstTask = 0; stateStats.maxGap = 0; lastCount = stateStats.count;
  if (dt < 0.3) return; // the first tick right at start has no frames yet
  push('ui', data);
  if (data.visible && data.fps < 30) debugLog('WARN', `ui: ${data.fps.toFixed(0)} fps, p95 ${data.p95.toFixed(1)} ms, worst ${data.worst.toFixed(0)} ms`);
  if (data.maxGap > 300) debugLog('WARN', `state: no update from Go for ${data.maxGap.toFixed(0)} ms`);
}

function onError(e) {
  const msg = e.reason ? `unhandled promise: ${e.reason && (e.reason.stack || e.reason)}` : `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
  debugLog('ERROR', 'js: ' + String(msg).split('\n').slice(0, 4).join(' | '));
}

export function startCollect() {
  if (on) return;
  on = true;
  lastFrame = 0; deltas = []; lastAt = 0; lastCount = stateStats.count;
  raf = requestAnimationFrame(frame);
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTasks++;
        worstTask = Math.max(worstTask, e.duration);
        if (e.duration >= 100) debugLog('WARN', `ui: long task ${e.duration.toFixed(0)} ms`);
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch (e) { observer = null; }
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onError);
  tick = setInterval(sample, TICK_MS);
}

/** Sends what was measured before the bridge came up. */
export function flushEarly() {
  while (early.length) { const [k, d] = early.shift(); call('PushDebug', k, d); }
}

export function stopCollect() {
  if (!on) return;
  on = false;
  cancelAnimationFrame(raf);
  clearInterval(tick);
  if (observer) observer.disconnect();
  observer = null;
  removeEventListener('error', onError);
  removeEventListener('unhandledrejection', onError);
}
