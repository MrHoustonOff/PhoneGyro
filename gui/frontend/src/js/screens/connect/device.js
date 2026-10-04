// Live device card (design: ScreenUsb, left column), for the phone and the USB
// controller alike: name, link badges, the level dial, connection time, recenter.

import { $, setText, show, toggleClass } from '../../core/dom.js';
import { call } from '../../core/bridge.js';
import { t, onLang } from '../../core/i18n.js';
import { onState, getState } from '../../core/state.js';
import { onScreen } from '../../shell/router.js';

const REM_PER_DEG = 0.125;  // bubble travel (2 px per degree at 16 px/rem)
const MAX_REM = 3.625;      // design: clamp to ±58 px
const LEVEL_DEG = 1;        // design: under 1° the bubble turns accent
const EASE = 0.18;          // easing factor per frame (~60 fps): higher = snappier
const SNAP = 0.04;          // snap-to-target threshold in degrees

// ── Level dial animation state ───────────────────────────────────────────────
let tPitch = 0, tRoll = 0, tYaw = 0;  // target (from state, 15 Hz)
let cPitch = 0, cRoll = 0, cYaw = 0;  // current (animated, 60 fps)
let rafId = 0;

// Cache DOM refs once per startDevice() call.
let dialEl, bubbleEl, yawEl, labelEl;
let biasStatusEl, biasBarFill, biasValX, biasValY, biasValZ;
let biasFlashTimeout;
let accelEls = null;           // per axis: { neg, pos, val, last }
const ACCEL_FULL_G = 1;        // a full bar is 1 g (DSU output, g)

function isDialVisible() {
  if (document.hidden) return false;
  const screen = $('screen-connect');
  if (!screen || screen.hidden) return false;
  const dash = $('view-dash');
  if (!dash || dash.hidden) return false;
  return true;
}

function dialStep() {
  rafId = 0;

  if (!isDialVisible()) {
    cPitch = tPitch; cRoll = tRoll; cYaw = tYaw;
    return;
  }

  const dp = tPitch - cPitch, dr = tRoll - cRoll;
  // Shortest-angle delta for yaw: normalise to (-180, +180] so crossing the
  // ±180° boundary animates the short way (e.g. 1°) not the long way (359°).
  let dy = tYaw - cYaw;
  dy = ((dy % 360) + 540) % 360 - 180;

  const done = Math.abs(dp) < SNAP && Math.abs(dr) < SNAP && Math.abs(dy) < SNAP;

  if (done) {
    cPitch = tPitch; cRoll = tRoll; cYaw += dy; // snap cYaw toward tYaw by dy
  } else {
    cPitch += dp * EASE;
    cRoll  += dr * EASE;
    cYaw   += dy * EASE; // cYaw accumulates freely; SVG rotate() handles any value
    rafId = requestAnimationFrame(dialStep); // keep running until settled
  }

  // Bubble position via CSS vars (already wired in the SVG via design).
  const clamp = (v) => Math.max(-MAX_REM, Math.min(MAX_REM, v * REM_PER_DEG));
  dialEl.style.setProperty('--bx', clamp(cRoll).toFixed(3) + 'rem');
  dialEl.style.setProperty('--by', clamp(-cPitch).toFixed(3) + 'rem');

  // Level state on bubble.
  const level = Math.abs(cRoll) < LEVEL_DEG && Math.abs(cPitch) < LEVEL_DEG;
  bubbleEl.classList.toggle('is-level', level);

  // Yaw arrow: only write when value actually changes.
  const rot = `rotate(${cYaw.toFixed(2)} 132 132)`;
  if (yawEl.getAttribute('transform') !== rot) yawEl.setAttribute('transform', rot);

  // Label: use target values (snappy text is fine, animation is visual).
  const flipped = Math.abs(tRoll) > 90 || Math.abs(tPitch) > 90;
  const big = Math.abs(tRoll) >= Math.abs(tPitch) ? ['ROLL', tRoll] : ['PITCH', tPitch];
  const label = level ? t('ui.level_level')
    : flipped ? t('ui.level_down')
    : `${big[0]} ${big[1] >= 0 ? '+' : ''}${big[1].toFixed(0)}°`;
  if (labelEl.textContent !== label) labelEl.textContent = label;
}

function wakeDialLoop() {
  if (!isDialVisible()) return;
  if (!rafId) rafId = requestAnimationFrame(dialStep);
}

// Called from render() on every state update.
function updateDial({ pitch = 0, roll = 0, yaw = 0 }) {
  // the same state 15 times a second (a still device) must not wake a frame (Rule 0)
  if (pitch === tPitch && roll === tRoll && yaw === tYaw) return;
  tPitch = pitch; tRoll = roll; tYaw = yaw;
  wakeDialLoop();
}

function badge(el, cls, text) {
  const c = 'pg-badge' + cls;
  if (el.className !== c) el.className = c;
  setText(el, text);
}

function render(st) {
  const usb = st.inputMode === 'usb';
  const online = st.status === 'online';
  toggleClass($('dev-chip'), 'is-usb', usb);
  setText($('dev-name'), st.deviceName || (usb ? t('usb_mode.connected_name') : t('mode.phone')));
  badge($('dev-status'), online ? ' pg-badge--ok pg-badge--dot' : ' pg-badge--danger pg-badge--dot', t('status.' + (online ? 'online' : 'paused')).toLowerCase());
  setText($('dev-hz'), `${Math.round(st.hz || 0)} Hz`);
  const extra = $('dev-extra');
  const extraText = usb ? (st.usbPort || '') : (st.pingMs >= 0 ? `${st.pingMs} ms` : '');
  show(extra, !!extraText);
  setText(extra, extraText);
  setText($('dev-link'), usb ? t('usb_mode.direct_connection') : t('ui.wifi_link'));
  setText($('dev-timer'), st.connectedTime || '00:00:00');

  updateDial(st); // only updates targets; rAF loop handles the visuals
  updateBiasMeta(st);
  updateAccel(st);

  const pause = $('btn-pause');
  toggleClass(pause, 'is-paused', !!st.isPaused);
  setText(pause, t(st.isPaused ? 'controls.resume' : 'controls.pause'));
}

export function startDevice() {
  // Cache dial DOM refs once — the loop runs at 60 fps, no querySelector overhead.
  dialEl   = $('dial');
  bubbleEl = $('dial-bubble');
  yawEl    = $('dial-yaw');
  labelEl  = $('dial-label');
  biasStatusEl = $('bias-status');
  biasBarFill = $('bias-bar-fill');
  biasValX = $('bias-val-x');
  biasValY = $('bias-val-y');
  biasValZ = $('bias-val-z');

  accelEls = ['x', 'y', 'z'].map((a) => ({ neg: $('accel-neg-' + a), pos: $('accel-pos-' + a), val: $('accel-val-' + a), last: Infinity, smooth: NaN }));

  $('btn-pause').onclick = () => call('TogglePause');
  onState(render);
  onLang(() => { if (getState()) render(getState()); });
  onScreen((screen) => {
    if (screen === 'connect') wakeDialLoop();
    else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    else if (!document.hidden) wakeDialLoop();
  });
}

// Accelerometer bars: the DSU output (what emulators receive), not the raw sensor.
// Written only while the card is on screen. Each axis is smoothed (about 0.3 s
// at the state's 15 Hz; a real tilt past ACCEL_JUMP_G catches up faster), and
// the shown value holds until the smoothed one moves past ACCEL_HOLD_G: a still
// device shows still numbers and costs no DOM work at all (Rule 0).
const ACCEL_EASE = 0.2, ACCEL_EASE_FAST = 0.6, ACCEL_JUMP_G = 0.08, ACCEL_HOLD_G = 0.01;
function updateAccel(st) {
  if (!accelEls || !isDialVisible()) return;
  const v = [st.dsuAccX, st.dsuAccY, st.dsuAccZ];
  for (let k = 0; k < 3; k++) {
    const e = accelEls[k];
    if (!e.val) continue;
    const raw = Number(v[k]) || 0;
    if (!Number.isFinite(e.smooth)) e.smooth = raw;
    else e.smooth += (Math.abs(raw - e.smooth) > ACCEL_JUMP_G ? ACCEL_EASE_FAST : ACCEL_EASE) * (raw - e.smooth);
    if (Math.abs(e.smooth - e.last) < ACCEL_HOLD_G) continue;
    e.last = e.smooth;
    const g = Math.round(e.smooth * 100) / 100;
    const f = Math.min(1, Math.abs(g) / ACCEL_FULL_G);
    e.pos.style.transform = `translateX(${g > 0 ? (f - 1) * 100 : -100}%)`;
    e.neg.style.transform = `translateX(${g < 0 ? (1 - f) * 100 : 100}%)`;
    e.val.textContent = (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(2);
  }
}

// Writes only what changed: this runs on every state (15 Hz).
const setCls = (el, c) => { if (el.className !== c) el.className = c; };
let biasScale = -1;
function setBiasScale(v) {
  if (v === biasScale) return;
  biasScale = v;
  biasBarFill.style.transform = `scaleX(${v})`;
}

function updateBiasMeta(st) {
  if (!biasStatusEl) return;

  if (!st.biasAtRest) {
    setCls(biasStatusEl, 'pg-badge app-bias-status pg-badge--danger pg-badge--dot');
    setText(biasStatusEl, t('ui.bias_moving'));
    setBiasScale(0);
    if (biasBarFill.classList.contains('is-far')) biasBarFill.classList.remove('is-far');
  } else {
    // If recently flashed "UPDATED", keep that text temporarily.
    if (!biasFlashTimeout) {
      setCls(biasStatusEl, 'pg-badge app-bias-status pg-badge--ok pg-badge--dot');
      setText(biasStatusEl, t('ui.bias_rest'));
    }
    setBiasScale(Math.round(Math.min(1, Math.max(0, st.biasRestProgress || 0)) * 100) / 100);
    
    // flash "ОБНОВЛЁН" when reaching 1
    if (st.biasRestProgress >= 1 && !biasFlashTimeout) {
      setCls(biasStatusEl, 'pg-badge app-bias-status pg-badge--ok');
      setText(biasStatusEl, t('ui.bias_updated'));
      biasFlashTimeout = setTimeout(() => {
        biasFlashTimeout = null;
        if (biasStatusEl) {
           setCls(biasStatusEl, 'pg-badge app-bias-status pg-badge--ok pg-badge--dot');
           setText(biasStatusEl, t('ui.bias_rest'));
        }
      }, 2000);
    }
  }

  setText(biasValX, (st.biasX >= 0 ? '+' : '') + (st.biasX || 0).toFixed(1));
  setText(biasValY, (st.biasY >= 0 ? '+' : '') + (st.biasY || 0).toFixed(1));
  setText(biasValZ, (st.biasZ >= 0 ? '+' : '') + (st.biasZ || 0).toFixed(1));
}
