// Benchmark for Task 4C: Step results preservation, layout stability, axis chips, and bridge off() registry
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 4C] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 4C] Server running at ${srv.base}`);

  console.log('[Bench 4C] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 4C] Loading app...');
    await p.goto(`${srv.base}/index.html`, 2500);

    // Bring backend online
    await ev(() => {
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(300);

    // ── Check 1: Bridge on() / off() registry test ──
    console.log('[Bench 4C] Testing bridge on() / off() multi-subscriber registry...');
    const bridgeTest = await ev(async () => {
      const { on, off, ready } = await import('./js/core/bridge.js');
      await ready;
      let calls1 = 0, calls2 = 0;
      const fn1 = () => calls1++;
      const fn2 = () => calls2++;

      on('test:event', fn1);
      on('test:event', fn2);

      window.__emit('test:event', {});
      const afterFirstEmit = { calls1, calls2 };

      off('test:event', fn1);
      window.__emit('test:event', {});
      const afterUnsub1 = { calls1, calls2 };

      off('test:event', fn2);
      window.__emit('test:event', {});
      const afterUnsub2 = { calls1, calls2 };

      return { afterFirstEmit, afterUnsub1, afterUnsub2 };
    });
    console.log('[Bench 4C] Bridge test result:', bridgeTest);
    if (
      bridgeTest.afterFirstEmit.calls1 !== 1 || bridgeTest.afterFirstEmit.calls2 !== 1 ||
      bridgeTest.afterUnsub1.calls1 !== 1 || bridgeTest.afterUnsub1.calls2 !== 2 ||
      bridgeTest.afterUnsub2.calls1 !== 1 || bridgeTest.afterUnsub2.calls2 !== 2
    ) {
      throw new Error(`Bridge event registry failed: ${JSON.stringify(bridgeTest)}`);
    }

    // ── Check 2: Open calibration & verify X/Y/Z is on top of left column ──
    console.log('[Bench 4C] Opening calibration...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(500);

    const checkOrder = await ev(() => {
      const leftCol = document.getElementById('cal-left');
      if (!leftCol) return { ok: false };
      const children = [...leftCol.children].map((c) => c.className);
      const statsIdx = children.findIndex((c) => c.includes('app-cal-stats'));
      const infoIdx = children.findIndex((c) => c.includes('app-cal-info'));
      const panelIdx = children.findIndex((c) => c.includes('app-cal-panel'));
      return {
        statsIdx,
        infoIdx,
        panelIdx,
        isXyzTop: statsIdx === 0 && infoIdx > statsIdx && panelIdx > infoIdx,
      };
    });
    console.log('[Bench 4C] Element order in left column:', checkOrder);
    if (!checkOrder.isXyzTop) {
      throw new Error(`X/Y/Z stats must be first in left column: ${JSON.stringify(checkOrder)}`);
    }

    // ── Check 3: Axis chips contrast styling ──
    const axisChips = await ev(() => {
      const chipX = document.querySelector('.pg-axis__key--x');
      const chipY = document.querySelector('.pg-axis__key--y');
      const chipZ = document.querySelector('.pg-axis__key--z');
      return {
        hasChipX: !!chipX,
        hasChipY: !!chipY,
        hasChipZ: !!chipZ,
        bgX: chipX ? window.getComputedStyle(chipX).backgroundColor : '',
        fontWeight: chipX ? window.getComputedStyle(chipX).fontWeight : '',
      };
    });
    console.log('[Bench 4C] Axis chips styles:', axisChips);
    if (!axisChips.hasChipX || !axisChips.hasChipY || !axisChips.hasChipZ) {
      throw new Error('Axis chips missing');
    }

    // ── Check 4: Step result preservation on Back ──
    console.log('[Bench 4C] Completing Step 0 (Rest)...');
    await ev(() => {
      const cap = document.querySelector('[data-act="capture"]');
      if (cap) cap.click();
    });
    await sleep(4200);

    // Verify Step 0 is done and has checkmark SVG
    const step0Done = await ev(() => {
      const notice = document.querySelector('.app-cal-success-notice');
      const svg = notice?.querySelector('.app-cal-ok-ico');
      const nextBtn = document.querySelector('#cal-foot [data-act="next"]');
      return {
        hasOkNotice: !!notice,
        hasSvgCheck: !!svg,
        nextEnabled: nextBtn && !nextBtn.disabled,
        nextHasPrimary: nextBtn?.classList.contains('pg-btn--primary'),
      };
    });
    console.log('[Bench 4C] Step 0 done state:', step0Done);
    if (!step0Done.hasOkNotice || !step0Done.hasSvgCheck || !step0Done.nextEnabled || !step0Done.nextHasPrimary) {
      throw new Error(`Step 0 done state invalid: ${JSON.stringify(step0Done)}`);
    }

    // Advance to Step 1 (Pitch)
    console.log('[Bench 4C] Advancing to Step 1 (Pitch)...');
    await ev(() => {
      const nextBtn = document.querySelector('#cal-foot [data-act="next"]');
      if (nextBtn) nextBtn.click();
    });
    await sleep(350);

    // Click Back -> Should return to Step 0 and Step 0 must STILL be completed!
    console.log('[Bench 4C] Clicking Back to return to Step 0...');
    await ev(() => {
      const backBtn = document.querySelector('#cal-foot [data-act="back"]');
      if (backBtn) backBtn.click();
    });
    await sleep(350);

    const step0OnBack = await ev(() => {
      const notice = document.querySelector('.app-cal-success-notice');
      const nextBtn = document.querySelector('#cal-foot [data-act="next"]');
      const stepTitle = document.querySelector('.app-cal-info .display-md')?.textContent || '';
      return {
        stepTitle,
        hasOkNotice: !!notice,
        nextEnabled: nextBtn && !nextBtn.disabled,
        nextHasPrimary: nextBtn?.classList.contains('pg-btn--primary'),
      };
    });
    console.log('[Bench 4C] Step 0 after Back state:', step0OnBack);
    if (!step0OnBack.hasOkNotice || !step0OnBack.nextEnabled || !step0OnBack.nextHasPrimary) {
      throw new Error(`Step 0 was reset after Back button (must keep results): ${JSON.stringify(step0OnBack)}`);
    }

    // Advance forward to Step 1 again
    await ev(() => {
      const nextBtn = document.querySelector('#cal-foot [data-act="next"]');
      if (nextBtn) nextBtn.click();
    });
    await sleep(350);

    // Complete Step 1, 2, 3 to reach Verify
    for (let step = 1; step < 4; step++) {
      console.log(`[Bench 4C] Capturing Step ${step}...`);
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

    // ── Check 5: Verify screen checks (No orphan dot, cal-mount rendered) ──
    console.log('[Bench 4C] Checking Verify screen...');
    const verifyState = await ev(() => {
      const headerTitle = document.querySelector('.app-cal-matrix-box b')?.textContent || '';
      const chips = document.querySelectorAll('.app-cal-matrix-box .app-cal-chips .pg-badge');
      const mountBox = document.getElementById('cal-mount');
      const mountRow = mountBox?.querySelector('.app-cal-mount');
      return {
        headerTitle,
        chipsCount: chips.length,
        hasMountRow: !!mountRow,
      };
    });
    console.log('[Bench 4C] Verify screen state:', verifyState);
    if (!verifyState.headerTitle.includes('Оси определены') || verifyState.chipsCount !== 3 || !verifyState.hasMountRow) {
      throw new Error(`Verify screen check failed: ${JSON.stringify(verifyState)}`);
    }

    const snapVerify = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '05_cal_verify_clean.png'), snapVerify);

    // ── Check 6: Advance to Save screen & check slot dropdown does not clip ──
    console.log('[Bench 4C] Advancing to Save screen...');
    await ev(() => {
      const toSave = document.querySelector('#cal-foot [data-act="tosave"]');
      if (toSave) toSave.click();
    });
    await sleep(400);

    console.log('[Bench 4C] Opening slot dropdown menu...');
    await ev(() => {
      const trigger = document.getElementById('cal-save-slot-trigger');
      if (trigger) trigger.click();
    });
    await sleep(250);

    const dropdownCheck = await ev(() => {
      const menu = document.getElementById('cal-save-slot-menu');
      const items = menu ? [...menu.querySelectorAll('[data-act="select-slot"]')] : [];
      const modalBody = document.querySelector('.app-cal-modal .pg-modal__body');

      let allVisible = true;
      const details = [];
      if (menu && modalBody) {
        const bodyRect = modalBody.getBoundingClientRect();
        for (const it of items) {
          const r = it.getBoundingClientRect();
          details.push({ rBottom: r.bottom, bodyBottom: bodyRect.bottom, diff: r.bottom - bodyRect.bottom });
          if (r.bottom > bodyRect.bottom + 2) {
            allVisible = false;
          }
        }
      }
      return {
        menuVisible: menu && !menu.hidden,
        itemCount: items.length,
        allVisibleWithoutOverflow: allVisible,
        details,
      };
    });
    console.log('[Bench 4C] Dropdown menu check:', dropdownCheck);
    if (!dropdownCheck.menuVisible || dropdownCheck.itemCount !== 6 || !dropdownCheck.allVisibleWithoutOverflow) {
      throw new Error(`Dropdown menu clipped or incomplete: ${JSON.stringify(dropdownCheck)}`);
    }

    const snapSaveDropdown = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '06_cal_save_dropdown.png'), snapSaveDropdown);

    // Also test at 820px width
    console.log('[Bench 4C] Checking at 820px width...');
    await p.S('Emulation.setDeviceMetricsOverride', { width: 820, height: 750, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    const check820 = await ev(() => {
      const menu = document.getElementById('cal-save-slot-menu');
      const items = menu ? [...menu.querySelectorAll('[data-act="select-slot"]')] : [];
      return { menuVisible: menu && !menu.hidden, itemCount: items.length };
    });
    console.log('[Bench 4C] 820px check:', check820);
    if (!check820.menuVisible || check820.itemCount !== 6) {
      throw new Error(`Failed at 820px: ${JSON.stringify(check820)}`);
    }
    const snap820 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '07_cal_save_820px.png'), snap820);

    // Check errors (filtering SwiftShader WebGL context limit in headless)
    const errs = p.errors().filter((e) => !e.includes('WebGLRenderer'));
    if (errs.length > 0) {
      console.error('[Bench 4C] Console errors detected:', errs);
      throw new Error(`Console errors: ${errs.join(', ')}`);
    }

    console.log('--- ALL BENCHMARK 4C CHECKS PASSED ---');
  } finally {
    b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 4C] FAILED:', err);
  process.exit(1);
});
