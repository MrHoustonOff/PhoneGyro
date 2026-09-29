// Main-thread cost of a UI scenario.
// node perf.mjs [page] [--scenario offline|rest|move|dsu] [--seconds 10] [--ref gitref]
//               [--eval "js"] [--probe "js"] [--shot out.png] [--width 880] [--height 620] [--font-scale 1]
// page: index.html (default) or livedebug.html. --eval runs after startup (e.g. open a
// wizard), --probe prints a page expression at the end. Prints ms of main-thread work
// per second (all / script / style / layout), layouts per second, heap and errors.
import { writeFileSync } from 'node:fs';
import { args, backendStub, browser, serve, sleep, withTree, FRONTEND } from './lib.mjs';

const { pos, opt } = args();
const pageName = pos[0] || 'index.html';
const scenario = opt.scenario || 'rest';
const seconds = Number(opt.seconds || 10);

async function run(dir) {
  const srv = await serve(dir);
  const b = await browser({ width: Number(opt.width || 880), height: Number(opt.height || 620) });
  try {
    const p = await b.page(backendStub({ fontScale: opt['font-scale'] ? Number(opt['font-scale']) : 1 }));
    await p.goto(`${srv.base}/${pageName}`, 3000);
    if (pageName === 'index.html') {
      await p.evaluate(`__benchStart(${JSON.stringify(scenario)})`);
      // measure the main screen, not the first-connection centring sheet
      if (scenario !== 'offline') await p.evaluate('FirstCenterGate.done.phone = true; setTimeout(() => RecenterManager.close(true), 300)');
    }
    if (opt.eval) await p.evaluate(opt.eval);
    await sleep(1500);
    const m0 = await p.metrics();
    await sleep(seconds * 1000);
    const m1 = await p.metrics();
    const d = (k) => (m1[k] - m0[k]) / seconds;
    const out = {
      page: pageName, scenario, seconds,
      msPerSec: +(1000 * d('TaskDuration')).toFixed(1),
      scriptMsPerSec: +(1000 * d('ScriptDuration')).toFixed(1),
      styleMsPerSec: +(1000 * d('RecalcStyleDuration')).toFixed(1),
      layoutMsPerSec: +(1000 * d('LayoutDuration')).toFixed(1),
      layoutsPerSec: +d('LayoutCount').toFixed(1),
      heapMB: +(m1.JSHeapUsedSize / 1048576).toFixed(1),
      stateUpdates: await p.evaluate('window.__bench && window.__bench.emitted'),
      errors: [...p.errors(), ...(await p.evaluate('window.__bench ? window.__bench.errors : []'))],
    };
    if (opt.probe) out.probe = await p.evaluate(opt.probe);
    if (opt.shot) writeFileSync(opt.shot, await p.screenshot());
    return out;
  } finally { b.close(); srv.close(); }
}

const out = opt.ref ? await withTree(opt.ref, run) : await run(FRONTEND);
console.log(JSON.stringify(out, null, 1));
process.exit(0);
