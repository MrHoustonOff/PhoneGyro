// Live charts of the stats page, in the spirit of LEGACY Live Debug: smooth curves (Catmull-Rom),
// a soft glow under the line, a glowing head dot, the full width from the first sample.
// One SVG drawer for single-line sparks and three-axis X/Y/Z charts. No rAF loop: the caller pushes
// values from its timer while the page is open; between pushes the picture glides left by one step
// (Web Animations on transform, compositor only), so the chart moves instead of jumping.
// The Y range eases toward its target, so a new peak never snaps the already drawn data.

import { t } from '../../core/i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 100, H = 40, PAD = 4;
const EASE = 0.18; // share of the way to the target range per push
let gradSeq = 0;

function el(tag, cls, parent) {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute('class', cls);
  if (parent) parent.appendChild(e);
  return e;
}

// 1-2-5 "nice" ceiling: 0.37 → 0.5, 13 → 20.
function nice(v) {
  if (!(v > 0)) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// Smooth path through points (Catmull-Rom → cubic Bézier), like LEGACY drawAppleChart.
function curve(xs, ys) {
  const n = ys.length;
  let d = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const i0 = i ? i - 1 : 0, i3 = i + 2 < n ? i + 2 : i + 1;
    const c1x = xs[i] + (xs[i + 1] - xs[i0]) / 6, c1y = ys[i] + (ys[i + 1] - ys[i0]) / 6;
    const c2x = xs[i + 1] - (xs[i3] - xs[i]) / 6, c2y = ys[i + 1] - (ys[i3] - ys[i]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${xs[i + 1].toFixed(2)} ${ys[i + 1].toFixed(2)}`;
  }
  return d;
}

// Shared frame: a still grid, a gliding layer for the data, a "no data" label.
function frame(host) {
  host.textContent = '';
  const grid = el('svg', 'app-chart__svg', host);
  grid.setAttribute('viewBox', `0 0 ${W} ${H}`);
  grid.setAttribute('preserveAspectRatio', 'none');
  for (const y of [H * 0.25, H * 0.5, H * 0.75]) el('path', 'app-chart__grid', grid).setAttribute('d', `M 0 ${y} L ${W} ${y}`);
  const svg = el('svg', 'app-chart__svg app-chart__glide', host);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const empty = document.createElement('span');
  empty.className = 'app-chart__empty';
  empty.dataset.i18n = 'ui.stats_no_data';
  empty.textContent = t('ui.stats_no_data');
  host.appendChild(empty);
  host.classList.add('is-empty');
  return svg;
}

function dot(host, cls) {
  const d = document.createElement('i');
  d.className = `app-chart__dot ${cls || ''}`;
  host.appendChild(d);
  return d;
}

// X positions of n samples: the oldest one step left of the edge, so the glide never shows a gap.
function xsFor(n) {
  const step = W / (n - 2);
  const xs = new Array(n);
  for (let i = 0; i < n; i++) xs[i] = -step + i * step;
  return xs;
}

function glide(svg, n, ms) {
  if (!svg.animate || !(ms > 0)) return;
  const pct = 100 / (n - 2);
  svg.getAnimations().forEach((a) => a.cancel());
  svg.animate([{ transform: `translateX(${pct}%)` }, { transform: 'translateX(0)' }], { duration: ms, easing: 'linear' });
}

/**
 * Single metric. opts: { n, area, mode: 'zero' (0..peak) | 'level' (around the value), minSpan, interval }
 */
export function createSpark(host, opts = {}) {
  if (!host) return { push() {}, clear() {} };
  const n = opts.n || 40, mode = opts.mode || 'zero', minSpan = opts.minSpan || 1, interval = opts.interval || 100;
  const svg = frame(host);
  let fill = null;
  if (opts.area !== false) {
    // Soft area under the line: the chart colour fading down (stops take --c from the host).
    const id = `app-chart-g${++gradSeq}`;
    const g = el('linearGradient', null, el('defs', null, svg));
    g.setAttribute('id', id);
    g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '0'); g.setAttribute('y2', '1');
    for (const [o, a] of [['0', '0.4'], ['0.55', '0.13'], ['1', '0']]) {
      const s = el('stop', null, g);
      s.setAttribute('offset', o);
      s.setAttribute('style', `stop-color:var(--c);stop-opacity:${a}`);
    }
    fill = el('path', 'app-chart__area', svg);
    fill.setAttribute('fill', `url(#${id})`);
  }
  const halo = el('path', 'app-chart__halo', svg);
  const line = el('path', 'app-chart__line', svg);
  const head = dot(host);
  const xs = xsFor(n);
  const buf = [];
  let lo = 0, hi = 0;

  function target() {
    let mn = Infinity, mx = -Infinity;
    for (const v of buf) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mode === 'level') {
      const span = Math.max(minSpan, (mx - mn) * 1.8), mid = (mx + mn) / 2;
      return [mid - span / 2, mid + span / 2];
    }
    return [0, Math.max(minSpan, nice(mx / 0.8))];
  }

  return {
    push(v) {
      const x = Number(v);
      if (!Number.isFinite(x)) return;
      const first = !buf.length;
      if (first) while (buf.length < n) buf.push(x); // full width from the first sample, like LEGACY
      else { buf.push(x); buf.shift(); }
      const [tl, th] = target();
      if (first) { lo = tl; hi = th; } else { lo += (tl - lo) * EASE; hi += (th - hi) * EASE; }
      const span = hi - lo || 1;
      const ys = buf.map((b) => H - PAD - Math.max(0, Math.min(1, (b - lo) / span)) * (H - PAD * 2));
      const d = curve(xs, ys);
      line.setAttribute('d', d);
      halo.setAttribute('d', d);
      if (fill) fill.setAttribute('d', `${d} L ${W} ${H} L ${xs[0]} ${H} Z`);
      head.style.top = `${((ys[n - 1] / H) * 100).toFixed(1)}%`;
      host.classList.remove('is-empty');
      if (!first) glide(svg, n, interval);
    },
    clear() {
      buf.length = 0;
      line.setAttribute('d', ''); halo.setAttribute('d', '');
      if (fill) fill.setAttribute('d', '');
      host.classList.add('is-empty');
    },
  };
}

/** Three signed series around a zero line (X/Y/Z colours from the axis tokens). opts: { n, minScale, interval } */
export function createAxisChart(host, opts = {}) {
  if (!host) return { push() {}, clear() {} };
  const n = opts.n || 64, minScale = opts.minScale || 1, interval = opts.interval || 50;
  const svg = frame(host);
  const axes = ['ax-x', 'ax-y', 'ax-z'].map((c) => ({
    halo: el('path', `app-chart__halo ${c}`, svg),
    line: el('path', `app-chart__line ${c}`, svg),
    head: dot(host, c),
    buf: [],
  }));
  const xs = xsFor(n);
  let scale = minScale;

  return {
    push(vals) {
      const first = !axes[0].buf.length;
      let peak = 0;
      axes.forEach((a, k) => {
        const x = Number(vals[k]) || 0;
        if (first) while (a.buf.length < n) a.buf.push(x);
        else { a.buf.push(x); a.buf.shift(); }
        for (const v of a.buf) if (Math.abs(v) > peak) peak = Math.abs(v);
      });
      const tgt = Math.max(minScale, peak * 1.15);
      scale = first ? tgt : scale + (tgt - scale) * EASE;
      const half = H / 2 - PAD;
      for (const a of axes) {
        const ys = a.buf.map((v) => H / 2 - Math.max(-1, Math.min(1, v / scale)) * half);
        const d = curve(xs, ys);
        a.line.setAttribute('d', d);
        a.halo.setAttribute('d', d);
        a.head.style.top = `${((ys[n - 1] / H) * 100).toFixed(1)}%`;
      }
      host.classList.remove('is-empty');
      if (!first) glide(svg, n, interval);
    },
    clear() {
      for (const a of axes) { a.buf.length = 0; a.line.setAttribute('d', ''); a.halo.setAttribute('d', ''); }
      scale = minScale;
      host.classList.add('is-empty');
    },
  };
}
