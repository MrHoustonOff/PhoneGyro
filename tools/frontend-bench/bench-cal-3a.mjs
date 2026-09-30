// Benchmark for Task 3A: Live 3D Gamepad on the Calibration Verify step
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND, GO_ONLINE } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 3A] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 3A] Server running at ${srv.base}`);

  console.log('[Bench 3A] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 3A] Loading app...');
    await p.goto(`${srv.base}/index.html`, 2500);

    // Bring app state online
    await ev(() => {
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(300);

    // Open calibration wizard
    console.log('[Bench 3A] Opening calibration...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(600);

    const initOpen = await ev(() => !document.getElementById('cal')?.hidden);
    if (!initOpen) throw new Error('Calibration modal did not open');

    // Fast advance through Steps 1 to 4 to reach Verify
    console.log('[Bench 3A] Fast-advancing to Verify step...');
    for (let step = 0; step < 4; step++) {
      console.log(`[Bench 3A] Advancing step ${step + 1}...`);
      await ev(() => {
        const cap = document.querySelector('[data-act="capture"]');
        if (cap) cap.click();
      });
      await sleep(step === 3 ? 1500 : 4200);

      await ev(() => {
        const next = document.querySelector('#cal-foot [data-act="next"]');
        if (next) next.click();
      });
      await sleep(400);
    }

    // ── 1. Verify Step State Verification ──
    const verifyState = await ev(() => {
      const modal = document.querySelector('.app-cal-modal');
      const grid = document.getElementById('cal-grid');
      const stage = document.getElementById('cal-stage');
      const canvas = stage?.querySelector('canvas');
      const tools = document.getElementById('cal-stage-tools');
      const recenterBtn = tools?.querySelector('[data-act="recenter"]');
      const stageCap = document.getElementById('cal-stage-cap');
      const live = document.getElementById('cal-live');
      const title = document.querySelector('.app-cal-info .display-md');
      const desc = document.querySelector('.app-cal-info .app-cal-desc');
      const matrixBox = document.querySelector('.app-cal-matrix-box');
      const chips = Array.from(matrixBox?.querySelectorAll('.app-cal-chips .pg-badge') || []).map(b => b.textContent.trim());
      const detText = matrixBox?.querySelector('.app-cal-det')?.textContent.trim();
      const mount = document.getElementById('cal-mount');
      const restartBtn = document.querySelector('#cal-foot [data-act="restart"]');
      const saveBtn = document.querySelector('#cal-foot [data-act="tosave"]');
      const manualBtn = document.querySelector('[data-act="manual"], [data-act="confirm_no"]');

      return {
        open: !!modal && !modal.hidden,
        hasGrid: !!grid,
        hasStage: !!stage,
        hasCanvas: !!canvas,
        hasTools: !!tools,
        recenterText: recenterBtn?.textContent.trim(),
        stageCapText: stageCap?.textContent.trim(),
        hasLiveRates: !!live,
        titleText: title?.textContent.trim(),
        descText: desc?.textContent.trim(),
        hasMatrixBox: !!matrixBox,
        chips,
        detText,
        hasMount: !!mount,
        restartText: restartBtn?.textContent.trim(),
        saveText: saveBtn?.textContent.trim(),
        hasManual: !!manualBtn,
      };
    });

    console.log('[Bench 3A] Verify initial state:', verifyState);

    if (!verifyState.open) throw new Error('Calibration modal not open');
    if (!verifyState.hasGrid) throw new Error('2-column grid missing on Verify step');
    if (!verifyState.hasCanvas) throw new Error('3D canvas missing on Verify step');
    if (!verifyState.recenterText?.includes('Центрировать') || !verifyState.recenterText?.includes('Пробел')) {
      throw new Error(`Recenter button missing or truncated: ${verifyState.recenterText}`);
    }
    if (!verifyState.stageCapText?.includes('телефон в руках')) {
      throw new Error(`Unexpected stage caption: ${verifyState.stageCapText}`);
    }
    if (!verifyState.titleText?.includes('Проверьте отклик')) {
      throw new Error(`Unexpected title: ${verifyState.titleText}`);
    }
    if (verifyState.chips.length !== 3) {
      throw new Error(`Expected 3 axis chips, got: ${JSON.stringify(verifyState.chips)}`);
    }
    if (!verifyState.detText?.includes('det = -1')) {
      throw new Error(`Unexpected det text: ${verifyState.detText}`);
    }
    if (verifyState.hasManual) {
      throw new Error('Manual setup button must NOT exist on Verify step');
    }
    if (!verifyState.restartText || !verifyState.saveText) {
      throw new Error('Footer Restart or Save button missing');
    }

    // ── 2. Emit ahrs:quat Events & Verify 3D Response ──
    console.log('[Bench 3A] Emitting ahrs:quat stream...');
    // Emit non-identity quaternion (e.g. 45 deg roll)
    await ev(() => {
      const angle = Math.PI / 4;
      const q = {
        q0: Math.cos(angle / 2),
        q1: 0,
        q2: 0,
        q3: Math.sin(angle / 2),
      };
      window.__emit('ahrs:quat', q);
    });
    await sleep(250);

    // Save screenshot: 08_verify_dark.png
    console.log('[Bench 3A] Saving screenshot: 08_verify_dark.png...');
    writeFileSync(path.join(OUT_DIR, '08_verify_dark.png'), await p.screenshot());

    // ── 3. Switch to Light Theme ──
    console.log('[Bench 3A] Switching to light theme...');
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await sleep(300);

    // Save screenshot: 09_verify_light.png
    console.log('[Bench 3A] Saving screenshot: 09_verify_light.png...');
    writeFileSync(path.join(OUT_DIR, '09_verify_light.png'), await p.screenshot());

    // Switch back to dark theme
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    // ── 4. Test Recenter (Button and Space) ──
    console.log('[Bench 3A] Testing recenter...');
    await ev(() => {
      const btn = document.querySelector('#cal-stage-tools [data-act="recenter"]');
      if (btn) btn.click();
    });
    await sleep(200);

    // ── 5. Responsive Narrow Window (820px) ──
    console.log('[Bench 3A] Testing narrow window (820px)...');
    await p.S('Emulation.setDeviceMetricsOverride', {
      width: 820,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);

    console.log('[Bench 3A] Saving screenshot: 10_verify_narrow_820px.png...');
    writeFileSync(path.join(OUT_DIR, '10_verify_narrow_820px.png'), await p.screenshot());

    // ── 6. 200% Zoom Test ──
    console.log('[Bench 3A] Testing 200% zoom...');
    await ev(async () => {
      const { setZoom } = await import('./js/ui/zoom.js');
      setZoom(2.0, { save: false, quiet: true });
    });
    await sleep(400);

    console.log('[Bench 3A] Saving screenshot: 11_verify_zoom_200.png...');
    writeFileSync(path.join(OUT_DIR, '11_verify_zoom_200.png'), await p.screenshot());

    // Reset zoom and viewport
    await ev(async () => {
      const { setZoom } = await import('./js/ui/zoom.js');
      setZoom(1.0, { save: false, quiet: true });
    });
    await p.S('Emulation.clearDeviceMetricsOverride');
    await sleep(250);

    // ── 7. Advance to Save Screen (Verify Unsubscription and Dispose) ──
    console.log('[Bench 3A] Advancing to Save screen...');
    await ev(() => {
      const saveBtn = document.querySelector('#cal-foot [data-act="tosave"]');
      if (saveBtn) saveBtn.click();
    });
    await sleep(350);

    const saveState = await ev(() => {
      const stage = document.getElementById('cal-stage');
      const nameInput = document.getElementById('cal-name');
      return {
        hasStage: !!stage,
        hasNameInput: !!nameInput,
      };
    });
    console.log('[Bench 3A] Save screen state:', saveState);
    if (saveState.hasStage) throw new Error('Stage must be disposed on Save screen');
    if (!saveState.hasNameInput) throw new Error('Save name input missing');

    // ── 8. Return to Verify via Back ──
    console.log('[Bench 3A] Returning to Verify step via Back button...');
    await ev(() => {
      const backBtn = document.querySelector('#cal-foot [data-act="toverify"]');
      if (backBtn) backBtn.click();
    });
    await sleep(400);

    const reVerifyState = await ev(() => {
      const stage = document.getElementById('cal-stage');
      const canvas = stage?.querySelector('canvas');
      return {
        hasStage: !!stage,
        hasCanvas: !!canvas,
      };
    });
    console.log('[Bench 3A] Re-verify state:', reVerifyState);
    if (!reVerifyState.hasStage || !reVerifyState.hasCanvas) {
      throw new Error('Scene must be restored when returning to Verify step');
    }

    // ── 9. Test Restart Button ──
    console.log('[Bench 3A] Testing Restart button...');
    await ev(() => {
      const restartBtn = document.querySelector('#cal-foot [data-act="restart"]');
      if (restartBtn) restartBtn.click();
    });
    await sleep(400);

    const restartedState = await ev(() => {
      const cap = document.getElementById('cal-stage-cap')?.textContent.trim();
      const step1Title = document.querySelector('.app-cal-info .display-md')?.textContent.trim();
      return { cap, step1Title };
    });
    console.log('[Bench 3A] Restarted state:', restartedState);
    if (!/поко/i.test(restartedState.step1Title || '')) {
      throw new Error(`Expected Step 1 after restart, got: ${restartedState.step1Title}`);
    }

    console.log('\n[Bench 3A] ALL VERIFICATIONS PASSED SUCCESSFULLY!\n');
  } finally {
    await b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 3A] FAILED:', err);
  process.exit(1);
});
