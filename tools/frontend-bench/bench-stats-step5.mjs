// Step 5 Verification Script for Response Test Bench & Motion Oscilloscope
import { serve, browser, backendStub, sleep } from './lib.mjs';

async function testStep5() {
  console.log('Testing Step 5: Response Test Bench & Motion Oscilloscope...');
  const { base, close: closeServer } = await serve();
  const b = await browser({ width: 1280, height: 720 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    await p.goto(base, 2500);

    // 1. Navigate to Stats -> Response Bench
    console.log('1. Navigating to Stats -> Response Bench...');
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(600);

    await ev(() => {
      document.getElementById('subtab-btn-bench')?.click();
    });
    await sleep(400);

    const isBenchActive = await ev(() => {
      const activeBtn = document.querySelector('#stats-subnav .pg-seg__btn.is-active');
      const activePane = document.querySelector('.app-subtab-pane.is-active');
      return activeBtn?.dataset.subtab === 'bench' && activePane?.id === 'pane-bench';
    });
    console.log('Bench pane active:', isBenchActive);
    if (!isBenchActive) throw new Error('Expected bench pane active');

    // 2. Verify Header & Meta elements
    console.log('2. Checking bench header controls and indicators...');
    const headerCheck = await ev(() => ({
      sourceSeg: !!document.getElementById('bench-source-seg'),
      recenterBtn: !!document.getElementById('btn-bench-recenter'),
      stabilityBadge: document.getElementById('bench-stability-badge')?.textContent,
      noiseVal: document.getElementById('bench-noise-val')?.textContent,
      rateVal: document.getElementById('bench-rate-val')?.textContent,
    }));
    console.log('Header check:', headerCheck);
    if (!headerCheck.sourceSeg || !headerCheck.recenterBtn) {
      throw new Error(`Missing header controls: ${JSON.stringify(headerCheck)}`);
    }

    // 3. Inspect Oscilloscope Canvas & Mode switching
    console.log('3. Inspecting oscilloscope canvas and axis switching...');
    const canvasCheck = await ev(() => {
      const c = document.getElementById('bench-oscilloscope-canvas');
      const wrap = document.getElementById('bench-osc-wrap');
      return {
        exists: !!c,
        width: c?.clientWidth,
        height: c?.clientHeight,
        hasWrap: !!wrap,
        isSingle: wrap?.classList.contains('mode-single'),
      };
    });
    console.log('Canvas initial status:', canvasCheck);
    if (!canvasCheck.exists || canvasCheck.width === 0) {
      throw new Error('Canvas not properly sized');
    }

    // Switch to single axis (Pitch X)
    console.log('Switching axis mode to Pitch (X)...');
    await ev(() => {
      document.querySelector('#bench-axis-seg [data-axis="x"]')?.click();
    });
    await sleep(250);

    const singleModeCheck = await ev(() => {
      const wrap = document.getElementById('bench-osc-wrap');
      const activeAxisBtn = document.querySelector('#bench-axis-seg .pg-seg__btn.is-active');
      return {
        isSingle: wrap?.classList.contains('mode-single'),
        axis: activeAxisBtn?.dataset.axis,
      };
    });
    console.log('Single mode status:', singleModeCheck);
    if (!singleModeCheck.isSingle || singleModeCheck.axis !== 'x') {
      throw new Error('Expected mode-single class on wrap for single axis');
    }

    // Switch back to All 3 axes
    console.log('Switching axis mode back to All 3 axes...');
    await ev(() => {
      document.querySelector('#bench-axis-seg [data-axis="all"]')?.click();
    });
    await sleep(250);

    // 4. Stream simulated telemetry frames
    console.log('4. Streaming simulated tuning frames into oscilloscope...');
    await ev(() => {
      // Simulate continuous 60Hz tuning frames for 500ms
      for (let i = 0; i < 30; i++) {
        const t = i * 0.05;
        const rawX = 2.5 * Math.sin(t * 3.0) + (Math.random() - 0.5) * 0.6;
        const rawY = 3.2 * Math.cos(t * 2.5) + (Math.random() - 0.5) * 0.5;
        const rawZ = 1.1 * Math.sin(t * 1.5) + (Math.random() - 0.5) * 0.4;
        const outX = 2.4 * Math.sin(t * 3.0);
        const outY = 3.1 * Math.cos(t * 2.5);
        const outZ = 1.0 * Math.sin(t * 1.5);
        window.__emit('tuning:frame', {
          RawX: rawX,
          RawY: rawY,
          RawZ: rawZ,
          OutX: outX,
          OutY: outY,
          OutZ: outZ,
          Hz: 60,
        });
      }
    });
    await sleep(350);

    const streamStatus = await ev(() => ({
      rate: document.getElementById('bench-rate-val')?.textContent,
      stability: document.getElementById('bench-stability-badge')?.textContent,
      noise: document.getElementById('bench-noise-val')?.textContent,
    }));
    console.log('Stream status:', streamStatus);
    if (!streamStatus.rate?.includes('60 Hz')) {
      throw new Error(`Expected rate ~60 Hz, got: ${streamStatus.rate}`);
    }

    // 5. Test Live Parameter Sliders
    console.log('5. Testing deadband and sensitivity sliders...');
    await ev(() => {
      const dSlider = document.getElementById('bench-deadband-slider');
      if (dSlider) {
        dSlider.value = '0.22';
        dSlider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const sSlider = document.getElementById('bench-sens-slider');
      if (sSlider) {
        sSlider.value = '1.80';
        sSlider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(250);

    const sliderValues = await ev(() => ({
      deadbandText: document.getElementById('bench-deadband-val')?.textContent,
      sensText: document.getElementById('bench-sens-val')?.textContent,
    }));
    console.log('Updated slider readouts:', sliderValues);
    if (!sliderValues.deadbandText?.includes('0.22') || !sliderValues.sensText?.includes('1.80')) {
      throw new Error(`Sliders did not update labels: ${JSON.stringify(sliderValues)}`);
    }

    // 6. Visual validation screenshots
    console.log('6. Capturing visual validation screenshots...');
    const fs = await import('fs');
    fs.writeFileSync('tools/frontend-bench/out/bench_step5_osc_dark.png', await p.screenshot());

    // Switch to light theme
    await ev(() => {
      document.getElementById('btn-theme')?.click();
    });
    await sleep(300);
    fs.writeFileSync('tools/frontend-bench/out/bench_step5_osc_light.png', await p.screenshot());

    // Switch to single axis mode for light screenshot
    await ev(() => {
      document.querySelector('#bench-axis-seg [data-axis="x"]')?.click();
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step5_single_axis.png', await p.screenshot());

    // Restore dark theme & all axes
    await ev(() => {
      document.getElementById('btn-theme')?.click();
      document.querySelector('#bench-axis-seg [data-axis="all"]')?.click();
    });
    await sleep(200);

    // 7. Verify Rule 0 Disposal on tab switch
    console.log('7. Testing disposal on tab switch...');
    await ev(() => {
      document.getElementById('subtab-btn-telemetry')?.click();
    });
    await sleep(300);

    const activeAfterSwitch = await ev(() => ({
      benchActive: document.getElementById('pane-bench')?.classList.contains('is-active'),
      telemetryActive: document.getElementById('pane-telemetry')?.classList.contains('is-active'),
      errors: window.__bench?.errors || [],
    }));
    console.log('After switch status:', activeAfterSwitch);
    if (activeAfterSwitch.benchActive || !activeAfterSwitch.telemetryActive) {
      throw new Error('Pane active status incorrect after switch');
    }
    if (activeAfterSwitch.errors.length > 0) {
      throw new Error(`Errors during test: ${JSON.stringify(activeAfterSwitch.errors)}`);
    }

    console.log('✅ Step 5 verification passed: 0 errors!');
  } finally {
    await b.close();
    closeServer();
  }
}

testStep5().catch((err) => {
  console.error('❌ Step 5 verification failed:', err);
  process.exit(1);
});
