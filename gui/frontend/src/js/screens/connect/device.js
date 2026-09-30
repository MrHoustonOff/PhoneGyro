// Live device card (design: ScreenUsb, left column), for the phone and the USB
// controller alike: name, link badges, the level dial, connection time, recenter.

import { $, setText, show, toggleClass } from '../../core/dom.js';
import { call } from '../../core/bridge.js';
import { t, onLang } from '../../core/i18n.js';
import { createDeviceLevel } from '../../ui/level.js';
import { onState, getState } from '../../core/state.js';
import { toast } from '../../ui/toast.js';

let level = null;

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

  level.update(st);

  const pause = $('btn-pause');
  toggleClass(pause, 'is-paused', !!st.isPaused);
  setText(pause, t(st.isPaused ? 'controls.resume' : 'controls.pause'));
}

export function startDevice() {
  level = createDeviceLevel($('level'), $('dial-label'));
  // Level model: Settings → Performance (Go settings.json "level3d", 3D by default).
  call('GetAppSettings').then((s) => level.setMode(s && s.level3d === false ? 'flat' : '3d'));
  addEventListener('pg:settings', (e) => level.setMode(e.detail.level3d === false ? 'flat' : '3d'));
  $('btn-recenter').onclick = async () => {
    await call('ResetAHRS');
    toast(t('status.horizon_recenter'));
  };
  $('btn-pause').onclick = () => call('TogglePause');
  onState(render);
  onLang(() => { if (getState()) render(getState()); });
}
