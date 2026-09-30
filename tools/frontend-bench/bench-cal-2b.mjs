// Test for Task 2B: Calibration wizard disconnect overlay and blocking
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 2B] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 2B] Server running at ${srv.base}`);

  console.log('[Bench 2B] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 2B] Loading app...');
    await p.goto(`${srv.base}/index.html`, 2500);

    // Click "Калибровать" to open calibration wizard
    console.log('[Bench 2B] Opening calibration...');
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(600);

    // ── 0. Verify Opening while Device is Offline ──
    const initOffline = await ev(() => {
      const cal = document.getElementById('cal');
      const overlay = document.getElementById('cal-disconnect-overlay');
      const modal = document.querySelector('.app-cal-modal');
      const oldOff = document.getElementById('cal-offline');
      return {
        calOpen: !cal?.hidden,
        overlayHidden: !!overlay?.hidden,
        modalDisconnected: modal?.classList.contains('is-disconnected'),
        hasOldOff: !!oldOff,
      };
    });
    console.log('[Bench 2B] Initial offline open state:', initOffline);
    if (!initOffline.calOpen) throw new Error('Calibration modal failed to open');
    if (initOffline.overlayHidden) throw new Error('Disconnect overlay should be visible when opened while offline');
    if (!initOffline.modalDisconnected) throw new Error('Modal should have is-disconnected when opened while offline');
    if (initOffline.hasOldOff) throw new Error('#cal-offline old notice should be removed');

    // ── 1. Bring Device Online ──
    console.log('[Bench 2B] Bringing device online...');
    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'online' });
      window.__STATE = s;
      window.__emit('state:change', s);
    });
    await sleep(350);

    const onlineState = await ev(() => {
      const overlay = document.getElementById('cal-disconnect-overlay');
      const modal = document.querySelector('.app-cal-modal');
      return {
        overlayHidden: !!overlay?.hidden,
        modalDisconnected: modal?.classList.contains('is-disconnected'),
      };
    });
    console.log('[Bench 2B] State after going online:', onlineState);
    if (!onlineState.overlayHidden) throw new Error('Disconnect overlay should hide when device goes online');
    if (onlineState.modalDisconnected) throw new Error('Modal should remove is-disconnected when device goes online');

    // ── 2. Simulate Device Disconnect during Wizard ──
    console.log('[Bench 2B] Triggering device disconnect (status: offline)...');
    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'offline' });
      window.__STATE = s;
      window.__emit('state:change', s);
    });
    await sleep(300);

    const disconnectState = await ev(() => {
      const overlay = document.getElementById('cal-disconnect-overlay');
      const modal = document.querySelector('.app-cal-modal');
      const title = document.querySelector('.app-cal-disconnect-title')?.textContent;
      const desc = document.querySelector('.app-cal-disconnect-desc')?.textContent;
      const badge = document.querySelector('.app-cal-disconnect-badge')?.textContent;
      const btn = document.getElementById('btn-cancel-cal-disconnect')?.textContent;
      return {
        overlayHidden: !!overlay?.hidden,
        modalDisconnected: modal?.classList.contains('is-disconnected'),
        title,
        desc,
        badge: badge?.trim(),
        btn: btn?.trim(),
      };
    });
    console.log('[Bench 2B] Disconnect overlay state (Dark, RU):', disconnectState);
    if (disconnectState.overlayHidden) throw new Error('Disconnect overlay must be visible when offline');
    if (!disconnectState.modalDisconnected) throw new Error('Modal must have is-disconnected class when offline');
    if (!disconnectState.title?.includes('Телефон отключен')) throw new Error(`Unexpected title: ${disconnectState.title}`);

    // Dismiss any old toast before capturing disconnect screenshots
    await ev(() => {
      const t = document.getElementById('toast');
      if (t) t.hidden = true;
    });

    // Screenshot: Disconnect overlay, Dark theme, RU
    console.log('[Bench 2B] Saving screenshot: 01_disconnect_dark.png...');
    writeFileSync(path.join(OUT_DIR, '01_disconnect_dark.png'), await p.screenshot());

    // ── 2. Test Light Theme ──
    console.log('[Bench 2B] Switching to light theme...');
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await sleep(200);
    console.log('[Bench 2B] Saving screenshot: 02_disconnect_light.png...');
    writeFileSync(path.join(OUT_DIR, '02_disconnect_light.png'), await p.screenshot());

    // Switch back to dark theme
    await ev(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await sleep(150);

    // ── 3. Test English Locale ──
    console.log('[Bench 2B] Switching to EN locale...');
    await ev(async () => {
      const { setLang } = await import('./js/core/i18n.js');
      setLang('en');
    });
    await sleep(400);

    const enState = await ev(() => {
      const title = document.querySelector('.app-cal-disconnect-title')?.textContent;
      const badge = document.querySelector('.app-cal-disconnect-badge')?.textContent;
      const btn = document.getElementById('btn-cancel-cal-disconnect')?.textContent;
      return { title, badge: badge?.trim(), btn: btn?.trim() };
    });
    console.log('[Bench 2B] Disconnect overlay state (Dark, EN):', enState);
    if (!enState.title?.includes('Phone Disconnected')) throw new Error(`EN title mismatch: ${enState.title}`);
    if (!enState.badge?.includes('Waiting for reconnection')) throw new Error(`EN badge mismatch: ${enState.badge}`);
    if (!enState.btn?.includes('Cancel Calibration')) throw new Error(`EN cancel button mismatch: ${enState.btn}`);

    console.log('[Bench 2B] Saving screenshot: 03_disconnect_en.png...');
    writeFileSync(path.join(OUT_DIR, '03_disconnect_en.png'), await p.screenshot());

    // Switch back to RU locale
    await ev(async () => {
      const { setLang } = await import('./js/core/i18n.js');
      setLang('ru');
    });
    await sleep(300);

    // ── 4. Reconnection & Toast ──
    console.log('[Bench 2B] Simulating device reconnection (status: online)...');
    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'online' });
      window.__STATE = s;
      window.__emit('state:change', s);
    });
    await sleep(350);

    const reconnectedState = await ev(() => {
      const overlay = document.getElementById('cal-disconnect-overlay');
      const modal = document.querySelector('.app-cal-modal');
      const toast = document.getElementById('toast');
      return {
        overlayHidden: !!overlay?.hidden,
        modalDisconnected: modal?.classList.contains('is-disconnected'),
        toastHidden: !!toast?.hidden,
        toastText: toast?.textContent?.trim(),
      };
    });
    console.log('[Bench 2B] Reconnected state:', reconnectedState);
    if (!reconnectedState.overlayHidden) throw new Error('Disconnect overlay must hide on reconnection');
    if (reconnectedState.modalDisconnected) throw new Error('Modal is-disconnected class must be removed');
    if (reconnectedState.toastHidden) throw new Error('Toast must be visible upon reconnection');
    if (!reconnectedState.toastText?.includes('Телефон подключен')) {
      throw new Error(`Unexpected toast text: ${reconnectedState.toastText}`);
    }

    console.log('[Bench 2B] Saving screenshot: 04_reconnected_toast.png...');
    writeFileSync(path.join(OUT_DIR, '04_reconnected_toast.png'), await p.screenshot());

    // ── 5. Interrupted In-Flight Capture ──
    console.log('[Bench 2B] Starting capture, then disconnecting mid-operation...');
    await ev(() => {
      const captureBtn = document.querySelector('#cal-foot [data-act="capture"]') || document.querySelector('#cal-left [data-act="capture"]');
      if (captureBtn) captureBtn.click();
    });
    // Wait for countdown / recording to become active
    await sleep(900);

    // Disconnect device mid-capture
    console.log('[Bench 2B] Disconnecting device during in-flight capture...');
    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'offline' });
      window.__STATE = s;
      window.__emit('state:change', s);
    });
    await sleep(300);

    const midCaptureState = await ev(() => {
      const overlay = document.getElementById('cal-disconnect-overlay');
      const modal = document.querySelector('.app-cal-modal');
      return {
        overlayHidden: !!overlay?.hidden,
        modalDisconnected: modal?.classList.contains('is-disconnected'),
      };
    });
    if (midCaptureState.overlayHidden) throw new Error('Overlay must be shown when capture was interrupted');

    // Reconnect device and verify ready-to-retry UI
    console.log('[Bench 2B] Reconnecting after interrupted capture...');
    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'online' });
      window.__STATE = s;
      window.__emit('state:change', s);
    });
    await sleep(350);

    const postInterruptedState = await ev(() => {
      const overlay = document.getElementById('cal-disconnect-overlay');
      const toast = document.getElementById('toast');
      const actionBox = document.querySelector('.app-cal-action-box');
      const captureBtn = document.querySelector('#cal-foot [data-act="capture"]');
      return {
        overlayHidden: !!overlay?.hidden,
        toastVisible: !toast?.hidden,
        toastText: toast?.textContent?.trim(),
        hasActionBox: !!actionBox,
        captureBtnDisabled: !!captureBtn?.disabled,
      };
    });
    console.log('[Bench 2B] Post-interrupted state:', postInterruptedState);
    if (!postInterruptedState.overlayHidden) throw new Error('Overlay must be hidden after reconnection');
    if (!postInterruptedState.toastVisible) throw new Error('Toast must be visible after interrupted reconnection');
    if (postInterruptedState.captureBtnDisabled) throw new Error('Capture button should be enabled and ready to retry');

    console.log('[Bench 2B] Saving screenshot: 05_capture_interrupted_reconnected.png...');
    writeFileSync(path.join(OUT_DIR, '05_capture_interrupted_reconnected.png'), await p.screenshot());

    // ── 6. Test Disabled disconnectAlert Setting ──
    console.log('[Bench 2B] Testing disconnectAlert: false setting...');
    // Close modal
    await ev(async () => {
      const { close } = await import('./js/screens/calibration.js');
      // Click close or cal-x
      const x = document.getElementById('cal-x');
      if (x) x.click();
    });
    await sleep(300);

    // Set disconnectAlert: false in __SETTINGS
    await ev(() => {
      window.__SETTINGS = Object.assign({}, window.__SETTINGS || {}, { disconnectAlert: false });
    });

    // Reopen calibration with setting disabled
    await ev(() => {
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(400);

    // Disconnect device
    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'offline' });
      window.__STATE = s;
      window.__emit('state:change', s);
    });
    await sleep(300);

    const noAlertState = await ev(() => {
      const overlay = document.getElementById('cal-disconnect-overlay');
      const modal = document.querySelector('.app-cal-modal');
      return {
        overlayHidden: !!overlay?.hidden,
        modalDisconnected: modal?.classList.contains('is-disconnected'),
      };
    });
    console.log('[Bench 2B] State with disconnectAlert disabled:', noAlertState);
    if (!noAlertState.overlayHidden) throw new Error('Overlay MUST NOT appear when disconnectAlert is disabled');
    if (noAlertState.modalDisconnected) throw new Error('Modal MUST NOT get is-disconnected class when disconnectAlert is disabled');

    // ── 7. Test Cancel Button ──
    console.log('[Bench 2B] Testing Cancel Calibration button...');
    // Restore disconnectAlert: true
    await ev(() => {
      window.__SETTINGS = Object.assign({}, window.__SETTINGS || {}, { disconnectAlert: true });
    });

    // Close and reopen calibration
    await ev(() => {
      const x = document.getElementById('cal-x');
      if (x) x.click();
    });
    await sleep(300);

    // Set online, open wizard
    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'online' });
      window.__STATE = s;
      window.__emit('state:change', s);
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(400);

    // Disconnect device
    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'offline' });
      window.__STATE = s;
      window.__emit('state:change', s);
    });
    await sleep(300);

    // Click "Отменить калибровку"
    console.log('[Bench 2B] Clicking Cancel Calibration button...');
    await ev(() => {
      const cancelBtn = document.getElementById('btn-cancel-cal-disconnect');
      if (cancelBtn) cancelBtn.click();
    });
    await sleep(350);

    const closedState = await ev(() => {
      const cal = document.getElementById('cal');
      return { calHidden: !!cal?.hidden };
    });
    console.log('[Bench 2B] Modal closed after cancel:', closedState);
    if (!closedState.calHidden) throw new Error('Calibration modal should close when Cancel Calibration is clicked');

    // ── 8. Narrow Window (820px) & 200% Zoom ──
    console.log('[Bench 2B] Testing narrow window (820px) with disconnect overlay...');
    await p.evaluate(`document.body.style.display = 'none'; void document.body.offsetHeight; document.body.style.display = '';`);
    // Resize viewport to 820x800 using CDP
    await p.S('Emulation.setDeviceMetricsOverride', {
      width: 820,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(200);

    // Set online, open wizard, then disconnect
    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'online' });
      window.__STATE = s;
      window.__emit('state:change', s);
      const btn = document.getElementById('btn-calibrate');
      if (btn) btn.click();
    });
    await sleep(400);

    await ev(() => {
      const s = Object.assign({}, window.__STATE, { status: 'offline' });
      window.__STATE = s;
      window.__emit('state:change', s);
    });
    await sleep(300);

    console.log('[Bench 2B] Saving screenshot: 06_disconnect_narrow_820.png...');
    writeFileSync(path.join(OUT_DIR, '06_disconnect_narrow_820.png'), await p.screenshot());

    // Test 200% zoom
    console.log('[Bench 2B] Testing 200% zoom with disconnect overlay...');
    await ev(async () => {
      const { setZoom } = await import('./js/ui/zoom.js');
      setZoom(2.0, { save: false, quiet: true });
    });
    await sleep(400);

    console.log('[Bench 2B] Saving screenshot: 07_disconnect_zoom_200.png...');
    writeFileSync(path.join(OUT_DIR, '07_disconnect_zoom_200.png'), await p.screenshot());

    console.log('\n[Bench 2B] ALL CHECKS PASSED SUCCESSFULLY!\n');
  } finally {
    await b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 2B] FAILED:', err);
  process.exit(1);
});
