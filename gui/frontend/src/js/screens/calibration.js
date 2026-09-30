// Calibration wizard (design: Modal with the stepper). The Go side does the
// maths (gui/internal/app/calibration.go); this walks the user through it:
//   rest (1.6 s) → pitch (2.4 s) → roll (2.4 s) → axes (listen ≤ 20 s)
//        → verify (the new matrix is previewed live) → name → save.
// Steps 1–4 feature a 2-column layout with texts and live rates on the left
// and the 3D GyroScene stage on the right.

import { $, esc, md, setText, setHTML } from '../core/dom.js';
import { call, on, off } from '../core/bridge.js';
import { t, onLang } from '../core/i18n.js';
import { getState, onState } from '../core/state.js';
import { toast } from '../ui/toast.js';
import { createGyroScene } from '../ui/scene.js';
import { profileIconSvg, ICON_KEYS } from '../ui/profile-icons.js';
import { go, onScreen } from '../shell/router.js';
import { openModal } from '../ui/modal.js';

const STEPS = [
  { key: 'rest', pill: 'step_pill_rest', ms: 1600, rest: true },
  { key: 'pitch', pill: 'step_pill_pitch', ms: 2400 },
  { key: 'roll', pill: 'step_pill_roll', ms: 2400 },
  { key: 'axes', pill: 'step_pill_align', axes: true },
];
const AXES_TIMEOUT_MS = 20000;

const S = {
  open: false,
  slot: 0,
  step: 0,
  phase: 'ready', // ready | run | done | fail | verify | save
  vectors: [],
  matrix: null,
  result: null,
  doneText: '',
  failText: '',
  timer: 0,
  poll: 0,
  busy: false,
  scene: null,
  sceneLoading: false,
  isDisconnectAlertActive: false,
  wasInterruptedByDisconnect: false,
  selectedIcon: 'default',
  slotDropdownOpen: false,
  hasRecorded: false,
  steps: [null, null, null, null],
  accelMap: [], // accelerometer axis for Pitch/Yaw/Roll, e.g. ['+Y', '+Z', '+X'] (from the axes step)
  axes: [null, null, null], // locked sensor axes: { role: 'pitch'|'roll'|'yaw', name: '+X', confidence }
};

// Per-axis tile cache: the DOM is only written when a tile's signature changes.
let axisCache = [null, null, null];
const RATE_FULL = 120; // deg/s that fills an axis bar
const AXIS_TILES = [{ i: 0, k: 'x', l: 'X' }, { i: 1, k: 'y', l: 'Y' }, { i: 2, k: 'z', l: 'Z' }];
const ringHost = (html) => `<span class="app-ringhost">${html}</span>`;

let quatListenerActive = false;
let lastAhrsTs = 0;
const liveQuat = [0, 0, 0, 1];

function handleAhrsQuat(q) {
  if (!S.open || S.phase !== 'verify') return;
  if (!q) return;
  lastAhrsTs = performance.now();
  // Loops.go emits q0=w, q1=x, q2=y, q3=z.
  // In Three.js / GyroScene (x, y, z, w) = (q1, q2, q3, q0).
  liveQuat[0] = q.q1;
  liveQuat[1] = q.q2;
  liveQuat[2] = q.q3;
  liveQuat[3] = q.q0;
  if (S.scene) {
    S.scene.setQuaternion(liveQuat);
  }
}

function startQuatListener() {
  if (quatListenerActive) return;
  quatListenerActive = true;
  on('ahrs:quat', handleAhrsQuat);
}

function stopQuatListener() {
  if (!quatListenerActive) return;
  quatListenerActive = false;
  off('ahrs:quat', handleAhrsQuat);
}

function recenter() {
  call('ResetAHRS');
  liveQuat[0] = 0;
  liveQuat[1] = 0;
  liveQuat[2] = 0;
  liveQuat[3] = 1;
  if (S.scene) S.scene.setQuaternion(null);
}

function det3(m) {
  if (!m) return 0;
  if (Array.isArray(m[0])) {
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
         - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
         + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  }
  if (m.length >= 9) {
    return m[0] * (m[4] * m[8] - m[5] * m[7])
         - m[1] * (m[3] * m[8] - m[5] * m[6])
         + m[2] * (m[3] * m[7] - m[4] * m[6]);
  }
  return 0;
}

let disconnectAlertEnabled = true;

async function syncDisconnectSetting() {
  try {
    const s = await call('GetAppSettings');
    if (s && typeof s.disconnectAlert === 'boolean') {
      disconnectAlertEnabled = s.disconnectAlert;
    }
  } catch (_) {}
}

export function showDisconnectAlert() {
  if (!S.open || S.isDisconnectAlertActive || !disconnectAlertEnabled) return;
  S.isDisconnectAlertActive = true;

  const modalEl = el().querySelector('.app-cal-modal');
  if (modalEl) {
    modalEl.classList.add('is-disconnected');
    modalEl.scrollTop = 0;
    const head = modalEl.querySelector('.pg-modal__head');
    const bdy = modalEl.querySelector('.pg-modal__body');
    const ft = modalEl.querySelector('.pg-modal__foot');
    if (head) head.inert = true;
    if (bdy) bdy.inert = true;
    if (ft) ft.inert = true;
  }

  // If capture was running, abort countdown/recording safely
  if (S.phase === 'run') {
    S.wasInterruptedByDisconnect = true;
    if (S.timer) { clearInterval(S.timer); S.timer = 0; }
    stopPoll();
    call('StopCapture', S.step).catch(() => {});
    if (S.scene) S.scene.setRecording(0);
    S.phase = 'ready';
    render();
  }

  const alertOverlay = $('cal-disconnect-overlay');
  if (alertOverlay) {
    alertOverlay.hidden = false;
  }

  // TODO: playSound('disconnect')
}

export function hideDisconnectAlert(opts = {}) {
  if (!S.isDisconnectAlertActive) return;
  S.isDisconnectAlertActive = false;

  const modalEl = el().querySelector('.app-cal-modal');
  if (modalEl) {
    modalEl.classList.remove('is-disconnected');
    const head = modalEl.querySelector('.pg-modal__head');
    const bdy = modalEl.querySelector('.pg-modal__body');
    const ft = modalEl.querySelector('.pg-modal__foot');
    if (head) head.inert = false;
    if (bdy) bdy.inert = false;
    if (ft) ft.inert = false;
  }

  const alertOverlay = $('cal-disconnect-overlay');
  if (alertOverlay) {
    alertOverlay.hidden = true;
  }

  if (!opts.silent) {
    // TODO: playSound('connect')
  }

  if (S.wasInterruptedByDisconnect) {
    S.wasInterruptedByDisconnect = false;
    if (!opts.silent) {
      toast(c('disconnect_reconnected_toast'));
    }
    render();
  }
}

export const isDisconnectAlertActive = () => S.isDisconnectAlertActive;

const c = (k, vars) => t('calibration.' + k, vars);
const el = () => $('screen-calibration');
const body = () => $('cal-body');
const foot = () => $('cal-foot');

function device() {
  const st = getState() || {};
  if (st.deviceName && st.deviceName !== 'Controller' && st.deviceName !== 'Unknown') return st.deviceName;
  return st.inputMode === 'usb' ? (st.deviceName || '') : (st.deviceName || 'iPhone');
}

// A pill is green when its step is completed; the ribbon keeps that while you jump around.
// Redoing a step clears every later one (see invalidateAfter).
function pillDone(i) {
  if (i < STEPS.length) return !!(S.steps[i] && S.steps[i].done);
  return STEPS.every((_, k) => S.steps[k] && S.steps[k].done) && !!S.matrix;
}

function stepper() {
  const pills = [...STEPS.map((s) => s.pill), 'step_pill_confirm'];
  const at = S.phase === 'verify' || S.phase === 'save' ? 4 : S.step;
  return '<div class="pg-stepper app-cal-stepper pg-scroll--x">' + pills.map((p, i) => {
    const done = pillDone(i);
    const canGo = done && i !== at && S.phase !== 'run';
    const go = canGo ? ` data-act="goto" data-step="${i}" role="button" tabindex="0"` : '';
    return (i ? `<span class="pg-step__link${pillDone(i - 1) ? ' is-done' : ''}"></span>` : '')
      + `<span class="pg-step${i === at ? ' is-active' : done ? ' is-done' : ''}"${go}><span class="pg-step__num">${i + 1}</span>${esc(c(p))}</span>`;
  }).join('') + '</div>';
}

// Redoing step k makes everything after it stale: those steps must be walked again.
function invalidateAfter(k) {
  for (let i = k + 1; i < STEPS.length; i++) {
    S.steps[i] = null;
    S.vectors[i] = undefined;
    clearAxisRole(i);
    if (i === 3) S.accelMap = [];
  }
  if (k <= 2) { S.matrix = null; S.result = null; }
}

const btn = (id, label, kind = '', dis = false) => `<button type="button" class="pg-btn${kind ? ' pg-btn--' + kind : ''}" data-act="${id}"${dis ? ' disabled' : ''}>${esc(label)}</button>`;

async function ensureScene(stepKey) {
  const stageEl = $('cal-stage');
  if (!stageEl) return;
  if (!S.scene && !S.sceneLoading) {
    S.sceneLoading = true;
    try {
      const sc = await createGyroScene(stageEl, { step: stepKey });
      if (!S.open || S.phase === 'save') {
        sc.dispose();
        return;
      }
      S.scene = sc;
      const currentStepKey = S.phase === 'verify' ? 'live' : (STEPS[S.step] ? STEPS[S.step].key : stepKey);
      S.scene.setStep(currentStepKey);
    } catch (err) {
      console.error('Failed to create GyroScene:', err);
    } finally {
      S.sceneLoading = false;
    }
  } else if (S.scene) {
    S.scene.setStep(stepKey);
  }
}

function disposeScene() {
  if (S.scene) {
    try { S.scene.dispose(); } catch (_) {}
    S.scene = null;
  }
  S.sceneLoading = false;
}

function toggleSlotDropdown(open) {
  S.slotDropdownOpen = open !== undefined ? open : !S.slotDropdownOpen;
  const m = $('cal-save-slot-menu');
  const t = $('cal-save-slot-trigger');
  if (m) m.hidden = !S.slotDropdownOpen;
  if (t) t.setAttribute('aria-expanded', String(S.slotDropdownOpen));
}

function selectSaveSlot(slotIdx) {
  S.slot = slotIdx;
  const st = getState() || {};
  const profiles = st.profiles || [];
  const p = profiles[slotIdx];
  // Requirement 3: Auto-select icon on slot change
  S.selectedIcon = (p && p.icon) ? p.icon : 'default';
  toggleSlotDropdown(false);
  render();
}

function selectSaveIcon(iconKey) {
  S.selectedIcon = iconKey;
  // Update icon card elements
  const cards = el().querySelectorAll('.app-cal-icon-card');
  cards.forEach((card) => {
    const isSel = card.dataset.icon === iconKey;
    card.classList.toggle('is-selected', isSel);
    card.setAttribute('aria-checked', String(isSel));
  });
  // Update trigger button and preview card icon
  const trigIcon = $('cal-save-trigger-icon');
  if (trigIcon) trigIcon.innerHTML = profileIconSvg(iconKey);
  const prevIcon = $('cal-preview-icon');
  if (prevIcon) prevIcon.innerHTML = profileIconSvg(iconKey);
}

function axisTilesHTML() {
  axisCache = [null, null, null];
  return `<div class="app-cal-stats" id="cal-stats">${AXIS_TILES.map((a) => `
    <div class="app-cal-axis" id="cal-ax-${a.i}">
      <div class="app-cal-axis__head"><span class="pg-axis__key pg-axis__key--${a.k}">${a.l}</span><span class="app-cal-axis__tag" id="cal-axtag-${a.i}"></span></div>
      <div class="mono app-cal-stat-val" id="cal-axval-${a.i}">+0°/s</div>
      <div class="app-cal-axbar"><i id="cal-axfill-${a.i}"></i></div>
    </div>`).join('')}</div>`;
}

// Live rate + fill per axis; a confirmed axis (found by a gesture) turns green and shows its role.
function updateAxisTiles(st) {
  if (!S.open || S.phase === 'verify' || S.phase === 'save' || !$('cal-ax-0')) return;
  const vals = [st.rawRotX || 0, st.rawRotY || 0, st.rawRotZ || 0];
  for (let i = 0; i < 3; i++) {
    const lk = S.axes[i];
    const pct = lk ? Math.round((lk.confidence || 0.95) * 100) : 0;
    const sig = lk ? `L|${lk.role}|${lk.name}|${pct}` : `F|${Math.round(vals[i])}`;
    if (axisCache[i] === sig) continue;
    axisCache[i] = sig;
    const tile = $('cal-ax-' + i);
    tile.classList.toggle('is-locked', !!lk);
    if (lk) {
      setText($('cal-axtag-' + i), `${c('axis_' + lk.role) || lk.role} ${lk.name}`);
      setText($('cal-axval-' + i), `${pct}%`);
      $('cal-axfill-' + i).style.setProperty('--p', '1');
    } else {
      const v = Math.round(vals[i]);
      setText($('cal-axtag-' + i), '');
      setText($('cal-axval-' + i), `${v >= 0 ? '+' : ''}${v}°/s`);
      $('cal-axfill-' + i).style.setProperty('--p', Math.min(1, Math.abs(vals[i]) / RATE_FULL).toFixed(2));
    }
  }
}

// A redone gesture step frees its axis (and the derived yaw axis).
function clearAxisRole(step) {
  const roles = step === 1 ? ['pitch', 'yaw'] : step === 2 ? ['roll', 'yaw'] : [];
  for (let i = 0; i < 3; i++) if (S.axes[i] && roles.includes(S.axes[i].role)) S.axes[i] = null;
}

function updateSegs(pairs, min) {
  const box = $('cal-segs');
  if (!box) return;
  if (box.childElementCount !== min) box.innerHTML = '<i></i>'.repeat(min);
  for (let i = 0; i < min; i++) {
    const on = i < pairs;
    if (box.children[i].classList.contains('is-on') !== on) box.children[i].classList.toggle('is-on', on);
  }
}

const GAME_AXES = [['x', 'P'], ['y', 'Y'], ['z', 'R']]; // Pitch, Yaw, Roll rows (colour key + letter)

// One signed sensor axis per game axis: from the 3x3 gyro matrix ...
function matrixRows(m) {
  return (m || []).slice(0, 3).map((row) => {
    let col = -1; let sign = 1;
    (row || []).forEach((v, k) => { if (col < 0 && Math.abs(v) > 0.5) { col = k; sign = v > 0 ? 1 : -1; } });
    return { col, sign };
  });
}
// ... and from the accelerometer's ['+Y', '+Z', '+X'].
function accelRows(map) {
  return (map || []).slice(0, 3).map((e) => {
    const mt = String(e || '').match(/([+-])?\s*([XYZ])/i);
    return mt ? { col: 'XYZ'.indexOf(mt[2].toUpperCase()), sign: mt[1] === '-' ? -1 : 1 } : { col: -1, sign: 1 };
  });
}
// Rows = game axes (P Y R), columns = the sensor's X Y Z; a lit cell is the axis (and sign) that feeds it.
function axisGridHTML(rows) {
  const head = 'XYZ'.split('').map((l, k) => `<span class="pg-axis__key pg-axis__key--${'xyz'[k]}">${l}</span>`).join('');
  const body = rows.map((r, i) => `<span class="pg-axis__key pg-axis__key--${GAME_AXES[i][0]}">${GAME_AXES[i][1]}</span>`
    + [0, 1, 2].map((k) => (r.col === k ? `<span class="app-cal-mcell is-on">${r.sign > 0 ? '+' : '\u2212'}1</span>` : '<span class="app-cal-mcell">\u00b7</span>')).join('')).join('');
  return `<div class="app-cal-mgrid"><span></span>${head}${body}</div>`;
}

function formatMatrix(m) {
  if (!m || !Array.isArray(m) || !m.length) {
    return '[ +1.00  +0.00  +0.00 ]\n[ +0.00  +1.00  +0.00 ]\n[ +0.00  +0.00  −1.00 ]';
  }
  const fmt = (v) => {
    const n = Number(v) || 0;
    const s = Math.abs(n).toFixed(2);
    return (n >= 0 ? '+' : '−') + s;
  };
  return m.map((row) => '[ ' + row.map(fmt).join('  ') + ' ]').join('\n');
}

function renderSaveScreen(st) {
  disposeScene();
  stopQuatListener();

  const profiles = st.profiles || [];
  const slot = S.slot;
  const p = profiles[slot];
  const isEmpty = !p || !p.name;
  const currentDevice = device() || (p && p.device && p.device !== 'Unknown' ? p.device : 'iPhone');

  if (!S.selectedIcon) {
    S.selectedIcon = (p && p.icon) ? p.icon : 'default';
  }

  const triggerTitle = isEmpty
    ? `${c('slot_label', { n: slot + 1 })} — ${c('slot_empty')}`
    : p.name;
  const triggerDevice = isEmpty
    ? c('device_label_preview', { device: currentDevice })
    : `${c('slot_label', { n: slot + 1 })} • ${c('device_label', { device: p.device || c('device_unknown') })}`;
  const triggerIcon = S.selectedIcon || (p && p.icon ? p.icon : 'default');

  const defaultName = (p && p.name && !p.name.startsWith('Слот') && !p.name.startsWith('Slot'))
    ? p.name
    : `${currentDevice} ${slot + 1}`;

  const existingInput = $('cal-name');
  const nameValue = (existingInput && existingInput.dataset.slot === String(slot))
    ? existingInput.value
    : defaultName;

  const slotItemsHtml = Array.from({ length: 6 }, (_, i) => {
    const sp = profiles[i];
    const sEmpty = !sp || !sp.name;
    const sDev = device() || (sp && sp.device && sp.device !== 'Unknown' ? sp.device : 'iPhone');
    const sTitle = sEmpty
      ? `${c('slot_label', { n: i + 1 })} — ${c('slot_empty')}`
      : sp.name;
    const sSub = sEmpty
      ? c('device_label_preview', { device: sDev })
      : c('device_label', { device: sp.device || c('device_unknown') });
    const sIcon = (sp && sp.icon) ? sp.icon : 'default';
    const isActive = i === slot;

    return `<button type="button" class="app-menu__item${isActive ? ' is-active' : ''}${sEmpty ? ' app-cal-menu-item--empty' : ''}" role="option" data-act="select-slot" data-slot="${i}" aria-selected="${isActive}">
      <span class="app-menu__icon${sEmpty ? ' app-cal-icon--muted' : ''}">${profileIconSvg(sIcon)}</span>
      <span class="app-grow">
        <span class="pg-profile__t">${esc(sTitle)}</span>
        <span class="pg-profile__s">${esc(c('slot_label', { n: i + 1 }))} • ${esc(sSub)}</span>
      </span>
      ${sEmpty ? `<span class="pg-badge app-cal-freebadge">${esc(t('ui.cal_slot_free'))}</span>` : ''}
      ${sp && sp.outdated ? `<span class="pg-badge pg-badge--danger">${esc(c('outdated_badge'))}</span>` : ''}
      ${isActive ? '<span class="app-menu__check">✓</span>' : ''}
    </button>`;
  }).join('');

  const showOverwrite = !isEmpty && p && p.name;
  const overwriteHtml = showOverwrite
    ? `<div class="pg-notice pg-notice--warn app-cal-warn">
        <span>${esc(c('save_overwrite_warn', { slot: slot + 1, name: p.name }))}</span>
      </div>`
    : '';

  const iconsHtml = ICON_KEYS.map((k) => `
    <button type="button" class="app-cal-icon-card${S.selectedIcon === k ? ' is-selected' : ''}" role="radio" aria-checked="${S.selectedIcon === k}" data-act="select-icon" data-icon="${k}">
      <span class="app-cal-icon-svg">${profileIconSvg(k)}</span>
      <span class="app-cal-icon-title">${esc(c('icon_' + k))}</span>
    </button>
  `).join('');

  const deviceBadgeHtml = `
    <div class="app-cal-device-row">
      <span class="pg-badge app-cal-device-badge">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="3"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        <span>${esc(c('device_label', { device: currentDevice }))}</span>
      </span>
    </div>
  `;

  const res = S.result || {};

  body().innerHTML = `
    <div class="app-cal-save app-cal-save-grid">
      <div class="app-cal-save-form">
        <div class="app-cal-info">
          <div class="pg-overline app-cal-overline">
            <span class="pg-ring"></span>
            <span>${esc(t('setup.step_x_of_y', { x: 5, y: 5 }))} · ${esc(t('ui.cal_save_step'))}</span>
          </div>
          <div class="display-md">${esc(c('save_slot_title'))}</div>
          <p class="app-cal-desc">${esc(c('save_slot_hint'))}</p>
        </div>

        <div class="app-cal-field">
          <div class="app-profwrap app-cal-slotwrap" id="cal-save-slotwrap">
            <button type="button" class="pg-row app-profbtn app-cal-slot-trigger" id="cal-save-slot-trigger" data-act="toggle-slot-menu" aria-haspopup="listbox" aria-expanded="${S.slotDropdownOpen}">
              <span class="app-menu__icon${isEmpty ? ' app-cal-icon--muted' : ''}" id="cal-save-trigger-icon">
                ${profileIconSvg(triggerIcon)}
              </span>
              <span class="app-grow">
                <span class="pg-profile__t" id="cal-save-trigger-title">${esc(triggerTitle)}</span>
                <span class="pg-profile__s" id="cal-save-trigger-device">${esc(triggerDevice)}</span>
              </span>
              <span class="pg-badge app-cal-slotbadge" id="cal-save-trigger-badge">${esc(c('slot_label', { n: slot + 1 }))}</span>
              <svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
            <div class="app-menu app-cal-slotmenu" id="cal-save-slot-menu"${S.slotDropdownOpen ? '' : ' hidden'} role="listbox">
              ${slotItemsHtml}
            </div>
          </div>
        </div>

        ${overwriteHtml}

        <div class="app-cal-field">
          <label class="app-cal-label" for="cal-name">${esc(c('save_name_title'))}</label>
          <input class="pg-input app-cal-name" id="cal-name" data-slot="${slot}" maxlength="40" placeholder="${esc(c('save_name_placeholder'))}" value="${esc(nameValue)}">
        </div>

        <div class="app-cal-field">
          <label class="app-cal-label">${esc(c('save_icon_title'))}</label>
          <div class="app-cal-icons" role="radiogroup" aria-label="${esc(c('save_icon_title'))}">
            ${iconsHtml}
          </div>
        </div>

        ${deviceBadgeHtml}
      </div>

      <div class="app-cal-save-preview">
        <div class="pg-overline app-cal-preview-head">
          <span class="pg-ring"></span>
          <span>${esc(c('preview_title', 'Предпросмотр профиля'))}</span>
        </div>
        <div class="pg-card app-cal-preview-card app-cal-ring-corner app-cal-ring-corner--br">
          <div class="pg-profile app-cal-preview-profile">
            <span class="app-menu__icon" id="cal-preview-icon">${profileIconSvg(triggerIcon)}</span>
            <span class="app-grow">
              <span class="pg-profile__t" id="cal-preview-name">${esc(nameValue || defaultName)}</span>
              <span class="pg-profile__s" id="cal-preview-sub">${esc(c('slot_label', { n: slot + 1 }))} • ${esc(c('device_label', { device: currentDevice }))}</span>
            </span>
            <span class="pg-badge pg-badge--info" id="cal-preview-slotbadge">${esc(c('slot_label', { n: slot + 1 }))}</span>
          </div>

          <div class="app-cal-preview-summary">
            <div class="pg-overline"><span class="pg-ring"></span><span>${esc(c('summary_saving', 'Что сохраняется'))}</span></div>
            <div class="app-cal-chips">
              <span class="pg-badge"><span class="pg-axis__key pg-axis__key--x">P</span> Pitch: <b>${esc(res.pitchAxis || '+X')}</b></span>
              <span class="pg-badge"><span class="pg-axis__key pg-axis__key--y">Y</span> Yaw: <b>${esc(res.yawAxis || '+Y')}</b></span>
              <span class="pg-badge"><span class="pg-axis__key pg-axis__key--z">R</span> Roll: <b>${esc(res.rollAxis || '+Z')}</b></span>
            </div>
            <div class="app-cal-preview-meta">
              <span class="pg-row__sub">${esc(c('calibrated_today', 'Калибровка: сегодня'))}</span>
              ${isEmpty
                ? `<span class="pg-badge pg-badge--ok">${esc(c('profile_new', 'Новый профиль'))}</span>`
                : `<span class="pg-badge pg-badge--warn">${esc(c('profile_overwrites', { name: p.name }))}</span>`
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  foot().innerHTML = ringHost(btn('toverify', c('btn_back'))) + '<span class="app-grow"></span>' + btn('save', c('btn_save'), 'primary');

  const inp = $('cal-name');
  if (inp) {
    inp.oninput = () => {
      const liveVal = inp.value.trim() || defaultName;
      setText($('cal-preview-name'), liveVal);
    };
    setTimeout(() => {
      inp.focus();
      inp.select();
    }, 30);
  }
}

function render() {
  const st = getState() || {};
  $('cal-sub').textContent = device() ? c('subtitle_device', { device: device() }) : c('subtitle');

  if (S.phase === 'save') {
    return renderSaveScreen(st);
  }

  // Common 2-column grid for Steps 1–4 and Step 5 (Verify)
  let grid = $('cal-grid');
  if (!grid) {
    body().innerHTML = stepper() + `<div class="app-cal-grid" id="cal-grid">
      <div class="app-cal-left" id="cal-left"></div>
      <div class="app-cal-right">
        <div class="pg-stage app-cal-stage" id="cal-stage">
          <div class="pg-stage__cap" id="cal-stage-cap"></div>
        </div>
        <div class="body-sm app-cal-disclaimer" id="cal-disclaimer">${esc(c('view_disclaimer'))}</div>
        <div class="app-cal-extra app-cal-extra--r" id="cal-extra-r"></div>
      </div>
    </div>`;
  } else {
    const stepperBox = body().querySelector('.app-cal-stepper');
    if (stepperBox) setHTML(stepperBox, stepper().replace(/^<div class="[^"]*">/, '').replace(/<\/div>$/, ''));
  }

  const leftCol = $('cal-left');
  const disclaimer = $('cal-disclaimer');
  if (disclaimer) disclaimer.hidden = S.phase === 'verify';

  if (S.phase === 'verify') {
    const r = S.result || {};
    const det = r.det != null ? r.det : det3(S.matrix);
    const isOk = Math.abs(det + 1.0) < 0.05;
    const detText = isOk ? c('matrix_det_ok') : c('matrix_det_err');

    if (leftCol) {
      leftCol.innerHTML = `
        <div class="app-cal-info">
          <div class="pg-overline app-cal-overline">
            <span class="pg-ring"></span>
            <span>${esc(t('setup.step_x_of_y', { x: 5, y: 5 }))} · ${esc(c('step_pill_confirm'))}</span>
          </div>
          <div class="display-md">${esc(c('confirm_title'))}</div>
          <p class="app-cal-desc">${esc(c('confirm_hint'))}</p>
        </div>
        <div class="app-cal-verify-stats" id="cal-verify-stats">
          ${[['x', 'P', 'Pitch', r.pitchAxis || '+X', 'pitch'], ['y', 'Y', 'Yaw', r.yawAxis || '+Y', 'yaw'], ['z', 'R', 'Roll', r.rollAxis || '+Z', 'roll']].map((a) => `
          <div class="app-cal-vstat">
            <div class="app-cal-vstat__head">
              <span class="app-cal-vstat__name"><span class="pg-axis__key pg-axis__key--${a[0]}">${a[1]}</span>${a[2]}</span>
              <span class="pg-badge">${esc(a[3])}</span>
            </div>
            <div class="mono app-cal-stat-val" id="cal-verify-${a[4]}">+0°</div>
          </div>`).join('')}
        </div>
        <div id="cal-mount"></div>
        <div class="app-cal-extra app-cal-extra--l" id="cal-extra-l"></div>
      `;
    }

    setText($('cal-stage-cap'), c('confirm_caption'));
    foot().innerHTML = ringHost(btn('restart', c('confirm_restart'))) + '<span class="app-grow"></span>' + btn('tosave', c('confirm_yes'), 'primary');

    const extraHTML = `
      <div class="app-cal-mcards">
        <div class="app-cal-mcard">
          <div class="app-cal-mcard__t"><span>${esc(t('ui.cal_gyro_title'))}</span><span class="pg-badge ${isOk ? 'pg-badge--ok' : 'pg-badge--danger'}">det ${det >= 0 ? '+' : '\u2212'}${Math.abs(det || 1).toFixed(0)}</span></div>
          ${axisGridHTML(matrixRows(S.matrix))}
        </div>
        <div class="app-cal-mcard">
          <div class="app-cal-mcard__t"><span>${esc(c('accel_axes_label'))}</span></div>
          ${S.accelMap.length ? axisGridHTML(accelRows(S.accelMap)) : `<span class="app-cal-mnote">${esc(c('accel_axes_unset'))}</span>`}
        </div>
      </div>
      <p class="app-cal-mnote">${esc(t('ui.cal_matrix_note'))}</p>
    `;
    for (const id of ['cal-extra-l', 'cal-extra-r']) { const x = $(id); if (x) x.innerHTML = extraHTML; }
    renderMount();
    updateLiveRates(st);
    ensureScene('live');
    startQuatListener();
    return;
  }

  // Steps 1–4
  stopQuatListener();
  for (const id of ['cal-extra-l', 'cal-extra-r']) { const x = $(id); if (x && x.firstChild) x.innerHTML = ''; }

  const cfg = STEPS[S.step];
  const n = S.step;
  const stepKey = cfg.key;
  const CORNER_CLASSES = [
    'app-cal-ring-corner--br',
    'app-cal-ring-corner--tr',
    'app-cal-ring-corner--bl',
    'app-cal-ring-corner--tl',
  ];

  // Render left column
  if (leftCol) {
    let panelHTML = '';

    if (S.phase === 'ready') {
      panelHTML = `<div class="pg-notice pg-notice--plain app-cal-action-box">
        <span class="pg-badge pg-badge--ok pg-badge--dot">${esc(t('ui.cal_ready_badge'))}</span>
        <button type="button" class="pg-btn pg-btn--primary pg-btn--lg pg-btn--block" data-act="capture">
          <svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" style="fill:currentColor"/></svg>
          ${esc(c(`step${n}_btn`))}
        </button>
      </div>`;
    } else if (S.phase === 'run') {
      panelHTML = cfg.axes
        ? `<div class="app-cal-run">
            <div class="app-cal-runrow">
              <span class="pg-badge pg-badge--ok pg-badge--dot">${esc(t('ui.cal_recording_badge'))}</span>
              <span class="pg-badge" id="cal-run-count">0/6</span>
            </div>
            <div class="app-cal-segs" id="cal-segs"></div>
            <span class="app-cal-runtext app-cal-runtext--soft" id="cal-run-text">${esc(c('align_status_recording'))}</span>
          </div>`
        : `<div class="app-cal-run">
            <div class="app-cal-runrow">
              <span class="pg-badge pg-badge--ok pg-badge--dot">${esc(t('ui.cal_recording_badge'))}</span>
              <span class="pg-badge" id="cal-run-count">0°/s</span>
            </div>
            <b class="app-cal-runtext" id="cal-run-text">${esc(cfg.rest ? c('status_recording_rest') : c('status_recording'))}</b>
            <div class="app-cal-bar"><i id="cal-bar"></i></div>
          </div>`;
    } else if (S.phase === 'done') {
      panelHTML = `<div class="pg-notice pg-notice--ok app-cal-success-notice">
        <svg class="app-cal-ok-ico" viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4 8-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="app-grow">
          <b>${esc(cfg.axes ? c('align_success_title') : c('capture_success_title'))}</b>
          ${S.doneText ? `<span class="pg-notice__sub">${md(S.doneText)}</span>` : ''}
        </div>
      </div>
      <button type="button" class="pg-btn pg-btn--block" data-act="retry">
        ${esc(cfg.axes ? c('btn_recalibrate_align') : c('btn_retry'))}
      </button>`;
    } else if (S.phase === 'fail') {
      panelHTML = `<div class="pg-notice pg-notice--danger">
        <div class="app-grow">
          <b>${esc(cfg.axes ? c('align_fail_title') : c('capture_fail_title'))}</b>
          <span class="pg-notice__sub">${md(S.failText || '')}</span>
        </div>
      </div>
      <button type="button" class="pg-btn pg-btn--primary pg-btn--lg pg-btn--block" data-act="capture">
        ${esc(c('btn_retry'))}
      </button>`;
    }

    leftCol.innerHTML = `
      ${axisTilesHTML()}
      <div class="app-cal-info">
        <div class="pg-overline app-cal-overline">
          <span class="pg-ring"></span>
          <span>${esc(t('setup.step_x_of_y', { x: n + 1, y: 4 }))} · ${esc(c(cfg.pill))}</span>
        </div>
        <div class="display-md">${md(c(`step${n}_title`).replace(/^[^:]*:\s*/, ''))}</div>
        <p class="app-cal-desc">${md(c(`step${n}_desc`))}</p>
      </div>
      <div class="app-cal-panel app-cal-ring-corner ${CORNER_CLASSES[n]}">${panelHTML}</div>
    `;
  }

  // Update right column caption
  const capText = c(`step${n}_caption`);
  setText($('cal-stage-cap'), capText);

  // Footer buttons: left Back/Cancel, right Next (active when done)
  const backLabel = n === 0 ? c('btn_cancel') : c('btn_back');
  const backBtn = btn('back', backLabel, '', S.phase === 'run');
  const nextLabel = n === STEPS.length - 1 || (n === 2 && S.result) ? c('btn_to_confirm') : c('btn_next_step');
  const isDone = S.phase === 'done' || !!(S.steps[n] && S.steps[n].done);
  const nextBtn = btn('next', nextLabel, isDone ? 'primary' : '', !isDone || S.phase === 'run');
  foot().innerHTML = ringHost(backBtn) + '<span class="app-grow"></span>' + nextBtn;

  // Live rates update
  updateLiveRates(st);

  // Update scene
  ensureScene(stepKey);
}

function updateLiveRates(st) {
  if (!S.open) return;
  if (S.phase !== 'verify' && S.phase !== 'save') {
    updateAxisTiles(st);
  } else if (S.phase === 'verify') {
    const f = (v) => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v || 0)) + '°';
    const pEl = $('cal-verify-pitch');
    const yEl = $('cal-verify-yaw');
    const rEl = $('cal-verify-roll');
    const pTxt = f(st.pitch);
    const yTxt = f(st.yaw);
    const rTxt = f(st.roll);
    if (pEl && pEl.textContent !== pTxt) setText(pEl, pTxt);
    if (yEl && yEl.textContent !== yTxt) setText(yEl, yTxt);
    if (rEl && rEl.textContent !== rTxt) setText(rEl, rTxt);
    // Fallback if no ahrs:quat event received within 500ms
    if (S.scene && performance.now() - lastAhrsTs > 500) {
      if (st.ahrsQ0 !== undefined && st.ahrsQ1 !== undefined) {
        liveQuat[0] = st.ahrsQ1;
        liveQuat[1] = st.ahrsQ2;
        liveQuat[2] = st.ahrsQ3;
        liveQuat[3] = st.ahrsQ0;
        S.scene.setQuaternion(liveQuat);
      } else if (st.qx !== undefined && st.qw !== undefined) {
        liveQuat[0] = st.qx;
        liveQuat[1] = st.qy;
        liveQuat[2] = st.qz;
        liveQuat[3] = st.qw;
        S.scene.setQuaternion(liveQuat);
      }
    }
  }
}

// A gesture step: 2..1 countdown, then Go records for the step's duration.
async function capture() {
  const cfg = STEPS[S.step];
  if (cfg.axes) return listenAxes();
  S.hasRecorded = true;
  clearAxisRole(S.step);
  S.steps[S.step] = null;
  invalidateAfter(S.step);
  S.phase = 'run';
  render();
  const txt = $('cal-run-text');
  for (let k = 2; k >= 1; k--) {
    if (txt) txt.textContent = c('preparing') + ' ' + k;
    await new Promise((r) => setTimeout(r, 650));
    if (!S.open || S.phase !== 'run') return;
  }
  if (txt) txt.textContent = cfg.rest ? c('status_recording_rest') : c('status_recording');
  await call('StartCapture');
  if (!S.open || S.phase !== 'run') {
    call('StopCapture', S.step).catch(() => {});
    return;
  }
  const t0 = performance.now();
  await new Promise((resolve) => {
    S.timer = setInterval(() => {
      if (!S.open || S.phase !== 'run') {
        clearInterval(S.timer);
        S.timer = 0;
        resolve();
        return;
      }
      const el2 = $('cal-bar');
      const p = Math.min(1, (performance.now() - t0) / cfg.ms);
      if (el2) el2.style.setProperty('--p', p.toFixed(3));
      if (S.scene) S.scene.setRecording(p);
      const st = getState() || {};
      const cnt = $('cal-run-count');
      if (cnt) cnt.textContent = Math.round(Math.hypot(st.rawRotX || 0, st.rawRotY || 0, st.rawRotZ || 0)) + '°/s';
      if (p >= 1) { clearInterval(S.timer); S.timer = 0; resolve(); }
    }, 50);
  });
  if (!S.open || S.phase !== 'run') return;
  if (S.scene) S.scene.setRecording(0);
  const res = await call('StopCapture', S.step);
  if (!res || !res.success) return fail(res && (c(res.errorCode) || res.errorMsg) || c('err_motion_record'));
  if (S.step === 0) {
    S.vectors[0] = [0, 0, 0];
    return done('');
  }
  S.vectors[S.step] = res.vector;
  if (res.axisIdx >= 0 && res.axisIdx < 3) S.axes[res.axisIdx] = { role: S.step === 1 ? 'pitch' : 'roll', name: res.axisName, confidence: res.confidence };
  const detail = c('res_gesture', { axis: res.axisName, pct: Math.round((res.confidence || 0) * 100), spd: Math.round(res.peakSpeed || 0) });
  if (S.step === 1 && S.vectors[2]) {
    const v = await call('ValidateCalibration', S.vectors[1], S.vectors[2]);
    if (v && v.success) {
      S.matrix = v.matrix;
      S.result = v;
      lockYaw(v);
    }
  } else if (S.step === 2 && S.vectors[1]) {
    const v = await call('ValidateCalibration', S.vectors[1], S.vectors[2]);
    if (!v || !v.success) return fail(v && (c(v.errorCode) || v.errorMsg) || c('err_axes_inconsistent'));
    S.matrix = v.matrix;
    S.result = v;
    lockYaw(v);
  }
  done(detail);
}

// Pitch and roll are known: the one axis left over is yaw.
function lockYaw(v) {
  for (let i = 0; i < 3; i++) if (!S.axes[i]) S.axes[i] = { role: 'yaw', name: v.yawAxis || '', confidence: 1 };
}

// Axes: the aligner learns from free movement; poll until it locks.
async function listenAxes() {
  S.hasRecorded = true;
  S.steps[S.step] = null;
  S.accelMap = [];
  S.phase = 'run';
  render();
  const txt = $('cal-run-text');
  if (txt) txt.textContent = c('align_status_recording');
  updateSegs(0, 6);
  const cnt0 = $('cal-run-count');
  if (cnt0) cnt0.textContent = '0/6';
  await call('StartAxisAlign', true);
  const t0 = performance.now();
  S.poll = setInterval(async () => {
    const st = await call('GetAxisAlignStatus');
    if (!S.open || S.phase !== 'run' || !st) return;
    const refining = st.pairs >= st.minPairs;
    const cnt = $('cal-run-count'), tEl = $('cal-run-text');
    const p = Math.min(1, st.pairs / Math.max(1, st.minPairs));
    updateSegs(st.pairs, Math.max(1, st.minPairs));
    if (S.scene) S.scene.setRecording(p);
    if (cnt) cnt.textContent = refining ? c('align_counter_refining') : `${st.pairs}/${st.minPairs}`;
    if (tEl) tEl.textContent = refining ? c('align_status_refining') : c('align_status_recording');
    if (st.known) {
      stopPoll();
      if (S.scene) S.scene.setRecording(0);
      S.accelMap = (st.mapping || []).slice(0, 3);
      done(c('align_success_desc', { mapping: (st.mapping || []).join(', ') }));
    } else if (performance.now() - t0 > AXES_TIMEOUT_MS) {
      stopPoll();
      if (S.scene) S.scene.setRecording(0);
      fail(c('align_fail_desc'));
    }
  }, 200);
}

function stopPoll() {
  if (S.poll) {
    clearInterval(S.poll);
    S.poll = 0;
  }
}

function done(text) {
  S.phase = 'done';
  S.doneText = text;
  S.steps[S.step] = { done: true, text, vector: S.vectors[S.step] || null };
  if (S.scene) S.scene.setRecording(0);
  render();
}

function fail(text) {
  S.phase = 'fail';
  S.failText = text;
  if (S.scene) S.scene.setRecording(0);
  render();
}

async function renderMount() {
  const box = $('cal-mount');
  if (!box) return;
  const m = await call('GetWizardMount');
  if (!m || !box.isConnected) return;
  const sign = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
  const text = c('mount_' + m.status, { tilt: m.tiltDeg.toFixed(1), fwd: sign(m.forwardDeg), right: sign(m.rightDeg), check: m.checkDeg.toFixed(1) });
  if (m.status === 'ok') {
    box.innerHTML = `<div class="pg-group__list app-cal-mount"><div class="pg-row"><div class="pg-row__label">${esc(c('mount_title'))}</div>
      <div class="pg-row__control"><label class="pg-toggle"><input type="checkbox" id="cal-mount-on"${m.enabled ? ' checked' : ''} aria-label="mount"><span class="pg-toggle__track"></span></label></div></div>
      <div class="pg-row"><span class="pg-row__sub">${esc(text)}</span></div></div>`;
    const tg = $('cal-mount-on');
    if (tg) tg.onchange = () => call('SetWizardMountEnabled', tg.checked);
    return;
  }
  const kind = m.status === 'small' ? 'pg-notice--plain' : 'pg-notice--warn';
  box.innerHTML = `<div class="pg-notice ${kind} app-cal-mountnote"><div class="app-grow"><b>${esc(c('mount_title'))}</b><span class="pg-notice__sub">${esc(text)}</span></div></div>`;
}

function startFlow(slot) {
  S.slot = slot;
  S.step = 0;
  S.steps = [null, null, null, null];
  S.axes = [null, null, null];
  S.accelMap = [];
  S.vectors = [];
  S.matrix = null;
  S.result = null;
  S.doneText = '';
  S.failText = '';
  S.phase = 'ready';
  S.selectedIcon = 'default';
  S.slotDropdownOpen = false;
  call('StartAxisAlign', true); // recalibrating never reuses an old axis mapping
  render();
}

function hasProgress() {
  return S.step > 0 || S.hasRecorded || S.phase === 'verify' || S.phase === 'save';
}

let confirmModalOpen = false;

export async function requestClose(opts = {}) {
  if (!S.open) return;
  if (confirmModalOpen) return;

  if (opts.force || !hasProgress()) {
    return close(opts);
  }

  confirmModalOpen = true;
  try {
    const choice = await openModal({
      title: t('calibration.exit_confirm_title', 'Выйти из калибровки?'),
      text: t('calibration.exit_confirm_desc', 'Пройденные шаги будут сброшены.'),
      actions: [
        { label: t('calibration.stay', 'Остаться'), kind: '' },
        { label: t('calibration.exit', 'Выйти'), kind: 'danger' },
      ],
    });

    if (choice === 1) {
      await close(opts);
    }
  } finally {
    confirmModalOpen = false;
  }
}

export async function close(opts = {}) {
  if (!S.open) return;
  S.wasInterruptedByDisconnect = false;
  hideDisconnectAlert({ silent: true });
  if (S.phase === 'run') call('StopCapture', S.step).catch(() => {});
  if (S.timer) { clearInterval(S.timer); S.timer = 0; }
  stopPoll();
  stopQuatListener();
  disposeScene();
  S.open = false;
  S.slotDropdownOpen = false;
  S.hasRecorded = false;
  call('ClearPreview').catch(() => {});
  await go('connect', { instant: opts.instant ?? false });
}

async function enterVerify() {
  S.phase = 'verify';
  S.slotDropdownOpen = false;
  await call('PreviewMatrix', S.matrix);
  recenter();
  render();
}

async function act(a, target) {
  if (a === 'close') return requestClose();
  if (a === 'capture') return capture();
  if (a === 'retry') {
    S.phase = 'ready';
    S.failText = '';
    render();
    return;
  }
  if (a === 'back') {
    if (S.timer) { clearInterval(S.timer); S.timer = 0; }
    stopPoll();
    if (S.phase === 'verify') {
      stopQuatListener();
      disposeScene();
      S.step = 3;
      if (S.steps[3] && S.steps[3].done) {
        S.phase = 'done';
        S.doneText = S.steps[3].text;
      } else {
        S.phase = 'ready';
      }
      render();
      return;
    }
    if (S.step > 0) {
      S.step--;
      if (S.steps[S.step] && S.steps[S.step].done) {
        S.phase = 'done';
        S.doneText = S.steps[S.step].text;
      } else {
        S.phase = 'ready';
      }
      render();
    } else {
      requestClose();
    }
    return;
  }
  if (a === 'next') {
    if (S.step < STEPS.length - 1) {
      S.step++;
      if (S.steps[S.step] && S.steps[S.step].done) {
        S.phase = 'done';
        S.doneText = S.steps[S.step].text;
      } else {
        S.phase = 'ready';
      }
      render();
      return;
    }
    return enterVerify();
  }
  if (a === 'goto') {
    const k = Number(target.dataset.step);
    if (S.phase === 'run' || !pillDone(k)) return;
    if (k >= STEPS.length) { stopPoll(); if (S.timer) { clearInterval(S.timer); S.timer = 0; } return enterVerify(); }
    if (S.timer) { clearInterval(S.timer); S.timer = 0; }
    stopPoll();
    stopQuatListener();
    if (S.phase === 'verify' || S.phase === 'save') disposeScene();
    S.slotDropdownOpen = false;
    S.step = k;
    if (S.steps[k] && S.steps[k].done) {
      S.phase = 'done';
      S.doneText = S.steps[k].text;
    } else {
      S.phase = 'ready';
    }
    render();
    return;
  }
  if (a === 'restart') {
    stopQuatListener();
    disposeScene();
    return startFlow(S.slot);
  }
  if (a === 'tosave') {
    stopQuatListener();
    disposeScene();
    S.phase = 'save';
    S.slotDropdownOpen = false;
    const st = getState() || {};
    const p = (st.profiles || [])[S.slot];
    S.selectedIcon = (p && p.icon) ? p.icon : 'default';
    render();
    return;
  }
  if (a === 'toverify') {
    S.phase = 'verify';
    S.slotDropdownOpen = false;
    recenter();
    render();
    return;
  }
  if (a === 'toggle-slot-menu') {
    toggleSlotDropdown();
    return;
  }
  if (a === 'select-slot') {
    const slotIdx = Number(target.dataset.slot);
    selectSaveSlot(slotIdx);
    return;
  }
  if (a === 'select-icon') {
    const iconKey = target.dataset.icon;
    selectSaveIcon(iconKey);
    return;
  }
  if (a === 'save') {
    if (S.busy) return;
    S.busy = true;
    const nameInput = $('cal-name');
    const inputVal = (nameInput ? nameInput.value : '').trim();
    const st = getState() || {};
    const profiles = st.profiles || [];
    const p = profiles[S.slot];
    const dev = device() || (p && p.device && p.device !== 'Unknown' ? p.device : 'iPhone');
    const defaultName = `${dev} ${S.slot + 1}`;
    const name = inputVal || defaultName;
    const icon = S.selectedIcon || (p && p.icon ? p.icon : 'default');
    const matrix = S.matrix || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

    const res = await call('SaveProfile', S.slot, name, dev, icon, matrix);
    S.busy = false;
    if (res !== 'ok') { toast(res || 'error'); return; }
    await call('SetActiveProfile', S.slot);
    await close();
    toast(c('profile_saved', { name }));
  }
}

/** Opens the wizard: straight into step 1 for the target (or active) slot. */
export function openCalibration(slot = null) {
  S.open = true;
  S.hasRecorded = false;
  const targetSlot = slot == null ? (getState()?.activeSlot ?? 0) : slot;
  startFlow(targetSlot);
  go('calibration');
  const st = getState();
  if (st && st.status === 'offline') {
    showDisconnectAlert();
  }
  syncDisconnectSetting().then(() => {
    if (S.open) {
      const curSt = getState();
      if (curSt && curSt.status === 'offline') {
        showDisconnectAlert();
      } else if (S.isDisconnectAlertActive) {
        hideDisconnectAlert();
      }
    }
  });
}

export function startCalibration() {
  const rootEl = el();
  if (rootEl) {
    rootEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) act(b.dataset.act, b);
      // NOTE: clicks on root background do nothing
    });
  }
  $('cal-x').onclick = () => requestClose();
  const cancelBtn = $('btn-cancel-cal-disconnect');
  if (cancelBtn) cancelBtn.onclick = () => close({ force: true });

  document.addEventListener('click', (e) => {
    if (!S.open || S.phase !== 'save' || !S.slotDropdownOpen) return;
    const wrap = $('cal-save-slotwrap');
    if (wrap && !wrap.contains(e.target)) {
      toggleSlotDropdown(false);
    }
  });

  addEventListener('keydown', (e) => {
    if (!S.open) return;
    if (e.key === 'Escape') {
      if (confirmModalOpen) return;
      if (S.phase === 'save' && S.slotDropdownOpen) {
        e.preventDefault();
        e.stopPropagation();
        toggleSlotDropdown(false);
        return;
      }
      requestClose();
    }
    else if (e.key === 'Enter' && S.phase === 'save') {
      if (S.slotDropdownOpen) {
        toggleSlotDropdown(false);
      } else {
        act('save');
      }
    }
  });

  // Completed step pills are keyboard-reachable buttons.
  el().addEventListener('keydown', (e) => {
    const b = e.target.closest && e.target.closest('.pg-step[data-act]');
    if (b && (e.key === 'Enter' || e.code === 'Space')) { e.preventDefault(); act(b.dataset.act, b); }
  });

  onScreen((screen) => {
    if (screen === 'calibration') {
      if (!S.open) openCalibration();
    } else {
      if (S.open) close({ instant: true });
    }
  });

  onState((st) => {
    if (!S.open || !st) return;
    updateLiveRates(st);
    if (st.status === 'offline') {
      showDisconnectAlert();
    } else if (S.isDisconnectAlertActive) {
      hideDisconnectAlert();
    }
  });

  onLang(() => {
    if (S.open) render();
  });

  syncDisconnectSetting();
}
