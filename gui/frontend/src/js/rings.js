// A new ring-and-wave tile every launch (js/zelda-rings.js), the same seed for
// both themes so switching theme keeps the pattern. Runs before first paint
// (~8 ms); the design tile (img/rings-*.svg) stays the fallback.
(function () {
  if (typeof ZeldaRings === 'undefined') return;
  var base = { circleCount: 30, minRadius: 50, maxRadius: 220, ringGap: 16, strokeWidth: 6, lineGap: 16,
    amplitude: 5, halfWave: 60, padding: 8, precision: 0, sortBySize: true, center: 'dot',
    seed: (Math.random() * 2147483647) >>> 0 };
  try {
    var d = document.documentElement.style;
    d.setProperty('--tex-rings-gen-light', 'url("' + ZeldaRings.toBlobURL(ZeldaRings.generate(Object.assign({}, base, { background: '#F1F1F1', stroke: '#E7E7E7' }))) + '")');
    d.setProperty('--tex-rings-gen-dark', 'url("' + ZeldaRings.toBlobURL(ZeldaRings.generate(Object.assign({}, base, { background: '#0B0B0B', stroke: '#191919' }))) + '")');
  } catch (e) { /* fallback tile */ }
})();
