// Benchmark for Task 5B: Visual review, compact Verify at 1100x705, dialogs, and screenshots with active 3D
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 5B] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 5B] Server running at ${srv.base}`);

  console.log('[Bench 5B] Launching browser at 1100x705...');
  const b = await browser({ width: 1100, height: 705 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 5B] Loading app with user accent = amber...');
    await p.goto(`${srv.base}/index.html`, 1000);

    // Wait for splash to finish if present
    for (let t = 0; t < 60; t++) {
      const isSplash = await ev(() => document.documentElement.classList.contains('is-splash'));
      if (!isSplash) break;
      await sleep(100);
    }
    await sleep(400);

    await ev(() => {
      document.documentElement.setAttribute('data-accent', 'amber');
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(500);

    // Capture main screen in dark mode
    const snapMainDark = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '01_main_amber_dark.png'), snapMainDark);

    // Capture main screen in light mode
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await sleep(200);
    const snapMainLight = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '01b_main_amber_light.png'), snapMainLight);

    // Switch back to dark theme
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await sleep(200);

    // Open calibration
    console.log('[Bench 5B] Opening calibration...');
    await ev(() => {
      document.getElementById('btn-calibrate')?.click();
    });
    for (let t = 0; t < 50; t++) {
      const hasC = await ev(() => !!document.querySelector('#cal-stage canvas'));
      if (hasC) break;
      await sleep(100);
    }
    await sleep(300);

    // ── Check 1: Step 0 (Rest) panel background & 3D scene ──
    console.log('[Bench 5B] Checking Step 0 (Rest) panel and 3D scene...');
    const step0Check = await ev(() => {
      const panel = document.querySelector('.app-cal-panel');
      const panelBg = panel ? getComputedStyle(panel).backgroundColor : '';
      const stage = document.getElementById('cal-stage');
      const canvas = stage?.querySelector('canvas');
      const fallback = stage?.querySelector('.pg-scene-fallback');
      return {
        panelBg,
        isTransparent: panelBg === 'rgba(0, 0, 0, 0)' || panelBg === 'transparent',
        hasCanvas: !!canvas,
        hasFallback: !!fallback,
      };
    });
    console.log('[Bench 5B] Step 0 check:', step0Check);

    if (!step0Check.isTransparent) {
      throw new Error(`Panel background is not transparent: ${step0Check.panelBg}`);
    }
    if (!step0Check.hasCanvas || step0Check.hasFallback) {
      throw new Error(`3D scene failed on step 0: ${JSON.stringify(step0Check)}`);
    }

    const snapStep0Dark = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '02_cal_step0_scene_dark.png'), snapStep0Dark);

    // ── Step 0 (Rest), Step 1 (Pitch), Step 2 (Roll) ──
    for (let step = 0; step < 3; step++) {
      console.log(`[Bench 5B] Capturing step ${step}...`);
      await ev(() => {
        document.querySelector('[data-act="capture"]')?.click();
      });
      for (let t = 0; t < 60; t++) {
        const enabled = await ev(() => {
          const btn = document.querySelector('#cal-foot [data-act="next"]');
          return btn && !btn.disabled;
        });
        if (enabled) break;
        await sleep(100);
      }
      await sleep(200);

      await ev(() => {
        document.querySelector('#cal-foot [data-act="next"]')?.click();
      });
      await sleep(400);
    }

    // Step 3 (Axes gesture)
    console.log('[Bench 5B] Capturing step 3 (Axes gesture)...');
    const step3Check = await ev(() => {
      const stage = document.getElementById('cal-stage');
      const canvas = stage?.querySelector('canvas');
      const fallback = stage?.querySelector('.pg-scene-fallback');
      return {
        hasCanvas: !!canvas,
        hasFallback: !!fallback,
      };
    });
    console.log('[Bench 5B] Step 3 check:', step3Check);
    if (!step3Check.hasCanvas || step3Check.hasFallback) {
      throw new Error(`3D scene failed on step 3: ${JSON.stringify(step3Check)}`);
    }

    const snapStep3Dark = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '03_cal_step3_axes_scene_dark.png'), snapStep3Dark);

    await ev(() => {
      document.querySelector('[data-act="capture"]')?.click();
    });
    for (let t = 0; t < 60; t++) {
      const enabled = await ev(() => {
        const btn = document.querySelector('#cal-foot [data-act="next"]');
        return btn && !btn.disabled;
      });
      if (enabled) break;
      await sleep(100);
    }
    await sleep(200);

    await ev(() => {
      document.querySelector('#cal-foot [data-act="next"]')?.click();
    });
    await sleep(500);

    // ── Check 2: Verify screen in 1100x705 without vertical scrollbar ──
    console.log('[Bench 5B] Checking Verify screen layout in 1100x705...');
    const verifyLayout = await ev(() => {
      const modalBody = document.querySelector('.app-cal-modal .pg-modal__body');
      const mount = document.querySelector('.app-cal-mount--compact');
      const toggle = document.getElementById('cal-mount-on');
      const vstats = [...document.querySelectorAll('.app-cal-vstat')];
      const stage = document.getElementById('cal-stage');
      const canvas = stage?.querySelector('canvas');
      const fallback = stage?.querySelector('.pg-scene-fallback');

      const isScrollable = modalBody ? modalBody.scrollHeight > modalBody.clientHeight : false;

      const left = document.getElementById('cal-left');
      const right = document.querySelector('.app-cal-right');
      const stepper = document.querySelector('.app-cal-stepper');
      const extraL = document.getElementById('cal-extra-l');
      const extraR = document.getElementById('cal-extra-r');

      return {
        hasScrollbar: isScrollable,
        scrollHeight: modalBody?.scrollHeight,
        clientHeight: modalBody?.clientHeight,
        stepperH: stepper?.getBoundingClientRect().height,
        leftH: left?.getBoundingClientRect().height,
        rightH: right?.getBoundingClientRect().height,
        stageH: stage?.getBoundingClientRect().height,
        extraL_display: extraL ? getComputedStyle(extraL).display : 'none',
        extraR_display: extraR ? getComputedStyle(extraR).display : 'none',
        hasCompactMount: !!mount,
        hasMountToggle: !!toggle,
        vstatsCount: vstats.length,
        hasCanvas: !!canvas,
        hasFallback: !!fallback,
      };
    });
    console.log('[Bench 5B] Verify screen check in 1100x705:', verifyLayout);

    if (verifyLayout.hasScrollbar) {
      throw new Error(`Vertical scrollbar present on Verify in 1100x705! scrollHeight: ${verifyLayout.scrollHeight}, clientHeight: ${verifyLayout.clientHeight}`);
    }
    if (!verifyLayout.hasCompactMount || !verifyLayout.hasMountToggle) {
      throw new Error(`Compact mount row missing: ${JSON.stringify(verifyLayout)}`);
    }
    if (!verifyLayout.hasCanvas || verifyLayout.hasFallback) {
      throw new Error(`3D scene failed on Verify: ${JSON.stringify(verifyLayout)}`);
    }

    const snapVerifyDark = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '04_cal_verify_scene_dark.png'), snapVerifyDark);

    // Switch to light theme on Verify
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await sleep(200);
    const snapVerifyLight = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '05_cal_verify_scene_light.png'), snapVerifyLight);

    // Switch back to dark theme
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await sleep(200);

    // ── Check 3: Save screen header hierarchy ──
    console.log('[Bench 5B] Advancing to Save screen...');
    await ev(() => {
      document.querySelector('#cal-foot [data-act="tosave"]')?.click();
    });
    await sleep(400);

    const saveHeaders = await ev(() => {
      const overline = document.querySelector('.app-cal-save-form .app-cal-overline');
      const mainTitle = document.querySelector('.app-cal-save-form .display-md');
      const nameLabel = document.querySelector('.app-cal-field label[for="cal-name"]');
      const prevCard = document.querySelector('.app-cal-preview-card');

      return {
        overlineText: overline?.textContent?.trim(),
        mainTitleText: mainTitle?.textContent?.trim(),
        nameLabelText: nameLabel?.textContent?.trim(),
        hasPrevCard: !!prevCard,
      };
    });
    console.log('[Bench 5B] Save screen headers:', saveHeaders);

    if (saveHeaders.mainTitleText === saveHeaders.nameLabelText) {
      throw new Error(`Duplicate heading found on Save screen: mainTitle and nameLabel both '${saveHeaders.mainTitleText}'`);
    }
    if (!saveHeaders.mainTitleText.includes('Слот') && !saveHeaders.mainTitleText.includes('Slot')) {
      throw new Error(`Expected mainTitle to be 'Слот сохранения', got '${saveHeaders.mainTitleText}'`);
    }

    const snapSaveDark = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '06_cal_save_dark.png'), snapSaveDark);

    // Switch to light theme on Save
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await sleep(200);
    const snapSaveLight = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '07_cal_save_light.png'), snapSaveLight);

    // Switch back to dark theme
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await sleep(200);

    // ── Check 4: Exit Confirmation Dialog ──
    console.log('[Bench 5B] Checking Exit confirmation dialog...');
    await ev(() => {
      document.getElementById('cal-x')?.click();
    });
    await sleep(300);

    const dialogCheck = await ev(() => {
      const dialog = document.querySelector('.app-modal-dialog');
      const head = dialog?.querySelector('.pg-modal__head');
      const title = dialog?.querySelector('.pg-modal__title');
      const sub = dialog?.querySelector('.pg-modal__sub');
      const dangerBtn = dialog?.querySelector('.pg-btn--danger');
      const rect = dialog?.getBoundingClientRect();

      return {
        hasDialog: !!dialog,
        hasRingsCorner: dialog?.classList.contains('pg-rings-corner'),
        titleText: title?.textContent?.trim(),
        subText: sub?.textContent?.trim(),
        hasDangerBtn: !!dangerBtn,
        widthPx: rect ? Math.round(rect.width) : 0,
      };
    });
    console.log('[Bench 5B] Exit dialog check:', dialogCheck);

    if (!dialogCheck.hasDialog || !dialogCheck.hasRingsCorner) {
      throw new Error(`Dialog missing or missing rings corner: ${JSON.stringify(dialogCheck)}`);
    }
    if (dialogCheck.widthPx > 460) {
      throw new Error(`Dialog is too wide (${dialogCheck.widthPx}px), expected <= 460px`);
    }

    const snapExitDialog = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '08_cal_exit_dialog_compact.png'), snapExitDialog);

    // Dismiss dialog (click Stay)
    await ev(() => {
      const stayBtn = document.querySelector('.app-modal-dialog .pg-btn:not(.pg-btn--danger)');
      stayBtn?.click();
    });
    await sleep(300);

    // ── Check 5: Disconnect Card ──
    console.log('[Bench 5B] Checking Disconnect Card...');
    await ev(() => {
      window.__emit('state:change', { status: 'offline' });
    });
    await sleep(300);

    const snapDisconnect = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '09_cal_disconnect_card.png'), snapDisconnect);

    console.log('[Bench 5B] ALL 5B VISUAL AND LAYOUT CHECKS PASSED PERFECTLY!');
  } finally {
    await b.close();
    await srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 5B FAILED]', err);
  process.exit(1);
});
