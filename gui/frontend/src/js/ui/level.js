// The bubble level on the device card, in one of two models (Settings →
// Performance → Level model):
//   3d   — design Level3D (vendor/level3d.js on Three.js r128, loaded on first use)
//   flat — the CSS dial (design Dial); also the fallback when WebGL is missing.
// The flat dial stays in the markup inside the 3D host (.pg-level3d__fb).

import { createLevel } from '../vendor/level3d.js';
import { setText, setVar, toggleClass } from '../core/dom.js';
import { t, onLang } from '../core/i18n.js';

const REM_PER_DEG = 0.125;  // flat: bubble travel (2 px per degree at 16 px)
const MAX_REM = 3.625;      // flat: design clamps to ±58 px
const LEVEL_DEG = 1;        // flat: under 1° the bubble turns accent

let three = null;
/** Loads the local three.min.js once; resolves false if it cannot. */
function loadThree() {
  if (window.THREE) return Promise.resolve(true);
  three = three || new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'vendor/three.min.js';
    s.onload = () => resolve(!!window.THREE);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return three;
}

const rad = (d) => (d * Math.PI) / 180;

/**
 * createDeviceLevel(host, label): host is the .pg-level3d element (the flat dial
 * inside it), label the pill under it. Returns { setMode('3d'|'flat'), update({pitch, roll}) }.
 */
export function createDeviceLevel(host, label) {
  const dial = host.querySelector('.pg-level3d__fb');
  const bubble = dial.querySelector('.pg-dial__bubble');
  let level3d = null;
  let mode = 'flat';
  let want = 'flat';
  let last = { pitch: 0, roll: 0 };
  let lastEvent = null;

  // The 3D level reports its state (data-state) only when it changes, so the
  // angle in the label comes from the vector we feed it, every update.
  let tiltDeg = 0;
  const label3d = () => {
    if (mode !== '3d') return;
    const state = host.dataset.state || (lastEvent && lastEvent.state) || 'level';
    const tilt = tiltDeg;
    setText(label, state === 'level' ? t('ui.level_level') : state === 'down' ? t('ui.level_down')
      : state === 'steep' ? t('ui.level_steep') : `${t('ui.level_tilt')} ${Math.round(tilt)}°`);
  };
  host.addEventListener('pglevel', (e) => { lastEvent = e.detail; label3d(); });

  function flat({ pitch, roll }) {
    const clamp = (v) => Math.max(-MAX_REM, Math.min(MAX_REM, v * REM_PER_DEG));
    setVar(dial, '--bx', clamp(roll).toFixed(3) + 'rem');
    setVar(dial, '--by', clamp(-pitch).toFixed(3) + 'rem');
    const isLevel = Math.abs(roll) < LEVEL_DEG && Math.abs(pitch) < LEVEL_DEG;
    toggleClass(bubble, 'is-level', isLevel);
    const big = Math.abs(roll) >= Math.abs(pitch) ? ['ROLL', roll] : ['PITCH', pitch];
    setText(label, isLevel ? t('ui.level_level') : `${big[0]} ${big[1] >= 0 ? '+' : ''}${big[1].toFixed(0)}°`);
  }

  // The 3D level wants gravity in device axes (face up = 0,0,1). Our source is
  // the calibrated pitch/roll the flat dial uses, so the two models agree: roll
  // right lifts +x, pitch up lifts +y.
  function update(st) {
    last = { pitch: st.pitch || 0, roll: st.roll || 0 };
    if (mode === '3d') {
      const p = rad(last.pitch), r = rad(last.roll);
      const az = Math.cos(p) * Math.cos(r);
      level3d.setAccel(Math.sin(r) * Math.cos(p), Math.sin(p), az);
      tiltDeg = (Math.acos(Math.max(-1, Math.min(1, az))) * 180) / Math.PI;
      label3d();
    } else {
      flat(last);
    }
  }

  async function setMode(next) {
    want = next;
    if (next === '3d' && !level3d) {
      const ok = await loadThree();
      if (want !== '3d') return;                  // changed while loading
      level3d = ok ? createLevel(host, { labels: {} }) : null; // null: no WebGL → flat
    } else if (next !== '3d' && level3d) {
      level3d.dispose();
      level3d = null;
      lastEvent = null;
    }
    mode = level3d ? '3d' : 'flat';
    toggleClass(host, 'is-3d', mode === '3d');
    update(last);
    label3d();
  }

  onLang(() => { if (mode === '3d') label3d(); else flat(last); });
  return { setMode, update };
}
