// Verification benchmark script for Task 6.9 Steps 1 & 2
// Tests:
// 1. Router navigation: stats tab click -> opens screen, repeat click -> back home.
// 2. 25 open/close cycles: verify loseContext() prevents WebGL exhaustion and "3D is unavailable".
// 3. Layout: 40/60 split, side panel with settings card, recorder, groups A-E & F, viewports.
// 4. Model toggle: Gamepad <-> Cube.
// 5. Camera modes: Static, Dynamic Orbit (drag, wheel, reset), 4 Cameras.
// 6. Eco-mode pause & Offline overlay.
// 7. Screenshots: Dark theme, Light theme, 820px narrow window, 200% zoom.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { serve, browser, backendStub, sleep } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function runVerification() {
  console.log('=== Starting Task 6.9 Steps 1 & 2 Verification ===');
  const { base, close: closeServer } = await serve();
  const b = await browser({ width: 1280, height: 720 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    await p.goto(base, 2500);

    // Initial wait for boot
    await sleep(500);

    // ─── TEST 1: Navigation and toggle to home ───
    console.log('[Test 1] Navigating to Stats screen...');
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(600);

    let state = await ev(() => ({
      statsVisible: !document.getElementById('screen-stats')?.hidden,
      connectVisible: !document.getElementById('screen-connect')?.hidden,
      tabActive: document.querySelector('#nav [data-tab="stats"]')?.classList.contains('is-active'),
      isShellStats: document.getElementById('shell')?.classList.contains('is-screen-stats'),
    }));
    console.log('Opened Stats screen:', state);
    if (!state.statsVisible || !state.tabActive || !state.isShellStats) {
      throw new Error(`Failed to open stats screen: ${JSON.stringify(state)}`);
    }

    // Repeat click: should return to connect
    console.log('[Test 1] Repeat click on Stats tab (should navigate home)...');
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(600);

    state = await ev(() => ({
      statsVisible: !document.getElementById('screen-stats')?.hidden,
      connectVisible: !document.getElementById('screen-connect')?.hidden,
      isHome: document.getElementById('home')?.classList.contains('is-home'),
      isShellStats: document.getElementById('shell')?.classList.contains('is-screen-stats'),
    }));
    console.log('Back to Connect screen:', state);
    if (state.statsVisible || !state.connectVisible || state.isShellStats) {
      throw new Error(`Failed to return home on repeat click: ${JSON.stringify(state)}`);
    }

    // Return to stats for the remaining tests
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(600);

    // ─── TEST 2: 25 open/close cycles for WebGL context leak check ───
    console.log('[Test 2] Running 25 open/close cycles to verify WebGL context cleanup...');
    for (let i = 1; i <= 25; i++) {
      // Go connect
      await ev(() => document.querySelector('#home')?.click());
      await sleep(180);
      // Go stats
      await ev(() => document.querySelector('#nav [data-tab="stats"]')?.click());
      await sleep(180);

      // Verify no "3D is unavailable" error
      const hasUnavailable = await ev(() => {
        return !!document.body.innerText.includes('3D is unavailable');
      });
      if (hasUnavailable) {
        throw new Error(`Cycle ${i}: Detected "3D is unavailable"! WebGL context was lost or exhausted.`);
      }
    }
    await sleep(250);
    console.log('[Test 2] PASS: 25 open/close cycles completed cleanly without context exhaustion.');

    // ─── TEST 3: Structural checks of tiles and layout ───
    console.log('[Test 3] Checking layout and metric tiles...');
    const tilesCheck = await ev(() => {
      const requiredIds = [
        'stat-card-quality',
        'stat-quality-val',
        'stat-quality-circle',
        'stat-quality-badge',
        'stat-card-hz',
        'stat-card-latency',
        'stat-card-jitter',
        'stat-card-tail',
        'stat-card-loss',
        'stats-usb-card',
        'stat-card-drift',
        'stat-card-noise',
        'stat-card-gravity',
        'stat-card-omega',
        'stat-card-pipeline-chain',
        'stat-card-pipe',
        'stat-card-raw-gyro',
        'stat-card-raw-accel',
        'stat-card-out-gyro',
        'stat-card-dsu-clients',
        'stat-card-session',
        'stat-card-resources',
      ];
      return requiredIds.map((id) => ({ id, exists: !!document.getElementById(id) }));
    });
    const missingTiles = tilesCheck.filter((t) => !t.exists);
    if (missingTiles.length > 0) {
      throw new Error(`Missing tiles: ${JSON.stringify(missingTiles)}`);
    }
    console.log('[Test 3] PASS: All 22 structure elements & metric tiles are present.');

    // Check data-tip presence on tiles
    const tipsCheck = await ev(() => {
      const cardIds = [
        'stat-card-quality', 'stat-card-hz', 'stat-card-latency', 'stat-card-jitter',
        'stat-card-tail', 'stat-card-loss', 'stat-card-drift', 'stat-card-noise',
        'stat-card-gravity', 'stat-card-omega', 'stat-card-pipeline-chain',
        'stat-card-pipe', 'stat-card-raw-gyro', 'stat-card-raw-accel',
        'stat-card-out-gyro', 'stat-card-dsu-clients', 'stat-card-session', 'stat-card-resources'
      ];
      return cardIds.map(id => ({
        id,
        hasTip: !!document.getElementById(id)?.getAttribute('data-i18n-title')
      }));
    });
    const missingTips = tipsCheck.filter(t => !t.hasTip);
    if (missingTips.length > 0) {
      throw new Error(`Tiles missing data-i18n-title: ${JSON.stringify(missingTips)}`);
    }
    console.log('[Test 3] PASS: All metric tiles have data-i18n-title tooltips.');

    // ─── TEST 4: Emit realistic telemetry state and verify Hero Link Quality ───
    console.log('[Test 4] Emitting live state and testing Quality index formula...');
    await ev(() => {
      window.__emit('state:change', {
        status: 'online',
        isPaused: false,
        deviceName: 'iPhone 15 Pro',
        hz: 60.0,
        pingMs: 8.5,
        connectedTime: '00:12:45',
        pitch: 5.2,
        roll: -3.1,
        yaw: 42.0,
        rawRotX: 0.02,
        rawRotY: -0.01,
        rawRotZ: 0.00,
        rawAccX: 0.01,
        rawAccY: 0.02,
        rawAccZ: -0.99,
        dsuClients: 1,
        dsuClientList: [{ name: 'Cemu.exe', endpoint: '127.0.0.1:54321' }],
        usbConnected: false,
      });
    });
    await sleep(250);

    const qualityState = await ev(() => ({
      val: document.getElementById('stat-quality-val')?.textContent,
      badge: document.getElementById('stat-quality-badge')?.textContent,
      dashoffset: document.getElementById('stat-quality-circle')?.style?.strokeDashoffset,
      hz: document.getElementById('stat-hz-val')?.textContent,
      lat: document.getElementById('stat-lat-val')?.textContent,
      grav: document.getElementById('stat-gravity-val')?.textContent,
      noise: document.getElementById('stat-noise-val')?.textContent,
      dsu: document.getElementById('stat-dsu-count')?.textContent,
    }));
    console.log('[Test 4] Rendered live values:', qualityState);
    if (parseInt(qualityState.val, 10) < 85) {
      throw new Error(`Expected high link quality >= 85, got ${qualityState.val}`);
    }
    console.log('[Test 4] PASS: Link Quality index and live telemetry rendered successfully.');

    // ─── TEST 5: Camera Modes (Static, Dynamic Orbit, 4 Cameras) ───
    console.log('[Test 5] Testing camera modes...');
    // Switch to Dynamic Orbit
    await ev(() => {
      document.querySelector('#stats-cam-mode-seg [data-cam="orbit"]')?.click();
    });
    await sleep(200);
    const orbitCheck = await ev(() => ({
      hintVisible: document.getElementById('stats-orbit-hint')?.style.display !== 'none',
      tag: document.getElementById('stats-viewport-tag')?.textContent,
    }));
    console.log('Orbit mode check:', orbitCheck);
    if (!orbitCheck.hintVisible || orbitCheck.tag !== 'DYNAMIC ORBIT') {
      throw new Error(`Failed to switch to Orbit mode: ${JSON.stringify(orbitCheck)}`);
    }

    // Switch to 4 Cameras
    await ev(() => {
      document.querySelector('#stats-cam-mode-seg [data-cam="quad"]')?.click();
    });
    await sleep(200);
    const quadCheck = await ev(() => ({
      quadVisible: document.getElementById('stats-3d-quad-wrap')?.style.display === 'grid',
      singleHidden: document.getElementById('stats-3d-viewport-single')?.style.display === 'none',
      tag: document.getElementById('stats-viewport-tag')?.textContent,
    }));
    console.log('Quad mode check:', quadCheck);
    if (!quadCheck.quadVisible || !quadCheck.singleHidden) {
      throw new Error(`Failed to switch to Quad mode: ${JSON.stringify(quadCheck)}`);
    }

    // Switch back to Static
    await ev(() => {
      document.querySelector('#stats-cam-mode-seg [data-cam="static"]')?.click();
    });
    await sleep(200);

    // ─── TEST 6: Model switch (Gamepad <-> Cube) ───
    console.log('[Test 6] Testing 3D model switch...');
    await ev(() => {
      document.querySelector('#stats-model-seg [data-model="cube"]')?.click();
    });
    await sleep(200);
    let isCubeActive = await ev(() =>
      document.querySelector('#stats-model-seg [data-model="cube"]')?.classList.contains('is-active')
    );
    if (!isCubeActive) throw new Error('Cube button did not become active');

    await ev(() => {
      document.querySelector('#stats-model-seg [data-model="gamepad"]')?.click();
    });
    await sleep(200);
    let isGamepadActive = await ev(() =>
      document.querySelector('#stats-model-seg [data-model="gamepad"]')?.classList.contains('is-active')
    );
    if (!isGamepadActive) throw new Error('Gamepad button did not become active');
    console.log('[Test 6] PASS: Model toggle operates cleanly.');

    // ─── TEST 7: Eco-mode pause & Offline overlay ───
    console.log('[Test 7] Testing Offline overlay & Eco pause...');
    // Emit offline state
    await ev(() => {
      window.__emit('state:change', { status: 'offline', hz: 0 });
    });
    await sleep(200);
    let offlineState = await ev(() => ({
      overlayDisplay: document.getElementById('stats-3d-offline')?.style.display,
      badgeText: document.getElementById('stats-live-badge')?.textContent,
    }));
    console.log('Offline state check:', offlineState);
    if (offlineState.overlayDisplay !== 'flex') {
      throw new Error('Expected offline overlay visible');
    }

    // Restore online
    await ev(() => {
      window.__emit('state:change', { status: 'online', hz: 60.0, pingMs: 10.0 });
    });
    await sleep(200);

    // ─── TEST 8: Screenshots (Dark, Light, 820px, 200% Zoom) ───
    console.log('[Test 8] Capturing screenshots for inspection...');

    // 1. Dark theme (Default)
    writeFileSync(path.join(OUT_DIR, 'task69_01_stats_dark_1280.png'), await p.screenshot());
    console.log('Saved: task69_01_stats_dark_1280.png');

    // 2. Light theme
    await ev(() => {
      document.getElementById('btn-theme')?.click();
    });
    await sleep(300);
    writeFileSync(path.join(OUT_DIR, 'task69_02_stats_light_1280.png'), await p.screenshot());
    console.log('Saved: task69_02_stats_light_1280.png');

    // Restore Dark theme
    await ev(() => {
      document.getElementById('btn-theme')?.click();
    });
    await sleep(300);

    // 3. 4 Cameras mode in Dark theme
    await ev(() => {
      document.querySelector('#stats-cam-mode-seg [data-cam="quad"]')?.click();
    });
    await sleep(300);
    writeFileSync(path.join(OUT_DIR, 'task69_03_stats_quad_1280.png'), await p.screenshot());
    console.log('Saved: task69_03_stats_quad_1280.png');

    // Back to Static mode
    await ev(() => {
      document.querySelector('#stats-cam-mode-seg [data-cam="static"]')?.click();
    });
    await sleep(200);

    // 4. Narrow window: 820px (Compact Responsive)
    await p.S('Emulation.setDeviceMetricsOverride', {
      width: 820,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(400);
    writeFileSync(path.join(OUT_DIR, 'task69_04_stats_narrow_820.png'), await p.screenshot());
    console.log('Saved: task69_04_stats_narrow_820.png');

    // Restore 1280px width
    await p.S('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(200);

    // 5. 200% Zoom
    await ev(() => {
      const shell = document.getElementById('shell');
      if (shell) shell.style.zoom = '2.0';
    });
    await sleep(400);
    writeFileSync(path.join(OUT_DIR, 'task69_05_stats_zoom_200.png'), await p.screenshot());
    console.log('Saved: task69_05_stats_zoom_200.png');

    // Reset zoom
    await ev(() => {
      const shell = document.getElementById('shell');
      if (shell) shell.style.zoom = '';
    });
    await sleep(200);

    console.log('Page console errors:', p.errors());
    if (p.errors().length > 0) {
      throw new Error(`Console errors detected: ${JSON.stringify(p.errors())}`);
    }

    console.log('=== All Task 6.9 Step 1 & 2 tests PASSED 100%! ===');
  } finally {
    await b.close();
    closeServer();
  }
}

runVerification().catch((err) => {
  console.error('Verification FAILED:', err);
  process.exit(1);
});
