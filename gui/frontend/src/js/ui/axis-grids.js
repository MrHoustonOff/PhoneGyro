// The two axis grids (gyroscope, accelerometer): rows are the game axes (P, Y, R),
// columns are the sensor's X, Y, Z; the lit cell is the sensor axis (and sign) that
// feeds that game axis. Shared by the calibration check and the profile card.

import { esc } from '../core/dom.js';
import { t } from '../core/i18n.js';

const GAME_AXES = [['x', 'P'], ['y', 'Y'], ['z', 'R']]; // Pitch, Yaw, Roll: colour key + letter

/** From a 3x3 matrix (one signed sensor axis per row). */
export function matrixRows(m) {
  return (m || []).slice(0, 3).map((row) => {
    let col = -1; let sign = 1;
    (row || []).forEach((v, k) => { if (col < 0 && Math.abs(v) > 0.5) { col = k; sign = v > 0 ? 1 : -1; } });
    return { col, sign };
  });
}

/** From the aligner's ['+Y', '+Z', '+X']. */
export function mappingRows(map) {
  return (map || []).slice(0, 3).map((e) => {
    const mt = String(e || '').match(/([+-])?\s*([XYZ])/i);
    return mt ? { col: 'XYZ'.indexOf(mt[2].toUpperCase()), sign: mt[1] === '-' ? -1 : 1 } : { col: -1, sign: 1 };
  });
}

function gridHTML(rows) {
  const head = 'XYZ'.split('').map((l, k) => `<span class="pg-axis__key pg-axis__key--${'xyz'[k]}">${l}</span>`).join('');
  const body = rows.map((r, i) => `<span class="pg-axis__key pg-axis__key--${GAME_AXES[i][0]}">${GAME_AXES[i][1]}</span>`
    + [0, 1, 2].map((k) => (r.col === k ? `<span class="app-cal-mcell is-on">${r.sign > 0 ? '+' : '−'}1</span>` : '<span class="app-cal-mcell">·</span>')).join('')).join('');
  return `<div class="app-cal-mgrid"><span></span>${head}${body}</div>`;
}

/**
 * Two cards side by side. gyro / accel: rows from matrixRows or mappingRows
 * (accel may be null: "not determined"). det: optional badge on the gyro card.
 */
export function axisCardsHTML({ gyro, accel, det = null, detOk = true, note = '' }) {
  const badge = det == null ? '' : `<span class="pg-badge ${detOk ? 'pg-badge--ok' : 'pg-badge--danger'}">det ${det >= 0 ? '+' : '−'}${Math.abs(det || 1).toFixed(0)}</span>`;
  return `<div class="app-cal-mcards">
    <div class="app-cal-mcard">
      <div class="app-cal-mcard__t"><span>${esc(t('ui.cal_gyro_title'))}</span>${badge}</div>
      ${gridHTML(gyro)}
    </div>
    <div class="app-cal-mcard">
      <div class="app-cal-mcard__t"><span>${esc(t('calibration.accel_axes_label'))}</span></div>
      ${accel && accel.length ? gridHTML(accel) : `<span class="app-cal-mnote">${esc(t('calibration.accel_axes_unset'))}</span>`}
    </div>
  </div>${note ? `<p class="app-cal-mnote">${esc(note)}</p>` : ''}`;
}
