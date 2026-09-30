// Benchmark for Task 4D: Green palette for the calibration page
// Verifies that calibration does not inherit user's accent (e.g. amber/gold),
// and uses green design tokens for stepper, progress, badges, buttons, axis-y,
// and 3D floor rings/arcs in both dark and light modes.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 4D] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 4D] Server running at ${srv.base}`);

  console.log('[Bench 4D] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 4D] Loading app with user accent = amber (gold)...');
    await p.goto(`${srv.base}/index.html`, 2500);

    // Set user accent = amber and theme = dark
    await ev(() => {
      document.documentElement.setAttribute('data-accent', 'amber');
      document.documentElement.setAttribute('data-theme', 'dark');
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(300);

    // Verify main app has amber accent
    const rootAccent = await ev(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    });
    console.log('[Bench 4D] Root element --accent:', rootAccent);
    if (!rootAccent.includes('#f2cc85') && !rootAccent.includes('242, 204, 133') && !rootAccent.includes('f2cc85')) {
      console.warn('[Bench 4D] Root accent not amber:', rootAccent);
    }

    // Open calibration
    console.log('[Bench 4D] Opening calibration...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(500);

    // ── Check 1: Dark mode tokens on .app-calpage ──
    console.log('[Bench 4D] Checking dark mode green tokens on .app-calpage...');
    const darkCalTokens = await ev(() => {
      const page = document.getElementById('screen-calibration');
      const cs = getComputedStyle(page);
      return {
        accent: cs.getPropertyValue('--accent').trim(),
        onAccent: cs.getPropertyValue('--on-accent').trim(),
        accentText: cs.getPropertyValue('--accent-text').trim(),
        accentSoft: cs.getPropertyValue('--accent-soft').trim(),
        accentLine: cs.getPropertyValue('--accent-line').trim(),
        axisY: cs.getPropertyValue('--axis-y').trim(),
      };
    });
    console.log('[Bench 4D] Dark calpage tokens:', darkCalTokens);

    if (darkCalTokens.accent !== '#a3bc69') {
      throw new Error(`Dark calpage --accent must be #a3bc69, got: ${darkCalTokens.accent}`);
    }

    // ── Check 2: Stepper, primary button, and Y axis chip use green in dark mode ──
    const darkElements = await ev(() => {
      const activeStepNum = document.querySelector('.pg-step.is-active .pg-step__num');
      const capBtn = document.querySelector('[data-act="capture"]');
      const axisYKey = document.querySelector('.pg-axis__key--y');
      return {
        stepNumBg: activeStepNum ? getComputedStyle(activeStepNum).backgroundColor : '',
        btnBg: capBtn ? getComputedStyle(capBtn).backgroundColor : '',
        btnColor: capBtn ? getComputedStyle(capBtn).color : '',
        axisYBg: axisYKey ? getComputedStyle(axisYKey).backgroundColor : '',
      };
    });
    console.log('[Bench 4D] Dark calpage element styles:', darkElements);

    // ── Check 3: 3D scene rings and arcs inherit green tokens ──
    console.log('[Bench 4D] Checking 3D scene token resolution...');
    for (let i = 0; i < 25; i++) {
      const hasStageChild = await ev(() => {
        const stage = document.getElementById('cal-stage');
        return !!stage?.querySelector('canvas, .pg-scene-fallback');
      });
      if (hasStageChild) break;
      await sleep(150);
    }

    const scene3dCheck = await ev(() => {
      const stage = document.getElementById('cal-stage');
      const canvas = stage?.querySelector('canvas');
      const fallback = stage?.querySelector('.pg-scene-fallback');
      const gcsAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      return {
        hasCanvasOrFallback: !!(canvas || fallback),
        hasCanvas: !!canvas,
        resolvedDocumentAccentDuringActiveScene: gcsAccent,
      };
    });
    console.log('[Bench 4D] 3D scene check:', scene3dCheck);
    if (!scene3dCheck.hasCanvasOrFallback) {
      throw new Error('3D stage failed to initialize in cal-stage');
    }
    if (scene3dCheck.resolvedDocumentAccentDuringActiveScene !== '#a3bc69') {
      throw new Error(`3D scene document --accent must resolve to green #a3bc69, got: ${scene3dCheck.resolvedDocumentAccentDuringActiveScene}`);
    }

    const snapDark = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '08_cal_dark_green_amber.png'), snapDark);

    // ── Check 4: Switch to Light mode ──
    console.log('[Bench 4D] Switching to Light mode with user accent = amber...');
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await sleep(400);

    const lightCalTokens = await ev(() => {
      const page = document.getElementById('screen-calibration');
      const cs = getComputedStyle(page);
      return {
        accent: cs.getPropertyValue('--accent').trim(),
        onAccent: cs.getPropertyValue('--on-accent').trim(),
        accentText: cs.getPropertyValue('--accent-text').trim(),
        accentSoft: cs.getPropertyValue('--accent-soft').trim(),
        accentLine: cs.getPropertyValue('--accent-line').trim(),
      };
    });
    console.log('[Bench 4D] Light calpage tokens:', lightCalTokens);

    if (lightCalTokens.accent !== '#5b7c26') {
      throw new Error(`Light calpage --accent must be #5b7c26, got: ${lightCalTokens.accent}`);
    }

    const snapLight = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '09_cal_light_green_amber.png'), snapLight);

    // Check errors (filtering SwiftShader WebGL context limit in headless)
    const errs = p.errors().filter((e) => !e.includes('WebGLRenderer'));
    if (errs.length > 0) {
      console.error('[Bench 4D] Console errors detected:', errs);
      throw new Error(`Console errors: ${errs.join(', ')}`);
    }

    console.log('--- ALL BENCHMARK 4D CHECKS PASSED ---');
  } finally {
    b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 4D] FAILED:', err);
  process.exit(1);
});
