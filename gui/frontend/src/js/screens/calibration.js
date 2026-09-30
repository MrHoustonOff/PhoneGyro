// Calibration wizard (design: Modal with the stepper). The Go side does the
// maths (gui/internal/app/calibration.go); this walks the user through it:
//   slot → rest (1.6 s) → pitch (2.4 s) → roll (2.4 s) → axes (listen ≤ 20 s)
//        → verify (the new matrix is previewed live) → name → save.
// Everything lives in one pg-modal; each phase re-renders its body.

import { $, esc, md } from '../core/dom.js';
import { call } from '../core/bridge.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/state.js';
import { toast } from '../ui/toast.js';

const STEPS = [
  { key: 'rest', pill: 'step_pill_rest', ms: 1600, rest: true },
  { key: 'pitch', pill: 'step_pill_pitch', ms: 2400 },
  { key: 'roll', pill: 'step_pill_roll', ms: 2400 },
  { key: 'axes', pill: 'step_pill_align', axes: true },
];
const AXES_TIMEOUT_MS = 20000;

const S = {
  open: false, slot: 0, step: 0, phase: 'slots', // slots | ready | run | done | fail | verify | save
  vectors: [], matrix: null, result: null, timer: 0, poll: 0, busy: false,
};

const c = (k, vars) => t('calibration.' + k, vars);
const el = () => $('cal');
const body = () => $('cal-body');
const foot = () => $('cal-foot');

function device() {
  const st = getState() || {};
  if (st.deviceName && st.deviceName !== 'Controller' && st.deviceName !== 'Unknown') return st.deviceName;
  return st.inputMode === 'usb' ? (st.deviceName || '') : (st.deviceName || 'iPhone');
}

function stepper() {
  const pills = [...STEPS.map((s) => s.pill), 'step_pill_confirm'];
  const at = S.phase === 'verify' || S.phase === 'save' ? 4 : S.step;
  return '<div class="pg-stepper app-cal-stepper pg-scroll--x">' + pills.map((p, i) =>
    (i ? `<span class="pg-step__link${i <= at ? ' is-done' : ''}"></span>` : '')
    + `<span class="pg-step${i === at ? ' is-active' : i < at ? ' is-done' : ''}"><span class="pg-step__num">${i + 1}</span>${esc(c(p))}</span>`).join('') + '</div>';
}

const btn = (id, label, kind = '', dis = false) => `<button type="button" class="pg-btn${kind ? ' pg-btn--' + kind : ''}" data-act="${id}"${dis ? ' disabled' : ''}>${esc(label)}</button>`;

function render() {
  const st = getState() || {};
  $('cal-sub').textContent = device() ? c('subtitle_device', { device: device() }) : c('subtitle');
  $('cal-offline').hidden = st.status === 'online' || st.status === 'paused' || S.phase === 'slots' || S.phase === 'save';

  if (S.phase === 'slots') {
    const profiles = st.profiles || [];
    body().innerHTML = `<div class="app-cal-slots">${[0, 1, 2, 3, 4, 5].map((i) => {
      const p = profiles[i];
      const has = p && p.name;
      return `<div class="app-cal-slot${i === st.activeSlot ? ' is-active' : ''}">
        <span class="app-grow"><span class="pg-profile__t">${esc(has ? p.name : c('slot_empty'))}</span><span class="pg-profile__s">${esc(c('slot_label', { n: i + 1 }))}${has && p.device ? ' · ' + esc(p.device) : ''}</span></span>
        <button type="button" class="pg-btn pg-btn--sm${has ? '' : ' pg-btn--primary'}" data-act="slot" data-slot="${i}">${esc(has ? c('btn_recalibrate') : c('btn_calibrate_short'))}</button></div>`;
    }).join('')}</div>`;
    foot().innerHTML = '<span></span>' + btn('close', c('btn_cancel'));
    return;
  }

  if (S.phase === 'verify') {
    const r = S.result || {};
    body().innerHTML = stepper() + `<div class="app-cal-main">
      <div class="display-md">${esc(c('confirm_title'))}</div>
      <p class="app-cal-desc">${esc(t('ui.cal_verify_hint'))}</p>
      <div class="pg-notice pg-notice--ok"><span>${md(c('res_all_done', { p: r.pitchAxis || '?', y: r.yawAxis || '?', r: r.rollAxis || '?' }))}</span></div>
      <div id="cal-mount"></div>
      <div class="app-cal-live"><span class="pg-dial__label" id="cal-live"></span></div>
    </div>`;
    foot().innerHTML = btn('restart', c('confirm_restart')) + btn('recenter', c('confirm_recenter').replace(/\s*\(.*\)$/, '')) + btn('tosave', c('confirm_yes'), 'primary');
    renderMount();
    live();
    return;
  }

  if (S.phase === 'save') {
    const profiles = st.profiles || [];
    const old = profiles[S.slot];
    body().innerHTML = `<div class="app-cal-main">
      <label class="app-cal-label" for="cal-name">${esc(c('save_name_title'))}</label>
      <input class="pg-input app-cal-name" id="cal-name" maxlength="40" placeholder="${esc(c('save_name_placeholder'))}" value="${esc(old && old.name ? old.name : c('slot_label', { n: S.slot + 1 }))}">
      ${old && old.name ? `<div class="pg-notice pg-notice--warn"><span>${esc(c('save_overwrite_warn', { slot: S.slot + 1, name: old.name }))}</span></div>` : ''}
    </div>`;
    foot().innerHTML = btn('toverify', c('btn_back')) + btn('save', c('btn_save'), 'primary');
    setTimeout(() => { const i = $('cal-name'); if (i) { i.focus(); i.select(); } }, 30);
    return;
  }

  // Capture steps.
  const cfg = STEPS[S.step];
  const n = S.step;
  let status = '', icon = '';
  if (S.phase === 'done') { icon = 'ok'; status = S.doneText; }
  if (S.phase === 'fail') { icon = 'fail'; status = S.failText; }
  body().innerHTML = stepper() + `<div class="app-cal-main">
    <div class="display-md">${md(c(`step${n}_title`).replace(/^[^:]*:\s*/, ''))}</div>
    <p class="app-cal-desc">${md(c(`step${n}_desc`))}</p>
    <div class="pg-notice app-cal-caption"><span>${esc(c(`step${n}_caption`))}</span></div>
    ${S.phase === 'run' ? `<div class="app-cal-run"><div class="app-cal-runrow"><b id="cal-run-text"></b><span class="pg-badge" id="cal-run-count"></span></div><div class="pg-progress"><i id="cal-bar"></i></div></div>` : ''}
    ${icon ? `<div class="pg-notice pg-notice--${icon === 'ok' ? 'ok' : 'danger'}"><span><b>${esc(icon === 'ok' ? (cfg.axes ? c('align_success_title') : c('capture_success_title')) : (cfg.axes ? c('align_fail_title') : c('capture_fail_title')))}</b><span class="pg-notice__sub">${md(status || '')}</span></span></div>` : ''}
  </div>`;
  const back = btn('back', c('btn_back'), '', S.phase === 'run');
  if (S.phase === 'ready') foot().innerHTML = back + btn('capture', c(`step${n}_btn`), 'primary');
  else if (S.phase === 'run') foot().innerHTML = back + btn('wait', cfg.axes ? c('align_recording_btn') : cfg.rest ? c('btn_recording_rest') : c('btn_recording'), 'primary', true);
  else if (S.phase === 'done') foot().innerHTML = back + '<span class="app-grow"></span>' + btn('capture', cfg.axes ? c('btn_recalibrate_align') : c('btn_retry')) + btn('next', n === STEPS.length - 1 || (n === 2 && S.result) ? c('btn_to_confirm') : c('btn_next_step'), 'primary');
  else foot().innerHTML = back + btn('capture', c('btn_retry'), 'primary');
  if (n === 2 && S.phase === 'done') foot().querySelector('[data-act=next]').textContent = c('btn_next_step');
}

// A gesture step: 2..1 countdown, then Go records for the step's duration.
async function capture() {
  const cfg = STEPS[S.step];
  if (cfg.axes) return listenAxes();
  S.phase = 'run';
  render();
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
  if (S.step === 0) {
    S.vectors[0] = [0, 0, 0];
    return done('');
  }
  S.vectors[S.step] = res.vector;
  const detail = c('res_gesture', { axis: res.axisName, pct: Math.round((res.confidence || 0) * 100), spd: Math.round(res.peakSpeed || 0) });
  if (S.step === 2) {
    const v = await call('ValidateCalibration', S.vectors[1], S.vectors[2]);
    if (!v || !v.success) return fail(v && (c(v.errorCode) || v.errorMsg) || c('err_axes_inconsistent'));
    S.matrix = v.matrix;
    S.result = v;
  }
  done(detail);
}

// Axes: the aligner learns from free movement; poll until it locks.
async function listenAxes() {
  S.phase = 'run';
  render();
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

async function renderMount() {
  const box = $('cal-mount');
  if (!box) return;
  const m = await call('GetWizardMount');
  if (!m || !box.isConnected) return;
  const sign = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
  const text = c('mount_' + m.status, { tilt: m.tiltDeg.toFixed(1), fwd: sign(m.forwardDeg), right: sign(m.rightDeg), check: m.checkDeg.toFixed(1) });
  box.innerHTML = `<div class="pg-group__list app-cal-mount"><div class="pg-row"><div class="pg-row__label">${esc(c('mount_title'))}</div>
    ${m.status === 'ok' ? `<div class="pg-row__control"><label class="pg-toggle"><input type="checkbox" id="cal-mount-on"${m.enabled ? ' checked' : ''} aria-label="mount"><span class="pg-toggle__track"></span></label></div>` : ''}</div>
    <div class="pg-row"><span class="pg-row__sub">${esc(text)}</span></div></div>`;
  const tg = $('cal-mount-on');
  if (tg) tg.onchange = () => call('SetWizardMountEnabled', tg.checked);
}

// Verify: the tilt the new matrix produces, live, so the user sees it follows.
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

function startFlow(slot) {
  S.slot = slot;
  S.step = 0;
  S.vectors = [];
  S.matrix = null;
  S.result = null;
  S.phase = 'ready';
  call('StartAxisAlign', true); // recalibrating never reuses an old axis mapping
  render();
}

async function act(a, target) {
  if (a === 'close') return close();
  if (a === 'slot') return startFlow(+target.dataset.slot);
  if (a === 'capture') return capture();
  if (a === 'back') {
    clearInterval(S.timer); stopPoll();
    if (S.step > 0) { S.step--; S.phase = 'ready'; render(); } else { S.phase = 'slots'; render(); }
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
  if (a === 'restart') return startFlow(S.slot);
  if (a === 'tosave') { S.phase = 'save'; render(); return; }
  if (a === 'toverify') { S.phase = 'verify'; render(); return; }
  if (a === 'save') {
    if (S.busy) return;
    S.busy = true;
    const name = ($('cal-name').value || '').trim() || c('slot_label', { n: S.slot + 1 });
    const res = await call('SaveProfile', S.slot, name, device(), 'default', S.matrix);
    S.busy = false;
    if (res !== 'ok') { toast(res || 'error'); return; }
    await call('SetActiveProfile', S.slot);
    close();
    toast(c('profile_saved', { name }));
  }
}

/** Opens the wizard: on the slot list, or straight into a slot. */
export function openCalibration(slot = null) {
  S.open = true;
  el().hidden = false;
  if (slot === null) { S.phase = 'slots'; render(); } else startFlow(slot);
}

function close() {
  if (!S.open) return;
  if (S.phase === 'run') call('StopCapture', S.step);
  clearInterval(S.timer);
  stopPoll();
  S.open = false;
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
}
