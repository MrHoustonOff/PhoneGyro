// Interface scale 50–300 % (design: Zoom). Ctrl + / Ctrl − step through the
// design's steps, Ctrl 0 resets, Ctrl + wheel (and touchpad pinch) moves by 10 %.
// The window root gets CSS zoom and is divided by it (css/app.css #shell), so its
// container queries see the zoomed width: 300 % of a 1280 px window lays out like
// a 427 px one. The value lives in Go (settings.json fontScale) and in
// localStorage for the next launch's first paint (<head> script).

import { call, on } from '../core/bridge.js';
import { toast } from './toast.js';

export const MIN = 0.5, MAX = 3;
const STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
let z = 1;
let saveT = 0;
const subs = [];

const clamp = (v) => Math.min(MAX, Math.max(MIN, Math.round(v * 100) / 100 || 1));
export const getZoom = () => z;
export const onZoom = (fn) => subs.push(fn);

/** Applies a scale; save: also store it in Go; quiet: no toast. */
export function setZoom(v, { save = true, quiet = false } = {}) {
  const next = clamp(v);
  if (next === z && quiet) return;
  z = next;
  document.documentElement.style.setProperty('--pg-zoom', String(z));
  try { localStorage.setItem('pg-zoom', String(z)); } catch (e) { /* default next time */ }
  if (!quiet) toast(`${Math.round(z * 100)} %`, 1200);
  if (save) { clearTimeout(saveT); saveT = setTimeout(() => call('SetFontScale', z), 400); }
  for (const fn of subs) fn(z);
}

function step(dir) {
  const next = dir > 0 ? STEPS.find((s) => s > z + 0.001) : [...STEPS].reverse().find((s) => s < z - 0.001);
  setZoom(next === undefined ? (dir > 0 ? MAX : MIN) : next);
}

export function startZoom() {
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { e.preventDefault(); step(1); }
    else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') { e.preventDefault(); step(-1); }
    else if (e.key === '0' || e.code === 'Numpad0') { e.preventDefault(); setZoom(1); }
  }, true);
  let last = 0;
  addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const now = performance.now();
    if (now - last < 70) return;
    last = now;
    setZoom(z + (e.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
  on('font-scale-sync', (v) => setZoom(v, { save: false, quiet: true }));
  call('GetFontScale').then((v) => setZoom(v || 1, { save: false, quiet: true }));
}

/** Mirrors Go's noAutoZoom setting to localStorage for the next launch's head script. */
export function syncAutoZoomSetting(noAutoZoom) {
  try { localStorage.setItem('pg-no-auto-zoom', noAutoZoom ? '1' : '0'); } catch (e) { /* ignore */ }
}
