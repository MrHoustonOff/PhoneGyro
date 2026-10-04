// The launch animation's rings, drawn on two canvases instead of animated SVG.
//
// Why: each SVG <circle> animated its stroke-dashoffset and transform, which the
// compositor cannot do, so every frame the whole SVG was painted and rasterised
// again — the backing set is 125rem square (2000 px; 4.5 M device pixels at
// 150 % Windows scale), the card's set 56.25rem. Integrated GPUs could not keep
// up. A canvas the size of what is seen, with 19 arcs drawn per frame, costs
// almost nothing; its element still takes the CSS fades and the burst
// (css/app.css, pg.css .pg-splash__rings) on the compositor.
//
// The look is the same as the SVG it replaces: the same radii, opacities,
// strokes, delays, durations and cubic-bezier curves as the keyframes
// pg-unroll (card) and app-unroll-rev (backing), and the backing set's slow
// counter-turn (app-bg-spin, 90 s per turn).

// cubic-bezier(x1, y1, x2, y2) as CSS evaluates it
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-6) break;
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    if (t < 0 || t > 1 || Math.abs(X(t) - x) > 1e-4) { // bisection fallback
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) { if (X(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    }
    return ((ay * t + by) * t + cy) * t;
  };
}
const EASE = bezier(0.2, 0.75, 0.2, 1);

// Radii and opacities as the SVG had them (viewBox units).
const CARD = { r: [46, 86, 126, 166, 206, 246, 286, 326], o: [0.55, 0.49, 0.43, 0.37, 0.31, 0.25, 0.19, 0.13] };
const BACK = { r: [380, 442, 504, 566, 628, 690, 752, 814, 876, 938, 1000], o: [0.11, 0.102, 0.094, 0.086, 0.078, 0.07, 0.062, 0.054, 0.046, 0.038, 0.03] };

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Opacity over keyframes 0% 0 → peakAt peak → 100% end, each interval eased. */
function fadeIn(p, peakAt, peak, end) {
  if (p <= 0) return 0;
  if (p < peakAt) return peak * EASE(p / peakAt);
  return peak + (end - peak) * EASE((p - peakAt) / (1 - peakAt));
}

// "r, g, b" of any CSS colour, through the canvas's own parser
function rgbOf(ctx, color) {
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  const v = ctx.fillStyle;
  if (v[0] === '#') return [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16)).join(', ');
  const m = v.match(/[\d.]+/g);
  return m ? m.slice(0, 3).join(', ') : '198, 144, 59';
}

const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

/**
 * One ring as a comet while it unrolls: the arc brightens from its tail to the
 * moving tip, and the tip carries a small glowing head. As the ring closes
 * (q → 1) the gradient evens out and the head fades, leaving the plain ring.
 * from/to: the arc; headAt: the moving end; dir 1 = the tip leads clockwise.
 * Costs one conic gradient and two small dots per ring: no extra layer.
 */
function comet(ctx, rgb, r, from, to, headAt, dir, q, lw) {
  // by time, not by arc: the curve closes most of the ring early, the glow
  // should live through the whole move
  const settle = smooth(0.35, 0.9, q); // 0 while unrolling, 1 when settled
  const tail = 0.12 + 0.88 * settle;   // tail brightness relative to the tip
  const span = (to - from) / TAU;     // part of the turn the arc covers
  if (ctx.createConicGradient && span > 0.002 && settle < 1) {
    // gradient angle 0 at the tail, the arc's span at the tip
    const g = dir > 0 ? ctx.createConicGradient(from, 0, 0) : ctx.createConicGradient(headAt, 0, 0);
    const tipStop = Math.min(1, span);
    if (dir > 0) {
      g.addColorStop(0, `rgba(${rgb}, ${tail})`);
      g.addColorStop(tipStop, `rgba(${rgb}, 1)`);
      if (tipStop < 1) g.addColorStop(Math.min(1, tipStop + 1e-4), `rgba(${rgb}, ${tail})`);
    } else {
      g.addColorStop(0, `rgba(${rgb}, 1)`);
      g.addColorStop(tipStop, `rgba(${rgb}, ${tail})`);
      if (tipStop < 1) g.addColorStop(Math.min(1, tipStop + 1e-4), `rgba(${rgb}, 1)`);
    }
    ctx.strokeStyle = g;
  } else {
    ctx.strokeStyle = `rgb(${rgb})`;
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, from, to);
  ctx.stroke();
  const head = 1 - settle;
  if (head > 0.01) {
    const x = Math.cos(headAt) * r, y = Math.sin(headAt) * r;
    const a0 = ctx.globalAlpha;
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.globalAlpha = a0 * 0.22 * head;      // soft glow
    ctx.beginPath(); ctx.arc(x, y, lw * 2.4, 0, TAU); ctx.fill();
    ctx.globalAlpha = Math.min(1, a0 * 1.6) * head; // bright core
    ctx.beginPath(); ctx.arc(x, y, lw * 0.9, 0, TAU); ctx.fill();
    ctx.globalAlpha = a0;
  }
}

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return dpr;
}

/**
 * Starts drawing; returns stop(). card: the canvas in the card (56.25rem square,
 * 600 viewBox units across); back: the full-window canvas (1 unit = 1/16 rem).
 */
export function startRings(card, back) {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const cardCtx = card && card.getContext('2d');
  const backCtx = back && back.getContext('2d');
  // the stroke colours follow the theme and accent (Go may switch the theme
  // while the animation plays, as var(--accent) in the SVG did)
  let cardColor = '', backColor = '';
  const readColors = () => {
    if (card) cardColor = rgbOf(cardCtx, getComputedStyle(card).getPropertyValue('--brand').trim() || '#c6903b');
    if (back) backColor = rgbOf(backCtx, getComputedStyle(back).getPropertyValue('--accent').trim() || '#c6903b');
    cardDone = false; // redraw the finished card set in the new colour
  };
  const themeWatch = new MutationObserver(readColors);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
  const t0 = performance.now();
  let raf = 0;
  let cardDone = false;
  readColors();

  function drawCard(t) {
    const dpr = fit(card);
    const unit = (56.25 * rem / 600) * dpr;
    const ctx = cardCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, card.width, card.height);
    ctx.translate(card.width / 2, card.height / 2);
    ctx.lineWidth = 2 * unit;
    ctx.lineCap = 'round';
    let finished = true;
    for (let i = 0; i < CARD.r.length; i++) {
      // pg-unroll 1.5s, delay .15s + i·.09s: dash grows from the path start,
      // rotate(-240deg) scale(.5) → none, opacity 0 → .95 (12%) → o
      const p = (t - 0.15 - i * 0.09) / 1.5;
      if (p < 1) finished = false;
      if (p <= 0) continue;
      const q = Math.min(1, p);
      const e = EASE(q);
      const a = fadeIn(q, 0.12, 0.95, CARD.o[i]);
      if (a <= 0 || e <= 0) continue;
      ctx.save();
      ctx.rotate(-240 * DEG * (1 - e));
      ctx.scale(0.5 + 0.5 * e, 0.5 + 0.5 * e);
      ctx.globalAlpha = a;
      comet(ctx, cardColor, CARD.r[i] * unit, 0, TAU * e, TAU * e, 1, q, ctx.lineWidth);
      ctx.restore();
    }
    return finished;
  }

  function drawBack(t) {
    const dpr = fit(back);
    const unit = (rem / 16) * dpr;
    const ctx = backCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, back.width, back.height);
    ctx.translate(back.width / 2, back.height / 2);
    ctx.rotate(-TAU * (t / 90)); // app-bg-spin: the whole set turns back once per 90 s
    ctx.lineWidth = 1.5 * unit;
    ctx.lineCap = 'round';
    for (let i = 0; i < BACK.r.length; i++) {
      // app-unroll-rev 1.9s, delay .35s + i·.08s: dash grows backwards from the
      // path end, rotate(200deg) scale(.7) → none, opacity 0 → o (15%)
      const p = (t - 0.35 - i * 0.08) / 1.9;
      if (p <= 0) continue;
      const q = Math.min(1, p);
      const e = EASE(q);
      const a = fadeIn(q, 0.15, BACK.o[i], BACK.o[i]);
      if (a <= 0 || e <= 0) continue;
      ctx.save();
      ctx.rotate(200 * DEG * (1 - e));
      ctx.scale(0.7 + 0.3 * e, 0.7 + 0.3 * e);
      ctx.globalAlpha = a;
      comet(ctx, backColor, BACK.r[i] * unit, TAU * (1 - e), TAU, TAU * (1 - e), -1, q, ctx.lineWidth);
      ctx.restore();
    }
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    // the card's set is still once unrolled: stop redrawing it
    if (cardCtx && !cardDone) cardDone = drawCard(t);
    if (backCtx) drawBack(t);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); raf = 0; themeWatch.disconnect(); };
}
