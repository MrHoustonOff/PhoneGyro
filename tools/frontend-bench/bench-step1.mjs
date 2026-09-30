// Step 1 Verification Script for Stats screen shell
import { serve, browser, backendStub, sleep } from './lib.mjs';

async function testStep1() {
  console.log('Testing Step 1: Stats Screen Shell...');
  const { base, close: closeServer } = await serve();
  const b = await browser({ width: 1280, height: 720 });
  const p = await b.page(backendStub());
  const ev = (fn) => p.evaluate(typeof fn === 'function' ? `(${fn.toString()})()` : fn);

  try {
    await p.goto(base, 2500);

    // Initial state: connect screen
    const initScreen = await ev(() => document.querySelector('.app-screen:not([hidden])')?.id);
    console.log('Initial visible screen:', initScreen);

    // Navigate to Stats tab
    console.log('Clicking Stats tab...');
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(600);

    // Check visible screen
    const statsVisible = await ev(() => {
      const el = document.getElementById('screen-stats');
      return el && !el.hidden && getComputedStyle(el).display !== 'none';
    });
    console.log('Is screen-stats visible:', statsVisible);
    if (!statsVisible) throw new Error('screen-stats should be visible after clicking Stats tab');

    // Check active subtab
    const activeSubtab = await ev(() => {
      const activeBtn = document.querySelector('#stats-subnav .pg-seg__btn.is-active');
      const activePane = document.querySelector('.app-subtab-pane.is-active');
      return { btn: activeBtn?.dataset.subtab, pane: activePane?.id };
    });
    console.log('Active subtab:', activeSubtab);
    if (activeSubtab.btn !== 'telemetry' || activeSubtab.pane !== 'pane-telemetry') {
      throw new Error(`Expected telemetry subtab active, got: ${JSON.stringify(activeSubtab)}`);
    }

    // Switch to games subtab
    console.log('Switching to games subtab...');
    await ev(() => {
      document.getElementById('subtab-btn-games')?.click();
    });
    await sleep(300);

    const gamesSubtab = await ev(() => {
      const activeBtn = document.querySelector('#stats-subnav .pg-seg__btn.is-active');
      const activePane = document.querySelector('.app-subtab-pane.is-active');
      return { btn: activeBtn?.dataset.subtab, pane: activePane?.id };
    });
    console.log('Games subtab:', gamesSubtab);
    if (gamesSubtab.btn !== 'games' || gamesSubtab.pane !== 'pane-games') {
      throw new Error(`Expected games subtab active, got: ${JSON.stringify(gamesSubtab)}`);
    }

    // Switch to bench subtab
    console.log('Switching to bench subtab...');
    await ev(() => {
      document.getElementById('subtab-btn-bench')?.click();
    });
    await sleep(300);

    const benchSubtab = await ev(() => {
      const activeBtn = document.querySelector('#stats-subnav .pg-seg__btn.is-active');
      const activePane = document.querySelector('.app-subtab-pane.is-active');
      return { btn: activeBtn?.dataset.subtab, pane: activePane?.id };
    });
    console.log('Bench subtab:', benchSubtab);
    if (benchSubtab.btn !== 'bench' || benchSubtab.pane !== 'pane-bench') {
      throw new Error(`Expected bench subtab active, got: ${JSON.stringify(benchSubtab)}`);
    }

    // Test second click on Stats tab returns to connect screen
    console.log('Second click on Stats tab (toggle back)...');
    await ev(() => {
      document.querySelector('#nav [data-tab="stats"]')?.click();
    });
    await sleep(600);

    const toggledScreen = await ev(() => document.querySelector('.app-screen:not([hidden])')?.id);
    console.log('Screen after toggle back:', toggledScreen);
    if (toggledScreen !== 'screen-connect') {
      throw new Error(`Expected screen-connect, got: ${toggledScreen}`);
    }

    const errs = p.errors();
    if (errs.length > 0) {
      throw new Error(`Console errors found: ${errs.join(', ')}`);
    }

    console.log('✅ Step 1 verification passed: 0 errors!');
  } finally {
    await b.close();
    closeServer();
  }
}

testStep1().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
