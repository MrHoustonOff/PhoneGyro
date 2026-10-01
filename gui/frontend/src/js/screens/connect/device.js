// Live device card (design: ScreenUsb, left column), for the phone and the USB
// controller alike: name, link badges, the level dial, connection time, recenter.

import { $, setText, show, toggleClass } from '../../core/dom.js';
import { call } from '../../core/bridge.js';
import { t, onLang } from '../../core/i18n.js';
import { onState, getState } from '../../core/state.js';
import { toast } from '../../ui/toast.js';
import { playSound } from '../../core/sound.js';

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

function dialStep() {
  rafId = 0;

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
  if (!rafId) rafId = requestAnimationFrame(dialStep);
}

// Called from render() on every state update.
function updateDial({ pitch = 0, roll = 0, yaw = 0 }) {
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

  $('btn-recenter').onclick = async () => {
    await call('ResetAHRS');
    playSound('recenter');
    toast(t('status.horizon_recenter'));
  };
  $('btn-pause').onclick = () => call('TogglePause');
  onState(render);
  onLang(() => { if (getState()) render(getState()); });
}
