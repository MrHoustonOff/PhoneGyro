// One benchmark run: cold boot, then the stages below, each measured the same
// way (frames from the in-page recorder, main-thread work from CDP Performance
// metrics, heap after a full GC, CPU/RAM of the whole process tree in native
// mode) and checked: a stage whose scenario did not reach what it claims, or ran
// in a hidden/unfocused window, is INVALID and carries no verdict.

import { procDelta } from './engine.mjs';

// Target: 60 fps. A frame slower than 1.25 × 16.7 ms means the page could not
// hold 60 fps there, whatever the display's refresh rate.
// Idle (Rule 0) is judged by what only the app does: frames it asks for and
// layout it causes. Script and style time are reported but not judged: the
// recorder's own rAF and the 15 Hz state feed cost ~5 ms/s of script, and with
// software compositing (headless) CSS animations restyle on the main thread.
export const TARGET = { fps: 60, slowFrameMs: 1000 / 60 * 1.25, maxSlowPct: 1, idleMaxAppRaf: 0, idleMaxLayoutMsPerSec: 0.5 };

const SCALES = {
  quick: { connect: 1500, motion: 3000, stats: 4000, tuning: 0, disconnect: 0, pages: 2, pageGap: 200, reflow: 0, idle: 2500 },
  standard: { connect: 2500, motion: 6000, stats: 6000, tuning: 4000, disconnect: 1400, pages: 4, pageGap: 250, reflow: 2, idle: 4000 },
  stress: { connect: 2500, motion: 15000, stats: 15000, tuning: 8000, disconnect: 1400, pages: 10, pageGap: 150, reflow: 4, idle: 8000 },
};

export const STAGES = [
  { id: 'boot', name: 'Cold boot (page load → splash gone)' },
  { id: 'connect', name: 'Device connects' },
  { id: 'calibrate', name: 'Calibration wizard, 4 steps + 3D' },
  { id: 'motion', name: 'Motion: 60 Hz quat + 15 Hz state' },
  { id: 'stats', name: 'Stats & 3D page under motion' },
  { id: 'tuning', name: 'Settings response graph, 60 Hz' },
  { id: 'disconnect', name: 'Disconnect and reconnect' },
  { id: 'pages', name: 'Page switching' },
  { id: 'reflow', name: 'Theme and zoom switching' },
  { id: 'idle', name: 'Idle, connected, still (Rule 0)' },
];

const CDP_KEYS = { scriptMsPerSec: 'ScriptDuration', styleMsPerSec: 'RecalcStyleDuration', layoutMsPerSec: 'LayoutDuration', taskMsPerSec: 'TaskDuration' };

function verdict(id, m) {
  if (id === 'boot') return 'INFO';
  if (id === 'idle') {
    return m.page.appRafPerSec <= TARGET.idleMaxAppRaf && m.main.layoutMsPerSec <= TARGET.idleMaxLayoutMsPerSec ? 'PASS' : 'FAIL';
  }
  return m.page.slowPct <= TARGET.maxSlowPct ? 'PASS' : 'FAIL';
}

export async function runOnce(engine, { scale = 'standard', onProgress = () => {} } = {}) {
  const cfg = SCALES[scale] || SCALES.standard;
  const plan = STAGES.filter((s) => !(s.id in cfg) || cfg[s.id] !== 0);
  const results = [];
  let vsyncMs = 0;
  let errSeen = 0;

  async function measure(stage, body) {
    onProgress({ i: results.length + 1, n: plan.length, stage, phase: 'start' });
    const p0 = await engine.sampleProc();
    const m0 = await engine.metrics();
    if (stage.id !== 'boot') await engine.evaluate(`window.__pgBench.start(${JSON.stringify(stage.id)})`);
    // the compositor's side (frames shown/dropped, raster time) from a trace, and
    // for boot the peak layer area
    let layer = null;
    const traced = await engine.traceDuring(async () => {
      if (stage.id !== 'boot') return body();
      const r = await engine.layerPeakDuring(body);
      layer = { mpx: r.layerMpx, count: r.layers };
      return r.value;
    });
    const checks = traced.value;
    const gpu = traced.trace;
    const page = await engine.evaluate(`window.__pgBench.end(${vsyncMs}, ${TARGET.slowFrameMs})`);
    const m1 = await engine.metrics();
    const p1 = await engine.sampleProc();
    const heapMb = await engine.heapAfterGC();

    const dt = page.durationSec;
    const main = {};
    // a reload may restart the counters: then the new value is the whole delta
    const delta = (key) => { const a = m0[key] || 0, b = m1[key] || 0; return b >= a ? b - a : b; };
    for (const [k, key] of Object.entries(CDP_KEYS)) main[k] = +(1000 * delta(key) / dt).toFixed(1);
    main.layoutsPerSec = +(delta('LayoutCount') / dt).toFixed(1);
    main.styleRecalcsPerSec = +(delta('RecalcStyleCount') / dt).toFixed(1);

    const proc = procDelta(p0, p1);
    const errors = engine.errors().slice(errSeen);
    errSeen += errors.length;

    const why = [];
    for (const c of checks) if (!c.ok) why.push(`check failed: ${c.name}${c.detail !== undefined ? ' (' + c.detail + ')' : ''}`);
    for (const v of page.visibility) {
      if (!v.visible) why.push('page was hidden');
      if (!v.focused) why.push('window not focused');
    }
    if (engine.mode === 'native' && p1 && !(p1.procs || []).some((x) => x.pid === p1.fg)) why.push('another app owned the foreground window');
    if (page.frames < 10) why.push(`only ${page.frames} frames recorded`);

    const r = {
      id: stage.id,
      name: stage.name,
      page,
      main,
      heapMb,
      compositor: { ...gpu, rasterMsPerSec: gpu.rasterMs != null ? +(gpu.rasterMs / dt).toFixed(1) : null },
      layers: layer,
      jsEventListeners: m1.JSEventListeners ?? null,
      cdpNodes: m1.Nodes ?? null,
      proc,
      checks,
      errors,
      invalid: [...new Set(why)],
    };
    r.status = r.invalid.length ? 'INVALID' : verdict(stage.id, r);
    results.push(r);
    onProgress({ i: results.length, n: plan.length, stage, phase: 'done', result: r });
    return r;
  }

  const run = (name, ...args) => engine.evaluate(`window.__pgBench.run(${JSON.stringify(name)}${args.map((a) => ', ' + JSON.stringify(a)).join('')})`);

  for (const stage of plan) {
    if (stage.id === 'boot') {
      // the recorder starts with the new document (harness), so reload inside the window
      const r = await measure(stage, async () => {
        await engine.reloadCold(engine.startUrl);
        return run('boot');
      });
      r.boot = await engine.evaluate('window.__pgBench.bootTimes()');
      // refresh interval from a quiet second right after boot
      vsyncMs = await engine.evaluate('window.__pgBench.vsync(1200)');
      continue;
    }
    if (stage.id === 'connect') await measure(stage, () => run('connect', cfg.connect));
    if (stage.id === 'calibrate') await measure(stage, () => run('calibrate'));
    if (stage.id === 'motion') await measure(stage, () => run('motion', cfg.motion));
    if (stage.id === 'stats') await measure(stage, () => run('stats', cfg.stats));
    if (stage.id === 'tuning') await measure(stage, () => run('tuning', cfg.tuning));
    if (stage.id === 'disconnect') await measure(stage, () => run('disconnect', cfg.disconnect));
    if (stage.id === 'pages') {
      const screens = [];
      for (let i = 0; i < cfg.pages; i++) screens.push('settings', 'stats', 'docs', 'games', 'connect');
      await measure(stage, () => run('pages', screens, cfg.pageGap));
    }
    if (stage.id === 'reflow') await measure(stage, () => run('reflow', cfg.reflow));
    if (stage.id === 'idle') { await run('idlePrep'); await measure(stage, () => run('idle', cfg.idle)); }
  }

  return {
    vsyncMs: +vsyncMs.toFixed(2),
    refreshHz: vsyncMs ? +(1000 / vsyncMs).toFixed(1) : null,
    gpu: await engine.evaluate('window.__pgBench.gpu()'),
    screen: await engine.evaluate('window.__pgBench.screen()'),
    stages: results,
  };
}
