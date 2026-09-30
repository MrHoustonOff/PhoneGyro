// Settings (design: ScreenSettings). The rows are data: each entry says which
// setting it edits and with which control, and one renderer builds them from the
// design system's classes (pg-group, pg-row, pg-input, pg-select, pg-slider,
// pg-toggle). Values round-trip as Go's whole AppSettings object, so fields this
// screen does not show are kept as they are.

import { $, setText, show, esc } from '../core/dom.js';
import { call } from '../core/bridge.js';
import { getState, onState } from '../core/state.js';
import { t, onLang } from '../core/i18n.js';
import { onScreen, go } from '../shell/router.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { enhanceSelects } from '../ui/select.js';
import { setZoom, onZoom } from '../ui/zoom.js';
import { ACCENTS, applyAccent } from '../ui/accent.js';
import { setDebugPanel } from '../debug/toggle.js';

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
      { type: 'mixer', label: 'settings_modal.sound_details_toggle', tip: 'settings_modal.sound_details_desc' },
      { key: 'checkUpdates', type: 'toggle', label: 'settings_modal.check_updates' },
      { type: 'datadir', label: 'settings_modal.data_dir' },
    ] },
    { title: 'settings_modal.group_appearance', rows: [
      { key: 'accent', type: 'swatches', label: 'ui.accent', tip: 'ui.accent_tip', options: ACCENTS, reset: (v) => applyAccent(v) },
      { key: 'fontScale', type: 'slider', min: 0.5, max: 3, step: 0.05, fmt: (v) => Math.round(v * 100) + ' %',
        label: 'settings_modal.font_scale', tip: 'settings_modal.font_scale_hotkeys', after: (v) => setZoom(v, { save: false, quiet: true }) },
      { key: 'noAutoZoom', type: 'toggle', label: 'settings_modal.auto_zoom', tip: 'settings_modal.auto_zoom_tip',
        after: (v) => { try { localStorage.setItem('pg-no-auto-zoom', v ? '1' : '0'); } catch (e) {} } },
    ] },
    { title: 'ui.group_performance', rows: [
      { key: 'debugPanel', type: 'toggle', label: 'ui.debug_panel', tip: 'ui.debug_panel_tip', after: setDebugPanel },
      { key: 'debugLog', type: 'toggle', label: 'ui.debug_log', tip: 'ui.debug_log_tip' },
      { key: 'splash', type: 'toggle', label: 'ui.splash', tip: 'ui.splash_tip', after: (v) => { try { localStorage.setItem('pg-splash', v ? '1' : '0'); } catch (e) { /* default next time */ } } },
    ] },
  ],
];

let cur = null;      // AppSettings as Go last returned them
let def = null;      // a first launch's settings: the "changed" marks and resets
let saveTimer = 0;
let mixOpen = false;  // the per-sound mixer is folded out

// Per-event volumes (settings.json soundVolumes, 0..3, 1 by default).
const SOUNDS = [
  ['connect', 'sound_phone_connect'], ['disconnect', 'sound_phone_disconnect'], ['loss', 'sound_link_loss'],
  ['dsu', 'sound_dsu_connect'], ['recenter', 'sound_recenter'],
];
const vol = (k) => { const v = cur.soundVolumes && cur.soundVolumes[k]; return v == null ? 1 : v; };
const CHEV = '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>';

function mixRows() {
  return SOUNDS.map(([k, label]) => {
    const v = vol(k);
    const mod = v !== 1;
    return `<div class="pg-row app-mix${mod ? ' is-modified' : ''}" data-mix="${k}"${mixOpen ? '' : ' hidden'}>${mod ? resetBtn() : ''}
      <div class="pg-row__label"><span class="app-mix__name">${esc(t('settings_modal.' + label))}</span><span class="pg-row__sub app-mix__desc">${esc(t('settings_modal.' + label + '_desc'))}</span></div>
      <div class="pg-row__control"><input class="pg-slider" type="range" min="0" max="3" step="1" value="${v}" style="--fill:${(v / 3) * 100}%"><span class="pg-value">${v}x</span></div></div>`;
  }).join('');
}

const INFO = (tip) => (t(tip) ? `<button class="pg-info" type="button" aria-label="Info" data-tip="${esc(t(tip))}">i</button>` : '');
const REGEN = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
const FOLDER = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

function control(r, i) {
  const id = `set-${i}`;
  const v = r.key ? cur[r.key] : null;
  switch (r.type) {
    case 'port': return `<input class="pg-input pg-input--num" id="${id}" type="number" min="1024" max="65535" value="${esc(v)}">`;
    case 'mac': return `<input class="pg-input pg-input--mono app-mac" id="${id}" value="${esc(v)}" readonly><button class="pg-btn-icon" type="button" data-regen data-tip="${esc(t('settings_modal.dsu_mac_regen'))}">${REGEN}</button>`;
    case 'select': return `<select class="pg-select" id="${id}">${r.options.map(([val, key]) =>
      `<option value="${val}"${String(r.num ? Number(v).toFixed(2) : r.bool ? v !== false : v) === val ? ' selected' : ''}>${esc(t(key))}</option>`).join('')}</select>`;
    case 'slider': {
      const fill = ((v - r.min) / (r.max - r.min)) * 100;
      return `<input class="pg-slider" id="${id}" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" style="--fill:${fill}%"><span class="pg-value" id="${id}-v">${esc(r.fmt(Number(v)))}</span>`;
    }
    case 'toggle': return (r.kbd && cur[r.kbd] ? `<span class="pg-kbd app-kbd">${esc(cur[r.kbd])}</span>` : '')
      + `<label class="pg-toggle"><input type="checkbox" id="${id}"${v ? ' checked' : ''} aria-label="${esc(t(r.label))}"><span class="pg-toggle__track"></span></label>`;
    case 'firewall': return `<span class="pg-badge pg-badge--dot" id="fw-state"></span><button class="pg-btn pg-btn--sm" type="button" id="fw-allow" hidden>${esc(t('firewall.allow'))}</button>`;
    // Design Accent picker: vendor/accent.js handles the click (wave + rings).
    case 'swatches': return `<div class="pg-swatches" role="radiogroup">${r.options.map((o) =>
      `<button type="button" class="pg-swatch" data-accent-pick="${o}" style="--sw:var(--sw-${o})" role="radio" aria-checked="${v === o}" aria-label="${esc(t('ui.accent_' + o))}" data-tip="${esc(t('ui.accent_' + o))}"></button>`).join('')}</div>`;
    case 'mixer': return `<button class="pg-btn pg-btn--sm app-mixbtn" type="button" data-mixer aria-expanded="${mixOpen}">${esc(t('settings_modal.sound_details_btn'))}${CHEV}</button>`;
    case 'datadir': return `<input class="pg-input pg-input--mono app-path" id="set-datadir" readonly><button class="pg-btn-icon" type="button" id="set-datadir-open" data-tip="${esc(t('settings_modal.data_dir_open'))}">${FOLDER}</button>`;
    default: return '';
  }
}

let gamesBtnEl = null; // kept by reference too: a re-render of the column would otherwise wipe it
let benchCardEl = null; // the response graph card; kept by reference because re-rendering the column wipes its children

function render() {
  if (!cur) return;
  if (!benchCardEl) benchCardEl = $('set-bench-card');
  if (!gamesBtnEl) gamesBtnEl = $('btn-open-games');
  if (gamesBtnEl && gamesBtnEl.parentNode) gamesBtnEl.remove();
  if (benchCardEl && benchCardEl.parentNode) benchCardEl.remove();
  let i = 0;
  COLUMNS.forEach((groups, c) => {
    const target = c === 0 ? $('set-col-1') : ($('set-col-2-groups') || $('set-col-2'));
    if (!target) return;
    target.innerHTML = groups.map((g) => `<div class="pg-group">
      <div class="pg-overline"><span class="pg-ring"></span>${esc(t(g.title))}</div>
      ${g.note ? `<div class="pg-notice"><span>${esc(t(g.note))}</span></div>` : ''}
      <div class="pg-group__list">${g.rows.map((r) => {
        r._i = i++;
        const mod = modified(r);
        return `<div class="pg-row${mod ? ' is-modified' : ''}" data-i="${r._i}">${mod ? resetBtn() : ''}<div class="pg-row__label">${esc(t(r.label))}${INFO(r.tip || r.label + '_tip')}</div><div class="pg-row__control">${control(r, r._i)}</div></div>`
          + (r.type === 'mixer' ? mixRows() : '');
      }).join('')}</div></div>`).join('')
      + (c === COLUMNS.length - 1 ? `<div class="app-set-foot"><button class="pg-btn" type="button" id="set-reset-all">${esc(t('settings_modal.btn_reset'))}</button></div>` : '');
  });
  // The response graph lives in the left column, right under the Motion group it tunes.
  const col1 = $('set-col-1');
  if (gamesBtnEl && col1) col1.appendChild(gamesBtnEl); // the mini-games entry sits right above the response card
  if (benchCardEl && col1) col1.appendChild(benchCardEl);
  enhanceSelects($('screen-settings'));
  refreshFirewall();
  call('GetDataDir').then((d) => { const el = $('set-datadir'); if (el && d) { el.value = d; el.dataset.tip = d; } });
}

const rows = () => COLUMNS.flat().flatMap((g) => g.rows);

// Changed from the default? The DSU MAC is random per install, never "changed".
function modified(r) {
  if (!r.key || !def || r.key === 'dsuMac' || !(r.key in def)) return false;
  const a = cur[r.key], b = def[r.key];
  return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-6 : a !== b;
}
const resetBtn = () => `<button class="app-reset" type="button" data-reset aria-label="reset" data-tip="${esc(t('ui.reset_one'))}"><svg viewBox="0 0 24 24"><path d="M4 11a8 8 0 1 1 2.3 5.7"/><path d="M4 4v7h7"/></svg></button>`;

// Re-marks one row after its value changed (no re-render: focus and drags survive).
function mark(rowEl, r) {
  const mod = modified(r);
  rowEl.classList.toggle('is-modified', mod);
  const btn = rowEl.querySelector(':scope > .app-reset');
  if (mod && !btn) rowEl.insertAdjacentHTML('afterbegin', resetBtn());
  if (!mod && btn) btn.remove();
}

function resetRow(rowEl) {
  if (rowEl.dataset.mix) {
    cur.soundVolumes = Object.assign({}, cur.soundVolumes, { [rowEl.dataset.mix]: 1 });
    render();
    save(true);
    return;
  }
  const r = rows()[+rowEl.dataset.i];
  if (!r || !r.key) return;
  cur[r.key] = def[r.key];
  if (r.after) r.after(cur[r.key]);
  if (r.reset) r.reset(cur[r.key]);
  render();
  save(true);
}

function resetAll() {
  openModal({
    title: t('ui.reset_all_title'),
    text: t('ui.reset_all_desc'),
    actions: [
      { label: t('settings_modal.btn_cancel') },
      { label: t('settings_modal.btn_reset'), kind: 'danger', onClick: () => {
        for (const r of rows()) {
          if (!r.key || r.key === 'dsuMac' || !(r.key in def)) continue;
          cur[r.key] = def[r.key];
          if (r.after) r.after(cur[r.key]);
          if (r.reset) r.reset(cur[r.key]);
        }
        cur.soundVolumes = Object.fromEntries(SOUNDS.map(([k]) => [k, 1]));
        render();
        save(true);
      } },
    ],
  });
}

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

function applyMotionFilterParams() {
  if (!cur) return;
  const db = Number(cur.gyroDeadband ?? 0.10);
  const dbUsb = Number(cur.gyroDeadbandUsb ?? 0.50);
  const sens = Number(cur.gyroSensitivity ?? 1.0);
  call('SetTuningFilterParams', db, dbUsb, sens);
  benchController?.setParams({ deadband: db, deadbandUsb: dbUsb, sensitivity: sens });
}

function onInput(e) {
  const rowEl = e.target.closest('.pg-row');
  if (!rowEl) return;
  if (rowEl.dataset.mix) {
    const v = Number(e.target.value);
    e.target.style.setProperty('--fill', (v / 3) * 100 + '%');
    setText(rowEl.querySelector('.pg-value'), v + 'x');
    if (e.type !== 'change') return;
    cur.soundVolumes = Object.assign({}, cur.soundVolumes, { [rowEl.dataset.mix]: v });
    rowEl.classList.toggle('is-modified', v !== 1);
    const b = rowEl.querySelector(':scope > .app-reset');
    if (v !== 1 && !b) rowEl.insertAdjacentHTML('afterbegin', resetBtn());
    if (v === 1 && b) b.remove();
    save();
    return;
  }
  const r = rows()[+rowEl.dataset.i];
  if (!r || !r.key) return;
  const el = e.target;
  if (r.type === 'slider') {
    const v = Number(el.value);
    el.style.setProperty('--fill', ((v - r.min) / (r.max - r.min)) * 100 + '%');
    setText($(el.id + '-v'), r.fmt(v));
    cur[r.key] = v;
    if (r.key === 'gyroSensitivity') {
      applyMotionFilterParams();
    }
    if (e.type === 'change') { if (r.after) r.after(v); mark(rowEl, r); save(); }
    return;
  }
  if (e.type !== 'change') return;
  if (r.type === 'toggle') cur[r.key] = el.checked;
  else if (r.type === 'select') {
    cur[r.key] = r.num ? Number(el.value) : r.bool ? el.value === 'true' : el.value;
    if (r.key === 'gyroDeadband' || r.key === 'gyroDeadbandUsb') {
      applyMotionFilterParams();
    }
  }
  else if (r.type === 'port') {
    const v = Number(el.value);
    const others = ['dsuPort', 'httpPort', 'httpsPort'].filter((k) => k !== r.key).map((k) => cur[k]);
    if (!(v >= 1024 && v <= 65535)) { toast(t('settings_modal.err_port_range')); el.value = cur[r.key]; return; }
    if (others.includes(v)) { toast(t('settings_modal.err_ports_duplicate')); el.value = cur[r.key]; return; }
    cur[r.key] = v;
  }
  if (r.after) r.after(cur[r.key]);
  mark(rowEl, r);
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
  badge.dataset.tip = st.network ? t('firewall.network_' + st.network) : '';
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
  [cur, def] = await Promise.all([call('GetAppSettings'), call('GetDefaultAppSettings')]);
  render();
  applyMotionFilterParams();
}

export function startSettings() {
  const screen = $('screen-settings');
  screen.addEventListener('input', onInput);
  screen.addEventListener('change', onInput);
  screen.addEventListener('click', (e) => {
    // The colour itself changes in vendor/accent.js (its own click listener);
    // here it is only stored in Go.
    const sw = e.target.closest('[data-accent-pick]');
    if (sw) {
      const rowEl = sw.closest('.pg-row');
      const r = rows()[+rowEl.dataset.i];
      cur[r.key] = sw.dataset.accentPick;
      mark(rowEl, r);
      save();
      return;
    }
    if (e.target.closest('[data-reset]')) resetRow(e.target.closest('.pg-row'));
    else if (e.target.closest('[data-mixer]')) {
      mixOpen = !mixOpen;
      e.target.closest('[data-mixer]').setAttribute('aria-expanded', String(mixOpen));
      screen.querySelectorAll('.app-mix').forEach((r) => { r.hidden = !mixOpen; });
    }
    else if (e.target.closest('#set-reset-all')) resetAll();
    else if (e.target.closest('[data-regen]')) regenMac();
    else if (e.target.closest('#fw-allow')) allowFirewall(e.target.closest('#fw-allow'));
    else if (e.target.closest('#set-datadir-open')) call('OpenDataDir');
    else if (e.target.closest('#btn-open-games')) go('games');
  });
  document.addEventListener('click', (e) => {
    // the whole top strip of the card folds/unfolds it (not only the arrow); the axis switch keeps its own clicks
    if (!e.target.closest('.app-bench-card__head') || e.target.closest('.pg-seg')) return;
    try { localStorage.setItem('pg-bench-open', benchOpen() ? '0' : '1'); } catch (_) { /* session only */ }
    applyBenchFold();
    syncBenchActive();
  });
  onScreen((s) => {
    if (s === 'settings') load();
    syncBenchActive();
  });
  document.addEventListener('visibilitychange', () => {
    syncBenchActive();
  });
  onState(() => {
    syncBenchActive();
  });
  // Changed elsewhere (the debug panel's cross): show it if this screen is open.
  addEventListener('pg:settings-changed', () => { if (!screen.hidden) load(); });
  // Ctrl +/− while Settings is open: keep the slider's value in step.
  onZoom((v) => { if (cur && !screen.hidden && Math.abs((cur.fontScale || 1) - v) > 1e-6) { cur.fontScale = v; render(); } });
  onLang(() => { if (!screen.hidden) render(); });
}

// The filter-response card is folded by default; opening it is remembered.
const benchOpen = () => { try { return localStorage.getItem('pg-bench-open') === '1'; } catch (_) { return false; } };
function applyBenchFold() {
  const card = $('set-bench-card'), btn = $('bench-fold');
  if (!card || !btn) return;
  const open = benchOpen();
  card.classList.toggle('is-collapsed', !open);
  btn.setAttribute('aria-expanded', String(open));
}

let benchLoaded = false;
let benchController = null;

async function ensureBenchLoaded() {
  if (benchLoaded) return;
  benchLoaded = true;
  try {
    const { initBench } = await import('./settings/bench.js');
    benchController = initBench($('set-bench-card'), {
      getInitialParams: () => ({
        deadband: cur?.gyroDeadband,
        sensitivity: cur?.gyroSensitivity,
        deadbandUsb: cur?.gyroDeadbandUsb,
      }),
    });
  } catch (err) {
    console.error('Failed to load settings bench:', err);
    benchLoaded = false;
  }
}

export async function syncBenchActive() {
  const isSettingsScreen = !$('screen-settings')?.hidden;
  const isDocVisible = !document.hidden;
  const state = getState();
  const isConnected = state?.status === 'online';

  applyBenchFold();
  if (isSettingsScreen && benchOpen()) {
    await ensureBenchLoaded();
    if (benchController) {
      benchController.setConnected(isConnected);
      if (cur) {
        benchController.setParams({
          deadband: cur.gyroDeadband,
          sensitivity: cur.gyroSensitivity,
          deadbandUsb: cur.gyroDeadbandUsb,
        });
      }
      // Rule 0: live streaming and rAF run ONLY when settings screen is active AND window is visible AND device is connected
      if (isDocVisible && isConnected) {
        benchController.activate();
      } else {
        benchController.deactivate();
      }
    }
  } else {
    benchController?.deactivate();
  }
}


