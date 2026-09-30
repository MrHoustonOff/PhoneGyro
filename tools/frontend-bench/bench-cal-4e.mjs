// Benchmark for Task 4E: Calibration Verify and Save screens filled with live content
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 4E] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 4E] Server running at ${srv.base}`);

  console.log('[Bench 4E] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 4E] Loading app...');
    await p.goto(`${srv.base}/index.html`, 2500);

    await ev(() => {
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(300);

    // Open calibration
    console.log('[Bench 4E] Opening calibration...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(500);

    // Advance through steps 0, 1, 2, 3 to reach Verify
    for (let step = 0; step < 4; step++) {
      console.log(`[Bench 4E] Capturing step ${step}...`);
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

    // ── Check 1: Verify screen live metrics & matrix ──
    console.log('[Bench 4E] Checking Verify screen content...');
    const verifyData = await ev(() => {
      const pEl = document.getElementById('cal-verify-pitch');
      const yEl = document.getElementById('cal-verify-yaw');
      const rEl = document.getElementById('cal-verify-roll');
      const matrixPre = document.querySelector('.app-cal-matrix-pre');
      const detBadge = document.querySelector('.app-cal-matrix-head .pg-badge');
      const mountRow = document.querySelector('#cal-mount .app-cal-mount');
      const duplicateLive = document.getElementById('cal-live');

      return {
        hasPitchVal: !!pEl && pEl.textContent.includes('°'),
        hasYawVal: !!yEl && yEl.textContent.includes('°'),
        hasRollVal: !!rEl && rEl.textContent.includes('°'),
        pitchVal: pEl?.textContent,
        matrixText: matrixPre?.textContent,
        detText: detBadge?.textContent,
        detIsOk: detBadge?.classList.contains('pg-badge--ok'),
        hasMountRow: !!mountRow,
        duplicateLiveEmpty: !duplicateLive || !duplicateLive.textContent.trim(),
      };
    });
    console.log('[Bench 4E] Verify screen elements:', verifyData);

    if (!verifyData.hasPitchVal || !verifyData.hasYawVal || !verifyData.hasRollVal) {
      throw new Error(`Verify stats values missing: ${JSON.stringify(verifyData)}`);
    }
    if (!verifyData.matrixText || !verifyData.matrixText.includes('[')) {
      throw new Error(`Matrix 3x3 not formatted: ${verifyData.matrixText}`);
    }
    if (!verifyData.detIsOk || !verifyData.hasMountRow || !verifyData.duplicateLiveEmpty) {
      throw new Error(`Verify screen layout incomplete: ${JSON.stringify(verifyData)}`);
    }

    // Stream live motion and check that pitch/yaw/roll live values update!
    console.log('[Bench 4E] Emitting live motion in verify phase...');
    await ev(() => {
      window.__emit('state:change', {
        status: 'online',
        pitch: 24.6,
        yaw: 12.3,
        roll: -18.2,
      });
    });
    await sleep(200);

    const updatedStats = await ev(() => {
      return {
        pitch: document.getElementById('cal-verify-pitch')?.textContent,
        yaw: document.getElementById('cal-verify-yaw')?.textContent,
        roll: document.getElementById('cal-verify-roll')?.textContent,
      };
    });
    console.log('[Bench 4E] Updated verify stats after motion:', updatedStats);
    if (!updatedStats.pitch.includes('25') || !updatedStats.yaw.includes('12') || !updatedStats.roll.includes('18')) {
      throw new Error(`Live rates did not update verify stat cards: ${JSON.stringify(updatedStats)}`);
    }

    const snapVerify = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '10_cal_verify_live_content.png'), snapVerify);

    // ── Check 2: Save screen 2-column layout and live profile preview ──
    console.log('[Bench 4E] Advancing to Save screen...');
    await ev(() => {
      const toSave = document.querySelector('#cal-foot [data-act="tosave"]');
      if (toSave) toSave.click();
    });
    await sleep(400);

    const saveLayout = await ev(() => {
      const form = document.querySelector('.app-cal-save-form');
      const preview = document.querySelector('.app-cal-save-preview');
      const previewCard = document.querySelector('.app-cal-preview-card');
      const previewName = document.getElementById('cal-preview-name');
      const chips = previewCard ? [...previewCard.querySelectorAll('.app-cal-chips .pg-badge')] : [];
      const meta = previewCard?.querySelector('.app-cal-preview-meta');

      return {
        hasFormCol: !!form,
        hasPreviewCol: !!preview,
        hasPreviewCard: !!previewCard,
        previewNameText: previewName?.textContent,
        chipsCount: chips.length,
        hasMeta: !!meta && meta.textContent.includes('Калибровка'),
      };
    });
    console.log('[Bench 4E] Save screen layout check:', saveLayout);

    if (!saveLayout.hasFormCol || !saveLayout.hasPreviewCol || !saveLayout.hasPreviewCard || saveLayout.chipsCount !== 3) {
      throw new Error(`Save screen 2-column preview missing or incomplete: ${JSON.stringify(saveLayout)}`);
    }

    // ── Check 3: Live name typing in preview card ──
    console.log('[Bench 4E] Testing live name typing in Save screen preview...');
    await ev(() => {
      const inp = document.getElementById('cal-name');
      if (inp) {
        inp.value = 'Custom Flight Stick';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(150);

    const liveNameCheck = await ev(() => {
      return document.getElementById('cal-preview-name')?.textContent;
    });
    console.log('[Bench 4E] Preview name after typing:', liveNameCheck);
    if (liveNameCheck !== 'Custom Flight Stick') {
      throw new Error(`Preview card name did not update on input: got "${liveNameCheck}"`);
    }

    // ── Check 4: Live icon choice in preview card ──
    console.log('[Bench 4E] Testing live icon change in preview card...');
    await ev(() => {
      const steerBtn = document.querySelector('[data-act="select-icon"][data-icon="steering"]');
      if (steerBtn) steerBtn.click();
    });
    await sleep(150);

    const previewIconUpdated = await ev(() => {
      const prevIcon = document.getElementById('cal-preview-icon');
      return !!prevIcon?.querySelector('svg');
    });
    if (!previewIconUpdated) {
      throw new Error('Preview card icon was not updated on selection');
    }

    const snapSave = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '11_cal_save_two_column_preview.png'), snapSave);

    // ── Check 5: Responsive stacking on 820px width ──
    console.log('[Bench 4E] Checking 820px responsive behavior...');
    await p.S('Emulation.setDeviceMetricsOverride', { width: 820, height: 750, deviceScaleFactor: 1, mobile: false });
    await sleep(250);

    const respCheck = await ev(() => {
      const grid = document.querySelector('.app-cal-save-grid');
      const cs = grid ? window.getComputedStyle(grid) : null;
      return {
        gridCols: cs?.gridTemplateColumns,
      };
    });
    console.log('[Bench 4E] 820px grid check:', respCheck);

    const snap820 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '12_cal_save_820px_responsive.png'), snap820);

    // Check errors (filtering SwiftShader WebGL context limit in headless)
    const errs = p.errors().filter((e) => !e.includes('WebGLRenderer'));
    if (errs.length > 0) {
      console.error('[Bench 4E] Console errors detected:', errs);
      throw new Error(`Console errors: ${errs.join(', ')}`);
    }

    console.log('--- ALL BENCHMARK 4E CHECKS PASSED ---');
  } finally {
    b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 4E] FAILED:', err);
  process.exit(1);
});
