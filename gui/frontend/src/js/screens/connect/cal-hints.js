// Calibration hint system (design: CalHints): two prompts that nudge the user
// towards calibration without interrupting the session. Neither banner is a
// link: the Calibrate button (it pulses) is what opens the wizard.
//
// hint-new   (urgent, red) - a device with no profile of its own connects: the
//                            device card glows red, the Calibrate button pulses,
//                            the banner offers "Calibrate". Fires once per device
//                            and session; fades after 20 s.
//
// hint-recal (soft, amber) - the phone has been still for >= 2.2 s and its
//                            horizon is off-centre (|pitch| or |roll| > 10 deg).
//                            The banner shows and the Calibrate button pulses
//                            amber. Gone after 10 s, then a 45 s cooldown.
//                            Respects settings.stillnessHint === false.

import { $, show, toggleClass } from '../../core/dom.js';
import { call } from '../../core/bridge.js';
import { onState } from '../../core/state.js';
import { openCalibration } from '../calibration.js';

const STILLNESS_MS   = 2200;   // phone must be still for this long
const STILLNESS_DEG  = 0.12;   // max change per state to count as "still"
const OFFCENTER_DEG  = 10.0;   // horizon offset that triggers the soft hint
const RECAL_TIMEOUT  = 10000;  // the soft hint goes away by itself
const RECAL_COOLDOWN = 45000;  // no new soft hint within this time after one
const SETTLE_MS      = 3500;   // after (re)connecting the horizon is still settling
const NEW_TIMEOUT    = 20000;  // the new-device alert fades after this long

let elRecal, elNew, elCalBtn, elCard;

// ── Soft hint ────────────────────────────────────────────────────────────────
let recalShown = false;
let recalDismissedAt = 0;
let recalTimer = null;
let stillnessStart = 0;
let lastPitch = 0;
let lastRoll = 0;
let settleUntil = 0;
let wasOnline = false;

async function showRecal(force = false) {
  if (recalShown) return;
  if (!force) {
    const s = await call('GetAppSettings');
    if (s && s.stillnessHint === false) return;
  }
  if (recalShown) return;
  recalShown = true;
  show(elRecal, true);
  toggleClass(elCalBtn, 'is-hint', true);
  clearTimeout(recalTimer);
  recalTimer = setTimeout(() => hideRecal(), RECAL_TIMEOUT);
}

function hideRecal() {
  if (!recalShown) return;
  recalShown = false;
  recalDismissedAt = Date.now();
  clearTimeout(recalTimer);
  recalTimer = null;
  show(elRecal, false);
  toggleClass(elCalBtn, 'is-hint', false);
}

// ── Urgent hint (new device) ─────────────────────────────────────────────────
const seenDevices = new Set();   // devices already alerted about this session
let newShown = false;
let newTimer = null;

function showNew() {
  newShown = true;
  show(elNew, true);
  toggleClass(elCard, 'is-alert', true);
  toggleClass(elCalBtn, 'is-urgent', true);
  // restart the countdown bar
  const bar = elNew.querySelector('.app-hint__bar');
  if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
  clearTimeout(newTimer);
  newTimer = setTimeout(hideNew, NEW_TIMEOUT);
}

function hideNew() {
  newShown = false;
  clearTimeout(newTimer);
  newTimer = null;
  show(elNew, false);
  toggleClass(elCard, 'is-alert', false);
  toggleClass(elCalBtn, 'is-urgent', false);
}

/** A profile made for this device (profiles remember the device they were calibrated on). */
export function hasProfileFor(st, dev) {
  const d = dev.toLowerCase();
  return (st.profiles || []).some((p) => p && p.name && (p.device || '').trim().toLowerCase() === d);
}

function realDevice(st) {
  const dev = (st.deviceName || '').trim();
  return dev && dev !== 'Controller' && dev !== 'Unknown' ? dev : '';
}

// ── Per-state logic ──────────────────────────────────────────────────────────
function onStateChange(st) {
  const online = st.status === 'online';
  const now = Date.now();

  if (online && !wasOnline) settleUntil = now + SETTLE_MS;
  wasOnline = online;

  if (!online) {
    hideRecal();
    recalDismissedAt = 0;
    stillnessStart = 0;
    if (newShown) hideNew();
    return;
  }

  // New device: no profile calibrated on it yet.
  const dev = realDevice(st);
  if (dev && !seenDevices.has(dev)) {
    seenDevices.add(dev);
    if (!hasProfileFor(st, dev) && !st?.noPopups && !window.__pgNoPopups) showNew();
  }
  if (newShown && dev && hasProfileFor(st, dev)) hideNew();   // calibrated meanwhile

  // Soft: still and off-centre.
  const p = st.pitch || 0;
  const r = st.roll || 0;
  const moving = Math.abs(p - lastPitch) > STILLNESS_DEG || Math.abs(r - lastRoll) > STILLNESS_DEG;
  lastPitch = p;
  lastRoll = r;

  if (moving) {
    stillnessStart = 0;
    hideRecal();
    return;
  }
  if (!stillnessStart) stillnessStart = now;
  if (now < settleUntil) return;

  const offCentre = Math.abs(p) > OFFCENTER_DEG || Math.abs(r) > OFFCENTER_DEG;
  if (!offCentre) {
    hideRecal();
    return;
  }
  const cooledDown = !recalDismissedAt || now - recalDismissedAt > RECAL_COOLDOWN;
  if (!recalShown && cooledDown && now - stillnessStart >= STILLNESS_MS && !st?.noPopups && !window.__pgNoPopups) showRecal();
}

/** DEV banner panel: the real show/hide, so the close buttons and timers behave as in use. */
export const debugHints = {
  recal: () => showRecal(true),
  newDevice: () => { elNew && showNew(); },
};

export function startCalHints() {
  elRecal  = $('hint-recal');
  elNew    = $('hint-new');
  elCalBtn = $('btn-calibrate');
  elCard   = document.querySelector('.app-devcard');

  $('hint-recal-close').onclick = () => hideRecal();
  $('hint-new-close').onclick = () => hideNew();
  $('hint-new-cal').onclick = () => { hideNew(); openCalibration(); };

  onState(onStateChange);
}
