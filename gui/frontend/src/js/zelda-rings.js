/*!
 * zelda-rings.js — бесшовный генератор паттерна «вложенные круги + волнистые линии».
 * Идея по статье Paul Hebert (Cloud Four), переписано под тайлинг и фон сайта.
 * Без зависимостей. Работает в браузере (<script>) и в Node (require) для генерации на этапе сборки.
 *
 *   const svg = ZeldaRings.generate({ seed: 42, background: '#cdb98a', stroke: '#efe8d6' });
 *   ZeldaRings.mount(document.body, { seed: 42 }, { tileSize: 600, opacity: 0.15, duration: 90 });
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZeldaRings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    // ── общее ─────────────────────────────────────────────
    seed: 1,              // число или 'random'. Одинаковый seed = одинаковый узор
    width: 1000,          // размер тайла в единицах viewBox
    height: 1000,
    background: '#cdb98a',// цвет фона И заливки-«заглушки» под кругами
    stroke: '#efe8d6',    // цвет колец
    strokeWidth: 10,      // толщина линии колец
    precision: 1,         // знаков после запятой в координатах (меньше = легче файл)

    // ── круги ─────────────────────────────────────────────
    circles: true,
    circleCount: 40,      // сколько групп пытаться поставить
    maxAttempts: 3000,    // сколько раз пробовать найти место
    minRadius: 50,
    maxRadius: 260,
    radiusBias: 1.6,      // 1 = равномерно, >1 = больше мелких, <1 = больше крупных
    ringGap: 20,          // шаг между кольцами (расстояние от линии до линии)
    snapRadius: true,     // радиус кратен ringGap → одинаковые центры у всех кругов
    minCenterDistance: 1, // центры дальше, чем k × радиус верхнего круга (0 = выкл.)
    padding: 0,           // «воздух» вокруг круга: насколько заглушка шире внешнего кольца
    center: 'dot',        // 'dot' | 'ring' | 'auto' (как в статье: кольца до нуля)
    dotRadius: null,      // радиус точки в центре; null = strokeWidth × 0.9
    sortBySize: false,    // true: крупные снизу, мелкие сверху (спокойнее композиция)

    // ── волнистые линии ───────────────────────────────────
    squiggles: true,
    direction: 'vertical',// 'vertical' | 'horizontal'
    squiggleStroke: null, // цвет; null = stroke
    squiggleWidth: null,  // толщина; null = strokeWidth
    lineGap: 20,          // шаг между линиями (подгоняется, чтобы целое число влезло в тайл)
    amplitude: 6,         // отклонение от оси (половина «ширины» зигзага)
    halfWave: 75,         // расстояние между соседними пиками (подгоняется под тайл)
    phaseJitter: 0,       // 0..1 — случайный сдвиг фазы каждой линии
    amplitudeJitter: 0,   // 0..1 — случайный разброс амплитуды по линиям
    lineCap: 'round',     // 'round' | 'butt' | 'square'
  };

  // ── детерминированный ГСЧ (mulberry32) ──────────────────
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function resolveOptions(user) {
    const o = Object.assign({}, DEFAULTS, user || {});
    if (o.seed === 'random' || o.seed == null) o.seed = (Math.random() * 2 ** 32) >>> 0;
    if (o.dotRadius == null) o.dotRadius = o.strokeWidth * 0.9;
    if (o.squiggleStroke == null) o.squiggleStroke = o.stroke;
    if (o.squiggleWidth == null) o.squiggleWidth = o.strokeWidth;
    return o;
  }

  // ── расстановка кругов на торе (с учётом переноса через край) ──
  function placeCircles(o, rnd) {
    const W = o.width, H = o.height, out = [];
    const torusDist = (ax, ay, bx, by) => {
      let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
      dx = Math.min(dx, W - dx); dy = Math.min(dy, H - dy);
      return Math.hypot(dx, dy);
    };
    for (let a = 0; a < o.maxAttempts && out.length < o.circleCount; a++) {
      let r = o.minRadius + (o.maxRadius - o.minRadius) * Math.pow(rnd(), o.radiusBias);
      if (o.snapRadius) r = Math.max(o.ringGap, Math.round(r / o.ringGap) * o.ringGap);
      const x = rnd() * W, y = rnd() * H;
      if (o.minCenterDistance > 0) {
        let ok = true;
        for (const c of out) {
          // правило из комментариев к статье: центр нижнего круга не должен
          // оказаться под верхним, иначе нижний почти целиком спрятан
          const topR = o.sortBySize ? Math.min(r, c.r) : r;
          if (torusDist(x, y, c.x, c.y) < o.minCenterDistance * topR) { ok = false; break; }
        }
        if (!ok) continue;
      }
      out.push({ x, y, r });
    }
    if (o.sortBySize) out.sort((p, q) => q.r - p.r);
    return out;
  }

  // ── форматирование чисел ────────────────────────────────
  function makeFmt(p) {
    const k = Math.pow(10, p);
    return (n) => String(Math.round(n * k) / k);
  }

  // ── кольца одной группы одним path (меньше элементов = быстрее растеризация) ──
  function ringsPath(cx, cy, o, r, f) {
    let d = '';
    const minR = o.center === 'auto' ? 0 : (o.center === 'dot' ? o.dotRadius + o.strokeWidth * 0.8 : o.ringGap * 0.5);
    for (let rr = r; rr > minR; rr -= o.ringGap) {
      // окружность = две дуги
      d += `M${f(cx - rr)} ${f(cy)}a${f(rr)} ${f(rr)} 0 1 0 ${f(2 * rr)} 0a${f(rr)} ${f(rr)} 0 1 0 ${f(-2 * rr)} 0`;
    }
    return d;
  }

  // ── копии группы, пересекающие край (для бесшовности) ─────
  function wrapOffsets(x, y, R, W, H) {
    const res = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const cx = x + i * W, cy = y + j * H;
        if (cx + R > 0 && cx - R < W && cy + R > 0 && cy - R < H) res.push([cx, cy]);
      }
    }
    return res;
  }

  // ── волнистые линии: зигзаг, сглаженный Catmull-Rom → кубические Безье ──
  function squigglesPath(o, rnd, f) {
    const vertical = o.direction !== 'horizontal';
    const along = vertical ? o.height : o.width;   // длина линии
    const across = vertical ? o.width : o.height;  // куда линии «шагают»
    const nLines = Math.max(1, Math.round(across / o.lineGap));
    const gap = across / nLines;
    const nWaves = Math.max(1, Math.round(along / (2 * o.halfWave)));
    const half = along / (2 * nWaves);             // точно укладывается в тайл

    // параметры на линию индексируются по модулю → копии на краях совпадают
    const phases = [], amps = [];
    for (let i = 0; i < nLines; i++) {
      phases.push(rnd() * o.phaseJitter * 2 * half);
      amps.push(o.amplitude * (1 - o.amplitudeJitter * rnd()));
    }
    const P = (a, b) => (vertical ? `${f(b)} ${f(a)}` : `${f(a)} ${f(b)}`);

    let d = '';
    // i = -1 и i = nLines — копии крайних линий на случай, если волна вылезает за край
    for (let i = -1; i <= nLines; i++) {
      const k = (i + nLines) % nLines;
      const base = (i + 0.5) * gap, amp = amps[k], ph = phases[k];
      const pts = [];
      for (let s = -3; s <= 2 * nWaves + 3; s++) {
        pts.push([s * half - ph, base + (s % 2 === 0 ? amp : -amp)]);
      }
      d += `M${P(pts[1][0], pts[1][1])}`;
      for (let s = 1; s < pts.length - 2; s++) {
        const p0 = pts[s - 1], p1 = pts[s], p2 = pts[s + 1], p3 = pts[s + 2];
        const c1a = p1[0] + (p2[0] - p0[0]) / 6, c1b = p1[1] + (p2[1] - p0[1]) / 6;
        const c2a = p2[0] - (p3[0] - p1[0]) / 6, c2b = p2[1] - (p3[1] - p1[1]) / 6;
        d += `C${P(c1a, c1b)} ${P(c2a, c2b)} ${P(p2[0], p2[1])}`;
      }
    }
    return d;
  }

  // ── главная функция: строка SVG ─────────────────────────
  function generate(userOptions) {
    const o = resolveOptions(userOptions);
    const rnd = mulberry32(o.seed);
    const f = makeFmt(o.precision);
    const W = o.width, H = o.height;

    const parts = [];
    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<style>` +
      `.b{fill:${o.background}}` +
      `.s{fill:none;stroke:${o.stroke};stroke-width:${o.strokeWidth}}` +
      `.q{fill:none;stroke:${o.squiggleStroke};stroke-width:${o.squiggleWidth};stroke-linecap:${o.lineCap}}` +
      `.d{fill:${o.stroke}}` +
      `</style>` +
      `<rect class="b" width="${W}" height="${H}"/>`
    );

    // отдельный ГСЧ для линий, чтобы параметры кругов не меняли узор линий
    const rndLines = mulberry32((o.seed ^ 0x9e3779b9) >>> 0);
    if (o.squiggles) parts.push(`<path class="q" d="${squigglesPath(o, rndLines, f)}"/>`);

    if (o.circles) {
      const circles = placeCircles(o, rnd);
      for (const c of circles) {
        const R = c.r + o.strokeWidth / 2 + o.padding; // радиус заглушки
        for (const [cx, cy] of wrapOffsets(c.x, c.y, R, W, H)) {
          parts.push(`<circle class="b" cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}"/>`);
          parts.push(`<path class="s" d="${ringsPath(cx, cy, o, c.r, f)}"/>`);
          if (o.center === 'dot') parts.push(`<circle class="d" cx="${f(cx)}" cy="${f(cy)}" r="${f(o.dotRadius)}"/>`);
        }
      }
    }

    parts.push('</svg>');
    return parts.join('');
  }

  // ── утилиты для браузера ────────────────────────────────
  function toDataURL(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function toBlobURL(svg) {
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  }

  // растеризация в WebP/PNG: тяжёлый узор превращается в одну картинку
  async function rasterize(svg, { width, height, type = 'image/webp', quality = 0.9 } = {}) {
    const img = new Image();
    img.src = toDataURL(svg);
    await img.decode();
    const w = Math.round(width || img.naturalWidth), h = Math.round(height || img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
    return URL.createObjectURL(blob);
  }

  /**
   * Вешает паттерн фоном: фиксированный слой, дрейф через transform (GPU, без перерисовки).
   * @param {HTMLElement} target — куда вставить слой (обычно document.body)
   * @param {object} patternOptions — опции generate()
   * @param {object} view
   *   tileSize  — ширина тайла в CSS px (высота по пропорции)
   *   opacity   — непрозрачность слоя
   *   mode      — 'svg' (векторно) | 'raster' (WebP с учётом devicePixelRatio)
   *   drift     — [kx, ky] направление в тайлах, каждое из -1 | 0 | 1; [0,0] = без движения
   *   duration  — секунд на один тайл пути
   *   zIndex    — z-index слоя
   *   position  — 'fixed' | 'absolute'
   * @returns {Promise<{el, url, destroy, animation}>}
   */
  async function mount(target, patternOptions = {}, view = {}) {
    const v = Object.assign({
      tileSize: 600, opacity: 0.12, mode: 'svg', drift: [1, 1], duration: 90, zIndex: -1, position: 'fixed',
    }, view);
    const o = resolveOptions(patternOptions);
    const svg = generate(o);
    const tw = v.tileSize, th = v.tileSize * (o.height / o.width);

    let url;
    if (v.mode === 'raster') {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      url = await rasterize(svg, { width: tw * dpr, height: th * dpr });
    } else {
      url = toBlobURL(svg);
    }

    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    const kx = Math.sign(v.drift[0] || 0), ky = Math.sign(v.drift[1] || 0);
    Object.assign(el.style, {
      position: v.position,
      top: `${-th}px`, left: `${-tw}px`, right: `${-tw}px`, bottom: `${-th}px`,
      backgroundImage: `url("${url}")`,
      backgroundSize: `${tw}px ${th}px`,
      backgroundRepeat: 'repeat',
      opacity: String(v.opacity),
      pointerEvents: 'none',
      zIndex: String(v.zIndex),
      contain: 'strict',
    });
    target.prepend(el);

    let animation = null;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if ((kx || ky) && !reduce && el.animate) {
      el.style.willChange = 'transform';
      animation = el.animate(
        [{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${kx * tw}px, ${ky * th}px, 0)` }],
        { duration: v.duration * 1000, iterations: Infinity, easing: 'linear' }
      );
    }

    return {
      el, url, animation, seed: o.seed,
      destroy() {
        if (animation) animation.cancel();
        el.remove();
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      },
    };
  }

  return { DEFAULTS, generate, toDataURL, toBlobURL, rasterize, mount };
});
