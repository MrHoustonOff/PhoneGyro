// Step 3 Verification Script for 3D Viewport with GyroScene, Multi-Camera, and Eco Pause
import { serve, browser, backendStub, sleep } from './lib.mjs';

async function testStep3() {
  console.log('Testing Step 3: 3D Orientation Viewport & Multi-Camera Modes...');
  const { base, close: closeServer } = await serve();
  const b = await browser({ width: 1280, height: 720 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    await p.goto(base, 2500);

    // 1. Navigate to Stats screen
    console.log('1. Navigating to Stats screen...');
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(800);

    // 2. Verify GyroScene mounted
    console.log('2. Checking GyroScene canvas mount...');
    const hasCanvas = await ev(() => {
      const host = document.getElementById('stats-3d-canvas-host');
      const canvas = host?.querySelector('canvas');
      const fallback = document.getElementById('stats-3d-fallback');
      return {
        canvasExists: !!canvas,
        canvasWidth: canvas?.width,
        canvasHeight: canvas?.height,
        fallbackHidden: fallback?.style.display === 'none',
      };
    });
    console.log('3D canvas status:', hasCanvas);
    if (!hasCanvas.canvasExists) throw new Error('Expected WebGL canvas in #stats-3d-canvas-host');

    // 3. Test Model switcher (Cube / Gamepad)
    console.log('3. Testing model switcher...');
    await ev(() => {
      const cubeBtn = document.querySelector('#stats-model-seg [data-model="cube"]');
      cubeBtn?.click();
    });
    await sleep(200);

    const modelCubeState = await ev(() => {
      const activeBtn = document.querySelector('#stats-model-seg .pg-seg__btn.is-active');
      return activeBtn?.dataset.model;
    });
    console.log('Active model after clicking cube:', modelCubeState);
    if (modelCubeState !== 'cube') throw new Error(`Expected cube, got ${modelCubeState}`);

    // Switch back to gamepad
    await ev(() => {
      const gpBtn = document.querySelector('#stats-model-seg [data-model="gamepad"]');
      gpBtn?.click();
    });
    await sleep(200);

    // 4. Test 60Hz quaternion orientation update
    console.log('4. Emitting ahrs:quat orientation...');
    await ev(() => {
      window.__emit('ahrs:quat', { q0: 0.9239, q1: 0.3827, q2: 0, q3: 0 }); // ~45 deg pitch
    });
    await sleep(100);

    // 5. Test Camera Modes (Quad, Orbit, Static)
    console.log('5. Testing Camera Modes...');
    // A. Quad mode
    await ev(() => {
      const quadBtn = document.querySelector('#stats-cam-mode-seg [data-cam="quad"]');
      quadBtn?.click();
    });
    await sleep(200);

    const quadCheck = await ev(() => {
      const quadWrap = document.getElementById('stats-3d-quad-wrap');
      const singleVp = document.getElementById('stats-3d-viewport-single');
      const tag = document.getElementById('stats-viewport-tag');
      return {
        quadDisplay: quadWrap?.style.display,
        singleDisplay: singleVp?.style.display,
        tagText: tag?.textContent,
      };
    });
    console.log('Quad mode check:', quadCheck);
    if (quadCheck.quadDisplay !== 'grid' || quadCheck.singleDisplay !== 'none') {
      throw new Error(`Expected quad visible, got: ${JSON.stringify(quadCheck)}`);
    }

    // B. Orbit mode
    await ev(() => {
      const orbitBtn = document.querySelector('#stats-cam-mode-seg [data-cam="orbit"]');
      orbitBtn?.click();
    });
    await sleep(200);

    const orbitCheck = await ev(() => {
      const quadWrap = document.getElementById('stats-3d-quad-wrap');
      const singleVp = document.getElementById('stats-3d-viewport-single');
      const hint = document.getElementById('stats-orbit-hint');
      const tag = document.getElementById('stats-viewport-tag');
      return {
        quadDisplay: quadWrap?.style.display,
        singleDisplay: singleVp?.style.display,
        hintVisible: hint && hint.style.display !== 'none',
        tagText: tag?.textContent,
      };
    });
    console.log('Orbit mode check:', orbitCheck);
    if (!orbitCheck.hintVisible || orbitCheck.tagText !== 'DYNAMIC ORBIT') {
      throw new Error(`Expected orbit mode active, got: ${JSON.stringify(orbitCheck)}`);
    }

    // C. Static mode
    await ev(() => {
      const staticBtn = document.querySelector('#stats-cam-mode-seg [data-cam="static"]');
      staticBtn?.click();
    });
    await sleep(200);

    const staticCheck = await ev(() => {
      const tag = document.getElementById('stats-viewport-tag');
      const hint = document.getElementById('stats-orbit-hint');
      return {
        tagText: tag?.textContent,
        hintVisible: hint && hint.style.display !== 'none',
      };
    });
    console.log('Static mode check:', staticCheck);
    if (staticCheck.tagText !== 'STATIC VIEW' || staticCheck.hintVisible) {
      throw new Error(`Expected static view, got: ${JSON.stringify(staticCheck)}`);
    }

    // 6. Test Offline and Eco Pause Overlays
    console.log('6. Testing Offline and Eco overlays...');
    // Offline
    await ev(() => {
      window.__emit('state:change', { status: 'offline' });
    });
    await sleep(150);

    const offlineVisible = await ev(() => {
      const overlay = document.getElementById('stats-3d-offline');
      return overlay && overlay.style.display === 'flex';
    });
    console.log('Offline overlay visible:', offlineVisible);
    if (!offlineVisible) throw new Error('Expected offline overlay visible');

    // Back to online
    await ev(() => {
      window.__emit('state:change', {
        status: 'online',
        hz: 60,
        pingMs: 5,
        pitch: 5,
        roll: 0,
        yaw: 10,
      });
    });
    await sleep(150);

    const onlineCheck = await ev(() => {
      const overlay = document.getElementById('stats-3d-offline');
      return overlay?.style.display === 'none';
    });
    console.log('Offline overlay hidden on online:', onlineCheck);
    if (!onlineCheck) throw new Error('Expected offline overlay hidden');

    // Eco pause test (simulate window blur)
    await ev(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await sleep(150);

    const ecoPauseVisible = await ev(() => {
      const badge = document.getElementById('stats-3d-ecopause');
      return badge && badge.style.display === 'inline-flex';
    });
    console.log('Eco pause badge visible on blur:', ecoPauseVisible);
    if (!ecoPauseVisible) throw new Error('Expected eco pause badge visible');

    // Resume on focus
    await ev(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await sleep(150);

    const ecoResumeCheck = await ev(() => {
      const badge = document.getElementById('stats-3d-ecopause');
      return badge?.style.display === 'none';
    });
    console.log('Eco pause badge hidden on focus:', ecoResumeCheck);
    if (!ecoResumeCheck) throw new Error('Expected eco pause badge hidden on focus');

    // 7. Screenshots in Dark and Light themes
    console.log('7. Capturing screenshots...');
    const fs = await import('fs');
    fs.writeFileSync('tools/frontend-bench/out/bench_step3_3d_dark.png', await p.screenshot());

    // Switch to Orbit for screenshot
    await ev(() => document.querySelector('#stats-cam-mode-seg [data-cam="orbit"]')?.click());
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step3_orbit.png', await p.screenshot());

    // Switch to Quad for screenshot
    await ev(() => document.querySelector('#stats-cam-mode-seg [data-cam="quad"]')?.click());
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step3_quad.png', await p.screenshot());

    // Switch back to Static and Light theme
    await ev(() => document.querySelector('#stats-cam-mode-seg [data-cam="static"]')?.click());
    await ev(() => document.getElementById('btn-theme')?.click());
    await sleep(300);
    fs.writeFileSync('tools/frontend-bench/out/bench_step3_3d_light.png', await p.screenshot());

    // Toggle back to Dark theme
    await ev(() => document.getElementById('btn-theme')?.click());
    await sleep(200);

    // 8. Test clean disposal on departure (Strict Rule 0)
    console.log('8. Testing disposal on tab switch...');
    await ev(() => {
      document.getElementById('home')?.click();
    });
    await sleep(400);

    const disposedStatus = await ev(() => {
      const host = document.getElementById('stats-3d-canvas-host');
      const canvas = host?.querySelector('canvas');
      const fallback = document.getElementById('stats-3d-fallback');
      return {
        canvasGone: !canvas,
        fallbackRestored: fallback?.style.display === 'flex',
      };
    });
    console.log('Disposal status after leaving stats:', disposedStatus);
    if (!disposedStatus.canvasGone) {
      throw new Error('Expected WebGL canvas to be disposed and removed when leaving stats screen');
    }

    const errs = p.errors();
    if (errs.length > 0) {
      throw new Error(`Console errors found: ${errs.join(', ')}`);
    }

    console.log('✅ Step 3 verification passed: 0 errors!');
  } finally {
    await b.close();
    closeServer();
  }
}

testStep3().catch((err) => {
  console.error('❌ Step 3 verification failed:', err);
  process.exit(1);
});
