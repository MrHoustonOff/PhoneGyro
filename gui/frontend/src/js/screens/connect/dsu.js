// The Cemuhook DSU card: server port, whether any emulator listens, and the
// clients by program name (click switches to the program, the cross disconnects,
// a disconnected one can be brought back). One element, moved into whichever
// view is showing, so it is rendered once.

import { setText, setHTML, esc } from '../../core/dom.js';
import { call, on } from '../../core/bridge.js';
import { t, onLang } from '../../core/i18n.js';
import { onState } from '../../core/state.js';
import { toast } from '../../ui/toast.js';

const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const RE = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

export const el = document.createElement('div');
el.className = 'pg-notice pg-notice--danger app-dsu';
el.innerHTML = `<div class="app-dsu__body"><div class="pg-notice__row"><span><b data-t="title"></b> <span class="pg-code" data-t="port"></span><span class="pg-notice__sub" data-t="sub"></span></span><span class="pg-badge pg-badge--warn" data-t="badge"></span></div><div class="app-dsu__list"></div></div>`;
const part = (k) => el.querySelector(`[data-t="${k}"]`);
const list = el.querySelector('.app-dsu__list');

const addr = (c) => c.address || `${c.ip}:${c.port}`;

// Tooltip: full address, what a click does, and for Cemu the gyro bias its filter holds.
function tip(c, kicked) {
  const lines = [addr(c)];
  if (kicked) lines.push(t('status.dsu_client_kicked'));
  if (c.process) lines.push(t('status.dsu_client_tip_switch', { name: c.process }));
  if (/^cemu$/i.test(c.process || '') && Array.isArray(c.cemuBias)) {
    lines.push(t('status.dsu_client_cemu_bias', { bias: c.cemuBias.map((v) => (v >= 0 ? '+' : '') + v.toFixed(3)).join(' / ') }));
    if (c.cemuGuard) lines.push(t('status.dsu_client_cemu_guard'));
  }
  return lines.join('\n');
}

function row(c, kicked) {
  const idle = !kicked && c.active === false;
  const state = kicked ? 'off' : idle ? 'idle' : 'active';
  const name = c.process || addr(c);
  const btn = kicked
    ? `<button class="pg-btn-icon" type="button" data-act="readmit" data-tip="${esc(t('status.dsu_client_readmit'))}">${RE}</button>`
    : `<button class="pg-btn-icon" type="button" data-act="kick" data-tip="${esc(t('status.dsu_client_remove'))}">${X}</button>`;
  return `<div class="app-client is-${state}${c.process ? ' is-app' : ''}" data-addr="${esc(addr(c))}" data-name="${esc(name)}" data-tip="${esc(tip(c, kicked))}">
    <span class="app-client__dot"></span><span class="app-client__name">${esc(name)}</span>
    <span class="pg-badge${kicked ? '' : idle ? ' pg-badge--warn' : ' pg-badge--ok'}">${esc(t('ui.dsu_' + (state === 'active' ? 'active' : state)))}</span>${btn}</div>`;
}

// What the card shows. The state carries it while a device streams; without one
// the state is quiet, so Go's dsu:status (every client connect and disconnect)
// keeps the card current too.
const dsu = { port: 26760, clients: [], kicked: [] };

function fromState(st) {
  dsu.port = st.dsuPort || dsu.port;
  dsu.clients = st.dsuClientList || [];
  dsu.kicked = st.dsuKickedList || [];
  render();
}

function fromStatus(d) {
  if (!d) return;
  dsu.clients = d.clients || [];
  dsu.kicked = d.kicked || [];
  render();
}

function render() {
  const { clients, kicked } = dsu;
  const n = clients.length;
  const ok = n > 0;
  const cls = 'pg-notice app-dsu pg-notice--' + (ok ? 'ok' : 'danger');
  if (el.className !== cls) el.className = cls;
  setText(part('title'), t('status.dsu_title'));
  setText(part('port'), ':' + dsu.port);
  setText(part('sub'), ok ? t(n === 1 ? 'status.dsu_connected' : 'status.dsu_connected_plural', { n }) : t('status.dsu_idle_notice'));
  const badge = part('badge');
  const bcls = 'pg-badge pg-badge--' + (ok ? 'ok' : 'danger');
  if (badge.className !== bcls) badge.className = bcls;
  setText(badge, ok ? t(n === 1 ? 'status.dsu_clients_count' : 'status.dsu_clients_count_plural', { n }) : t('status.dsu_waiting'));
  // setHTML skips the rebuild while the list looks the same (hover and clicks survive).
  setHTML(list, clients.map((c) => row(c, false)).join('') + kicked.map((c) => row(c, true)).join(''));
}

export function startDsu() {
  list.addEventListener('click', async (e) => {
    const r = e.target.closest('.app-client');
    if (!r) return;
    const act = e.target.closest('[data-act]');
    const name = r.dataset.name;
    if (act && act.dataset.act === 'kick') {
      if ((await call('DisconnectDSUClient', r.dataset.addr)) === 'ok') toast(t('status.dsu_client_removed', { name }));
    } else if (act && act.dataset.act === 'readmit') {
      if ((await call('ReconnectDSUClient', r.dataset.addr)) === 'ok') toast(t('status.dsu_client_readmitted', { name }));
    } else if (r.classList.contains('is-app')) {
      call('FocusDSUClient', r.dataset.addr);
    }
  });
  onState(fromState);
  on('dsu:status', fromStatus);
  call('GetDSUStatus').then(fromStatus);
  onLang(() => { list._html = null; render(); });
}
