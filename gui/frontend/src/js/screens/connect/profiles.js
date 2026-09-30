// Control profiles card (design: ScreenUsb, right column): the active profile as
// a button that opens the list (switch, delete), the mount-tilt toggle for USB
// profiles, the stored axes, and Calibrate. Rendered only when the profiles or
// the active slot change, not on every state tick.

import { $, setText, setHTML, show, esc } from '../../core/dom.js';
import { call } from '../../core/bridge.js';
import { t, getLang, onLang } from '../../core/i18n.js';
import { onState, getState } from '../../core/state.js';
import { openModal } from '../../ui/modal.js';
import { toast } from '../../ui/toast.js';

const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
let lastKey = '';
let menuOpen = false;

const slotName = (i) => `${t('calibration.slot_prefix')} ${i + 1}`;
const devText = (p) => t('calibration.device_label', { device: p.device || t('calibration.device_unknown') });

// When a profile was calibrated: short date for the line, full date and app version for the tooltip.
function calDate(p) {
  if (!p || !p.calibratedAt) return null;
  const d = new Date(p.calibratedAt * 1000);
  const loc = getLang() === 'en' ? 'en-GB' : 'ru-RU';
  const opts = d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  const when = d.toLocaleString(loc, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const full = t('calibration.calibrated_on_full', { date: when }) + (p.calibratedWith ? ' · ' + t('calibration.calibrated_with', { version: p.calibratedWith }) : '');
  return { short: d.toLocaleDateString(loc, opts), full };
}

// A signed-permutation matrix row by row: which raw axis, which sign.
function axisLabels(m) {
  return [0, 1, 2].map((r) => {
    for (let c = 0; c < 3; c++) {
      if (m[r][c] > 0.5) return '+' + 'XYZ'[c];
      if (m[r][c] < -0.5) return '−' + 'XYZ'[c];
    }
    return '?';
  });
}

function render(st) {
  const profiles = st.profiles || [];
  const slot = st.activeSlot;
  const active = slot >= 0 ? profiles[slot] : null;
  const has = !!(active && active.name);

  show($('prof-slot'), has);
  if (has) setText($('prof-slot'), t('ui.slot_active', { n: slot + 1 }));
  setText($('prof-name'), has ? active.name : t('ui.no_profile'));
  const cal = has ? calDate(active) : null;
  setText($('prof-sub'), has ? devText(active) + (cal ? ' · ' + cal.short : '') : t('ui.no_profiles'));
  $('prof-current').dataset.tip = cal ? cal.full : '';
  show($('prof-outdated'), has && active.outdated);
  show($('prof-warn'), has && active.outdated);
  show($('prof-slotbadge'), has);
  if (has) setText($('prof-slotbadge'), slotName(slot).toUpperCase());

  // Mount-tilt correction exists only for USB profiles that measured it.
  const mount = has && active.mount && active.mount.status === 'ok' ? active.mount : null;
  show($('prof-mount'), !!mount);
  if (mount) {
    setText($('prof-mount-text'), t('calibration.mount_profile_toggle', { tilt: Number(mount.tiltDeg || 0).toFixed(1) }));
    $('prof-mount-toggle').checked = !!mount.enabled;
  }

  const m = (st.activeMatrix && st.activeMatrix.length === 3) ? st.activeMatrix : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [p, y, r] = axisLabels(m);
  let acc = t('calibration.accel_axes_unset');
  if (has && active.sensorFrame && active.sensorFrame.q) {
    const [ap, ay, ar] = axisLabels(active.sensorFrame.q);
    acc = `Pitch ${ap} · Yaw ${ay} · Roll ${ar}`;
  }
  setHTML($('prof-axes'), `<b>${esc(t('calibration.axes_label'))}:</b> Pitch ${p} · Yaw ${y} · Roll ${r}<br><b>${esc(t('calibration.accel_axes_label'))}:</b> ${esc(acc)}`);

  // The list: only slots that hold a profile.
  const items = profiles.map((pr, i) => {
    if (!pr || !pr.name) return '';
    const c = calDate(pr);
    return `<div class="app-menu__item${i === slot ? ' is-active' : ''}" role="option" data-slot="${i}"${c ? ` data-tip="${esc(c.full)}"` : ''}>
      <span class="app-grow"><span class="pg-profile__t">${esc(pr.name)}</span><span class="pg-profile__s">${esc(slotName(i))} · ${esc(devText(pr))}${c ? ' · ' + esc(c.short) : ''}</span></span>
      ${pr.outdated ? `<span class="pg-badge pg-badge--danger">${esc(t('calibration.outdated_badge'))}</span>` : ''}
      <button class="pg-btn-icon" type="button" data-del="${i}" data-tip="${esc(t('calibration.delete_profile_tip'))}">${X}</button></div>`;
  }).join('');
  setHTML($('prof-menu'), items || `<div class="app-menu__empty">${esc(t('ui.no_profiles'))}</div>`);
}

function setMenu(open) {
  menuOpen = open;
  show($('prof-menu'), open);
  $('prof-current').setAttribute('aria-expanded', String(open));
}

async function select(slot) {
  setMenu(false);
  const st = getState();
  if (!st || slot === st.activeSlot) return;
  if ((await call('SetActiveProfile', slot)) === 'ok') {
    toast(`${t('calibration.profile_switched')}: ${st.profiles[slot].name}`);
  }
}

async function remove(slot) {
  setMenu(false);
  const p = getState().profiles[slot];
  await openModal({
    title: t('calibration.delete_profile_title', { name: p.name }),
    text: t('calibration.delete_profile_desc'),
    actions: [
      { label: t('calibration.delete_profile_cancel') },
      { label: t('calibration.delete_profile_confirm'), kind: 'danger', onClick: async () => {
        if ((await call('DeleteProfile', slot)) === 'ok') toast(t('calibration.profile_deleted', { name: p.name }));
      } },
    ],
  });
}

export function startProfiles() {
  $('prof-current').onclick = (e) => { e.stopPropagation(); setMenu(!menuOpen); };
  $('prof-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    const del = e.target.closest('[data-del]');
    if (del) return remove(+del.dataset.del);
    const item = e.target.closest('[data-slot]');
    if (item) select(+item.dataset.slot);
  });
  document.addEventListener('click', () => { if (menuOpen) setMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) setMenu(false); });

  $('prof-mount-toggle').onchange = async (e) => {
    const want = e.target.checked;
    const res = await call('SetProfileMountEnabled', getState().activeSlot, want);
    if (res !== 'ok') e.target.checked = !want;
  };
  $('btn-calibrate').onclick = () => openModal({ title: t('ui.calibrate'), text: t('ui.calib_soon'), actions: [{ label: t('ui.close'), kind: 'primary' }] });

  onState((st) => {
    const key = JSON.stringify([st.profiles, st.activeSlot, st.activeMatrix]);
    if (key === lastKey) return;
    lastKey = key;
    render(st);
  });
  onLang(() => { lastKey = ''; $('prof-menu')._html = null; if (getState()) render(getState()); });
}
