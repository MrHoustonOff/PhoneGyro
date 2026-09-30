// Calibration hint system (design: CalHints): two reusable prompts that nudge
// the user towards calibration without interrupting the session.
//
// hint-new  (urgent, red)  — fires once per session when the device comes online
//                            and has no calibrated profiles at all. Stays visible
//                            until dismissed or a profile is saved.
//
// hint-recal (soft, amber) — fires when the phone has been still for ≥ 2.2 s
//                            and its horizon is off-centre (|pitch|>10° OR |roll|>10°).
//                            Auto-dismisses after 20 s. Cooldown 45 s after dismiss.
//                            Respects settings.stillnessHint === false.

import { $, show, toggleClass } from '../../core/dom.js';
import { onState } from '../../core/state.js';
import { openCalibration } from '../calibration.js';

// ── Constants ────────────────────────────────────────────────────────────────
const STILLNESS_MS   = 2200;   // phone must be still for this long
const STILLNESS_DEG  = 0.12;   // max delta per frame to count as "still"
const OFFCENTER_DEG  = 10.0;   // horizon offset to trigger the hint
const RECAL_TIMEOUT  = 20000;  // auto-dismiss soft hint after 20 s
const RECAL_COOLDOWN = 45000;  // don't re-show within 45 s of a dismiss

// ── Soft hint (stillness recal) state ────────────────────────────────────────
let recalShown      = false;
let recalDismissedAt = 0;
let recalTimer      = null;
let stillnessStart  = 0;
let lastPitch       = 0;
let lastRoll        = 0;

// ── Urgent hint (new device) state ───────────────────────────────────────────
let newHintShownForSession = false; // once per mode-session
let lastInputMode = '';

// ── DOM refs (cached in startCalHints) ───────────────────────────────────────
let elRecal, elNew, elCalBtn;

// ────────────────────────────────────────────────────────────────────────────
// Soft hint helpers
// ────────────────────────────────────────────────────────────────────────────
function showRecal() {
  if (recalShown) return;
  recalShown = true;
  show(elRecal, true);
  if (recalTimer) clearTimeout(recalTimer);
  recalTimer = setTimeout(() => hideRecal(false), RECAL_TIMEOUT);
}

function hideRecal(immediate) {
  if (!recalShown && !immediate) return;
  recalShown = false;
  recalDismissedAt = Date.now();
  if (recalTimer) { clearTimeout(recalTimer); recalTimer = null; }
  show(elRecal, false);
}

// ────────────────────────────────────────────────────────────────────────────
// Urgent hint helpers
// ────────────────────────────────────────────────────────────────────────────
function showNew() {
  show(elNew, true);
  toggleClass(elCalBtn, 'is-urgent', true);
}

function hideNew() {
  show(elNew, false);
  toggleClass(elCalBtn, 'is-urgent', false);
}

// ────────────────────────────────────────────────────────────────────────────
// Returns true when the state has at least one calibrated profile
// (a profile is calibrated if it has a non-empty name).
// ────────────────────────────────────────────────────────────────────────────
function hasAnyProfile(st) {
  return (st.profiles || []).some((p) => p && p.name);
}

// ────────────────────────────────────────────────────────────────────────────
// Main per-state logic
// ────────────────────────────────────────────────────────────────────────────
function onStateChange(st) {
  const online = st.status === 'online';
  const mode   = st.inputMode || 'phone';

  // ── Urgent: new device (no profiles at all) ──────────────────────────────
  if (mode !== lastInputMode) {
    // Mode changed (phone ↔ USB or first render): reset session gate.
    lastInputMode = mode;
    newHintShownForSession = false;
    hideNew();
  }

  if (online && !newHintShownForSession && !hasAnyProfile(st)) {
    newHintShownForSession = true;
    showNew();
  }
  // If user calibrated mid-session → hide banner immediately.
  if (hasAnyProfile(st)) hideNew();

  // ── Soft: stillness + off-centre ─────────────────────────────────────────
  if (!online) {
    // Device offline: reset everything.
    hideRecal(true);
    stillnessStart = 0;
    return;
  }

  // If device got calibrated: dismiss hint and reset.
  if (hasAnyProfile(st)) {
    if (recalShown) hideRecal(true);
    // No stillness-hint when there are profiles and device is online & centred.
  }

  const p = st.pitch || 0;
  const r = st.roll  || 0;

  const moving = Math.abs(p - lastPitch) > STILLNESS_DEG || Math.abs(r - lastRoll) > STILLNESS_DEG;
  lastPitch = p;
  lastRoll  = r;

  if (moving) {
    stillnessStart = 0;
    if (recalShown) hideRecal(false);
    return;
  }

  // Phone is still:
  const now = Date.now();
  if (!stillnessStart) stillnessStart = now;

  const isOffCentre = Math.abs(p) > OFFCENTER_DEG || Math.abs(r) > OFFCENTER_DEG;
  const cooldownOk  = !recalDismissedAt || (now - recalDismissedAt > RECAL_COOLDOWN);

  if (!isOffCentre) {
    if (recalShown) hideRecal(false);
    return;
  }

  if (!recalShown && cooldownOk && (now - stillnessStart >= STILLNESS_MS)) {
    showRecal();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public init — called once from connect.js
// ────────────────────────────────────────────────────────────────────────────
export function startCalHints() {
  elRecal  = $('hint-recal');
  elNew    = $('hint-new');
  elCalBtn = $('btn-calibrate');

  $('hint-recal-close').onclick = () => hideRecal(false);
  $('hint-new-close').onclick   = () => {
    hideNew();
    newHintShownForSession = true; // don't re-show after manual dismiss
  };

  // Clicking the banners themselves (except the close button) opens calibration.
  elRecal.addEventListener('click', (e) => {
    if (e.target.closest('.app-hint__close')) return;
    hideRecal(true);
    openCalibration();
  });
  elNew.addEventListener('click', (e) => {
    if (e.target.closest('.app-hint__close')) return;
    hideNew();
    newHintShownForSession = true;
    openCalibration();
  });

  onState(onStateChange);
}
