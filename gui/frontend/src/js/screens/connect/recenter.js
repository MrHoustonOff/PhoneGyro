// Centering (as in the legacy app, in the design's modal sheet): hold the device
// still for a second, and that pose becomes the zero of the shown angles (Go:
// ResetAHRS). Moving during the second fails it ("Retry").
// Reconnecting a known device (a profile was calibrated on it): the same sheet
// opens forced, with the profile picker, once per device per launch; an unknown
// device gets the calibration hint instead (cal-hints.js). The only way out is a
// finished centering (or the device going away). A tray round trip reloads the page, so "once" lives in
// sessionStorage.

import { $, esc } from '../../core/dom.js';
import { call } from '../../core/bridge.js';
import { t } from '../../core/i18n.js';
import { onState, getState } from '../../core/state.js';
import { playSound } from '../../core/sound.js';
import { profileIconSvg } from '../../ui/profile-icons.js';
import { getCurrentScreen } from '../../shell/router.js';
import { toast } from '../../ui/toast.js';
import { hasProfileFor } from './cal-hints.js';

const HOLD_MS = 1000;
const GRACE_MS = 100;
const STILL_DPS = 2.6; // gyro speed above this during the second = moved
const TICK_MS = 50;    // the check runs only while measuring

let sheet = null;      // { overlay, forced, timer, measuring, pickerSig }

const doneKey = (key) => 'pg-centered-' + key;
function isDone(key) { try { return sessionStorage.getItem(doneKey(key)) === '1'; } catch (e) { return false; } }
function markDone(key) { try { sessionStorage.setItem(doneKey(key), '1'); } catch (e) { /* asks again after a reload */ } }

const modeOf = (st) => (st && st.inputMode) || 'phone';
const deviceOf = (st) => ((st && st.deviceName) || '').trim();
const keyOf = (st) => modeOf(st) + ':' + deviceOf(st).toLowerCase();
const r = (k, v) => t('recenter.' + k, v);

function activeProfile(st) {
  const p = st && st.activeSlot >= 0 ? (st.profiles || [])[st.activeSlot] : null;
  return p && p.name ? p : null;
}

function pickerHTML(st) {
  const profs = (st && st.profiles) || [];
  const named = profs.map((p, i) => ({ p, i })).filter(({ p }) => p && p.name);
  const rows = named.map(({ p, i }) => `<button type="button" class="app-menu__item${i === st.activeSlot ? ' is-active' : ''}" data-slot="${i}">
      <span class="app-menu__icon">${profileIconSvg(p.icon || 'default')}</span>
      <span class="app-grow"><span class="pg-profile__t">${esc(p.name)}</span><span class="pg-profile__s">${esc(t('calibration.slot_prefix'))} ${i + 1} · ${esc(p.device || '')}</span></span>
    </button>`).join('');
  return `<div class="pg-overline app-rc__label">${esc(r('forced_pick_label'))}</div>`
    + (rows ? `<div class="app-rc__list">${rows}</div>` : `<div class="pg-notice pg-notice--warn"><span>${esc(r('forced_no_profiles'))}</span></div>`);
}

function profileHTML(st) {
  const p = activeProfile(st);
  const slot = st && st.activeSlot >= 0 ? st.activeSlot : 0;
  const sub = p ? `${t('calibration.slot_prefix')} ${slot + 1} · ${p.device || t('calibration.device_unknown')}` : t('ui.no_profiles');
  return `<div class="pg-overline app-rc__label">${esc(r('active_profile_label'))}</div>
    <div class="pg-profile"><span class="app-menu__icon">${profileIconSvg((p && p.icon) || 'default')}</span>
      <span class="app-grow"><span class="pg-profile__t">${esc(p ? p.name : t('ui.no_profile'))}</span><span class="pg-profile__s">${esc(sub)}</span></span></div>`;
}

function prompt(st, forced) {
  return forced ? r('forced_prompt') : r('modal_hold_prompt');
}

function render() {
  if (!sheet) return;
  const st = getState();
  const top = sheet.overlay.querySelector('[data-rc="top"]');
  const sig = sheet.forced ? JSON.stringify([st && st.activeSlot, ((st && st.profiles) || []).map((p) => p && [p.name, p.icon, p.device])]) : 'plain';
  if (sig !== sheet.pickerSig) {
    sheet.pickerSig = sig;
    top.innerHTML = sheet.forced ? pickerHTML(st) : profileHTML(st);
  }
  sheet.overlay.querySelector('[data-rc="prompt"]').textContent = prompt(st, sheet.forced);
}

function setButton(state) { // 'ready' | 'holding' | 'retry' | 'done'
  const btn = sheet.overlay.querySelector('[data-rc="go"]');
  btn.disabled = state === 'holding' || state === 'done';
  btn.classList.toggle('is-holding', state === 'holding');
  btn.querySelector('span').textContent = r({ ready: 'btn_action', holding: 'btn_action_holding', retry: 'btn_retry', done: 'status_success' }[state]);
  if (state !== 'holding') btn.style.setProperty('--p', state === 'done' ? '100%' : '0%');
}

function stopTimer() {
  if (sheet && sheet.timer) { clearInterval(sheet.timer); sheet.timer = 0; }
}

function measure() {
  if (!sheet || sheet.measuring) return;
  sheet.measuring = true;
  sheet.overlay.querySelector('[data-rc="moved"]').hidden = true;
  setButton('holding');
  const t0 = performance.now();
  const btn = sheet.overlay.querySelector('[data-rc="go"]');
  sheet.timer = setInterval(() => {
    if (!sheet) return;
    const el = performance.now() - t0;
    btn.style.setProperty('--p', Math.min(100, (el / HOLD_MS) * 100).toFixed(1) + '%');
    const st = getState() || {};
    const speed = Math.hypot(st.rawRotX || 0, st.rawRotY || 0, st.rawRotZ || 0);
    if (el > GRACE_MS && speed > STILL_DPS) return fail();
    if (el >= HOLD_MS) succeed();
  }, TICK_MS);
}

function fail() {
  stopTimer();
  sheet.measuring = false;
  setButton('retry');
  sheet.overlay.querySelector('[data-rc="moved"]').hidden = false;
  playSound('defeat');
}

async function succeed() {
  stopTimer();
  sheet.measuring = false;
  setButton('done');
  await call('ResetAHRS');
  playSound('recenter');
  markDone(keyOf(getState()));
  setTimeout(() => {
    closeRecenter(true);
    toast(r('toast_done'));
  }, 450);
}

/** Opens the sheet; forced: the first-connection variant (picker, no way out). */
export function openRecenter({ forced = false } = {}) {
  if (sheet) return;
  if (forced && (getState()?.noPopups || window.__pgNoPopups)) return;
  const overlay = document.createElement('div');
  overlay.className = 'pg-overlay app-overlay';
  const headHTML = forced
    ? `<div class="pg-modal__head"><div>
      <div class="pg-modal__title">${esc(r('forced_title'))}</div>
      <div class="pg-modal__sub">${esc(r('forced_subtitle'))}</div>
    </div></div>`
    : '';
  const cancelLabel = forced ? r('btn_later') : r('btn_cancel');

  overlay.innerHTML = `<div class="pg-modal pg-rings-corner app-modal-dialog app-rc${forced ? '' : ' app-rc--headless'}" role="dialog" aria-modal="true">
    ${headHTML}
    <div class="pg-modal__body app-rc__body">
      <div data-rc="top"></div>
      <p class="app-rc__prompt" data-rc="prompt"></p>
      <div class="pg-notice pg-notice--danger" data-rc="moved" hidden><span>${esc(r('status_moved'))}</span></div>
      <div class="pg-notice pg-notice--plain app-rc__note"><span><b>${esc(r('game_disclaimer_title'))}</b><span class="pg-notice__sub">${esc(r('game_disclaimer_desc'))}</span></span></div>
    </div>
    <div class="pg-modal__foot app-rc__foot">
      <button type="button" class="pg-btn pg-btn--danger app-rc__cancel" data-rc="cancel">${esc(cancelLabel)}</button>
      <button type="button" class="pg-btn app-rc__go" data-rc="go"><span></span></button>
    </div>
  </div>`;
  sheet = { overlay, forced, timer: 0, measuring: false, pickerSig: '' };
  overlay.addEventListener('click', async (e) => {
    if (!sheet) return;
    const slot = e.target.closest('[data-slot]');
    if (slot && !sheet.measuring) { await call('SetActiveProfile', +slot.dataset.slot); return; }
    if (e.target.closest('[data-rc="go"]')) return measure();
    if (e.target.closest('[data-rc="cancel"]')) {
      if (sheet.forced) markDone(keyOf(getState()));
      closeRecenter(true);
      return;
    }
    if (e.target === overlay && !sheet.forced) closeRecenter();
  });
  addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  render();
  setButton('ready');
  overlay.querySelector('[data-rc="go"]').focus({ preventScroll: true });
}

function onKey(e) {
  if (e.key === 'Escape' && sheet && !sheet.forced) { e.preventDefault(); closeRecenter(); }
}

/** Closes the sheet; the user's ways out do nothing while it is forced (force: finished or device gone). */
export function closeRecenter(force = false) {
  if (!sheet || (sheet.forced && !force)) return;
  stopTimer();
  removeEventListener('keydown', onKey, true);
  sheet.overlay.remove();
  sheet = null;
}

// First connection: real sensor data (hz > 0, e.g. after the iOS permission),
// nothing else on screen, not done yet for this mode in this launch.
function gate(st) {
  if (st?.noPopups || window.__pgNoPopups) return;
  const online = st && st.status && st.status !== 'offline';
  if (sheet) {
    if (sheet.forced && !online) closeRecenter(true); // device gone: ask again when it returns
    else render();
    return;
  }
  if (!online || !(st.hz > 0) || isDone(keyOf(st))) return;
  // «Нам знакомо это устройство» — только если на нём есть профиль. Незнакомое
  // помечаем сразу, чтобы окно не всплыло, когда его откалибруют в этом запуске.
  if (!deviceOf(st) || !hasProfileFor(st, deviceOf(st))) { markDone(keyOf(st)); return; }
  if (getCurrentScreen() !== 'connect' || document.querySelector('.pg-overlay')) return;
  openRecenter({ forced: true });
}

export function startRecenter() {
  $('btn-recenter').onclick = () => openRecenter();
  onState(gate);
}
