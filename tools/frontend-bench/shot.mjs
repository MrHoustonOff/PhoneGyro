// One-shot screenshot helper: open a screen of the new UI and save a PNG.
//   node tools/frontend-bench/shot.mjs --screen stats --theme light --w 820 --zoom 2 --state offline --name stats_narrow
// Options (all optional):
//   --screen connect|settings|stats|docs|calibration   (default connect)
//   --theme dark|light   --w 1280 --h 720   --zoom 1.75   --lang ru|en   --accent gold|green|...
//   --state online|move|offline (fixture state, default online)   --wait 1200 (ms after opening)
//   --click "#selector"   (repeatable via commas: "#a,#b", clicked in order, 400 ms apart)
//   --eval "js"            run JS in the page before the shot (e.g. emit events: window.__emit('tuning:frame', {...}))
//   --after 500            ms to wait after --eval before the shot
//   --name file            output tools/frontend-bench/out/<name>.png (default shot_<screen>_<theme>)
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { browser, serve, backendStub, sleep, args, FRONTEND, HERE } from './lib.mjs';

const { opt } = args();
const screen = opt.screen || 'connect', theme = opt.theme || 'dark';
const out = path.join(HERE, 'out'); mkdirSync(out, { recursive: true });
const srv = await serve(FRONTEND);
const b = await browser({ width: +(opt.w || 1280), height: +(opt.h || 720) });
const p = await b.page(backendStub());
const ev = (js) => p.evaluate(typeof js === 'function' ? `(${js.toString()})()` : js);
await p.goto(`${srv.base}/index.html`, 2500);
await ev(`document.documentElement.dataset.theme='${theme}'`);
if (opt.zoom) await ev(`document.documentElement.style.setProperty('--pg-zoom','${opt.zoom}')`);
if (opt.accent) await ev(`document.documentElement.dataset.accent='${opt.accent}'`);
if (opt.lang) { await ev(`window.__emit && 0`); }
await ev(`window.__emit('state:change', window.__stateAt('${opt.state === 'offline' ? 'offline' : opt.state === 'move' ? 'move' : 'rest'}', 1))`);
await sleep(300);
const tab = { settings: '#nav [data-tab="settings"]', stats: '#nav [data-tab="stats"]', docs: '#nav [data-tab="docs"]', calibration: '#btn-calibrate' }[screen];
if (tab) await ev(`document.querySelector('${tab}').click()`);
await sleep(+(opt.wait || 1200));
for (const sel of String(opt.click || '').split(',').filter(Boolean)) { await ev(`document.querySelector('${sel}')?.click()`); await sleep(400); }
if (opt.eval) { await ev(String(opt.eval)); await sleep(+(opt.after || 500)); }
const name = opt.name || `shot_${screen}_${theme}`;
writeFileSync(path.join(out, name + '.png'), await p.screenshot());
console.log(path.join(out, name + '.png'));
process.exit(0);
