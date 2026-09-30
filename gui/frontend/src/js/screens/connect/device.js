// Live device card (design: ScreenUsb, left column), for the phone and the USB
// controller alike: name, link badges, the level dial, connection time, recenter.

import { $, setText, show, toggleClass, setVar } from '../../core/dom.js';
import { call } from '../../core/bridge.js';
import { t, onLang } from '../../core/i18n.js';
import { onState, getState } from '../../core/state.js';
import { toast } from '../../ui/toast.js';

const REM_PER_DEG = 0.125;  // bubble travel (2 px per degree at 16 px)
const MAX_REM = 3.625;      // design: clamp to ±58 px
const LEVEL_DEG = 1;        // design: under 1° the bubble turns accent

// Level dial (design: Dial): roll moves the bubble sideways, pitch up and down.
// Past 90 degrees the device is upside down: the label says so.
function renderLevel({ pitch = 0, roll = 0, yaw = 0 }) {
  const clamp = (v) => Math.max(-MAX_REM, Math.min(MAX_REM, v * REM_PER_DEG));
  const dial = $('dial');
  setVar(dial, '--bx', clamp(roll).toFixed(3) + 'rem');
  setVar(dial, '--by', clamp(-pitch).toFixed(3) + 'rem');
  const level = Math.abs(roll) < LEVEL_DEG && Math.abs(pitch) < LEVEL_DEG;
  toggleClass($('dial-bubble'), 'is-level', level);
  // The green arrow shows heading: turning the device clockwise (seen from
  // above; Go's yaw is + that way) turns it clockwise too.
  const yawEl = $('dial-yaw');
  const rot = `rotate(${(yaw || 0).toFixed(1)} 132 132)`;
  if (yawEl.getAttribute('transform') !== rot) yawEl.setAttribute('transform', rot);
  const flipped = Math.abs(roll) > 90 || Math.abs(pitch) > 90;
  const big = Math.abs(roll) >= Math.abs(pitch) ? ['ROLL', roll] : ['PITCH', pitch];
  setText($('dial-label'), level ? t('ui.level_level') : flipped ? t('ui.level_down')
    : `${big[0]} ${big[1] >= 0 ? '+' : ''}${big[1].toFixed(0)}°`);
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
  badge($('dev-status'), online ? ' pg-badge--ok pg-badge--dot' : ' pg-badge--warn pg-badge--dot', t('status.' + (online ? 'online' : 'paused')).toLowerCase());
  setText($('dev-hz'), `${Math.round(st.hz || 0)} Hz`);
  const extra = $('dev-extra');
  const extraText = usb ? (st.usbPort || '') : (st.pingMs >= 0 ? `${st.pingMs} ms` : '');
  show(extra, !!extraText);
  setText(extra, extraText);
  setText($('dev-link'), usb ? t('usb_mode.direct_connection') : t('ui.wifi_link'));
  setText($('dev-timer'), st.connectedTime || '00:00:00');

  renderLevel(st);

  const pause = $('btn-pause');
  toggleClass(pause, 'is-paused', !!st.isPaused);
  setText(pause, t(st.isPaused ? 'controls.resume' : 'controls.pause'));
}

export function startDevice() {
  $('btn-recenter').onclick = async () => {
    await call('ResetAHRS');
    toast(t('status.horizon_recenter'));
  };
  $('btn-pause').onclick = () => call('TogglePause');
  onState(render);
  onLang(() => { if (getState()) render(getState()); });
}
