// UI accent colour (Settings → Appearance): gold (default), green (the design's
// leaf), blue (the design's info teal) or pink. It swaps the --accent* tokens
// (css/app.css, "Accent colours"); <html data-accent> is set before first paint
// from localStorage and kept in sync with Go's settings.json accent.

import { call } from '../core/bridge.js';

export const ACCENTS = ['gold', 'green', 'blue', 'pink'];

export function applyAccent(a) {
  if (!ACCENTS.includes(a)) a = 'gold';
  document.documentElement.setAttribute('data-accent', a);
  try { localStorage.setItem('pg-accent', a); } catch (e) { /* default next time */ }
}

export function startAccent() {
  call('GetAppSettings').then((s) => { if (s) applyAccent(s.accent); });
}
