// Live charts of the stats page, in the spirit of LEGACY Live Debug: smooth curves (Catmull-Rom),
// a soft glow under the line, a glowing head dot, the full width from the first sample.
// One SVG drawer for single-line sparks and three-axis X/Y/Z charts.
// Cost control (the look stays the same):
//  - push() only records the sample and eases the range; drawing happens once per frame for all
//    charts together (one-shot rAF, no loop), and only for charts on screen with the window visible;
//    a chart scrolled out of view catches up in one draw when it comes back;
//  - the glow is a <use> of the line (one path to parse, not two);
//  - between pushes the data layer glides left by one step (one reused Web Animation on transform);
//  - head dots move by transform, not top, so a sample causes no layout.
// The Y range eases toward its target, so a new peak never snaps the already drawn data.

import { t } from '../../core/i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 100, H = 40, PAD = 4;
const EASE = 0.18; // share of the way to the target range per push
let seq = 0;

// ── One frame for every dirty chart; charts off screen wait until they are seen. ──
const dirty = new Set();
let raf = 0;
function flush() {
  raf = 0;
  for (const c of dirty) c.draw();
  dirty.clear();
}
let enabled = true; // the "Charts" switch on the stats page: off = no drawing at all, samples still recorded
function schedule(c) {
  if (!enabled || !c.visible || document.hidden) { c.stale = true; return; }
  dirty.add(c);
  if (!raf) raf = requestAnimationFrame(flush);
}
const byHost = new WeakMap();
const io = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      const c = byHost.get(e.target);
      if (!c) continue;
      c.visible = e.isIntersecting;
      if (c.visible && c.stale) schedule(c);
    }
  })
  : null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  // back from a hidden window: redraw what went stale meanwhile (WeakMap is not iterable, so charts register here)
  for (const c of live) if (c.stale) schedule(c);
});
const live = new Set();

/** Turns chart drawing on/off; turning on catches every chart up in one frame. */
export function setChartsEnabled(on) {
  enabled = !!on;
  if (enabled) for (const c of live) if (c.stale) schedule(c);
}
/** Force-wake every chart (call after the stats screen becomes visible to resolve IO edge-cases). */
export function wakeCharts() {
  for (const c of live) { c.visible = true; if (c.stale) schedule(c); }
}
function watch(host, c) {
  c.visible = !io;
  byHost.set(host, c);
  live.add(c);
  if (io) io.observe(host);
}

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

const f1 = (v) => Math.round(v * 10) / 10;

// Smooth path through points (Catmull-Rom → cubic Bézier), like LEGACY drawAppleChart.
function curve(xs, ys) {
  const n = ys.length;
  let d = `M${f1(xs[0])} ${f1(ys[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const i0 = i ? i - 1 : 0, i3 = i + 2 < n ? i + 2 : i + 1;
    d += `C${f1(xs[i] + (xs[i + 1] - xs[i0]) / 6)} ${f1(ys[i] + (ys[i + 1] - ys[i0]) / 6)} ${f1(xs[i + 1] - (xs[i3] - xs[i]) / 6)} ${f1(ys[i + 1] - (ys[i3] - ys[i]) / 6)} ${f1(xs[i + 1])} ${f1(ys[i + 1])}`;
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

// A line plus its glow (<use> of the same path); stroke comes from the group, so each can style it.
function lineWithGlow(svg, cls) {
  const g = el('g', `app-chart__lines ${cls || ''}`, svg);
  const id = `app-chart-l${++seq}`;
  const halo = el('use', 'app-chart__halo', g);
  const line = el('path', 'app-chart__line', g);
  line.setAttribute('id', id);
  halo.setAttribute('href', `#${id}`);
  return line;
}

// Head dot: a full-height rail moved by transform (percent of the rail = percent of the chart).
function dot(host, cls) {
  const rail = document.createElement('i');
  rail.className = `app-chart__rail ${cls || ''}`;
  rail.appendChild(document.createElement('b'));
  host.appendChild(rail);
  return rail;
}
const placeDot = (rail, y) => { rail.style.transform = `translateY(${((y / H) * 100).toFixed(1)}%)`; };

// X positions of n samples: the oldest steps left of the edge, so the glide never shows a gap.
function xsFor(n) {
  const step = W / (n - 3);
  const xs = new Array(n);
  for (let i = 0; i < n; i++) xs[i] = -2 * step + i * step;
  return xs;
}

function glider(svg, n, ms) {
  if (!svg.animate || !(ms > 0)) return () => {};
  const a = svg.animate([{ transform: `translateX(${100 / (n - 3)}%)` }, { transform: 'translateX(0)' }], { duration: ms, easing: 'linear' });
  a.cancel();
  return () => { a.cancel(); a.play(); };
}

function base(host) {
  return { visible: true, stale: false, pending: 0, empty: true, host };
}
function markFilled(c) {
  if (c.empty) { c.empty = false; c.host.classList.remove('is-empty'); }
}
function markEmpty(c) {
  c.empty = true; c.pending = 0; c.stale = false; dirty.delete(c);
  c.host.classList.add('is-empty');
}

/**
 * Single metric. opts: { n, area, mode: 'zero' (0..peak) | 'level' (around the value), minSpan, interval }
 */
export function createSpark(host, opts = {}) {
  if (!host) return { push() {}, clear() {} };
  const n = opts.n || 40, mode = opts.mode || 'zero', minSpan = opts.minSpan || 1;
  const svg = frame(host);
  let fill = null;
  if (opts.area !== false) {
    // Soft area under the line: the chart colour fading down (stops take --c from the host).
    const id = `app-chart-g${++seq}`;
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
  const line = lineWithGlow(svg);
  const head = dot(host);
  const glide = glider(svg, n, opts.interval || 100);
  const xs = xsFor(n);
  const buf = [];
  let lo = 0, hi = 0;
  const c = base(host);

  function target() {
    let mn = Infinity, mx = -Infinity;
    for (const v of buf) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mode === 'level') {
      const span = Math.max(minSpan, (mx - mn) * 1.8), mid = (mx + mn) / 2;
      return [mid - span / 2, mid + span / 2];
    }
    return [0, Math.max(minSpan, nice(mx / 0.8))];
  }

  c.draw = () => {
    if (!buf.length) return;
    const span = hi - lo || 1;
    const ys = buf.map((b) => H - PAD - Math.max(0, Math.min(1, (b - lo) / span)) * (H - PAD * 2));
    const d = curve(xs, ys);
    line.setAttribute('d', d);
    if (fill) fill.setAttribute('d', `${d}L${W} ${H}L${f1(xs[0])} ${H}Z`);
    placeDot(head, ys[n - 1]);
    markFilled(c);
    if (c.pending === 1 && !c.stale) glide(); // one fresh sample: slide it in; a catch-up draw just lands
    c.pending = 0; c.stale = false;
  };
  watch(host, c);

  return {
    push(v) {
      const x = Number(v);
      if (!Number.isFinite(x)) return;
      const first = !buf.length;
      if (first) while (buf.length < n) buf.push(x); // full width from the first sample, like LEGACY
      else { buf.push(x); buf.shift(); }
      const [tl, th] = target();
      if (first) { lo = tl; hi = th; } else { lo += (tl - lo) * EASE; hi += (th - hi) * EASE; }
      c.pending += first ? 2 : 1;
      schedule(c);
    },
    clear() {
      buf.length = 0;
      line.setAttribute('d', '');
      if (fill) fill.setAttribute('d', '');
      markEmpty(c);
    },
  };
}

/** Three signed series around a zero line (X/Y/Z colours from the axis tokens). opts: { n, minScale, interval } */
export function createAxisChart(host, opts = {}) {
  if (!host) return { push() {}, clear() {} };
  const n = opts.n || 64, minScale = opts.minScale || 1;
  const svg = frame(host);
  const axes = ['ax-x', 'ax-y', 'ax-z'].map((cls) => ({ line: lineWithGlow(svg, cls), head: dot(host, cls), buf: [] }));
  const glide = glider(svg, n, opts.interval || 50);
  const xs = xsFor(n);
  let scale = minScale;
  const c = base(host);

  c.draw = () => {
    if (!axes[0].buf.length) return;
    const half = H / 2 - PAD;
    for (const a of axes) {
      const ys = a.buf.map((v) => H / 2 - Math.max(-1, Math.min(1, v / scale)) * half);
      a.line.setAttribute('d', curve(xs, ys));
      placeDot(a.head, ys[n - 1]);
    }
    markFilled(c);
    if (c.pending === 1 && !c.stale) glide();
    c.pending = 0; c.stale = false;
  };
  watch(host, c);

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
      c.pending += first ? 2 : 1;
      schedule(c);
    },
    clear() {
      for (const a of axes) { a.buf.length = 0; a.line.setAttribute('d', ''); }
      scale = minScale;
      markEmpty(c);
    },
  };
}
