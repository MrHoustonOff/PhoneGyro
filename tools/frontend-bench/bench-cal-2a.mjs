// Test for Task 2A: Calibration wizard straight to step 1 with 3D GyroScene
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 2A] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 2A] Server running at ${srv.base}`);

  console.log('[Bench 2A] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 2A] Loading app...');
    await p.goto(`${srv.base}/index.html`, 2500);

    // Click "Калибровать" on the connect screen
    console.log('[Bench 2A] Opening calibration...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(600);

    // Verify modal is open and on step 1 (Rest), NOT slots!
    const state0 = await ev(() => {
      const cal = document.getElementById('cal');
      const grid = document.getElementById('cal-grid');
      const stage = document.getElementById('cal-stage');
      const canvas = document.querySelector('#cal-stage canvas');
      const stats = document.getElementById('cal-stats');
      const slots = document.querySelector('.app-cal-slots');
      const title = document.getElementById('cal-step-title')?.textContent;
      const cap = document.getElementById('cal-stage-cap')?.textContent;
      return {
        open: !cal?.hidden,
        hasGrid: !!grid,
        hasStage: !!stage,
        hasCanvas: !!canvas,
        hasStats: !!stats,
        hasSlots: !!slots,
        title,
        cap,
      };
    });

    console.log('[Bench 2A] Step 1 (Rest) initial state:', state0);
    if (!state0.open) throw new Error('Calibration modal did not open');
    if (state0.hasSlots) throw new Error('Slots list still present! Expected direct step 1.');
    if (!state0.hasGrid || !state0.hasStage) throw new Error('2-column layout or stage missing');

    // Wait for 3D model to be fully ready
    await sleep(400);

    // Capture screenshot: Dark theme, Step 1 (Rest)
    console.log('[Bench 2A] Capturing screenshot: 01_step1_rest_dark.png...');
    const shot01 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '01_step1_rest_dark.png'), shot01);

    // Test live rotation rates update
    console.log('[Bench 2A] Simulating rotation rate in state...');
    await ev(() => {
      const s = window.__STATE;
      s.rawRotX = 14;
      s.rawRotY = -5;
      s.rawRotZ = 2;
      window.__emit('state:change', s);
    });
    await sleep(150);

    const rates = await ev(() => ({
      x: document.getElementById('cal-val-x')?.textContent,
      y: document.getElementById('cal-val-y')?.textContent,
      z: document.getElementById('cal-val-z')?.textContent,
    }));
    console.log('[Bench 2A] Live rates reading:', rates);
    if (rates.x !== '+14°/s' || rates.y !== '-5°/s' || rates.z !== '+2°/s') {
      throw new Error(`Rates mismatch: ${JSON.stringify(rates)}`);
    }

    // Step 1: Capture (Rest)
    console.log('[Bench 2A] Running capture on Step 1 (Rest)...');
    await ev(() => {
      const captureBtn = document.querySelector('#cal-foot [data-act="capture"]') || document.querySelector('#cal-left [data-act="capture"]');
      if (captureBtn) captureBtn.click();
    });
    // Wait for countdown (1.3s) + mid recording
    await sleep(2000);
    // Capture screenshot during recording
    const shot01Rec = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '01_step1_rest_recording.png'), shot01Rec);

    // Wait for capture to finish (1.6s duration + buffer)
    await sleep(1500);

    // Check step 1 done notice
    const step1Done = await ev(() => ({
      notice: document.querySelector('#cal-left .pg-notice--ok')?.textContent,
      nextBtn: document.querySelector('#cal-foot [data-act="next"]')?.textContent,
    }));
    console.log('[Bench 2A] Step 1 done state:', step1Done);

    // Click Next to advance to Step 2 (Pitch)
    console.log('[Bench 2A] Advancing to Step 2 (Pitch)...');
    await ev(() => {
      const nextBtn = document.querySelector('#cal-foot [data-act="next"]');
      if (nextBtn) nextBtn.click();
    });
    await sleep(500);

    const step2State = await ev(() => ({
      title: document.getElementById('cal-step-title')?.textContent,
      cap: document.getElementById('cal-stage-cap')?.textContent,
      hasCanvas: !!document.querySelector('#cal-stage canvas'),
    }));
    console.log('[Bench 2A] Step 2 (Pitch) state:', step2State);
    if (!step2State.hasCanvas) throw new Error('3D canvas lost on transition to Step 2');

    // Screenshot: Step 2 Pitch
    const shot02 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '02_step2_pitch.png'), shot02);

    // Advance to Step 3 (Roll)
    console.log('[Bench 2A] Advancing to Step 3 (Roll)...');
    await ev(() => {
      // Simulate done and advance
      const nextBtn = document.querySelector('#cal-foot [data-act="capture"]');
      if (nextBtn) nextBtn.click();
    });
    await sleep(4200); // 1300ms countdown + 2400ms recording + buffer
    await ev(() => {
      const nextBtn = document.querySelector('#cal-foot [data-act="next"]');
      if (nextBtn) nextBtn.click();
    });
    await sleep(500);

    // Screenshot: Step 3 Roll
    const shot03 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '03_step3_roll.png'), shot03);

    // Advance to Step 4 (Axes)
    console.log('[Bench 2A] Advancing to Step 4 (Axes)...');
    await ev(() => {
      const nextBtn = document.querySelector('#cal-foot [data-act="capture"]');
      if (nextBtn) nextBtn.click();
    });
    await sleep(4200);
    await ev(() => {
      const nextBtn = document.querySelector('#cal-foot [data-act="next"]');
      if (nextBtn) nextBtn.click();
    });
    await sleep(500);

    // Step 4: Axes
    const step4State = await ev(() => ({
      title: document.getElementById('cal-step-title')?.textContent,
      cap: document.getElementById('cal-stage-cap')?.textContent,
      hasStats: !!document.getElementById('cal-stats'),
    }));
    console.log('[Bench 2A] Step 4 (Axes) state:', step4State);
    if (step4State.hasStats) throw new Error('cal-stats should be hidden on axes step');

    // Screenshot: Step 4 Axes
    const shot04 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '04_step4_axes.png'), shot04);

    // Test Back button navigation
    console.log('[Bench 2A] Testing Back button to Step 3...');
    await ev(() => {
      const backBtn = document.querySelector('#cal-foot [data-act="back"]');
      if (backBtn) backBtn.click();
    });
    await sleep(300);

    // Light theme test
    console.log('[Bench 2A] Switching to Light theme...');
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await sleep(400);

    const shotLight = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '05_light_step3.png'), shotLight);

    // Narrow window test (responsive 1-column layout)
    console.log('[Bench 2A] Testing narrow window (820px)...');
    await p.S('Emulation.setDeviceMetricsOverride', {
      width: 820,
      height: 700,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);
    const shotNarrow = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '06_narrow_820px.png'), shotNarrow);

    // Reset window size and theme
    await p.S('Emulation.clearDeviceMetricsOverride');
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    // Close modal test
    console.log('[Bench 2A] Navigating back to step 1 and clicking Back to close...');
    await ev(() => {
      // Click back until step 0
      document.querySelector('#cal-foot [data-act="back"]')?.click();
    });
    await sleep(200);
    await ev(() => {
      document.querySelector('#cal-foot [data-act="back"]')?.click();
    });
    await sleep(200);
    // Now on step 0: clicking back should close
    await ev(() => {
      document.querySelector('#cal-foot [data-act="back"]')?.click();
    });
    await sleep(300);

    const closedState = await ev(() => ({
      calHidden: document.getElementById('cal')?.hidden,
      hasCanvas: !!document.querySelector('#cal-stage canvas'),
    }));
    console.log('[Bench 2A] Closed state:', closedState);
    if (!closedState.calHidden) throw new Error('Calibration modal did not close on Step 1 Back');
    if (closedState.hasCanvas) throw new Error('Stage canvas was not disposed on modal close');

    // Check errors
    const errs = p.errors();
    console.log('[Bench 2A] Console errors:', errs.length ? errs.join('\n') : 'none');
    if (errs.length > 0) throw new Error(`Errors during run: ${errs.join('; ')}`);

    console.log('[Bench 2A] ALL VERIFICATIONS PASSED.');
    console.log(`[Bench 2A] Screenshots saved to: ${OUT_DIR}`);
  } finally {
    b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 2A] FAILED:', err);
  process.exit(1);
});
