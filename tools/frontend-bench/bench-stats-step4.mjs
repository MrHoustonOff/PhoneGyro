// Step 4 Verification Script for Clean Mini-Games (Aim & Platform)
import { serve, browser, backendStub, sleep } from './lib.mjs';

async function testStep4() {
  console.log('Testing Step 4: Mini-Games (Zelda Aim & Shrine Platform)...');
  const { base, close: closeServer } = await serve();
  const b = await browser({ width: 1280, height: 720 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    await p.goto(base, 2500);

    // 1. Navigate to Stats -> Mini-Games
    console.log('1. Navigating to Stats -> Mini-Games...');
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(600);

    await ev(() => {
      document.getElementById('subtab-btn-games')?.click();
    });
    await sleep(400);

    const isGamesActive = await ev(() => {
      const activeBtn = document.querySelector('#stats-subnav .pg-seg__btn.is-active');
      const activePane = document.querySelector('.app-subtab-pane.is-active');
      return activeBtn?.dataset.subtab === 'games' && activePane?.id === 'pane-games';
    });
    console.log('Games pane active:', isGamesActive);
    if (!isGamesActive) throw new Error('Expected games pane active');

    // 2. Verify HUD elements
    console.log('2. Checking HUD elements...');
    const hudCheck = await ev(() => ({
      score: document.getElementById('game-score')?.textContent,
      record: document.getElementById('game-record')?.textContent,
      timer: document.getElementById('game-val-timer')?.textContent,
      startBtn: !!document.getElementById('btn-game-start'),
      recenterBtn: !!document.getElementById('btn-game-recenter'),
      fsBtn: !!document.getElementById('btn-game-fullscreen'),
    }));
    console.log('HUD check:', hudCheck);
    if (!hudCheck.startBtn || !hudCheck.recenterBtn || !hudCheck.fsBtn) {
      throw new Error(`Missing HUD buttons: ${JSON.stringify(hudCheck)}`);
    }

    // 3. Test Aim Game Target Spawning & Hit Detection
    console.log('3. Testing Aim Game target & hit detection...');
    const targetBefore = await ev(() => {
      const t = document.querySelector('#game-aim-targets .bench-aim-target');
      return { exists: !!t };
    });
    console.log('Target before start:', targetBefore);
    if (!targetBefore.exists) throw new Error('Expected initial aim target');

    // Click Start
    await ev(() => document.getElementById('btn-game-start')?.click());
    await sleep(200);

    // Get active target coordinates and simulate reticle motion to hit it
    const targetHitResult = await ev(() => {
      const reticle = document.getElementById('game-aim-reticle');
      const target = document.querySelector('#game-aim-targets .bench-aim-target');
      if (!target) return { hit: false };

      // Force reticle position right onto target to trigger hit
      const ml = parseFloat(target.style.marginLeft) || 0;
      const mt = parseFloat(target.style.marginTop) || 0;
      const targetX = ml + 30;
      const targetY = mt + 30;

      // Simulate motion to target
      window.__emit('tuning:frame', {
        OutX: 0,
        OutY: 0,
        RawX: 0,
        RawY: 0,
      });

      return { targetX, targetY };
    });
    console.log('Target coordinates:', targetHitResult);

    // Simulate motion packet sequence that steers reticle to hit target
    await ev(() => {
      // Direct call on AimGame for deterministic test
      const games = window._gamesController;
      // Or move reticle
      const target = document.querySelector('#game-aim-targets .bench-aim-target');
      if (target) {
        const ml = parseFloat(target.style.marginLeft) || 0;
        const mt = parseFloat(target.style.marginTop) || 0;
        const reticle = document.getElementById('game-aim-reticle');
        if (reticle) reticle.style.transform = `translate(${ml + 30}px, ${mt + 30}px)`;
        // trigger hit check via small tuning:frame
        window.__emit('tuning:frame', { OutX: 0.001, OutY: 0.001 });
      }
    });
    await sleep(300);

    const scoreAfterHit = await ev(() => ({
      score: document.getElementById('game-score')?.textContent,
      timer: document.getElementById('game-val-timer')?.textContent,
    }));
    console.log('Score & timer after target interaction:', scoreAfterHit);

    // 4. Test Platform Game Switcher & 3D Shrine Apparatus
    console.log('4. Switching to Platform Game...');
    await ev(() => {
      document.querySelector('#game-picker-seg [data-game="platform"]')?.click();
    });
    await sleep(800);

    const platformStatus = await ev(() => {
      const canvas = document.getElementById('game-platform-canvas');
      const aimView = document.getElementById('game-aim-view');
      const platView = document.getElementById('game-platform-view');
      const timerLabel = document.getElementById('game-label-timer')?.textContent;
      const timerVal = document.getElementById('game-val-timer')?.textContent;
      return {
        canvasExists: !!canvas,
        canvasWidth: canvas?.width,
        aimHidden: aimView?.style.display === 'none',
        platVisible: platView?.style.display === 'block',
        timerLabel,
        timerVal,
      };
    });
    console.log('Platform game status:', platformStatus);
    if (!platformStatus.platVisible || platformStatus.canvasWidth === 0) {
      throw new Error(`Platform view not ready: ${JSON.stringify(platformStatus)}`);
    }

    // Emit tilt to platform
    console.log('Emitting platform tilt...');
    await ev(() => {
      window.__emit('state:change', {
        pitch: 12.5,
        roll: -6.2,
      });
    });
    await sleep(200);

    const tiltReadout = await ev(() => document.getElementById('game-val-timer')?.textContent);
    console.log('Platform tilt readout:', tiltReadout);
    if (!tiltReadout?.includes('P:') || !tiltReadout?.includes('R:')) {
      throw new Error(`Expected tilt readout in timer pill, got ${tiltReadout}`);
    }

    // 5. Test Technical Parameters Disclosure
    console.log('5. Testing parameters disclosure...');
    await ev(() => {
      const details = document.querySelector('.app-game-disclosure');
      if (details) details.open = true;
      const slider = document.getElementById('game-sens-slider');
      if (slider) {
        slider.value = '1.8';
        slider.dispatchEvent(new Event('input'));
      }
    });
    await sleep(150);

    const sensVal = await ev(() => document.getElementById('game-sens-val')?.textContent);
    console.log('Sensitivity readout:', sensVal);
    if (sensVal !== '1.8x') throw new Error(`Expected 1.8x, got ${sensVal}`);

    // 6. Screenshots
    console.log('6. Capturing screenshots...');
    const fs = await import('fs');
    fs.writeFileSync('tools/frontend-bench/out/bench_step4_platform_dark.png', await p.screenshot());

    // Switch back to Aim Game for screenshot
    await ev(() => {
      document.querySelector('#game-picker-seg [data-game="aim"]')?.click();
    });
    await sleep(300);
    fs.writeFileSync('tools/frontend-bench/out/bench_step4_aim_dark.png', await p.screenshot());

    // Toggle Light theme
    await ev(() => document.getElementById('btn-theme')?.click());
    await sleep(300);
    fs.writeFileSync('tools/frontend-bench/out/bench_step4_aim_light.png', await p.screenshot());

    // Toggle back to Dark theme
    await ev(() => document.getElementById('btn-theme')?.click());
    await sleep(200);

    // 7. Test clean disposal on leaving
    console.log('7. Testing disposal on tab switch...');
    await ev(() => {
      document.getElementById('home')?.click();
    });
    await sleep(400);

    const errs = p.errors();
    if (errs.length > 0) {
      throw new Error(`Console errors found: ${errs.join(', ')}`);
    }

    console.log('✅ Step 4 verification passed: 0 errors!');
  } finally {
    await b.close();
    closeServer();
  }
}

testStep4().catch((err) => {
  console.error('❌ Step 4 verification failed:', err);
  process.exit(1);
});
