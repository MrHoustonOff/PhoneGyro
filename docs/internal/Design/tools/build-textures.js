// node tools/build-textures.js  -> writes the two ring tiles used by the design system
const fs = require('fs');
const { generate } = require('./zelda-rings.js');
const base = { seed: 7, circleCount: 30, minRadius: 50, maxRadius: 220, ringGap: 16, strokeWidth: 6,
  lineGap: 16, amplitude: 5, halfWave: 60, padding: 8, precision: 0, sortBySize: true, center: 'dot' };
fs.writeFileSync('rings-light.svg', generate({ ...base, background: '#F1F1F1', stroke: '#E7E7E7' }));
fs.writeFileSync('rings-dark.svg',  generate({ ...base, background: '#0B0B0B', stroke: '#191919' }));
