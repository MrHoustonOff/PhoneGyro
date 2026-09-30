// Settings (design: ScreenSettings). The rows are data: each entry says which
// setting it edits and with which control, and one renderer builds them from the
// design system's classes (pg-group, pg-row, pg-input, pg-select, pg-slider,
// pg-toggle). Values round-trip as Go's whole AppSettings object, so fields this
// screen does not show are kept as they are.

import { $, setText, show, esc } from '../core/dom.js';
import { call } from '../core/bridge.js';
import { t, onLang } from '../core/i18n.js';
import { onScreen } from '../shell/router.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

const DEADBAND = ['0.00', '0.05', '0.10', '0.20', '0.35', '0.50', '0.75', '1.00'];
const dbKey = (v) => 'settings_modal.deadband_' + (v === '0.00' ? 'off' : v.replace('.', '')); // 0.05 → deadband_005
const deadbandOptions = (vals) => vals.map((v) => [v, dbKey(v)]);

// label/tip are i18n keys (tip defaults to label + "_tip").
const COLUMNS = [
  [
    { title: 'settings_modal.group_network', rows: [
      { type: 'firewall', label: 'firewall.label', tip: 'firewall.tip' },
      { key: 'dsuPort', type: 'port', label: 'settings_modal.dsu_port' },
      { key: 'dsuMac', type: 'mac', label: 'settings_modal.dsu_mac' },
      { key: 'httpPort', type: 'port', label: 'settings_modal.http_port' },
      { key: 'httpsPort', type: 'port', label: 'settings_modal.https_port' },
    ] },
    { title: 'settings_modal.group_motion', note: 'settings_modal.filter_live_hint', rows: [
      { key: 'gyroDeadband', type: 'select', num: true, label: 'settings_modal.gyro_deadband', options: deadbandOptions(DEADBAND) },
      { key: 'gyroDeadbandUsb', type: 'select', num: true, label: 'settings_modal.gyro_deadband_usb', options: deadbandOptions(DEADBAND.filter((v) => v !== '0.05')) },
      { key: 'gyroSensitivity', type: 'slider', min: 0.25, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + 'x', label: 'settings_modal.gyro_sensitivity' },
      { key: 'cemuDriftGuard', type: 'toggle', label: 'settings_modal.cemu_drift_guard' },
    ] },
  ],
  [
    { title: 'settings_modal.group_behavior', rows: [
      { key: 'stillnessHint', type: 'toggle', label: 'settings_modal.stillness_hint' },
      { key: 'disconnectAlert', type: 'toggle', label: 'settings_modal.disconnect_alert' },
      { key: 'silenceDisconnect', type: 'toggle', label: 'settings_modal.silence_disconnect' },
      { key: 'closeAction', type: 'select', label: 'settings_modal.close_action',
        options: [['ask', 'settings_modal.close_action_ask'], ['minimize', 'settings_modal.close_action_minimize'], ['quit', 'settings_modal.close_action_quit']] },
      { key: 'soundMode', type: 'select', label: 'settings_modal.sound_mode',
        options: [['cute', 'settings_modal.sound_cute'], ['windows', 'settings_modal.sound_windows'], ['off', 'settings_modal.sound_off']] },
      { key: 'soundVolume', type: 'slider', min: 0, max: 3, step: 1, fmt: (v) => v + 'x', label: 'settings_modal.sound_volume' },
      { key: 'splash', type: 'toggle', label: 'ui.splash', tip: 'ui.splash_tip', after: (v) => { try { localStorage.setItem('pg-splash', v ? '1' : '0'); } catch (e) { /* default next time */ } } },
      { key: 'checkUpdates', type: 'toggle', label: 'settings_modal.check_updates' },
      { type: 'datadir', label: 'settings_modal.data_dir' },
    ] },
    { title: 'settings_modal.group_hotkeys', rows: [
      { key: 'hotkeyRecenterEnabled', type: 'toggle', label: 'settings_modal.hotkey_recenter', kbd: 'hotkeyRecenterKey' },
    ] },
  ],
];

let cur = null;      // AppSettings as Go last returned them
let saveTimer = 0;

const INFO = (tip) => (t(tip) ? `<button class="pg-info" type="button" aria-label="Info" title="${esc(t(tip))}">i</button>` : '');
const REGEN = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
const FOLDER = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

function control(r, i) {
  const id = `set-${i}`;
  const v = r.key ? cur[r.key] : null;
  switch (r.type) {
    case 'port': return `<input class="pg-input pg-input--num" id="${id}" type="number" min="1024" max="65535" value="${esc(v)}">`;
    case 'mac': return `<input class="pg-input pg-input--mono app-mac" id="${id}" value="${esc(v)}" readonly><button class="pg-btn-icon" type="button" data-regen title="${esc(t('settings_modal.dsu_mac_regen'))}">${REGEN}</button>`;
    case 'select': return `<select class="pg-select" id="${id}">${r.options.map(([val, key]) =>
      `<option value="${val}"${String(r.num ? Number(v).toFixed(2) : v) === val ? ' selected' : ''}>${esc(t(key))}</option>`).join('')}</select>`;
    case 'slider': {
      const fill = ((v - r.min) / (r.max - r.min)) * 100;
      return `<input class="pg-slider" id="${id}" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" style="--fill:${fill}%"><span class="pg-value" id="${id}-v">${esc(r.fmt(Number(v)))}</span>`;
    }
    case 'toggle': return (r.kbd && cur[r.kbd] ? `<span class="pg-kbd app-kbd">${esc(cur[r.kbd])}</span>` : '')
      + `<label class="pg-toggle"><input type="checkbox" id="${id}"${v ? ' checked' : ''} aria-label="${esc(t(r.label))}"><span class="pg-toggle__track"></span></label>`;
    case 'firewall': return `<span class="pg-badge pg-badge--dot" id="fw-state"></span><button class="pg-btn pg-btn--sm" type="button" id="fw-allow" hidden>${esc(t('firewall.allow'))}</button>`;
    case 'datadir': return `<input class="pg-input pg-input--mono app-path" id="set-datadir" readonly><button class="pg-btn-icon" type="button" id="set-datadir-open" title="${esc(t('settings_modal.data_dir_open'))}">${FOLDER}</button>`;
    default: return '';
  }
}

function render() {
  if (!cur) return;
  let i = 0;
  COLUMNS.forEach((groups, c) => {
    $('set-col-' + (c + 1)).innerHTML = groups.map((g) => `<div class="pg-group">
      <div class="pg-overline"><span class="pg-ring"></span>${esc(t(g.title))}</div>
      ${g.note ? `<div class="pg-notice"><span>${esc(t(g.note))}</span></div>` : ''}
      <div class="pg-group__list">${g.rows.map((r) => {
        r._i = i++;
        return `<div class="pg-row" data-i="${r._i}"><div class="pg-row__label">${esc(t(r.label))}${INFO(r.tip || r.label + '_tip')}</div><div class="pg-row__control">${control(r, r._i)}</div></div>`;
      }).join('')}</div></div>`).join('');
  });
  refreshFirewall();
  call('GetDataDir').then((d) => { const el = $('set-datadir'); if (el && d) { el.value = d; el.title = d; } });
}

const rows = () => COLUMNS.flat().flatMap((g) => g.rows);

function save(now = false) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await call('SaveAppSettings', cur);
    } catch (e) {
      toast(String(e && e.message || e));
      load();
    }
  }, now ? 0 : 350);
}

function onInput(e) {
  const rowEl = e.target.closest('.pg-row');
  if (!rowEl) return;
  const r = rows()[+rowEl.dataset.i];
  if (!r || !r.key) return;
  const el = e.target;
  if (r.type === 'slider') {
    const v = Number(el.value);
    el.style.setProperty('--fill', ((v - r.min) / (r.max - r.min)) * 100 + '%');
    setText($(el.id + '-v'), r.fmt(v));
    cur[r.key] = v;
    if (e.type === 'change') save();
    return;
  }
  if (e.type !== 'change') return;
  if (r.type === 'toggle') cur[r.key] = el.checked;
  else if (r.type === 'select') cur[r.key] = r.num ? Number(el.value) : el.value;
  else if (r.type === 'port') {
    const v = Number(el.value);
    const others = ['dsuPort', 'httpPort', 'httpsPort'].filter((k) => k !== r.key).map((k) => cur[k]);
    if (!(v >= 1024 && v <= 65535)) { toast(t('settings_modal.err_port_range')); el.value = cur[r.key]; return; }
    if (others.includes(v)) { toast(t('settings_modal.err_ports_duplicate')); el.value = cur[r.key]; return; }
    cur[r.key] = v;
  }
  if (r.after) r.after(cur[r.key]);
  save(r.type === 'port');
}

async function refreshFirewall() {
  const badge = $('fw-state');
  if (!badge) return;
  const st = await call('GetFirewallStatus');
  if (!st) return;
  const good = st.state === 'allowed' || st.state === 'off';
  const bad = st.state === 'blocked' || st.state === 'pending';
  badge.className = 'pg-badge pg-badge--dot ' + (good ? 'pg-badge--ok' : bad ? 'pg-badge--danger' : '');
  setText(badge, t('firewall.state_' + st.state) || st.state);
  badge.title = st.network ? t('firewall.network_' + st.network) : '';
  show($('fw-allow'), bad || st.state === 'unknown');
}

async function allowFirewall(btn) {
  btn.disabled = true;
  setText(btn, t('firewall.waiting'));
  const res = await call('AllowFirewall');
  btn.disabled = false;
  setText(btn, t('firewall.allow'));
  const ok = res && res.status && (res.status.state === 'allowed' || res.status.state === 'off');
  toast(t(ok ? 'firewall.toast_ok' : res && res.result === 'cancelled' ? 'firewall.toast_cancelled' : 'firewall.toast_failed'));
  refreshFirewall();
}

async function regenMac() {
  await openModal({
    title: t('settings_modal.dsu_mac_regen_title'),
    text: t('settings_modal.dsu_mac_regen_confirm'),
    actions: [
      { label: t('settings_modal.btn_cancel') },
      { label: t('settings_modal.dsu_mac_regen'), kind: 'primary', onClick: async () => {
        const mac = await call('RegenerateDSUMAC');
        if (mac) { cur.dsuMac = mac; render(); toast(t('settings_modal.dsu_mac_regen_success')); }
      } },
    ],
  });
}

async function load() {
  cur = await call('GetAppSettings');
  render();
}

export function startSettings() {
  const screen = $('screen-settings');
  screen.addEventListener('input', onInput);
  screen.addEventListener('change', onInput);
  screen.addEventListener('click', (e) => {
    if (e.target.closest('[data-regen]')) regenMac();
    else if (e.target.closest('#fw-allow')) allowFirewall(e.target.closest('#fw-allow'));
    else if (e.target.closest('#set-datadir-open')) call('OpenDataDir');
  });
  onScreen((s) => { if (s === 'settings') load(); });
  onLang(() => { if (!screen.hidden) render(); });
}
