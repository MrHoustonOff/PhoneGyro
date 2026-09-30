// Step 2 Verification Script for Stats Telemetry, Metrics, Sparklines & CSV Recording
import { serve, browser, backendStub, sleep } from './lib.mjs';

async function testStep2() {
  console.log('Testing Step 2: Telemetry Metrics, Sparklines & CSV Recording...');
  const { base, close: closeServer } = await serve();
  const b = await browser({ width: 1280, height: 720 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    await p.goto(base, 2500);

    // Navigate to Stats tab
    console.log('1. Navigating to Stats screen...');
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(600);

    // Verify subtab is telemetry
    const isTelemetryActive = await ev(() => {
      const activeBtn = document.querySelector('#stats-subnav .pg-seg__btn.is-active');
      const activePane = document.querySelector('.app-subtab-pane.is-active');
      return activeBtn?.dataset.subtab === 'telemetry' && activePane?.id === 'pane-telemetry';
    });
    console.log('Telemetry pane active:', isTelemetryActive);
    console.log('Page errors so far:', p.errors());
    if (!isTelemetryActive) throw new Error('Expected telemetry pane active');

    // 2. Verify all 10 metric cards exist
    console.log('2. Checking 10 metric cards...');
    const cardsCheck = await ev(() => {
      const cardIds = [
        'stat-card-hz',
        'stat-card-latency',
        'stat-card-jitter',
        'stat-card-loss',
        'stat-card-raw-gyro',
        'stat-card-raw-accel',
        'stat-card-out-gyro',
        'stat-card-pipe',
        'stat-card-dsu-clients',
        'stat-card-angles',
      ];
      return cardIds.map((id) => ({ id, exists: !!document.getElementById(id) }));
    });
    console.log('Cards check:', cardsCheck);
    const missing = cardsCheck.filter((c) => !c.exists);
    if (missing.length > 0) throw new Error(`Missing cards: ${JSON.stringify(missing)}`);

    // 3. Emit real-time state changes and verify updates and sparkline generation
    console.log('3. Emitting state changes...');
    await ev(() => {
      const dummy = {
        status: 'online',
        isPaused: false,
        deviceName: 'iPhone 15 Pro',
        hz: 59.8,
        pingMs: 4.8,
        connectedTime: '00:15:20',
        pitch: 14.5,
        roll: -8.2,
        yaw: 120.4,
        rawRotX: 0.12,
        rawRotY: -0.45,
        rawRotZ: 0.03,
        rawAccX: 0.05,
        rawAccY: 0.12,
        rawAccZ: -0.98,
        dsuClients: 1,
        dsuClientList: [{ name: 'Cemu.exe', endpoint: '127.0.0.1:54321' }],
        usbConnected: false,
      };
      window.__emit('state:change', dummy);
    });
    await sleep(200);

    const values = await ev(() => ({
      hz: document.getElementById('stat-hz-val')?.textContent,
      lat: document.getElementById('stat-lat-val')?.textContent,
      jitter: document.getElementById('stat-jitter-val')?.textContent,
      gx: document.getElementById('tel-raw-gx')?.textContent,
      gy: document.getElementById('tel-raw-gy')?.textContent,
      gz: document.getElementById('tel-raw-gz')?.textContent,
      ax: document.getElementById('tel-raw-ax')?.textContent,
      ay: document.getElementById('tel-raw-ay')?.textContent,
      az: document.getElementById('tel-raw-az')?.textContent,
      dsuCount: document.getElementById('stat-dsu-count')?.textContent,
      dsuClient: document.getElementById('stat-dsu-client-name')?.textContent,
      pitch: document.getElementById('tel-angle-pitch')?.textContent,
      roll: document.getElementById('tel-angle-roll')?.textContent,
      yaw: document.getElementById('tel-angle-yaw')?.textContent,
    }));
    console.log('Rendered telemetry values:', values);
    if (values.hz !== '59.8') throw new Error(`Expected hz 59.8, got ${values.hz}`);
    if (values.lat !== '4.8') throw new Error(`Expected lat 4.8, got ${values.lat}`);
    if (values.gx !== '+0.12') throw new Error(`Expected gx +0.12, got ${values.gx}`);
    if (values.az !== '-0.98') throw new Error(`Expected az -0.98, got ${values.az}`);
    if (values.pitch !== '+14.5°') throw new Error(`Expected pitch +14.5°, got ${values.pitch}`);

    // Emit multiple states to generate sparkline path
    console.log('Emitting sequence to build sparklines...');
    for (let i = 0; i < 5; i++) {
      await ev(`window.__emit('state:change', {
        hz: ${58.0 + (i % 3)},
        pingMs: ${4.5 + i * 0.5},
        rawRotX: ${0.1 * i},
        rawRotY: ${-0.1 * i},
        rawRotZ: ${0.05 * i},
        rawAccX: ${0.01 * i},
        rawAccY: ${0.02 * i},
        rawAccZ: -0.99,
        pitch: ${10 + i},
        roll: ${-5 - i},
        yaw: ${100 + i}
      });`);
      await sleep(50);
    }

    const sparklines = await ev(() => ({
      hzPath: document.getElementById('stat-hz-spark')?.getAttribute('d'),
      latPath: document.getElementById('stat-lat-spark')?.getAttribute('d'),
      jitterPath: document.getElementById('stat-jitter-spark')?.getAttribute('d'),
    }));
    console.log('Sparklines path D preview:', {
      hz: sparklines.hzPath?.slice(0, 30),
      lat: sparklines.latPath?.slice(0, 30),
    });
    if (!sparklines.hzPath || !sparklines.hzPath.startsWith('M')) {
      throw new Error(`Expected valid SVG path for Hz sparkline, got ${sparklines.hzPath}`);
    }

    // 4. Test CSV Telemetry Recording
    console.log('4. Testing CSV Telemetry Recording...');
    const recordBtnBefore = await ev(() => {
      const btn = document.getElementById('btn-stats-record');
      return { isRec: btn?.classList.contains('is-recording'), text: btn?.textContent.trim() };
    });
    console.log('Record button before click:', recordBtnBefore);

    // Click start record
    await ev(() => document.getElementById('btn-stats-record')?.click());
    await sleep(200);

    const recordBtnAfterStart = await ev(() => {
      const btn = document.getElementById('btn-stats-record');
      return { isRec: btn?.classList.contains('is-recording'), text: btn?.textContent.trim() };
    });
    console.log('Record button after start:', recordBtnAfterStart);
    if (!recordBtnAfterStart.isRec) throw new Error('Record button should have .is-recording class');

    // Emit frames while recording
    for (let i = 0; i < 4; i++) {
      await ev(() => {
        window.__emit('state:change', {
          hz: 60,
          pingMs: 5,
          rawRotX: 0.5,
          rawRotY: 0.2,
          rawRotZ: -0.1,
          rawAccX: 0,
          rawAccY: 0,
          rawAccZ: -1,
        });
      });
      await sleep(120);
    }

    // Check timer and meta updated
    const recMeta = await ev(() => ({
      time: document.getElementById('stats-rec-time')?.textContent,
      meta: document.getElementById('stats-rec-meta')?.textContent,
    }));
    console.log('Recording progress:', recMeta);

    // Click stop record -> should open export modal
    console.log('Stopping recording to verify export modal...');
    await ev(() => document.getElementById('btn-stats-record')?.click());
    await sleep(400);

    const modalVisible = await ev(() => {
      const modal = document.querySelector('.app-overlay .pg-modal');
      return !!modal && getComputedStyle(modal).display !== 'none';
    });
    console.log('Export modal opened:', modalVisible);
    if (!modalVisible) throw new Error('Expected CSV export modal to open after recording stops');

    // Close export modal
    await ev(() => {
      const cancelBtn = Array.from(document.querySelectorAll('.app-overlay button')).find((b) =>
        b.textContent.includes('Закрыть') || b.textContent.includes('Close') || b.textContent.includes('Не сохранять')
      );
      cancelBtn?.click();
    });
    await sleep(300);

    // 5. Test USB card visibility
    console.log('5. Testing USB protocol card...');
    await ev(() => {
      window.__emit('state:change', {
        usbConnected: true,
        usbPort: 'COM3',
      });
      window.__emit('livedebug:telemetry', JSON.stringify({
        type: 'usb_proto',
        connected: true,
        port: 'COM3',
        baud: 115200,
        rate_hz: 500,
        frames: 12800,
        protocol: '1.1.0',
        gyro_range_dps: 2000,
        accel_range_g: 8,
        crc_rejects: 0,
        lost: 0,
      }));
    });
    await sleep(200);

    const usbCard = await ev(() => {
      const card = document.getElementById('stats-usb-card');
      return {
        visible: card && !card.hidden,
        l1: document.getElementById('stats-usb-l1')?.textContent,
        l2: document.getElementById('stats-usb-l2')?.textContent,
        l3: document.getElementById('stats-usb-l3')?.textContent,
      };
    });
    console.log('USB card state:', usbCard);
    if (!usbCard.visible) throw new Error('USB card should be visible when usbConnected is true');
    if (!usbCard.l1.includes('COM3')) throw new Error(`Expected COM3 in L1, got: ${usbCard.l1}`);

    // 6. Test camera mode switcher
    console.log('6. Testing camera mode switcher...');
    await ev(() => {
      const quadBtn = document.querySelector('#stats-cam-mode-seg [data-cam="quad"]');
      quadBtn?.click();
    });
    await sleep(150);

    const quadState = await ev(() => ({
      quadDisplay: document.getElementById('stats-3d-quad-wrap')?.style.display,
      singleDisplay: document.getElementById('stats-3d-viewport-single')?.style.display,
    }));
    console.log('Quad mode displays:', quadState);
    if (quadState.quadDisplay !== 'grid' || quadState.singleDisplay !== 'none') {
      throw new Error(`Expected quad visible, got: ${JSON.stringify(quadState)}`);
    }

    // Switch back to static
    await ev(() => {
      const staticBtn = document.querySelector('#stats-cam-mode-seg [data-cam="static"]');
      staticBtn?.click();
    });
    await sleep(150);

    // 7. Screenshots in Dark and Light themes
    console.log('7. Capturing screenshots...');
    const fs = await import('fs');
    fs.writeFileSync('tools/frontend-bench/out/bench_step2_dark.png', await p.screenshot());

    // Toggle to Light theme
    await ev(() => document.getElementById('btn-theme')?.click());
    await sleep(300);
    fs.writeFileSync('tools/frontend-bench/out/bench_step2_light.png', await p.screenshot());

    // Toggle back to Dark theme
    await ev(() => document.getElementById('btn-theme')?.click());
    await sleep(200);

    // Scroll sidebar to capture 10 metric cards
    await ev(() => {
      const side = document.querySelector('.pg-tel__side');
      if (side) side.scrollTop = 280;
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step2_metrics_scroll.png', await p.screenshot());

    const errs = p.errors();
    if (errs.length > 0) {
      throw new Error(`Console errors found: ${errs.join(', ')}`);
    }

    console.log('✅ Step 2 verification passed: 0 errors!');
  } finally {
    await b.close();
    closeServer();
  }
}

testStep2().catch((err) => {
  console.error('❌ Step 2 verification failed:', err);
  process.exit(1);
});
