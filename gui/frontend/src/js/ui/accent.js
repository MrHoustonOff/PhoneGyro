// UI accent colour (Settings → Appearance). The design's PhoneGyro.accent
// (js/vendor/accent.js, generated): <html data-accent>, eight colours, and on a
// swatch click the wave of the new colour with the ring burst. Green is the
// design's own (no attribute); amber is the app's default (owner's pick).
// <head> applies the stored colour before first paint; Go's settings.json
// accent is the truth and is mirrored back here.

import { call } from '../core/bridge.js';
import { accent } from '../vendor/accent.js';

export const ACCENTS = accent.list;
export const DEFAULT_ACCENT = 'amber';

/** Applies a colour; from: the swatch (runs the wave), none: instant. */
export function applyAccent(name, from = null) {
  if (!ACCENTS.includes(name)) name = DEFAULT_ACCENT;
  accent.set(name, from ? { from } : { animate: false });
}

export function startAccent() {
  call('GetAppSettings').then((s) => { if (s) applyAccent(s.accent === 'gold' ? 'amber' : s.accent); });
}
