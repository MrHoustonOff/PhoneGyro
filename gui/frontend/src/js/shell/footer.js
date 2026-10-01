// Footer islands: the app's CPU load with a mini graph, RAM with a meter
// (Go "resource-stats", every ~1.5 s), the update check's state, the version and
// the repository link.

import { $, setText, setVar } from '../core/dom.js';
import { call, on, openURL } from '../core/bridge.js';
import { t, getLang, onLang } from '../core/i18n.js';

const N = 12;            // samples in the mini graph
const cpu = [];

function renderStats(s) {
  if (!s) return;
  const pct = Math.max(0, s.cpuPercent || 0);
  cpu.push(pct);
  if (cpu.length > N) cpu.shift();
  setText($('cpu-val'), (pct < 10 ? pct.toFixed(1) : Math.round(pct)) + '%');
  // Right-aligned, scaled to the recent peak (at least 5 %) so small loads still show a shape.
  const top = Math.max(5, ...cpu), step = 44 / (N - 1), off = 44 - (cpu.length - 1) * step;
  const pts = cpu.map((v, i) => `${(off + i * step).toFixed(1)},${(15 - (v / top) * 13).toFixed(1)}`);
  $('cpu-line').setAttribute('points', pts.join(' '));
  $('cpu-area').setAttribute('d', `M${off.toFixed(1)},16 L${pts.join(' L')} L44,16 Z`);
  setText($('ram-val'), Math.round(s.ramMb || 0) + ' MB');
  // The meter fills at 10 % of the machine's RAM: PhoneGyro normally sits well below 1 %.
  setVar($('ram-bar'), '--p', Math.min(100, Math.max(3, (s.ramPercent || 0) * 10)).toFixed(0) + '%');
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
  if (upd.state === 'available') openURL(upd.releaseUrl || 'https://github.com/MrHoustonOff/PhoneGyro/releases');
  else if (upd.state === 'error') call('CheckUpdateNow');
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
