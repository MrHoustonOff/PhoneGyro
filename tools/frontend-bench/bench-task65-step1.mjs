// Step 1 Verification Script for Task 6.5
import { serve, browser, backendStub, sleep } from './lib.mjs';

async function testStep1() {
  console.log('Testing Task 6.5 Step 1: Relocating Bench & Mini-games to Settings...');
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
    await sleep(500);

    const isSettingsActive = await ev(() => {
      const activeBtn = document.querySelector('#nav .pg-tab.is-active');
      const activePane = document.getElementById('screen-settings');
      return activeBtn?.dataset.tab === 'settings' && !activePane?.hidden;
    });
    console.log('Settings screen active:', isSettingsActive);
    if (!isSettingsActive) throw new Error('Expected settings screen active');

    // 2. Inspect Bench Section in Settings (Default Collapsed State)
    console.log('2. Inspecting bench section in settings (collapsed by default)...');
    const initialBenchState = await ev(() => {
      const wrap = document.getElementById('set-bench-wrap');
      const group = document.getElementById('set-bench-group');
      const toggle = document.getElementById('set-bench-toggle');
      const body = document.getElementById('set-bench-body');
      return {
        wrapExists: !!wrap,
        groupExists: !!group,
        isOpen: group?.classList.contains('is-open'),
        ariaExpanded: toggle?.getAttribute('aria-expanded'),
        bodyHidden: body?.hidden,
      };
    });
    console.log('Initial bench section state:', initialBenchState);
    if (!initialBenchState.wrapExists || initialBenchState.isOpen || initialBenchState.ariaExpanded !== 'false' || !initialBenchState.bodyHidden) {
      throw new Error(`Expected bench section collapsed by default: ${JSON.stringify(initialBenchState)}`);
    }

    // 3. Expand the bench section
    console.log('3. Expanding bench section...');
    await ev(() => {
      document.getElementById('set-bench-toggle')?.click();
    });
    await sleep(300);

    const expandedState = await ev(() => {
      const group = document.getElementById('set-bench-group');
      const toggle = document.getElementById('set-bench-toggle');
      const body = document.getElementById('set-bench-body');
      const paneBench = document.getElementById('set-pane-bench');
      const paneGames = document.getElementById('set-pane-games');
      const activeTabBtn = document.querySelector('#set-bench-seg .pg-seg__btn.is-active');
      return {
        isOpen: group?.classList.contains('is-open'),
        ariaExpanded: toggle?.getAttribute('aria-expanded'),
        bodyHidden: body?.hidden,
        activeTab: activeTabBtn?.dataset.benchTab,
        benchHidden: paneBench?.hidden,
        gamesHidden: paneGames?.hidden,
      };
    });
    console.log('Expanded bench state:', expandedState);
    if (!expandedState.isOpen || expandedState.ariaExpanded !== 'true' || expandedState.bodyHidden || expandedState.benchHidden || !expandedState.gamesHidden) {
      throw new Error(`Expanded state invalid: ${JSON.stringify(expandedState)}`);
    }

    // 4. Switch to Mini-games tab
    console.log('4. Switching to Mini-games tab...');
    await ev(() => {
      document.querySelector('#set-bench-seg [data-bench-tab="games"]')?.click();
    });
    await sleep(200);

    const gamesTabState = await ev(() => {
      const paneBench = document.getElementById('set-pane-bench');
      const paneGames = document.getElementById('set-pane-games');
      const activeTabBtn = document.querySelector('#set-bench-seg .pg-seg__btn.is-active');
      return {
        activeTab: activeTabBtn?.dataset.benchTab,
        benchHidden: paneBench?.hidden,
        gamesHidden: paneGames?.hidden,
        storedTab: localStorage.getItem('pg-settings-bench-tab'),
        storedOpen: localStorage.getItem('pg-settings-bench-open'),
      };
    });
    console.log('Games tab state:', gamesTabState);
    if (gamesTabState.activeTab !== 'games' || !gamesTabState.benchHidden || gamesTabState.gamesHidden) {
      throw new Error(`Mini-games tab switch failed: ${JSON.stringify(gamesTabState)}`);
    }

    // 5. Navigate to Stats & 3D and verify clean single-page telemetry
    console.log('5. Navigating to Stats & 3D to verify clean layout...');
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(600);

    const statsCleanState = await ev(() => {
      const statsScreen = document.getElementById('screen-stats');
      const subnav = document.getElementById('stats-subnav');
      const paneGames = document.getElementById('pane-games');
      const paneBench = document.getElementById('pane-bench');
      const pgTel = document.querySelector('#screen-stats .pg-tel');
      const canvasHost = document.getElementById('stats-3d-canvas-host');
      const statCards = document.querySelectorAll('#screen-stats .pg-stat');
      return {
        statsActive: !statsScreen?.hidden,
        noSubnav: !subnav,
        noOldGamesPane: !paneGames,
        noOldBenchPane: !paneBench,
        pgTelExists: !!pgTel,
        canvasHostExists: !!canvasHost,
        statCardCount: statCards.length,
      };
    });
    console.log('Stats clean state:', statsCleanState);
    if (!statsCleanState.statsActive || !statsCleanState.noSubnav || !statsCleanState.noOldGamesPane || !statsCleanState.noOldBenchPane || !statsCleanState.pgTelExists) {
      throw new Error(`Stats screen not properly cleaned: ${JSON.stringify(statsCleanState)}`);
    }

    // 6. Capture Screenshots
    console.log('6. Capturing visual validation screenshots...');
    const fs = await import('fs');
    fs.mkdirSync('tools/frontend-bench/out', { recursive: true });

    // Clean Stats screen
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_stats_clean.png', await p.screenshot());

    // Back to Settings (expanded)
    await ev(() => {
      document.querySelector('#nav [data-tab="settings"]')?.click();
    });
    await sleep(400);
    await ev(() => {
      const group = document.getElementById('set-bench-group');
      if (!group?.classList.contains('is-open')) {
        document.getElementById('set-bench-toggle')?.click();
      }
      document.getElementById('set-bench-wrap')?.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_settings_expanded.png', await p.screenshot());

    // Settings (collapsed)
    await ev(() => {
      const group = document.getElementById('set-bench-group');
      if (group?.classList.contains('is-open')) {
        document.getElementById('set-bench-toggle')?.click();
      }
      document.getElementById('set-bench-wrap')?.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_settings_collapsed.png', await p.screenshot());

    // Settings Light Theme (expanded to check both theme & bench styling)
    await ev(() => {
      const group = document.getElementById('set-bench-group');
      if (!group?.classList.contains('is-open')) {
        document.getElementById('set-bench-toggle')?.click();
      }
      document.getElementById('btn-theme')?.click();
      document.getElementById('set-bench-wrap')?.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
    await sleep(300);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_settings_light.png', await p.screenshot());

    // Restore dark theme
    await ev(() => {
      document.getElementById('btn-theme')?.click();
    });
    await sleep(200);

    // 7. Check 820px container query behavior
    console.log('7. Testing 820px container responsiveness...');
    await p.S('Emulation.setDeviceMetricsOverride', { width: 820, height: 720, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    await ev(() => {
      document.getElementById('set-bench-wrap')?.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
    await sleep(200);
    fs.writeFileSync('tools/frontend-bench/out/bench_step65_820px.png', await p.screenshot());

    // 8. Console and bridge error check
    const consoleErrs = p.errors();
    const benchErrs = await ev(() => window.__bench?.errors || []);
    console.log('Console errors:', consoleErrs);
    console.log('Bench errors:', benchErrs);
    if (consoleErrs.length > 0 || benchErrs.length > 0) {
      throw new Error(`Errors during test: ${consoleErrs.join('; ')} / ${benchErrs.join('; ')}`);
    }

    console.log('✅ Task 6.5 Step 1 verification passed: 0 errors!');
  } finally {
    await b.close();
    closeServer();
  }
}

testStep1().catch((err) => {
  console.error('❌ Task 6.5 Step 1 verification failed:', err);
  process.exit(1);
});
