// Calibration wizard (design: Modal + stepper). The Go side does the maths
// (gui/internal/app/calibration.go); this walks the user through it:
//   rest (1.6 s) → pitch (2.4 s) → roll (2.4 s) → axes (listen ≤ 20 s)
//        → verify (new matrix previewed live) → save (name + icon + slot).
//
// Flow change vs legacy Claude rework:
//   • openCalibration() goes straight to capture — no slot-selector screen.
//     The target slot is pre-chosen: the active slot if calibrated, else the
//     first empty slot, else slot 0. The user can change it on the save screen.
//   • Manual calibration mode fully removed.
//   • Disconnect is shown as a blocking overlay inside the modal (not a banner).
//   • Save screen has an icon picker (gamepad / vertical / horizontal).

import { $, esc, md, show } from '../core/dom.js';
import { call } from '../core/bridge.js';
import { t } from '../core/i18n.js';
import { getState, onState } from '../core/state.js';
import { toast } from '../ui/toast.js';
import { profileIconSvg, ICON_KEYS } from '../ui/profile-icons.js';

const STEPS = [
  { key: 'rest',  pill: 'step_pill_rest',  ms: 1600, rest: true },
  { key: 'pitch', pill: 'step_pill_pitch', ms: 2400 },
  { key: 'roll',  pill: 'step_pill_roll',  ms: 2400 },
  { key: 'axes',  pill: 'step_pill_align', axes: true },
];
const AXES_TIMEOUT_MS = 20000;

const S = {
  open: false, slot: 0, step: 0,
  phase: 'ready', // ready | run | done | fail | verify | save
  vectors: [], matrix: null, result: null,
  timer: 0, poll: 0, busy: false,
  selectedIcon: 'default',
  disconnectShown: false,
};

const c  = (k, vars) => t('calibration.' + k, vars);
const el = () => $('cal');
const body = () => $('cal-body');
const foot = () => $('cal-foot');

// ── Helpers ──────────────────────────────────────────────────────────────────

function device() {
  const st = getState() || {};
  if (st.deviceName && st.deviceName !== 'Controller' && st.deviceName !== 'Unknown') return st.deviceName;
  return st.inputMode === 'usb' ? (st.deviceName || '') : (st.deviceName || 'iPhone');
}

/** Pick the best default slot: active (if named) → first empty → slot 0. */
function smartSlot() {
  const st = getState() || {};
  const profiles = st.profiles || [];
  const active = st.activeSlot;
  if (active >= 0 && profiles[active] && profiles[active].name) return active;
  const empty = profiles.findIndex((p) => !p || !p.name);
  return empty >= 0 ? empty : 0;
}

const btn = (id, label, kind = '', dis = false) =>
  `<button type="button" class="pg-btn${kind ? ' pg-btn--' + kind : ''}" data-act="${id}"${dis ? ' disabled' : ''}>${esc(label)}</button>`;

// ── Stepper ───────────────────────────────────────────────────────────────────

function stepper() {
  const pills = [...STEPS.map((s) => s.pill), 'step_pill_confirm'];
  const at = (S.phase === 'verify' || S.phase === 'save') ? 4 : S.step;
  return '<div class="pg-stepper app-cal-stepper pg-scroll--x">' + pills.map((p, i) =>
    (i ? `<span class="pg-step__link${i <= at ? ' is-done' : ''}"></span>` : '')
    + `<span class="pg-step${i === at ? ' is-active' : i < at ? ' is-done' : ''}"><span class="pg-step__num">${i + 1}</span>${esc(c(p))}</span>`).join('') + '</div>';
}

// ── CSS 3D gamepad scene ──────────────────────────────────────────────────────
// Renders as a styled div with perspective transforms — no Three.js required.
// Shows a simplified gamepad silhouette that tips in response to live sensors.

function gamepadScene(captionKey) {
  return `<div class="app-cal-scene" id="cal-scene">
    <div class="app-cal-gamepad" id="cal-gp">
      <div class="app-cal-gp__body">
        <div class="app-cal-gp__left"></div><div class="app-cal-gp__mid"></div><div class="app-cal-gp__right"></div>
      </div>
      <div class="app-cal-gp__stick app-cal-gp__stick--l"></div>
      <div class="app-cal-gp__stick app-cal-gp__stick--r"></div>
      <div class="app-cal-gp__dpad">
        <div></div><div></div><div></div><div></div>
      </div>
      <div class="app-cal-gp__btns">
        <div class="app-cal-gp__btn app-cal-gp__btn--a"></div>
        <div class="app-cal-gp__btn app-cal-gp__btn--b"></div>
        <div class="app-cal-gp__btn app-cal-gp__btn--x"></div>
        <div class="app-cal-gp__btn app-cal-gp__btn--y"></div>
      </div>
    </div>
    <div class="app-cal-scene__cap">${esc(c(captionKey))}</div>
  </div>`;
}

// Update the CSS gamepad tilt based on live sensor data (60fps RAF).
let gpRaf = 0;
function startGpAnim() {
  if (gpRaf) return;
  const tick = () => {
    const gp = $('cal-gp');
    if (!gp || !S.open || (S.phase !== 'ready' && S.phase !== 'run' && S.phase !== 'done' && S.phase !== 'fail' && S.phase !== 'verify')) {
      gpRaf = 0; return;
    }
    const st = getState() || {};
    const pitch = Math.max(-45, Math.min(45, st.pitch || 0));
    const roll  = Math.max(-45, Math.min(45, st.roll  || 0));
    gp.style.transform = `perspective(400px) rotateX(${(-pitch * 0.5).toFixed(1)}deg) rotateZ(${(roll * 0.5).toFixed(1)}deg)`;
    gpRaf = requestAnimationFrame(tick);
  };
  gpRaf = requestAnimationFrame(tick);
}

// ── Disconnect overlay ────────────────────────────────────────────────────────

function renderDisconnect(shown) {
  S.disconnectShown = shown;
  const ov = $('cal-disconnect');
  if (!ov) return;
  show(ov, shown);
}

// ── Main render ───────────────────────────────────────────────────────────────

function render() {
  const st = getState() || {};
  $('cal-sub').textContent = device() ? c('subtitle_device', { device: device() }) : c('subtitle');

  if (S.phase === 'verify') {
    const r = S.result || {};
    body().innerHTML = stepper() + `<div class="app-cal-main">
      <div class="app-cal-cols">
        <div class="app-cal-col">
          <div class="display-md">${esc(c('confirm_title'))}</div>
          <p class="app-cal-desc">${esc(t('ui.cal_verify_hint'))}</p>
          <div class="pg-notice pg-notice--ok"><span>${md(c('res_all_done', { p: r.pitchAxis || '?', y: r.yawAxis || '?', r: r.rollAxis || '?' }))}</span></div>
          <div id="cal-mount"></div>
          <div class="app-cal-live"><span class="pg-dial__label" id="cal-live"></span></div>
        </div>
        ${gamepadScene('step3_caption')}
      </div>
    </div>`;
    foot().innerHTML = btn('restart', c('confirm_restart')) +
      btn('recenter', c('confirm_recenter').replace(/\s*\(.*\)$/, '')) +
      btn('tosave', c('confirm_yes'), 'primary');
    renderMount();
    startGpAnim();
    live();
    return;
  }

  if (S.phase === 'save') {
    const profiles = (st.profiles || []);
    const old = profiles[S.slot];
    const iconPicker = ICON_KEYS.map((k) =>
      `<button type="button" class="app-cal-icon-btn${S.selectedIcon === k ? ' is-active' : ''}" data-act="icon" data-icon="${k}" title="${esc(c('icon_' + k))}">
        ${profileIconSvg(k)}<span>${esc(c('icon_' + k))}</span>
      </button>`).join('');

    // Slot picker — a compact dropdown row
    const slotOptions = [0, 1, 2, 3, 4, 5].map((i) => {
      const pr = profiles[i];
      const label = (pr && pr.name) ? `${esc(c('slot_label', { n: i + 1 }))} · ${esc(pr.name)}` : esc(c('slot_label', { n: i + 1 }));
      return `<option value="${i}"${i === S.slot ? ' selected' : ''}>${label}</option>`;
    }).join('');

    body().innerHTML = `<div class="app-cal-main">
      <div class="app-cal-save">
        <div class="app-cal-save__row">
          <label class="app-cal-label" for="cal-slot-sel">${esc(c('save_slot_title'))}</label>
          <select class="pg-input app-cal-slot-sel" id="cal-slot-sel">${slotOptions}</select>
        </div>
        ${old && old.name ? `<div class="pg-notice pg-notice--warn"><span>${esc(c('save_overwrite_warn', { slot: S.slot + 1, name: old.name }))}</span></div>` : ''}
        <div class="app-cal-save__row">
          <label class="app-cal-label" for="cal-name">${esc(c('save_name_title'))}</label>
          <input class="pg-input app-cal-name" id="cal-name" maxlength="40" placeholder="${esc(c('save_name_placeholder'))}" value="${esc(old && old.name ? old.name : c('slot_label', { n: S.slot + 1 }))}">
        </div>
        <div class="app-cal-save__row">
          <label class="app-cal-label">${esc(c('save_icon_title'))}</label>
          <div class="app-cal-icon-grid">${iconPicker}</div>
        </div>
      </div>
    </div>`;
    foot().innerHTML = btn('toverify', c('btn_back')) + btn('save', c('btn_save'), 'primary');
    // Wire slot selector
    const sel = $('cal-slot-sel');
    if (sel) sel.onchange = () => { S.slot = +sel.value; render(); };
    setTimeout(() => { const i = $('cal-name'); if (i) { i.focus(); i.select(); } }, 30);
    return;
  }

  // Capture steps: rest / pitch / roll / axes
  const cfg = STEPS[S.step];
  const n = S.step;
  let status = '', statusIcon = '';
  if (S.phase === 'done') { statusIcon = 'ok';   status = S.doneText; }
  if (S.phase === 'fail') { statusIcon = 'fail'; status = S.failText; }

  body().innerHTML = stepper() + `<div class="app-cal-main">
    <div class="app-cal-cols">
      <div class="app-cal-col">
        <div class="display-md">${md(c(`step${n}_title`).replace(/^[^:]*:\s*/, ''))}</div>
        <p class="app-cal-desc">${md(c(`step${n}_desc`))}</p>
        <div class="pg-notice app-cal-caption"><span>${esc(c(`step${n}_caption`))}</span></div>
        ${S.phase === 'run' ? `<div class="app-cal-run"><div class="app-cal-runrow"><b id="cal-run-text"></b><span class="pg-badge" id="cal-run-count"></span></div><div class="pg-progress"><i id="cal-bar"></i></div></div>` : ''}
        ${statusIcon ? `<div class="pg-notice pg-notice--${statusIcon === 'ok' ? 'ok' : 'danger'}"><span><b>${esc(statusIcon === 'ok' ? (cfg.axes ? c('align_success_title') : c('capture_success_title')) : (cfg.axes ? c('align_fail_title') : c('capture_fail_title')))}</b><span class="pg-notice__sub">${md(status || '')}</span></span></div>` : ''}
      </div>
      ${gamepadScene(`step${n}_caption`)}
    </div>
  </div>`;

  const back = btn('back', c('btn_back'), '', S.phase === 'run');
  if (S.phase === 'ready') {
    foot().innerHTML = back + btn('capture', c(`step${n}_btn`), 'primary');
  } else if (S.phase === 'run') {
    foot().innerHTML = back + btn('wait', cfg.axes ? c('align_recording_btn') : cfg.rest ? c('btn_recording_rest') : c('btn_recording'), 'primary', true);
  } else if (S.phase === 'done') {
    const nextLabel = (n === STEPS.length - 1 || (n === 2 && S.result)) ? c('btn_to_confirm') : c('btn_next_step');
    foot().innerHTML = back + '<span class="app-grow"></span>' +
      btn('capture', cfg.axes ? c('btn_recalibrate_align') : c('btn_retry')) +
      btn('next', nextLabel, 'primary');
  } else {
    foot().innerHTML = back + btn('capture', c('btn_retry'), 'primary');
  }
  startGpAnim();
}

// ── Capture logic (unchanged from before) ────────────────────────────────────

async function capture() {
  const cfg = STEPS[S.step];
  if (cfg.axes) return listenAxes();
  S.phase = 'run'; render();
  const txt = $('cal-run-text');
  for (let k = 2; k >= 1; k--) {
    txt.textContent = c('preparing') + ' ' + k;
    await new Promise((r) => setTimeout(r, 650));
    if (!S.open) return;
  }
  txt.textContent = cfg.rest ? c('status_recording_rest') : c('status_recording');
  await call('StartCapture');
  const t0 = performance.now();
  await new Promise((resolve) => {
    S.timer = setInterval(() => {
      const el2 = $('cal-bar');
      const p = Math.min(1, (performance.now() - t0) / cfg.ms);
      if (el2) el2.style.setProperty('--p', (p * 100).toFixed(1) + '%');
      const st = getState() || {};
      const cnt = $('cal-run-count');
      if (cnt) cnt.textContent = Math.round(Math.hypot(st.rawRotX || 0, st.rawRotY || 0, st.rawRotZ || 0)) + '°/s';
      if (p >= 1) { clearInterval(S.timer); resolve(); }
    }, 50);
  });
  if (!S.open) return;
  const res = await call('StopCapture', S.step);
  if (!res || !res.success) return fail(res && (c(res.errorCode) || res.errorMsg) || c('err_motion_record'));
  if (S.step === 0) { S.vectors[0] = [0, 0, 0]; return done(''); }
  S.vectors[S.step] = res.vector;
  const detail = c('res_gesture', { axis: res.axisName, pct: Math.round((res.confidence || 0) * 100), spd: Math.round(res.peakSpeed || 0) });
  if (S.step === 2) {
    const v = await call('ValidateCalibration', S.vectors[1], S.vectors[2]);
    if (!v || !v.success) return fail(v && (c(v.errorCode) || v.errorMsg) || c('err_axes_inconsistent'));
    S.matrix = v.matrix; S.result = v;
  }
  done(detail);
}

async function listenAxes() {
  S.phase = 'run'; render();
  $('cal-run-text').textContent = c('align_status_recording');
  await call('StartAxisAlign', true);
  const t0 = performance.now();
  S.poll = setInterval(async () => {
    const st = await call('GetAxisAlignStatus');
    if (!S.open || S.phase !== 'run' || !st) return;
    const refining = st.pairs >= st.minPairs;
    const bar = $('cal-bar'), cnt = $('cal-run-count'), txt = $('cal-run-text');
    if (bar) bar.style.setProperty('--p', Math.min(100, (st.pairs / Math.max(1, st.minPairs)) * 100) + '%');
    if (cnt) cnt.textContent = refining ? c('align_counter_refining') : `${st.pairs}/${st.minPairs}`;
    if (txt) txt.textContent = refining ? c('align_status_refining') : c('align_status_recording');
    if (st.known) { stopPoll(); done(c('align_success_desc', { mapping: (st.mapping || []).join(', ') })); }
    else if (performance.now() - t0 > AXES_TIMEOUT_MS) { stopPoll(); fail(c('align_fail_desc')); }
  }, 200);
}

function stopPoll() { clearInterval(S.poll); S.poll = 0; }
function done(text) { S.phase = 'done'; S.doneText = text; render(); }
function fail(text) { S.phase = 'fail'; S.failText = text; render(); }

// ── Mount correction ──────────────────────────────────────────────────────────

async function renderMount() {
  const box = $('cal-mount');
  if (!box) return;
  const m = await call('GetWizardMount');
  if (!m || !box.isConnected) return;
  const sign = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
  const text = c('mount_' + m.status, { tilt: m.tiltDeg.toFixed(1), fwd: sign(m.forwardDeg), right: sign(m.rightDeg), check: m.checkDeg.toFixed(1) });
  box.innerHTML = `<div class="pg-group__list app-cal-mount"><div class="pg-row"><div class="pg-row__label">${esc(c('mount_title'))}</div>
    ${m.status === 'ok' ? `<div class="pg-row__control"><label class="pg-toggle"><input type="checkbox" id="cal-mount-on"${m.enabled ? ' checked' : ''} aria-label="mount"><span class="pg-toggle__track"></span></label></div>` : ''}
    </div><div class="pg-row"><span class="pg-row__sub">${esc(text)}</span></div></div>`;
  const tg = $('cal-mount-on');
  if (tg) tg.onchange = () => call('SetWizardMountEnabled', tg.checked);
}

// ── Live verify tilt display ──────────────────────────────────────────────────

function live() {
  const tick = () => {
    const out = $('cal-live');
    if (!out || S.phase !== 'verify') return;
    const st = getState() || {};
    const f = (v) => (v >= 0 ? '+' : '') + (v || 0).toFixed(0) + '°';
    out.textContent = `PITCH ${f(st.pitch)} · ROLL ${f(st.roll)} · YAW ${f(st.yaw)}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── Start flow ────────────────────────────────────────────────────────────────

function startFlow(slot) {
  S.slot = slot;
  S.step = 0;
  S.vectors = [];
  S.matrix = null;
  S.result = null;
  S.phase = 'ready';
  S.selectedIcon = 'default';
  call('StartAxisAlign', true);
  render();
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function act(a, target) {
  if (a === 'close') return close();
  if (a === 'icon') {
    S.selectedIcon = target.dataset.icon || 'default';
    // Re-render only the icon grid, not the whole save screen.
    document.querySelectorAll('.app-cal-icon-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.icon === S.selectedIcon);
    });
    return;
  }
  if (a === 'capture') return capture();
  if (a === 'back') {
    clearInterval(S.timer); stopPoll();
    if (S.step > 0) { S.step--; S.phase = 'ready'; render(); }
    else close();
    return;
  }
  if (a === 'next') {
    if (S.step < STEPS.length - 1) { S.step++; S.phase = 'ready'; render(); return; }
    S.phase = 'verify';
    await call('PreviewMatrix', S.matrix);
    call('ResetAHRS');
    render();
    return;
  }
  if (a === 'recenter') return call('ResetAHRS');
  if (a === 'restart')  return startFlow(S.slot);
  if (a === 'tosave')   { S.phase = 'save'; render(); return; }
  if (a === 'toverify') { S.phase = 'verify'; render(); return; }
  if (a === 'save') {
    if (S.busy) return;
    S.busy = true;
    const name = ($('cal-name').value || '').trim() || c('slot_label', { n: S.slot + 1 });
    const res = await call('SaveProfile', S.slot, name, device(), S.selectedIcon, S.matrix);
    S.busy = false;
    if (res !== 'ok') { toast(res || 'error'); return; }
    await call('SetActiveProfile', S.slot);
    close();
    toast(c('profile_saved', { name }));
  }
}

// ── Disconnect watcher ────────────────────────────────────────────────────────

function watchDisconnect(st) {
  if (!S.open) return;
  // Don't block the save screen — user can save even if phone disconnected momentarily.
  const offline = st.status === 'offline' || st.status === 'paused';
  const shouldBlock = offline && S.phase !== 'save' && S.phase !== 'verify';
  if (shouldBlock !== S.disconnectShown) renderDisconnect(shouldBlock);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Opens the wizard: straight into capture for the best available slot. */
export function openCalibration(slot = null) {
  S.open = true;
  el().hidden = false;
  startFlow(slot !== null ? slot : smartSlot());
}

function close() {
  if (!S.open) return;
  if (S.phase === 'run') call('StopCapture', S.step);
  clearInterval(S.timer);
  stopPoll();
  gpRaf = 0;
  S.open = false;
  S.disconnectShown = false;
  el().hidden = true;
  call('ClearPreview');
}

export function startCalibration() {
  el().addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) act(b.dataset.act, b);
    else if (e.target === el()) close();
  });
  $('cal-x').onclick = close;
  addEventListener('keydown', (e) => {
    if (!S.open) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && S.phase === 'save') act('save');
    else if (e.code === 'Space' && S.phase === 'verify') { e.preventDefault(); call('ResetAHRS'); }
  });
  onState(watchDisconnect);
}
