// Footer islands: the app's RAM, Go core and WebView2 UI apart
// (Go "resource-stats", every ~1.5 s), the update check's state, the version and
// the repository link.

import { $, setText } from '../core/dom.js';
import { call, on, openURL } from '../core/bridge.js';
import { t, getLang, onLang } from '../core/i18n.js';
import { go } from './router.js';

const mb = (x) => Math.round(x || 0) + ' MB';

function renderStats(s) {
  if (!s) return;
  setText($('ram-core'), mb(s.coreRamMb));
  setText($('ram-web'), mb(s.webRamMb));
}

// ── Update check (Go "update:status", update_check.go) ──────────────────────
let upd = { state: 'off' };

function renderUpdate() {
  const el = $('upd');
  if (!el) return;
  const s = upd.state || 'off';
  const time = upd.checkedAt
    ? new Date(upd.checkedAt * 1000).toLocaleString(getLang() === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
  const vars = { version: upd.latest || '', time, error: upd.error || '' };
  setText($('upd-val'), t('footer.update_' + s, vars));
  el.dataset.tip = t('footer.update_' + s + '_tip', vars);
  el.dataset.state = s;
  el.hidden = false;
}

function onUpdateClick() {
  if (upd.state === 'available') {
    openURL(upd.releaseUrl || 'https://github.com/MrHoustonOff/PhoneGyro/releases');
  } else if (upd.state === 'off') {
    go('settings');
  } else {
    call('CheckUpdateNow');
  }
}

export function startFooter() {
  on('update:status', (s) => { upd = s || { state: 'off' }; renderUpdate(); });
  call('GetUpdateStatus').then((s) => { if (s) upd = s; renderUpdate(); });
  onLang(renderUpdate);
  $('upd').addEventListener('click', onUpdateClick);
  on('resource-stats', renderStats);
  call('GetResourceStats').then(renderStats);
  $('repo').addEventListener('click', (e) => { e.preventDefault(); openURL('https://github.com/MrHoustonOff/PhoneGyro'); });
}
