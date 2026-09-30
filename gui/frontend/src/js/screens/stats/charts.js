// Live charts of the stats page: one SVG drawer for single-line sparks (line + soft area)
// and three-axis X/Y/Z charts. No rAF: the caller pushes values from its 10 Hz tick while the
// page is open. The scale is stepped (1-2-5) with slow decay, so the picture does not breathe.
// An empty chart is a zero line with a "no data" label, not a black box.

import { t } from '../../core/i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 100, H = 40, PAD = 3;
const STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2000, 5000];
let gradSeq = 0;
const CALM_TICKS = 30; // ~3 s under a quarter of the scale before stepping down

function el(tag, cls, parent) {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute('class', cls);
  if (parent) parent.appendChild(e);
  return e;
}

// Shared frame: svg with a grid, an overlay label for "no data" and an end dot.
function frame(host) {
  host.textContent = '';
  const svg = el('svg', 'app-chart__svg', host);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  for (const y of [H * 0.25, H * 0.5, H * 0.75]) {
    const g = el('path', 'app-chart__grid', svg);
    g.setAttribute('d', `M 0 ${y} L ${W} ${y}`);
  }
  const empty = document.createElement('span');
  empty.className = 'app-chart__empty';
  empty.dataset.i18n = 'ui.stats_no_data';
  empty.textContent = t('ui.stats_no_data');
  host.appendChild(empty);
  host.classList.add('is-empty');
  return svg;
}

function stepScale(state, peak) {
  let s = state.scale;
  if (peak > s * 0.9) {
    s = STEPS.find((x) => x * 0.9 >= peak) || STEPS[STEPS.length - 1];
    state.calm = 0;
  } else if (peak < s * 0.3 && s > state.minScale) {
    if (++state.calm > CALM_TICKS) { s = STEPS[Math.max(0, STEPS.indexOf(s) - 1)]; state.calm = 0; }
  } else state.calm = 0;
  state.scale = Math.max(s, state.minScale);
}

// Single metric, non-negative: scale 0..step. opts: { n, area, minScale }
export function createSpark(host, opts = {}) {
  if (!host) return { push() {}, clear() {} };
  const n = opts.n || 60;
  const svg = frame(host);
  let fill = null;
  if (opts.area !== false) {
    // Soft area under the line: the chart colour fading down (stops take --c from the host).
    const id = `app-chart-g${++gradSeq}`;
    const g = el('linearGradient', null, el('defs', null, svg));
    g.setAttribute('id', id);
    g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '0'); g.setAttribute('y2', '1');
    for (const [o, a] of [['0', '0.42'], ['1', '0.02']]) {
      const st = el('stop', null, g);
      st.setAttribute('offset', o);
      st.setAttribute('style', `stop-color:var(--c);stop-opacity:${a}`);
    }
    fill = el('path', 'app-chart__area', svg);
    fill.setAttribute('fill', `url(#${id})`);
  }
  const line = el('path', 'app-chart__line', svg);
  const dot = document.createElement('i');
  dot.className = 'app-chart__dot';
  host.appendChild(dot);
  const buf = [];
  const st = { scale: opts.minScale || STEPS[0], minScale: opts.minScale || STEPS[0], calm: 0 };

  return {
    push(v) {
      const x = Number(v);
      if (!Number.isFinite(x)) return;
      buf.push(Math.max(0, x));
      if (buf.length > n) buf.shift();
      if (buf.length < 2) return;
      let peak = 0;
      for (const b of buf) if (b > peak) peak = b;
      stepScale(st, peak);
      const step = W / (n - 1), off = (n - buf.length) * step, s = st.scale;
      let d = '';
      let y = 0;
      for (let i = 0; i < buf.length; i++) {
        y = H - PAD - Math.min(1, buf[i] / s) * (H - PAD * 2);
        d += `${i ? 'L' : 'M'} ${(off + i * step).toFixed(1)} ${y.toFixed(1)} `;
      }
      line.setAttribute('d', d);
      if (fill) fill.setAttribute('d', `${d}L ${W} ${H} L ${off.toFixed(1)} ${H} Z`);
      dot.style.top = `${((y / H) * 100).toFixed(1)}%`;
      host.classList.remove('is-empty');
    },
    clear() {
      buf.length = 0;
      line.setAttribute('d', '');
      if (fill) fill.setAttribute('d', '');
      st.scale = st.minScale;
      host.classList.add('is-empty');
    },
  };
}

// Three signed series around a zero line (X/Y/Z colours come from CSS axis tokens).
export function createAxisChart(host, opts = {}) {
  if (!host) return { push() {}, clear() {} };
  const n = opts.n || 90;
  const svg = frame(host);
  const paths = ['ax-x', 'ax-y', 'ax-z'].map((c) => el('path', `app-chart__line ${c}`, svg));
  const buf = [[], [], []];
  const st = { scale: opts.minScale || 0.5, minScale: opts.minScale || STEPS[0], calm: 0 };

  return {
    push(vals) {
      for (let k = 0; k < 3; k++) {
        const x = Number(vals[k]);
        buf[k].push(Number.isFinite(x) ? x : 0); // telemetry.js only pushes finite triples
        if (buf[k].length > n) buf[k].shift();
      }
      if (buf[0].length < 2) return;
      let peak = 0;
      for (const b of buf) for (const v of b) if (Math.abs(v) > peak) peak = Math.abs(v);
      stepScale(st, peak);
      const step = W / (n - 1), off = (n - buf[0].length) * step, s = st.scale, half = H / 2 - PAD;
      for (let k = 0; k < 3; k++) {
        let d = '';
        const b = buf[k];
        for (let i = 0; i < b.length; i++) {
          const y = H / 2 - Math.max(-1, Math.min(1, b[i] / s)) * half;
          d += `${i ? 'L' : 'M'} ${(off + i * step).toFixed(1)} ${y.toFixed(1)} `;
        }
        paths[k].setAttribute('d', d);
      }
      host.classList.remove('is-empty');
    },
    clear() {
      for (let k = 0; k < 3; k++) { buf[k].length = 0; paths[k].setAttribute('d', ''); }
      host.classList.add('is-empty');
    },
  };
}
