// Live device card (design: ScreenUsb, left column), for the phone and the USB
// controller alike: name, link badges, the level dial, connection time, recenter.

import { $, setText, show, toggleClass, setVar } from '../../core/dom.js';
import { call } from '../../core/bridge.js';
import { t, onLang } from '../../core/i18n.js';
import { onState, getState } from '../../core/state.js';
import { toast } from '../../ui/toast.js';

const PX_PER_DEG = 2;   // bubble travel
const MAX_PX = 58;      // design: clamp to ±58 px
const LEVEL_DEG = 1;    // design: under 1° the bubble turns accent

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

  // Level dial: roll moves the bubble sideways, pitch up and down.
  const roll = st.roll || 0, pitch = st.pitch || 0;
  const clamp = (v) => Math.max(-MAX_PX, Math.min(MAX_PX, v * PX_PER_DEG));
  const dial = $('dial');
  setVar(dial, '--bx', clamp(roll).toFixed(1) + 'px');
  setVar(dial, '--by', clamp(-pitch).toFixed(1) + 'px');
  const level = Math.abs(roll) < LEVEL_DEG && Math.abs(pitch) < LEVEL_DEG;
  toggleClass($('dial-bubble'), 'is-level', level);
  const big = Math.abs(roll) >= Math.abs(pitch) ? ['ROLL', roll] : ['PITCH', pitch];
  setText($('dial-label'), level ? 'LEVEL' : `${big[0]} ${big[1] >= 0 ? '+' : ''}${big[1].toFixed(0)}°`);

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
