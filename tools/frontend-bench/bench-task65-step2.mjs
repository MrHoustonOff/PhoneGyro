// Step 2 Verification Script for Task 6.5: Response Bench in Settings & Bidirectional Sync
import { serve, browser, backendStub, sleep } from './lib.mjs';

async function testStep2() {
  console.log('Testing Task 6.5 Step 2: Response Bench in Settings & Bidirectional Sync...');
  const { base, close: closeServer } = await serve();
  const b = await browser({ width: 1280, height: 720 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    await p.goto(base, 2500);

    // 1. Navigate to Settings
    console.log('1. Navigating to Settings...');
    await ev(() => {
      document.querySelector('#nav [data-tab="settings"]')?.click();
    });
    await sleep(400);

    // 2. Expand Bench section
    console.log('2. Expanding bench section in Settings...');
    await ev(() => {
      const group = document.getElementById('set-bench-group');
      if (!group?.classList.contains('is-open')) {
        document.getElementById('set-bench-toggle')?.click();
      }
    });
    await sleep(400);

    // 3. Verify all Response Bench DOM elements exist
    console.log('3. Verifying Bench DOM elements...');
    const domCheck = await ev(() => {
      return {
        benchPane: !!document.getElementById('set-pane-bench'),
        benchPaneActive: document.getElementById('set-pane-bench')?.classList.contains('is-active'),
        sourceSeg: !!document.getElementById('bench-source-seg'),
        recenterBtn: !!document.getElementById('btn-bench-recenter'),
        stabilityBadge: !!document.getElementById('bench-stability-badge'),
        noiseVal: !!document.getElementById('bench-noise-val'),
        rateVal: !!document.getElementById('bench-rate-val'),
        pingVal: !!document.getElementById('bench-ping-val'),
        axisSeg: !!document.getElementById('bench-axis-seg'),
        oscWrap: !!document.getElementById('bench-osc-wrap'),
        canvas: !!document.getElementById('bench-oscilloscope-canvas'),
        deadbandSlider: !!document.getElementById('bench-deadband-slider'),
        deadbandVal: !!document.getElementById('bench-deadband-val'),
        sensSlider: !!document.getElementById('bench-sens-slider'),
        sensVal: !!document.getElementById('bench-sens-val'),
        saveBtn: !!document.getElementById('btn-bench-save'),
      };
    });
    console.log('DOM check results:', domCheck);
    for (const [k, v] of Object.entries(domCheck)) {
      if (!v) throw new Error(`Missing expected bench element: ${k}`);
    }

    // 4. Test simulated live streaming & metrics (tuning:frame & state:change)
    console.log('4. Testing live stream & metrics...');
    await ev(() => {
      window.__emit('state:change', {
        status: 'online',
        pingMs: 14.2,
        hz: 60,
      });
      window.__emit('tuning:frame', {
        rawX: 2.5, rawY: 1.2, rawZ: -0.8,
        outX: 1.8, outY: 0.9, outZ: -0.5,
        hz: 60,
      });
    });
    await sleep(250);

    const metricsCheck = await ev(() => {
      const pingText = document.getElementById('bench-ping-val')?.textContent;
      const rateText = document.getElementById('bench-rate-val')?.textContent;
      const stabilityText = document.getElementById('bench-stability-badge')?.textContent;
      return { pingText, rateText, stabilityText };
    });
    console.log('Metrics readouts:', metricsCheck);
    if (!metricsCheck.pingText?.includes('14 ms')) {
      throw new Error(`Expected ping readout ~14 ms, got: ${metricsCheck.pingText}`);
    }
    if (!metricsCheck.rateText?.includes('60 Hz')) {
      throw new Error(`Expected rate readout ~60 Hz, got: ${metricsCheck.rateText}`);
    }

    // 5. Test Bidirectional Sync: Bench -> Settings
    console.log('5. Testing parameter sync from Bench to Settings...');
    await ev(() => {
      const dbSlider = document.getElementById('bench-deadband-slider');
      dbSlider.value = '0.20';
      dbSlider.dispatchEvent(new Event('input', { bubbles: true }));

      const sensSlider = document.getElementById('bench-sens-slider');
      sensSlider.value = '1.75';
      sensSlider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(200);

    const syncBenchToSettings = await ev(() => {
      // Find matching motion rows in Settings
      const rows = Array.from(document.querySelectorAll('#screen-settings .pg-row'));
      const deadbandSelect = rows.find(r => r.textContent.includes('Deadband') || r.textContent.includes('Порог дрожи'))?.querySelector('select');
      const sensInput = rows.find(r => r.textContent.includes('Sensitivity') || r.textContent.includes('Чувствительность'))?.querySelector('input[type="range"]');
      const sensBadge = rows.find(r => r.textContent.includes('Sensitivity') || r.textContent.includes('Чувствительность'))?.querySelector('.pg-value');

      return {
        benchDbVal: document.getElementById('bench-deadband-val')?.textContent,
        settingsDbSelectVal: deadbandSelect?.value,
        benchSensVal: document.getElementById('bench-sens-val')?.textContent,
        settingsSensInputVal: sensInput?.value,
        settingsSensBadge: sensBadge?.textContent,
      };
    });
    console.log('Bench -> Settings sync result:', syncBenchToSettings);
    if (syncBenchToSettings.benchDbVal !== '0.20 °/s' || syncBenchToSettings.settingsDbSelectVal !== '0.20') {
      throw new Error(`Deadband sync failed: ${JSON.stringify(syncBenchToSettings)}`);
    }
    if (syncBenchToSettings.benchSensVal !== '1.75x' || syncBenchToSettings.settingsSensInputVal !== '1.75' || syncBenchToSettings.settingsSensBadge !== '1.75x') {
      throw new Error(`Sensitivity sync failed: ${JSON.stringify(syncBenchToSettings)}`);
    }

    // 6. Test Bidirectional Sync: Settings -> Bench
    console.log('6. Testing parameter sync from Settings to Bench...');
    await ev(() => {
      const rows = Array.from(document.querySelectorAll('#screen-settings .pg-row'));
      const deadbandSelect = rows.find(r => r.textContent.includes('Deadband') || r.textContent.includes('Порог дрожи'))?.querySelector('select');
      if (deadbandSelect) {
        deadbandSelect.value = '0.35';
        deadbandSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const sensInput = rows.find(r => r.textContent.includes('Sensitivity') || r.textContent.includes('Чувствительность'))?.querySelector('input[type="range"]');
      if (sensInput) {
        sensInput.value = '2.25';
        sensInput.dispatchEvent(new Event('input', { bubbles: true }));
        sensInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await sleep(200);

    const syncSettingsToBench = await ev(() => {
      return {
        benchDbSliderVal: document.getElementById('bench-deadband-slider')?.value,
        benchDbVal: document.getElementById('bench-deadband-val')?.textContent,
        benchSensSliderVal: document.getElementById('bench-sens-slider')?.value,
        benchSensVal: document.getElementById('bench-sens-val')?.textContent,
      };
    });
    console.log('Settings -> Bench sync result:', syncSettingsToBench);
    if (syncSettingsToBench.benchDbSliderVal !== '0.35' || syncSettingsToBench.benchDbVal !== '0.35 °/s') {
      throw new Error(`Settings -> Bench Deadband sync failed: ${JSON.stringify(syncSettingsToBench)}`);
    }
    if (syncSettingsToBench.benchSensSliderVal !== '2.25' || syncSettingsToBench.benchSensVal !== '2.25x') {
      throw new Error(`Settings -> Bench Sensitivity sync failed: ${JSON.stringify(syncSettingsToBench)}`);
    }

    // 7. Test Save Button
    console.log('7. Testing "Save as setting" button...');
    await ev(() => {
      document.getElementById('btn-bench-save')?.click();
    });
    await sleep(200);

    const toastText = await ev(() => {
      const t = document.getElementById('toast');
      return { hidden: t?.hidden, text: t?.textContent };
    });
    console.log('Toast after save:', toastText);
    if (toastText.hidden || !toastText.text) {
      throw new Error(`Expected save toast message, got: ${JSON.stringify(toastText)}`);
    }

    // 8. Capture Screenshots
    console.log('8. Capturing visual validation screenshots...');
    const fs = await import('fs');
    fs.mkdirSync('tools/frontend-bench/out', { recursive: true });

    // Scroll bench into view (end: sliders & footer)
    await ev(() => {
      document.getElementById('set-bench-wrap')?.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step2_bench_dark.png', await p.screenshot());

    // Scroll bench into view (start: header bar & axis tabs)
    await ev(() => {
      document.getElementById('set-bench-wrap')?.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step2_bench_header.png', await p.screenshot());

    // Switch Axis to Single (Pitch X)
    await ev(() => {
      document.querySelector('#bench-axis-seg [data-axis="x"]')?.click();
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step2_bench_single_axis.png', await p.screenshot());

    // Switch back to All axes
    await ev(() => {
      document.querySelector('#bench-axis-seg [data-axis="all"]')?.click();
    });
    await sleep(150);

    // Light theme
    await ev(() => {
      document.getElementById('btn-theme')?.click();
    });
    await sleep(300);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step2_bench_light.png', await p.screenshot());

    // Restore dark theme
    await ev(() => {
      document.getElementById('btn-theme')?.click();
    });
    await sleep(200);

    // 820px container query
    await p.S('Emulation.setDeviceMetricsOverride', { width: 820, height: 720, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    await ev(() => {
      document.getElementById('set-bench-wrap')?.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_step2_bench_820px.png', await p.screenshot());

    // Restore viewport
    await p.S('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

    // 9. Verify Rule 0: Collapse section and verify no errors / zero overhead
    console.log('9. Testing Rule 0 deactivation on collapse & screen switch...');
    await ev(() => {
      document.getElementById('set-bench-toggle')?.click();
    });
    await sleep(200);

    const isCollapsed = await ev(() => {
      return !document.getElementById('set-bench-group')?.classList.contains('is-open') &&
             document.getElementById('set-bench-body')?.hidden === true;
    });
    if (!isCollapsed) throw new Error('Expected bench section collapsed');

    // Check errors
    const consoleErrs = p.errors();
    const benchErrs = await ev(() => window.__bench?.errors || []);
    console.log('Console errors:', consoleErrs);
    console.log('Bench errors:', benchErrs);
    if (consoleErrs.length > 0 || benchErrs.length > 0) {
      throw new Error(`Errors during Step 2 test: ${consoleErrs.join('; ')} / ${benchErrs.join('; ')}`);
    }

    console.log('✅ Task 6.5 Step 2 verification passed: 0 errors!');
  } finally {
    await b.close();
    closeServer();
  }
}

testStep2().catch((err) => {
  console.error('❌ Task 6.5 Step 2 verification failed:', err);
  process.exit(1);
});
