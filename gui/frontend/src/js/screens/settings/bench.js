// Response graph (Settings, next to the Motion group): the raw sensor signal and the
// signal after the DSU filter, per axis, over a fixed time window. The band between
// the two traces is filled in a bright colour, so whatever the filter changes (tremor
// removed, deadband cut, sensitivity) is visible at a glance.
// Rule 0: frames arrive from Go only while the card is active; a draw is one rAF per
// frame batch, nothing runs when the screen is hidden or no device is connected.

import { $, toggleClass } from '../../core/dom.js';
import { on, off, call } from '../../core/bridge.js';
import { getState } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { chartsGloballyOff, onChartsFlag } from '../../core/charts-flag.js';

const WINDOW_MS = 3500;                 // what the graph shows, regardless of the device's rate
const MIN_SCALE = 4; // °/s: the smallest full scale (a still device stays a calm line)
const SCALE_EASE = 0.12; // share of the way per drawn frame (~0.4 s to settle): a new peak never snaps old data
const AXES = ['x', 'y', 'z'];

export function initBench(container, options = {}) {
  const none = { activate: () => {}, deactivate: () => {}, setParams: () => {}, setConnected: () => {} };
  if (!container) return none;

  const canvas = $('bench-oscilloscope-canvas');
  const offlineOverlay = $('bench-offline-overlay');
  const axisSeg = $('bench-axis-seg');
  const badge = $('bench-stability-badge');
  const noiseEl = $('bench-noise-val');
  const rateEl = $('bench-rate-val');
  const pingEl = $('bench-ping-val');

  let activeAxis = 'all';
  try { activeAxis = localStorage.getItem('pg-bench-axis') || 'all'; } catch (_) { /* default */ }
  let isActive = false;
  let isConnected = false;
  let drawQueued = false;
  let lastFrameTs = 0;
  let lastDomTs = 0;
  let speed = 0;
  let deadband = 0.10, deadbandUsb = 0.50, sensitivity = 1.0;

  // Samples: parallel arrays of time and raw/filtered values per axis.
  const T = [], RAW = { x: [], y: [], z: [] }, FILT = { x: [], y: [], z: [] };
  const shown = { x: 0, y: 0, z: 0 };                         // eased scale actually drawn (0 = not yet)
  let devRaw = 0, devFilt = 0, devN = 0; // running means of |value| (for the noise readout)

  // ── theme tokens (read once per theme/accent) ────────────────────────────
  let colorsKey = '', colors = null;
  function theme() {
    const r = document.documentElement;
    const key = (r.dataset.theme || '') + '|' + (r.dataset.accent || '');
    if (colors && key === colorsKey) return colors;
    const cs = getComputedStyle(canvas);
    const v = (n) => cs.getPropertyValue(n).trim();
    colorsKey = key;
    colors = { raw: v('--ink'), filt: v(document.documentElement.dataset.theme === 'light' ? '--viz-moss' : '--viz-leaf'), diff: v('--info'),
      line: v('--line-subtle'), zero: v('--line'), ink: v('--ink'), ink2: v('--ink-2'), chip: v('--tile-hi') };
    return colors;
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  function syncUI() {
    if (axisSeg) {
      axisSeg.querySelectorAll('.pg-seg__btn').forEach((b) => toggleClass(b, 'is-active', b.dataset.axis === activeAxis));
    }
  }
  if (axisSeg) {
    axisSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.pg-seg__btn');
      if (!b || !b.dataset.axis) return;
      activeAxis = b.dataset.axis;
      try { localStorage.setItem('pg-bench-axis', activeAxis); } catch (_) { /* session only */ }
      syncUI();
      queueDraw();
    });
  }

  function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }

  function updateDOM(hz) {
    setText(rateEl, `${Math.round(hz)} Hz`);
    let cls = 'pg-badge--ok', txt = t('ui.bench_status_still');
    if (speed >= 3.2) { cls = 'pg-badge--accent'; txt = t('ui.bench_status_active'); }
    else if (speed >= 0.12) { cls = 'pg-badge--info'; txt = t('ui.bench_status_aim'); }
    if (badge) { badge.className = `pg-badge ${cls} pg-badge--dot`; setText(badge, txt); }
    // Noise removed by the filter: only meaningful while (almost) still.
    let noise = '—';
    if (devN >= 30 && speed < 2.5 && devRaw / devN > 0.03) {
      const pct = Math.round(Math.max(0, Math.min(0.99, 1 - devFilt / devRaw)) * 100);
      noise = `${pct} %`;
    }
    setText(noiseEl, noise);
  }

  function updatePing(s) {
    if (!pingEl) return;
    if (s && s.inputMode === 'usb') setText(pingEl, 'USB');
    else if (s && s.pingMs >= 0) setText(pingEl, `${Math.round(s.pingMs)} ms`);
    else setText(pingEl, '—');
  }

  function showOffline() {
    setText(rateEl, '— Hz');
    setText(noiseEl, '—');
    setText(pingEl, '—');
    if (badge) { badge.className = 'pg-badge pg-badge--dot'; setText(badge, t('ui.bench_status_offline')); }
  }

  // ── data ─────────────────────────────────────────────────────────────────
  function handleFrame(f) {
    if (!isActive || !f) return;
    const now = performance.now();
    lastFrameTs = now;
    const r = [f.rawX ?? 0, f.rawY ?? 0, f.rawZ ?? 0];
    const o = [f.outX ?? 0, f.outY ?? 0, f.outZ ?? 0];
    if (!T.length) { // full width from the first frame, like the stats charts: a flat line at the current value
      T.push(now - WINDOW_MS);
      for (let k = 0; k < 3; k++) { RAW[AXES[k]].push(r[k]); FILT[AXES[k]].push(o[k]); }
    }
    T.push(now);
    for (let k = 0; k < 3; k++) { RAW[AXES[k]].push(r[k]); FILT[AXES[k]].push(o[k]); }
    // drop what left the window (by index, in one splice)
    let drop = 0;
    while (drop < T.length - 2 && now - T[drop] > WINDOW_MS) drop++;
    if (drop > 0) { T.splice(0, drop); for (const a of AXES) { RAW[a].splice(0, drop); FILT[a].splice(0, drop); } }
    const sel = activeAxis === 'y' ? 1 : activeAxis === 'z' ? 2 : 0;
    devRaw = devRaw * 0.98 + Math.abs(r[sel]); devFilt = devFilt * 0.98 + Math.abs(o[sel]); devN = Math.min(devN + 1, 50);
    speed = Math.hypot(o[0], o[1], o[2]);
    if (now - lastDomTs >= 100) { lastDomTs = now; updateDOM(f.hz ?? 60); }
    queueDraw();
  }

  function handleState(s) {
    if (!s) return;
    updatePing(s);
    if (s.status === 'offline') showOffline();
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  function queueDraw() {
    if (drawQueued || !isActive || !isConnected || chartsGloballyOff()) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; if (isActive && isConnected) draw(); });
  }

  // Full scale per axis follows the window's peak with some headroom; the drawn value eases toward it,
  // so the trace fills the track without ever snapping the old data.
  function fitScale(a) {
    let peak = 0;
    const R = RAW[a], F = FILT[a];
    for (let i = 0; i < R.length; i++) { const v = Math.max(Math.abs(R[i]), Math.abs(F[i])); if (v > peak) peak = v; }
    const s = Math.max(MIN_SCALE, peak / 0.85);
    shown[a] = shown[a] ? shown[a] + (s - shown[a]) * SCALE_EASE : s;
    return shown[a];
  }

  // Smooth curve through the points (Catmull-Rom → Bézier), in the given index order.
  function curve(ctx, xs, ys, from, to, move) {
    const st = from <= to ? 1 : -1;
    const at = (i) => Math.max(Math.min(from, to), Math.min(Math.max(from, to), i));
    if (move) ctx.moveTo(xs[from], ys[from]); else ctx.lineTo(xs[from], ys[from]);
    for (let i = from; i !== to; i += st) {
      const i0 = at(i - st), i2 = i + st, i3 = at(i + 2 * st);
      ctx.bezierCurveTo(xs[i] + (xs[i2] - xs[i0]) / 6, ys[i] + (ys[i2] - ys[i0]) / 6,
        xs[i2] - (xs[i3] - xs[i]) / 6, ys[i2] - (ys[i3] - ys[i]) / 6, xs[i2], ys[i2]);
    }
  }

  function headDot(ctx, x, y, color, r) {
    ctx.globalAlpha = 0.3; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function track(ctx, c, a, x0, y0, w, h, now, label) {
    const cy = y0 + h / 2;
    const R = RAW[a], F = FILT[a], n = T.length;
    ctx.strokeStyle = c.zero; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x0 + w, cy); ctx.stroke(); ctx.setLineDash([]);
    if (n >= 2) {
      const k = (h * 0.42) / fitScale(a);
      const xs = new Array(n), yr = new Array(n), yf = new Array(n);
      for (let i = 0; i < n; i++) { xs[i] = x0 + w - ((T[n - 1] - T[i]) / WINDOW_MS) * w; yr[i] = cy - R[i] * k; yf[i] = cy - F[i] * k; }
      // band between the traces (what the filter changed)
      ctx.beginPath();
      curve(ctx, xs, yr, 0, n - 1, true);
      curve(ctx, xs, yf, n - 1, 0, false);
      ctx.closePath(); ctx.globalAlpha = 0.45; ctx.fillStyle = c.diff; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // raw: thin with a faint glow
      ctx.beginPath(); curve(ctx, xs, yr, 0, n - 1, true);
      ctx.strokeStyle = c.raw; ctx.globalAlpha = 0.18; ctx.lineWidth = 4; ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.6; ctx.stroke();
      // filtered (what goes to DSU): the hero line, wide glow + crisp core
      ctx.beginPath(); curve(ctx, xs, yf, 0, n - 1, true);
      ctx.strokeStyle = c.filt; ctx.globalAlpha = 0.26; ctx.lineWidth = 6; ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 2.2; ctx.stroke();
      headDot(ctx, xs[n - 1] - 3, yr[n - 1], c.raw, 2);
      headDot(ctx, xs[n - 1] - 3, yf[n - 1], c.filt, 3);
      const cur = F[n - 1];
      ctx.font = '600 11px ui-monospace, Consolas, monospace'; ctx.fillStyle = c.filt; ctx.textAlign = 'right';
      ctx.fillText(`${cur >= 0 ? '+' : ''}${cur.toFixed(1)}°/s`, x0 + w - 6, y0 + 14); ctx.textAlign = 'left';
    }
    ctx.font = '700 10px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = c.chip; ctx.fillRect(x0 + 6, y0 + 4, tw, 16);
    ctx.fillStyle = c.ink; ctx.fillText(label, x0 + 11, y0 + 16);
  }

  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const c = theme(), now = performance.now();
    const labels = { x: 'Pitch · X', y: 'Yaw · Y', z: 'Roll · Z' };
    if (activeAxis === 'all') {
      const th = h / 3;
      AXES.forEach((a, i) => {
        if (i) { ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(0, i * th); ctx.lineTo(w, i * th); ctx.stroke(); }
        track(ctx, c, a, 0, i * th, w, th, now, labels[a]);
      });
    } else track(ctx, c, activeAxis, 0, 0, w, h, now, labels[activeAxis]);
  }

  // ── public ───────────────────────────────────────────────────────────────
  const apply = () => call('SetTuningFilterParams', deadband, deadbandUsb, sensitivity);

  function setParams(p) {
    if (p.deadband !== undefined) deadband = p.deadband;
    if (p.sensitivity !== undefined) sensitivity = p.sensitivity;
    if (p.deadbandUsb !== undefined) deadbandUsb = p.deadbandUsb;
    apply();
  }

  function setConnected(ok) {
    isConnected = !!ok;
    if (offlineOverlay) offlineOverlay.hidden = isConnected;
    if (!isConnected) {
      showOffline();
      const ctx = canvas && canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else queueDraw();
  }

  onChartsFlag((off) => { if (!off) queueDraw(); else if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); });

  async function activate() {
    if (isActive) return;
    isActive = true;
    syncUI();
    T.length = 0; for (const a of AXES) { RAW[a].length = 0; FILT[a].length = 0; }
    devRaw = devFilt = devN = 0; lastFrameTs = 0;
    for (const a of AXES) shown[a] = 0;
    const p = options.getInitialParams && options.getInitialParams();
    if (p) {
      if (p.deadband !== undefined) deadband = p.deadband;
      if (p.sensitivity !== undefined) sensitivity = p.sensitivity;
      if (p.deadbandUsb !== undefined) deadbandUsb = p.deadbandUsb;
    }
    call('SetTuningActive', true);
    apply();
    on('tuning:frame', handleFrame);
    on('state:change', handleState);
    handleState(getState());
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    drawQueued = false;
    call('SetTuningActive', false);
    off('tuning:frame', handleFrame);
    off('state:change', handleState);
  }

  return { activate, deactivate, setParams, setConnected };
}
