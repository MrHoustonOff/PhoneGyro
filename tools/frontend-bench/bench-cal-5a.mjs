// Benchmark for Task 5A: Palette via html.is-calibrating, WebGL loseContext, 25 open/close cycles
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('[Bench 5A] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 5A] Server running at ${srv.base}`);

  console.log('[Bench 5A] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 5A] Loading app with user accent = amber (#f2cc85)...');
    await p.goto(`${srv.base}/index.html`, 2500);

    await ev(() => {
      document.documentElement.setAttribute('data-accent', 'amber');
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(300);

    // ── Check 1: window.getComputedStyle is NOT monkey-patched ──
    console.log('[Bench 5A] Verifying getComputedStyle is native...');
    const isUnpatched = await ev(() => {
      const fnStr = window.getComputedStyle.toString();
      const hasHook = !!window.__gyroSceneHooked;
      return {
        isNative: fnStr.includes('[native code]'),
        hasHook,
      };
    });
    console.log('[Bench 5A] getComputedStyle check:', isUnpatched);
    if (!isUnpatched.isNative || isUnpatched.hasHook) {
      throw new Error(`getComputedStyle is still monkey-patched! ${JSON.stringify(isUnpatched)}`);
    }

    // ── Check 2: html.is-calibrating palette switch & revert ──
    console.log('[Bench 5A] Checking palette switch between main and calibration...');
    const mainAccent = await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    console.log('[Bench 5A] Main screen accent:', mainAccent);
    if (mainAccent !== '#f2cc85') {
      throw new Error(`Expected main accent #f2cc85, got ${mainAccent}`);
    }

    // Open calibration
    await ev(() => {
      document.getElementById('btn-calibrate')?.click();
    });
    await sleep(400);

    const calCheck = await ev(() => {
      const htmlHasClass = document.documentElement.classList.contains('is-calibrating');
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const titlebarTitleColor = getComputedStyle(document.querySelector('.pg-titlebar__title')).color;
      return {
        htmlHasClass,
        accent,
        titlebarTitleColor,
      };
    });
    console.log('[Bench 5A] Calibration open check:', calCheck);
    if (!calCheck.htmlHasClass || calCheck.accent !== '#a3bc69') {
      throw new Error(`Calibration palette failed: expected html.is-calibrating with #a3bc69, got ${JSON.stringify(calCheck)}`);
    }

    // Close calibration
    await ev(() => {
      document.getElementById('cal-x')?.click();
    });
    await sleep(400);

    const afterCloseAccent = await ev(() => {
      const htmlHasClass = document.documentElement.classList.contains('is-calibrating');
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      return { htmlHasClass, accent };
    });
    console.log('[Bench 5A] After close check:', afterCloseAccent);
    if (afterCloseAccent.htmlHasClass || afterCloseAccent.accent !== '#f2cc85') {
      throw new Error(`Revert failed: expected accent #f2cc85 without is-calibrating, got ${JSON.stringify(afterCloseAccent)}`);
    }

    // ── Check 3: 25 Open / Close cycles without WebGL context exhaustion ──
    console.log('[Bench 5A] Testing 25 consecutive open / close cycles for WebGL context leaks...');
    for (let i = 1; i <= 25; i++) {
      await ev(() => {
        document.getElementById('btn-calibrate')?.click();
      });
      // Wait for scene to mount canvas
      await sleep(150);

      const sceneStatus = await ev(() => {
        const stage = document.getElementById('cal-stage');
        const canvas = stage?.querySelector('canvas');
        const fallback = stage?.querySelector('.pg-scene-fallback');
        return {
          hasCanvas: !!canvas,
          hasFallback: !!fallback,
          fallbackText: fallback?.textContent,
        };
      });

      if (sceneStatus.hasFallback || !sceneStatus.hasCanvas) {
        throw new Error(`Cycle ${i}/25 FAILED: WebGL context exhausted or 3D unavailable! ${JSON.stringify(sceneStatus)}`);
      }

      // Close calibration (triggers scene.dispose() and WebGL_lose_context)
      await ev(() => {
        document.getElementById('cal-x')?.click();
      });
      await sleep(100);

      if (i % 5 === 0) {
        console.log(`[Bench 5A] Completed ${i}/25 cycles successfully (canvas mounted & disposed)`);
      }
    }

    console.log('[Bench 5A] ALL 25 CYCLES PASSED WITHOUT A SINGLE WEBGL FALLBACK!');
  } finally {
    await b.close();
    await srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 5A FAILED]', err);
  process.exit(1);
});
