// Benchmark for Task 4A: Sequential page fade in the router & rapid interruption resilience
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, serve, backendStub, sleep, FRONTEND } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  console.log('[Bench 4A] Serving frontend...');
  const srv = await serve(FRONTEND);
  console.log(`[Bench 4A] Server running at ${srv.base}`);

  console.log('[Bench 4A] Launching browser...');
  const b = await browser({ width: 1100, height: 800 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    console.log('[Bench 4A] Loading app...');
    await p.goto(`${srv.base}/index.html`, 2500);

    // Bring backend online
    await ev(() => {
      window.__emit('state:change', window.__stateAt('rest', 0));
    });
    await sleep(300);

    // Verify initial screen is 'connect'
    const initialScreen = await ev(() => {
      const connect = document.getElementById('screen-connect');
      const settings = document.getElementById('screen-settings');
      return {
        connectVisible: connect && !connect.hidden,
        settingsVisible: settings && !settings.hidden,
      };
    });
    console.log('[Bench 4A] Initial state:', initialScreen);
    if (!initialScreen.connectVisible || initialScreen.settingsVisible) {
      throw new Error('Initial screen state is incorrect');
    }

    // ── Test 1: Sequential fade from connect to settings ──
    console.log('[Bench 4A] Navigating connect -> settings...');
    // Capture 0% (before transition)
    const snap0 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '01_fade_0pct.png'), snap0);

    // Trigger navigation
    await ev(() => {
      const tab = document.querySelector('#nav [data-tab="settings"]');
      if (tab) tab.click();
    });

    // Capture ~50% (during transition, ~160ms out)
    await sleep(150);
    const snap50 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '01_fade_50pct.png'), snap50);

    const midOpacity = await ev(() => {
      const body = document.getElementById('body');
      return window.getComputedStyle(body).opacity;
    });
    console.log(`[Bench 4A] Mid-transition opacity: ${midOpacity}`);

    // Wait for fade-in to complete (~160 + ~210 + safety)
    await sleep(350);
    const snap100 = await p.screenshot();
    writeFileSync(path.join(OUT_DIR, '01_fade_100pct.png'), snap100);

    const postSettings = await ev(() => {
      const connect = document.getElementById('screen-connect');
      const settings = document.getElementById('screen-settings');
      const body = document.getElementById('body');
      return {
        connectHidden: connect.hidden,
        settingsHidden: settings.hidden,
        bodyOpacity: window.getComputedStyle(body).opacity,
        bodyInert: body.inert,
        bodyPointerEvents: window.getComputedStyle(body).pointerEvents,
      };
    });
    console.log('[Bench 4A] Settings state:', postSettings);
    if (!postSettings.connectHidden || postSettings.settingsHidden || postSettings.bodyOpacity !== '1') {
      throw new Error(`Settings transition failed: ${JSON.stringify(postSettings)}`);
    }

    // ── Test 2: Sequential fade from settings to docs ──
    console.log('[Bench 4A] Navigating settings -> docs (same chrome, header stays)...');
    await ev(() => {
      const tab = document.querySelector('#nav [data-tab="docs"]');
      if (tab) tab.click();
    });
    await sleep(450);

    const postDocs = await ev(() => {
      const docs = document.getElementById('screen-docs');
      const settings = document.getElementById('screen-settings');
      const header = document.getElementById('header');
      const body = document.getElementById('body');
      return {
        docsVisible: docs && !docs.hidden,
        settingsHidden: settings && settings.hidden,
        headerVisible: header && !header.hidden,
        headerOpacity: window.getComputedStyle(header).opacity,
        bodyOpacity: window.getComputedStyle(body).opacity,
      };
    });
    console.log('[Bench 4A] Docs state:', postDocs);
    if (!postDocs.docsVisible || !postDocs.settingsHidden || postDocs.bodyOpacity !== '1') {
      throw new Error(`Docs transition failed: ${JSON.stringify(postDocs)}`);
    }

    // ── Test 3: 10 rapid clicks interruption test ──
    console.log('[Bench 4A] Testing 10 rapid clicks (settings <-> docs <-> home)...');
    await ev(async () => {
      const setTab = document.querySelector('#nav [data-tab="settings"]');
      const docsTab = document.querySelector('#nav [data-tab="docs"]');
      const home = document.getElementById('home');

      const targets = [setTab, docsTab, setTab, docsTab, setTab, docsTab, setTab, docsTab, setTab, home];
      for (const t of targets) {
        if (t) t.click();
        await new Promise((r) => setTimeout(r, 20)); // 20ms between clicks
      }
    });

    // Wait for the final transition (home) to complete
    await sleep(550);

    const postRapid = await ev(() => {
      const connect = document.getElementById('screen-connect');
      const settings = document.getElementById('screen-settings');
      const docs = document.getElementById('screen-docs');
      const body = document.getElementById('body');
      const header = document.getElementById('header');
      return {
        connectVisible: connect && !connect.hidden,
        settingsHidden: settings.hidden,
        docsHidden: docs.hidden,
        bodyOpacity: window.getComputedStyle(body).opacity,
        bodyInert: body.inert,
        bodyPointerEvents: window.getComputedStyle(body).pointerEvents,
        headerOpacity: window.getComputedStyle(header).opacity,
        headerInert: header.inert,
      };
    });
    console.log('[Bench 4A] Post 10 rapid clicks state:', postRapid);
    if (!postRapid.connectVisible || postRapid.bodyOpacity !== '1' || postRapid.bodyInert) {
      throw new Error(`Rapid clicks interruption failed: ${JSON.stringify(postRapid)}`);
    }

    // ── Test 4: Prefers-reduced-motion test ──
    console.log('[Bench 4A] Testing prefers-reduced-motion emulation...');
    await p.S('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });

    const reducedMotionResult = await ev(async () => {
      const setTab = document.querySelector('#nav [data-tab="settings"]');
      const t0 = performance.now();
      if (setTab) setTab.click();
      // Wait only 40ms
      await new Promise((r) => setTimeout(r, 40));
      const t1 = performance.now();
      const settings = document.getElementById('screen-settings');
      const body = document.getElementById('body');
      return {
        elapsedMs: t1 - t0,
        settingsVisible: settings && !settings.hidden,
        bodyOpacity: window.getComputedStyle(body).opacity,
      };
    });
    console.log('[Bench 4A] Prefers-reduced-motion result:', reducedMotionResult);
    if (!reducedMotionResult.settingsVisible || reducedMotionResult.bodyOpacity !== '1') {
      throw new Error(`Prefers-reduced-motion failed: ${JSON.stringify(reducedMotionResult)}`);
    }

    // Check for errors
    const errs = p.errors();
    if (errs.length > 0) {
      console.error('[Bench 4A] Console errors detected:', errs);
      throw new Error(`Console errors: ${errs.join(', ')}`);
    }

    console.log('--- ALL BENCHMARK 4A CHECKS PASSED ---');
  } finally {
    b.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error('[Bench 4A] FAILED:', err);
  process.exit(1);
});
