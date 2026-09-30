// Benchmark for Task 4B: Calibration as its own page, confirmation dialog, and disconnect card
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 4B] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 4B] Server running at ${srv.base}`);

  console.log('[Bench 4B] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 4B] Loading app...');
    await p.goto(`${srv.base}/index.html`, 2500);

    // Bring backend online
    await ev(() => {
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(300);

    // ── Check 1: Open calibration and verify page structure ──
    console.log('[Bench 4B] Opening calibration...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(500); // wait for fade transition

    const check1 = await ev(() => {
      const calScreen = document.getElementById('screen-calibration');
      const header = document.getElementById('header');
      const footer = document.getElementById('footer');
      const shell = document.getElementById('shell');
      const oldCalOverlay = document.getElementById('cal');
      const titlebar = document.getElementById('titlebar');
      const calCard = document.getElementById('cal-card');
      const computedCardWidth = calCard ? window.getComputedStyle(calCard).maxWidth : null;

      return {
        calVisible: calScreen && !calScreen.hidden,
        headerHidden: header ? header.hidden : true,
        footerHidden: footer ? footer.hidden : true,
        hasNoChrome: shell && shell.classList.contains('has-no-chrome'),
        oldOverlayExists: !!oldCalOverlay,
        titlebarVisible: titlebar && !titlebar.hidden,
        cardMaxWidth: computedCardWidth,
      };
    });
    console.log('[Bench 4B] Calibration page state:', check1);
    if (!check1.calVisible || !check1.headerHidden || !check1.footerHidden || !check1.hasNoChrome || check1.oldOverlayExists) {
      throw new Error(`Calibration page check failed: ${JSON.stringify(check1)}`);
    }

    const snapOpen = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '02_cal_page_open.png'), snapOpen);

    // ── Check 2: Clicking background does NOT close calibration ──
    console.log('[Bench 4B] Testing background click does not close...');
    await ev(() => {
      const calScreen = document.getElementById('screen-calibration');
      if (calScreen) calScreen.click();
    });
    await sleep(200);
    const stillOpen = await ev(() => {
      const calScreen = document.getElementById('screen-calibration');
      return calScreen && !calScreen.hidden;
    });
    if (!stillOpen) throw new Error('Background click improperly closed calibration');

    // ── Check 3: Close without progress (Step 1, unrecorded) -> immediate close ──
    console.log('[Bench 4B] Testing close without progress (immediate)...');
    await ev(() => {
      const xBtn = document.getElementById('cal-x');
      if (xBtn) xBtn.click();
    });
    await sleep(500); // wait for fade transition
    const postClose1 = await ev(() => {
      const connect = document.getElementById('screen-connect');
      const calScreen = document.getElementById('screen-calibration');
      const header = document.getElementById('header');
      return {
        connectVisible: connect && !connect.hidden,
        calHidden: calScreen.hidden,
        headerVisible: header && !header.hidden,
      };
    });
    console.log('[Bench 4B] Immediate close state:', postClose1);
    if (!postClose1.connectVisible || !postClose1.calHidden || !postClose1.headerVisible) {
      throw new Error(`Immediate close failed: ${JSON.stringify(postClose1)}`);
    }

    // ── Check 4: Close with progress -> shows exit confirmation dialog ──
    console.log('[Bench 4B] Reopening calibration and recording to create progress...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(500);

    // Start recording on step 0
    await ev(() => {
      const cap = document.querySelector('[data-act="capture"]');
      if (cap) cap.click();
    });
    await sleep(600); // in countdown or recording

    // Now press Esc -> should trigger confirm dialog
    console.log('[Bench 4B] Triggering close via Esc (should show confirmation modal)...');
    await ev(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await sleep(200);

    const dialogState = await ev(() => {
      const overlays = document.querySelectorAll('.pg-overlay.app-overlay');
      const modal = overlays.length > 0 ? overlays[overlays.length - 1] : null;
      if (!modal) return { open: false };
      const title = modal.querySelector('.pg-modal__title')?.textContent || '';
      const buttons = [...modal.querySelectorAll('.pg-modal__foot button')].map(b => b.textContent.trim());
      return { open: true, title, buttons };
    });
    console.log('[Bench 4B] Confirm dialog state:', dialogState);
    if (!dialogState.open || !dialogState.title.includes('калибровки')) {
      throw new Error(`Exit confirm dialog did not show: ${JSON.stringify(dialogState)}`);
    }

    const snapDialog = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '03_cal_exit_dialog.png'), snapDialog);

    // Press Esc inside dialog -> Stay
    console.log('[Bench 4B] Dismissing dialog via Esc (Stay)...');
    await ev(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await sleep(200);

    const dialogDismissed = await ev(() => {
      const overlays = document.querySelectorAll('.pg-overlay.app-overlay');
      const calScreen = document.getElementById('screen-calibration');
      return {
        overlaysCount: overlays.length,
        calStillOpen: calScreen && !calScreen.hidden,
      };
    });
    console.log('[Bench 4B] After stay:', dialogDismissed);
    if (dialogDismissed.overlaysCount !== 0 || !dialogDismissed.calStillOpen) {
      throw new Error('Dismissing dialog did not keep calibration open');
    }

    // Now click ✕ -> click "Выйти"
    console.log('[Bench 4B] Clicking ✕ and confirming exit...');
    await ev(() => {
      const xBtn = document.getElementById('cal-x');
      if (xBtn) xBtn.click();
    });
    await sleep(200);

    await ev(() => {
      const exitBtn = document.querySelector('.pg-overlay.app-overlay button.pg-btn--danger');
      if (exitBtn) exitBtn.click();
    });
    await sleep(500);

    const afterConfirmedExit = await ev(() => {
      const connect = document.getElementById('screen-connect');
      const calScreen = document.getElementById('screen-calibration');
      return {
        connectVisible: connect && !connect.hidden,
        calHidden: calScreen.hidden,
      };
    });
    console.log('[Bench 4B] After confirmed exit:', afterConfirmedExit);
    if (!afterConfirmedExit.connectVisible || !afterConfirmedExit.calHidden) {
      throw new Error('Confirmed exit failed to return to connect screen');
    }

    // ── Check 5: Disconnect alert inside card with 2px border and tex-grain ──
    console.log('[Bench 4B] Testing disconnect alert inside card...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(500);

    // Emit offline state
    await ev(() => {
      window.__emit('state:change', window.__stateAt('offline', 0));
    });
    await sleep(300);

    const disconnectState = await ev(() => {
      const overlay = document.getElementById('cal-disconnect-overlay');
      const card = overlay?.querySelector('.app-cal-disconnect-card');
      const modal = document.querySelector('.app-cal-modal');
      const modalBorder = modal ? window.getComputedStyle(modal).borderWidth : '';
      const cardBg = card ? window.getComputedStyle(card).backgroundImage : '';

      return {
        overlayVisible: overlay && !overlay.hidden,
        modalBorder,
        cardHasGrain: cardBg.includes('grain') || cardBg.includes('data:image') || cardBg.length > 0,
      };
    });
    console.log('[Bench 4B] Disconnect card state:', disconnectState);
    if (!disconnectState.overlayVisible || disconnectState.modalBorder !== '2px') {
      throw new Error(`Disconnect card styling check failed: ${JSON.stringify(disconnectState)}`);
    }

    const snapDisconnect = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '04_cal_disconnect_card.png'), snapDisconnect);

    // Click "Отменить калибровку" -> should exit immediately without confirmation dialog
    console.log('[Bench 4B] Canceling calibration via disconnect card...');
    await ev(() => {
      const cancelBtn = document.getElementById('btn-cancel-cal-disconnect');
      if (cancelBtn) cancelBtn.click();
    });
    await sleep(500);

    const postCancelDisconnect = await ev(() => {
      const connect = document.getElementById('screen-connect');
      const calScreen = document.getElementById('screen-calibration');
      return {
        connectVisible: connect && !connect.hidden,
        calHidden: calScreen.hidden,
      };
    });
    console.log('[Bench 4B] Post cancel disconnect state:', postCancelDisconnect);
    if (!postCancelDisconnect.connectVisible || !postCancelDisconnect.calHidden) {
      throw new Error('Cancel calibration on disconnect card failed to exit immediately');
    }

    // Check errors (filtering SwiftShader headless WebGL context error)
    const errs = p.errors().filter((e) => !e.includes('WebGLRenderer'));
    if (errs.length > 0) {
      console.error('[Bench 4B] Console errors detected:', errs);
      throw new Error(`Console errors: ${errs.join(', ')}`);
    }

    console.log('--- ALL BENCHMARK 4B CHECKS PASSED ---');
  } finally {
    b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 4B] FAILED:', err);
  process.exit(1);
});
