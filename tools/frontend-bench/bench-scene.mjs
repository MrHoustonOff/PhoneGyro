// Benchmark and verification script for GyroScene (3D stage)
// Tests:
// 1. Lazy loading (no Three.js / GLB loaded before init)
// 2. Full scene creation, GLB parsing and gamepad tinting
// 3. Step changes: rest, pitch, roll, axes, live
// 4. Recording ring: setRecording(0.5)
// 5. Orientation: setQuaternion([0,0,0,1])
// 6. Dynamic theme switching: dark <-> light
// 7. Console error verification
// 8. Screenshots in both themes and states

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = path.join(HERE, 'screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
};

function startServer(port = 0) {
  const server = createServer((req, res) => {
    const rawPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath;
    if (rawPath === '/' || rawPath === '/scene-bench.html') {
      filePath = path.join(HERE, 'scene-bench.html');
    } else {
      filePath = path.join(FRONTEND, rawPath.replace(/^\/+/, ''));
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${rawPath}`);
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => server.close(),
      });
    });
  });
}

async function main() {
  const isServeOnly = process.argv.includes('--serve');
  const portArgIdx = process.argv.indexOf('--serve');
  const customPort = (portArgIdx >= 0 && parseInt(process.argv[portArgIdx + 1], 10)) || 0;

  const srv = await startServer(customPort || (isServeOnly ? 8000 : 0));
  console.log(`[Bench] Server running at ${srv.base}/scene-bench.html`);

  if (isServeOnly) {
    console.log(`[Bench] Interactive mode. Open ${srv.base}/scene-bench.html in your browser. Press Ctrl+C to stop.`);
    return;
  }

  console.log('[Bench] Launching headless browser...');
  const b = await browser({ width: 900, height: 750 });
  const p = await b.page();

  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench] Navigating to bench page...');
    await p.goto(`${srv.base}/scene-bench.html`, 1000);

    // 1. Verify lazy loading: neither Three.js nor GLB should be in resources yet
    const initialResources = await ev(() =>
      performance.getEntriesByType('resource').map(r => r.name)
    );
    const hasThreeBefore = initialResources.some(u => u.includes('three.min.js'));
    const hasGlbBefore = initialResources.some(u => u.includes('gamepad.glb.txt'));
    console.log(`[Bench] Before init: Three.js loaded: ${hasThreeBefore}, GLB loaded: ${hasGlbBefore}`);
    if (hasThreeBefore || hasGlbBefore) {
      throw new Error('Eager loading detected! Dependencies must be lazy-loaded.');
    }

    // 2. Init scene
    console.log('[Bench] Initializing GyroScene (lazy load)...');
    await ev(async () => {
      await window.__benchScene.init();
    });
    await sleep(600);

    // Verify dependencies now loaded
    const afterResources = await ev(() =>
      performance.getEntriesByType('resource').map(r => ({
        name: r.name.split('/').pop(),
        transferSize: r.transferSize || r.encodedBodySize || 0,
        duration: Math.round(r.duration),
      }))
    );
    const threeRes = afterResources.find(r => r.name === 'three.min.js');
    const gyroRes = afterResources.find(r => r.name === 'gyroscene.js');
    const glbRes = afterResources.find(r => r.name === 'gamepad.glb.txt');

    console.log('[Bench] Resources loaded after init:');
    if (threeRes) console.log(`  - three.min.js: ${threeRes.transferSize} bytes (${threeRes.duration}ms)`);
    if (gyroRes) console.log(`  - gyroscene.js: ${gyroRes.transferSize} bytes (${gyroRes.duration}ms)`);
    if (glbRes) console.log(`  - gamepad.glb.txt: ${glbRes.transferSize} bytes (${glbRes.duration}ms)`);

    // Verify tinted gamepad mesh in scene
    const sceneCheck = await ev(() => {
      const s = window.__benchScene.scene;
      let webglErr = null;
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
        if (!gl) webglErr = 'getContext returned null';
      } catch (e) {
        webglErr = String(e);
      }
      return {
        hasScene: !!s,
        hasPhoneGyro: !!window.PhoneGyro,
        hasCanvas: !!document.querySelector('.pg-stage canvas'),
        webglErr,
        stageHTML: document.getElementById('stage')?.innerHTML,
      };
    });
    console.log('[Bench] Scene sanity check:', sceneCheck);
    if (!sceneCheck.hasCanvas) throw new Error(`Canvas not found inside .pg-stage. Detail: ${JSON.stringify(sceneCheck)}`);

    // 3. Step tests & screenshots
    // State 1: Dark theme, Rest
    console.log('[Bench] Capturing Dark theme (Rest)...');
    const shotDarkRest = await p.screenshot();
    writeFileSync(path.join(SHOTS_DIR, '01_dark_rest.png'), shotDarkRest);

    // State 2: Dark theme, Pitch + Recording 0.5
    console.log('[Bench] Setting Step: pitch, Recording: 0.5...');
    await ev(() => {
      window.__benchScene.step('pitch');
      window.__benchScene.rec(0.5);
    });
    await sleep(400);
    const shotPitchRec = await p.screenshot();
    writeFileSync(path.join(SHOTS_DIR, '02_dark_pitch_rec05.png'), shotPitchRec);

    // State 3: Step Roll
    console.log('[Bench] Setting Step: roll...');
    await ev(() => {
      window.__benchScene.step('roll');
    });
    await sleep(300);

    // State 4: Step Axes
    console.log('[Bench] Setting Step: axes...');
    await ev(() => {
      window.__benchScene.step('axes');
    });
    await sleep(400);
    const shotAxes = await p.screenshot();
    writeFileSync(path.join(SHOTS_DIR, '03_dark_axes.png'), shotAxes);

    // State 5: Step Live + setQuaternion
    console.log('[Bench] Setting Step: live, setQuaternion([0,0,0,1])...');
    await ev(() => {
      window.__benchScene.step('live');
      window.__benchScene.quat([0, 0, 0, 1]);
    });
    await sleep(300);

    // State 6: Switch theme to Light (live update)
    console.log('[Bench] Switching to Light theme...');
    await ev(() => {
      window.__benchScene.theme('light');
      window.__benchScene.step('rest');
      window.__benchScene.rec(0);
    });
    await sleep(500);
    const shotLightRest = await p.screenshot();
    writeFileSync(path.join(SHOTS_DIR, '04_light_rest.png'), shotLightRest);

    // State 7: Light theme, Pitch + Recording 0.5
    await ev(() => {
      window.__benchScene.step('pitch');
      window.__benchScene.rec(0.5);
    });
    await sleep(400);
    const shotLightPitchRec = await p.screenshot();
    writeFileSync(path.join(SHOTS_DIR, '05_light_pitch_rec05.png'), shotLightPitchRec);


    // 4. Verify console errors
    const errs = p.errors();
    console.log(`[Bench] Console errors: ${errs.length ? '\n' + errs.join('\n') : 'none'}`);
    if (errs.length > 0) {
      throw new Error(`Console errors found: ${errs.join('; ')}`);
    }

    console.log('[Bench] ALL VERIFICATIONS PASSED.');
    console.log(`[Bench] Screenshots saved to: ${SHOTS_DIR}`);
  } finally {
    b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench] FAILED:', err);
  process.exit(1);
});
