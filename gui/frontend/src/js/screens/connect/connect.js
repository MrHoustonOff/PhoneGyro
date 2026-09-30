// The home screen: phone / USB switch and which view shows.
//   phone, nothing streaming  → pairing card (QR, address, DSU, Initial Setup)
//   USB, no controller        → waiting card
//   a device streams (either) → live dashboard (device card, DSU, pause, profiles)

import { $, show, toggleClass } from '../../core/dom.js';
import { call, openURL } from '../../core/bridge.js';
import { onState, getState, setState } from '../../core/state.js';
import { go } from '../../shell/router.js';
import { el as dsuCard, startDsu } from './dsu.js';
import { startPairing } from './pairing.js';
import { startDevice } from './device.js';
import { startProfiles } from './profiles.js';

const VIEWS = ['pair', 'usbwait', 'dash'];
let view = '';

function markMode(mode) {
  document.querySelectorAll('#mode-seg .pg-seg__btn').forEach((b) => {
    const on = b.dataset.mode === mode;
    toggleClass(b, 'is-active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

function pickView(st) {
  const live = st.status === 'online' || st.status === 'paused';
  if (live) return 'dash';
  return st.inputMode === 'usb' ? 'usbwait' : 'pair';
}

function render(st) {
  markMode(st.inputMode === 'usb' ? 'usb' : 'phone');
  const next = pickView(st);
  if (next === view) return;
  view = next;
  for (const v of VIEWS) show($('view-' + v), v === view);
  // The DSU card lives in whichever view shows.
  const slot = document.querySelector(`[data-dsu-slot="${view}"]`);
  if (slot && dsuCard.parentNode !== slot) slot.appendChild(dsuCard);
}

export function startConnect() {
  $('mode-seg').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || !getState() || getState().inputMode === b.dataset.mode) return;
    markMode(b.dataset.mode); // at once; Go confirms with a state update
    await call('SetInputMode', b.dataset.mode);
    setState(await call('GetState'));
  });
  $('btn-setup').onclick = () => go('setup');
  $('btn-usb-repo').onclick = () => openURL('https://github.com/MrHoustonOff/PhoneGyro_hardware_protocol');

  startDsu();
  startPairing();
  startDevice();
  startProfiles();
  onState(render);
}
