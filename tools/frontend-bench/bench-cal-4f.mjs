// Benchmark for Task 4F: Ring corners and overlines across the calibration page
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 4F] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 4F] Server running at ${srv.base}`);

  console.log('[Bench 4F] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 4F] Loading app...');
    await p.goto(`${srv.base}/index.html`, 2500);

    await ev(() => {
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(300);

    // Open calibration
    console.log('[Bench 4F] Opening calibration...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(500);

    // ── Check 1: Card corner rings & Step 0 (Rest) decor ──
    console.log('[Bench 4F] Checking Step 0 decor...');
    const step0Decor = await ev(() => {
      const card = document.getElementById('cal-card');
      const overline = document.querySelector('.app-cal-left .app-cal-overline');
      const ring = overline?.querySelector('.pg-ring');
      const panel = document.querySelector('.app-cal-panel');
      const legend = document.getElementById('cal-legend');
      const legendItems = legend ? [...legend.querySelectorAll('.app-cal-legend-item')] : [];

      return {
        cardHasCornerRings: card?.classList.contains('pg-rings-corner'),
        cardHasDiagRings: card?.classList.contains('has-diag-rings'),
        hasOverline: !!overline,
        hasRingInOverline: !!ring,
        overlineText: overline?.textContent?.trim(),
        panelCornerClass: panel?.className,
        hasLegend: !!legend,
        legendItemsCount: legendItems.length,
      };
    });
    console.log('[Bench 4F] Step 0 decor:', step0Decor);

    if (!step0Decor.cardHasCornerRings || !step0Decor.cardHasDiagRings) {
      throw new Error(`Cal card corner rings missing: ${JSON.stringify(step0Decor)}`);
    }
    if (!step0Decor.hasOverline || !step0Decor.hasRingInOverline) {
      throw new Error(`Step 0 overline with pg-ring missing: ${JSON.stringify(step0Decor)}`);
    }
    if (!step0Decor.panelCornerClass.includes('app-cal-ring-corner--br')) {
      throw new Error(`Step 0 panel expected --br corner: ${step0Decor.panelCornerClass}`);
    }
    if (!step0Decor.hasLegend || step0Decor.legendItemsCount !== 3) {
      throw new Error(`Stage axis legend missing or incomplete: ${JSON.stringify(step0Decor)}`);
    }

    const snap0 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '11_cal_step0_decor_dark.png'), snap0);

    // ── Advance through steps 1, 2, 3 and check alternating corner rings & overlines ──
    const expectedCorners = [
      'app-cal-ring-corner--tr', // Step 1
      'app-cal-ring-corner--bl', // Step 2
      'app-cal-ring-corner--tl', // Step 3
    ];

    for (let step = 0; step < 3; step++) {
      console.log(`[Bench 4F] Capturing step ${step}...`);
      await ev(() => {
        const cap = document.querySelector('[data-act="capture"]');
        if (cap) cap.click();
      });
      await sleep(4200);

      await ev(() => {
        const next = document.querySelector('#cal-foot [data-act="next"]');
        if (next) next.click();
      });
      await sleep(400);

      const currentStep = step + 1;
      const stepCheck = await ev(() => {
        const overline = document.querySelector('.app-cal-left .app-cal-overline');
        const ring = overline?.querySelector('.pg-ring');
        const panel = document.querySelector('.app-cal-panel');
        return {
          overlineText: overline?.textContent?.trim(),
          hasRing: !!ring,
          panelClass: panel?.className,
        };
      });
      console.log(`[Bench 4F] Step ${currentStep} decor:`, stepCheck);

      if (!stepCheck.hasRing) {
        throw new Error(`Step ${currentStep} overline missing pg-ring: ${JSON.stringify(stepCheck)}`);
      }
      if (!stepCheck.panelClass.includes(expectedCorners[step])) {
        throw new Error(`Step ${currentStep} expected corner ${expectedCorners[step]}, got: ${stepCheck.panelClass}`);
      }
    }

    // Step 3 (Axes gesture)
    console.log('[Bench 4F] Capturing step 3 (Axes gesture)...');
    await ev(() => {
      const cap = document.querySelector('[data-act="capture"]');
      if (cap) cap.click();
    });
    await sleep(1500);

    await ev(() => {
      const next = document.querySelector('#cal-foot [data-act="next"]');
      if (next) next.click();
    });
    await sleep(400);

    // ── Check 2: Verify screen decor ──
    console.log('[Bench 4F] Checking Verify screen decor...');
    const verifyDecor = await ev(() => {
      const overline = document.querySelector('.app-cal-left .app-cal-overline');
      const ring = overline?.querySelector('.pg-ring');
      const matrixCard = document.querySelector('.app-cal-matrix-card');
      const matrixRing = matrixCard?.querySelector('.pg-row .pg-ring');

      return {
        hasOverline: !!overline,
        hasRing: !!ring,
        overlineText: overline?.textContent?.trim(),
        matrixHasCornerRing: matrixCard?.classList.contains('app-cal-ring-corner--tr'),
        matrixHasHeaderRing: !!matrixRing,
      };
    });
    console.log('[Bench 4F] Verify decor:', verifyDecor);

    if (!verifyDecor.hasOverline || !verifyDecor.hasRing || !verifyDecor.matrixHasCornerRing || !verifyDecor.matrixHasHeaderRing) {
      throw new Error(`Verify decor incomplete: ${JSON.stringify(verifyDecor)}`);
    }

    const snapVerify = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '12_cal_verify_decor_dark.png'), snapVerify);

    // ── Check 3: Save screen decor ──
    console.log('[Bench 4F] Advancing to Save screen...');
    await ev(() => {
      const toSave = document.querySelector('#cal-foot [data-act="tosave"]');
      if (toSave) toSave.click();
    });
    await sleep(400);

    const saveDecor = await ev(() => {
      const formOverline = document.querySelector('.app-cal-save-form .app-cal-overline');
      const formRing = formOverline?.querySelector('.pg-ring');
      const prevOverline = document.querySelector('.app-cal-save-preview .app-cal-preview-head');
      const prevRing = prevOverline?.querySelector('.pg-ring');
      const prevCard = document.querySelector('.app-cal-preview-card');
      const sumOverline = prevCard?.querySelector('.app-cal-preview-summary .pg-overline');
      const sumRing = sumOverline?.querySelector('.pg-ring');

      return {
        formHasRing: !!formRing,
        formOverlineText: formOverline?.textContent?.trim(),
        prevHasRing: !!prevRing,
        prevCardCorner: prevCard?.classList.contains('app-cal-ring-corner--br'),
        sumHasRing: !!sumRing,
      };
    });
    console.log('[Bench 4F] Save screen decor:', saveDecor);

    if (!saveDecor.formHasRing || !saveDecor.prevHasRing || !saveDecor.prevCardCorner || !saveDecor.sumHasRing) {
      throw new Error(`Save screen decor incomplete: ${JSON.stringify(saveDecor)}`);
    }

    const snapSave = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '13_cal_save_decor_dark.png'), snapSave);

    // ── Check 4: Disconnect card decor ──
    console.log('[Bench 4F] Checking Disconnect modal card decor...');
    const disDecor = await ev(() => {
      const disCard = document.querySelector('.app-cal-disconnect-card');
      return {
        hasRingsCorner: disCard?.classList.contains('pg-rings-corner'),
      };
    });
    console.log('[Bench 4F] Disconnect card decor:', disDecor);
    if (!disDecor.hasRingsCorner) {
      throw new Error(`Disconnect card missing pg-rings-corner: ${JSON.stringify(disDecor)}`);
    }

    // ── Check 5: Light theme verification ──
    console.log('[Bench 4F] Checking Light theme decor...');
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await sleep(200);

    const snapLight = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '14_cal_save_decor_light.png'), snapLight);

    // ── Check 6: English locale overline verification ──
    console.log('[Bench 4F] Checking EN locale...');
    await ev(async () => {
      const { setLang } = await import('./js/core/i18n.js');
      setLang('en');
    });
    await sleep(300);

    const enText = await ev(() => {
      const formOverline = document.querySelector('.app-cal-save-form .app-cal-overline');
      const prevOverline = document.querySelector('.app-cal-save-preview .app-cal-preview-head');
      return {
        formOverline: formOverline?.textContent?.trim(),
        prevOverline: prevOverline?.textContent?.trim(),
      };
    });
    console.log('[Bench 4F] EN overlines:', enText);
    if (!enText.formOverline?.toLowerCase().includes('save') && !enText.formOverline?.toLowerCase().includes('slot')) {
      throw new Error(`EN locale not reflected in overline: ${JSON.stringify(enText)}`);
    }

    console.log('[Bench 4F] ALL DECOR CHECKS PASSED SUCCESSFULLY!');
  } finally {
    await b.close();
    await srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 4F FAILED]', err);
  process.exit(1);
});
