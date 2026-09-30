// Step 3 Verification Script for Task 6.5: Response Bench in Settings & Mini-games removal
import { serve, browser, backendStub, sleep } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

async function testStep3() {
  console.log('Testing Task 6.5 Step 3: Response Bench next to Motion settings & Terminology update...');
  const { base, close: closeServer } = await serve();
  const b = await browser({ width: 1280, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    await p.goto(base, 2500);

    // Intercept backend calls to track SetTuningActive and SetTuningFilterParams
    await ev(() => {
      window.__calls = [];
      const origApp = window.go?.app?.App;
      if (origApp) {
        window.go.app.App = new Proxy(origApp, {
          get(target, prop) {
            return (...args) => {
              window.__calls.push({ method: prop, args });
              return target[prop](...args);
            };
          }
        });
      }
    });

    // Dismiss splash screen immediately for instant testing
    await ev(() => {
      document.getElementById('splash')?.remove();
      document.documentElement.classList.remove('is-splash', 'is-enter');
    });
    await sleep(200);

    // 1. Navigate to Settings
    console.log('1. Navigating to Settings...');
    await ev(() => {
      document.querySelector('#nav [data-tab="settings"]')?.click();
    });
    await sleep(500);

    // 2. Verify Mini-games and old collapsible bench wrappers are gone
    console.log('2. Verifying mini-games and old collapsible wrappers are removed...');
    const removalCheck = await ev(() => {
      return {
        oldBenchWrap: !!document.getElementById('set-bench-wrap'),
        oldBenchGroup: !!document.getElementById('set-bench-group'),
        oldPaneGames: !!document.getElementById('pane-games'),
        oldPaneBench: !!document.getElementById('pane-bench'),
        duplicateSliders: !!document.getElementById('bench-deadband-slider'),
        duplicateSaveBtn: !!document.getElementById('btn-bench-save'),
      };
    });
    console.log('Removal checks:', removalCheck);
    for (const [k, v] of Object.entries(removalCheck)) {
      if (v) throw new Error(`Obsolete element still present in DOM: ${k}`);
    }

    // 3. Verify new Response Bench Card exists in Settings
    console.log('3. Verifying new Bench Card DOM elements in Settings...');
    const cardCheck = await ev(() => {
      const card = document.getElementById('set-bench-card');
      const col1 = document.getElementById('set-col-1');
      const col2 = document.getElementById('set-col-2');
      return {
        cardExists: !!card,
        inCol2: col2?.contains(card),
        canvas: !!document.getElementById('bench-oscilloscope-canvas'),
        offlineOverlay: !!document.getElementById('bench-offline-overlay'),
        axisSeg: !!document.getElementById('bench-axis-seg'),
        sourceSeg: !!document.getElementById('bench-source-seg'),
        recenterBtn: !!document.getElementById('btn-bench-recenter'),
        sparkCanvas: !!document.getElementById('bench-net-spark-canvas'),
        noiseVal: !!document.getElementById('bench-noise-val'),
        rateVal: !!document.getElementById('bench-rate-val'),
        pingVal: !!document.getElementById('bench-ping-val'),
        stabilityBadge: !!document.getElementById('bench-stability-badge'),
      };
    });
    console.log('Card checks:', cardCheck);
    for (const [k, v] of Object.entries(cardCheck)) {
      if (!v) throw new Error(`Missing required Bench Card element: ${k}`);
    }

    // 4. Verify Offline State (Device not connected)
    console.log('4. Verifying Offline State (Blur overlay, blank canvas, no stream)...');
    const offlineCheck = await ev(() => {
      const overlay = document.getElementById('bench-offline-overlay');
      const title = document.getElementById('bench-offline-title')?.textContent?.trim();
      const desc = document.getElementById('bench-offline-desc')?.textContent?.trim();
      const isVisible = overlay && !overlay.hidden && window.getComputedStyle(overlay).display !== 'none';
      return { isVisible, title, desc };
    });
    console.log('Offline overlay status:', offlineCheck);
    if (!offlineCheck.isVisible) throw new Error('Offline overlay must be visible when device is disconnected');
    if (!offlineCheck.title?.includes('Нет подключённого устройства') && !offlineCheck.title?.includes('No connected device')) {
      throw new Error(`Unexpected offline title: ${offlineCheck.title}`);
    }

    // Capture screenshot: Offline state (Dark theme)
    fs.mkdirSync('tools/frontend-bench/out', { recursive: true });
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step3_wide_offline_dark.png', await p.screenshot());
    console.log('Saved offline screenshot');

    // 5. Connect Device (State: Online)
    console.log('5. Connecting device and streaming live frames...');
    await ev(() => {
      window.__emit('state:change', {
        status: 'online',
        pingMs: 14.5,
        hz: 60,
      });
    });
    await sleep(200);

    const onlineCheck = await ev(() => {
      const overlay = document.getElementById('bench-offline-overlay');
      return { overlayHidden: overlay?.hidden };
    });
    console.log('Online check overlay hidden:', onlineCheck.overlayHidden);
    if (!onlineCheck.overlayHidden) throw new Error('Offline overlay must be hidden when device is online');

    // Stream live tuning frames
    await ev(() => {
      for (let i = 0; i < 40; i++) {
        const t = i * 0.05;
        window.__emit('tuning:frame', {
          rawX: 3.5 * Math.sin(t),
          rawY: 1.8 * Math.cos(t),
          rawZ: 0.5 * Math.sin(t * 0.5),
          outX: 2.8 * Math.sin(t),
          outY: 1.2 * Math.cos(t),
          outZ: 0.2 * Math.sin(t * 0.5),
          hz: 60,
        });
      }
    });
    await sleep(300);

    const readouts = await ev(() => {
      return {
        ping: document.getElementById('bench-ping-val')?.textContent,
        rate: document.getElementById('bench-rate-val')?.textContent,
        stability: document.getElementById('bench-stability-badge')?.textContent,
      };
    });
    console.log('Live readouts:', readouts);
    if (!readouts.ping?.includes('15 ms') && !readouts.ping?.includes('14 ms')) {
      throw new Error(`Unexpected ping readout: ${readouts.ping}`);
    }
    if (!readouts.rate?.includes('60 Hz')) {
      throw new Error(`Unexpected rate readout: ${readouts.rate}`);
    }

    // Capture screenshot: Online state (Wide, Dark)
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step3_wide_online_dark.png', await p.screenshot());
    console.log('Saved online wide dark screenshot');

    // 6. Test Motion Group parameter changes triggering SetTuningFilterParams
    console.log('6. Testing filter parameter changes from Motion group rows...');
    await ev(() => {
      // Find rows in settings
      const rows = Array.from(document.querySelectorAll('#screen-settings .pg-row'));
      const dbSelect = rows.find(r => r.textContent.includes('Deadband') || r.textContent.includes('Порог дрожи'))?.querySelector('select');
      if (dbSelect) {
        dbSelect.value = '0.20';
        dbSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const sensSlider = rows.find(r => r.textContent.includes('Sensitivity') || r.textContent.includes('Чувствительность'))?.querySelector('input[type="range"]');
      if (sensSlider) {
        sensSlider.value = '1.75';
        sensSlider.dispatchEvent(new Event('input', { bubbles: true }));
        sensSlider.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await sleep(300);

    const filterCall = await ev(() => {
      const calls = window.__calls.filter(c => c.method === 'SetTuningFilterParams');
      return calls[calls.length - 1];
    });
    console.log('Last SetTuningFilterParams call:', filterCall);
    if (!filterCall) throw new Error('SetTuningFilterParams was not invoked when motion parameters changed');
    if (filterCall.args[0] !== 0.20 || filterCall.args[2] !== 1.75) {
      throw new Error(`Unexpected SetTuningFilterParams args: ${JSON.stringify(filterCall.args)}`);
    }

    // 7. Test Narrow Screen (820px layout)
    console.log('7. Testing narrow screen container query (820px)...');
    await p.S('Emulation.setDeviceMetricsOverride', { width: 820, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(250);

    const narrowLayout = await ev(() => {
      const col1 = document.getElementById('set-col-1');
      const benchCard = document.getElementById('set-bench-card');
      const r1 = col1.getBoundingClientRect();
      const rb = benchCard.getBoundingClientRect();
      return {
        col1Top: r1.top,
        col1Bottom: r1.bottom,
        benchTop: rb.top,
        benchBottom: rb.bottom,
        benchUnderCol1: rb.top >= r1.top,
      };
    });
    console.log('Narrow layout geometry:', narrowLayout);
    if (!narrowLayout.benchUnderCol1) {
      throw new Error(`Bench card should flow beneath Col 1 in narrow view: ${JSON.stringify(narrowLayout)}`);
    }

    // Capture screenshot: Narrow screen 820px (top)
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step3_narrow_820px.png', await p.screenshot());
    console.log('Saved narrow 820px screenshot');

    // Scroll bench card into view on narrow screen
    await ev(() => {
      document.getElementById('set-bench-card')?.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step3_narrow_820px_card.png', await p.screenshot());
    console.log('Saved narrow 820px centered card screenshot');

    // Restore wide viewport
    await p.S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(200);

    // 8. Test Light Theme and Gold Accent
    console.log('8. Testing light theme...');
    await ev(() => {
      document.getElementById('btn-theme')?.click();
    });
    await sleep(300);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step3_wide_online_light.png', await p.screenshot());
    console.log('Saved wide online light screenshot');

    // Test Zoom 200%
    console.log('Testing Zoom 200%...');
    await ev(() => {
      document.documentElement.style.fontSize = '32px';
    });
    await sleep(250);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step3_zoom_200.png', await p.screenshot());
    console.log('Saved zoom 200% screenshot');
    await ev(() => {
      document.documentElement.style.fontSize = '';
    });
    await sleep(150);

    // Test English Locale
    console.log('Testing EN locale...');
    await ev(() => {
      document.querySelector('#lang-seg [data-lang="en"]')?.click();
    });
    await sleep(250);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step3_en_locale.png', await p.screenshot());
    console.log('Saved EN locale screenshot');

    // Switch back to RU
    await ev(() => {
      document.querySelector('#lang-seg [data-lang="ru"]')?.click();
    });
    await sleep(150);

    // Restore dark theme
    await ev(() => {
      document.getElementById('btn-theme')?.click();
    });
    await sleep(200);

    // 9. Test Rule 0: Lifecycle deactivation when leaving settings
    console.log('9. Testing Rule 0 deactivation on screen change...');
    await ev(() => {
      document.querySelector('#nav [data-tab="docs"]')?.click();
    });
    await sleep(250);

    const deactCheck = await ev(() => {
      const activeCalls = window.__calls.filter(c => c.method === 'SetTuningActive');
      return activeCalls[activeCalls.length - 1];
    });
    console.log('Last SetTuningActive call on leaving settings:', deactCheck);
    if (!deactCheck || deactCheck.args[0] !== false) {
      throw new Error(`Expected SetTuningActive(false) on leaving settings, got: ${JSON.stringify(deactCheck)}`);
    }

    // Return to Settings -> Should reactivate streaming
    await ev(() => {
      document.querySelector('#nav [data-tab="settings"]')?.click();
    });
    await sleep(250);

    const reactCheck = await ev(() => {
      const activeCalls = window.__calls.filter(c => c.method === 'SetTuningActive');
      return activeCalls[activeCalls.length - 1];
    });
    console.log('Last SetTuningActive call on re-entering settings:', reactCheck);
    if (!reactCheck || reactCheck.args[0] !== true) {
      throw new Error(`Expected SetTuningActive(true) on re-entering settings, got: ${JSON.stringify(reactCheck)}`);
    }

    // 10. Check Console and Runtime Errors
    const consoleErrs = p.errors();
    const benchErrs = await ev(() => window.__bench?.errors || []);
    console.log('Console errors:', consoleErrs);
    console.log('Bench errors:', benchErrs);
    if (consoleErrs.length > 0 || benchErrs.length > 0) {
      throw new Error(`Errors encountered during Step 3 test: ${consoleErrs.join('; ')} / ${benchErrs.join('; ')}`);
    }

    console.log('🎉 Task 6.5 Step 3 automated verification passed completely with 0 errors!');
  } finally {
    await b.close();
    closeServer();
  }
}

testStep3().catch((err) => {
  console.error('❌ Task 6.5 Step 3 test failed:', err);
  process.exit(1);
});
