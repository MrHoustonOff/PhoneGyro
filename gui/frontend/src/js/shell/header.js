// Header controls: theme, language and the link status capsule.

import { $, setText, toggleClass } from '../core/dom.js';
import { call, on } from '../core/bridge.js';
import { t, getLang, setLang, onLang } from '../core/i18n.js';
import { onState, getState } from '../core/state.js';

function applyTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('pg-theme', theme); } catch (e) { /* first paint only */ }
}

function markLang() {
  document.querySelectorAll('#lang-seg .pg-seg__btn').forEach((b) => toggleClass(b, 'is-active', b.dataset.lang === getLang()));
}

// Status word and colour: streaming, paused, waiting for the USB controller, or offline.
function renderStatus(st) {
  const el = $('status');
  let kind = st.status === 'online' ? 'online' : st.status === 'paused' ? 'paused' : 'offline';
  if (kind === 'offline' && st.inputMode === 'usb') kind = 'usb';
  if (el._kind !== kind) {
    el._kind = kind;
    el.className = 'pg-status' + (kind === 'offline' ? '' : ' pg-status--' + kind);
  }
  const key = kind === 'usb' ? 'status.waiting_usb' : 'status.' + kind;
  toggleClass($('brand-o'), 'is-live', kind === 'online'); // design: the ring's dot orbits while streaming
  setText($('status-t'), t(key).toLowerCase());
}

export async function startHeader() {
  $('btn-theme').onclick = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    call('SetTheme', next);
  };
  $('lang-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (b) setLang(b.dataset.lang);
  });
  onLang(() => { markLang(); if (getState()) renderStatus(getState()); });
  onState(renderStatus);
  on('theme-sync', applyTheme);
  applyTheme(await call('GetTheme'));
}
