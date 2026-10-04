// Screenshots of the PhoneGyro UI (docs, reviews), no Windows needed.
// The frontend runs in headless Chrome with the bench's mock backend
// (tools/bench-daemon): splash played, a device connected, then the screen asked.
//
//   node tools/screenshot/shot.mjs [options] out.png [more shots...]
//
//   --screen connect|stats|settings|docs|games|calibration   (default connect)
//   --lang ru|en        --theme dark|light       --zoom 1.25
//   --width 1280 --height 720 --dpr 1
//   --device "Nano MPU-6050"   connected device name; --offline: no device
//   --motion            live motion + 2 DSU clients (Cemu, PadTest) before the shot
//   --wait 600          ms to settle before the shot
//   --click "#sel"      click an element first (repeatable)
//   --eval "js"         run JS in the page first (repeatable)
//   --clip "#sel"       shot of one element instead of the window
//   --full              whole scroll height of the current screen
//
// Several shots in one run: separate them with "--", e.g.
//   node tools/screenshot/shot.mjs --screen docs docs.png -- --screen stats --motion stats.png
// Options carry over to the next shot unless set again.
// 3D is drawn by software (SwiftShader): looks right, just slow.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../bench-daemon/engine.mjs';

function parse(args) {
  const o = { click: [], eval: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { o.out = a; continue; }
    const k = a.slice(2);
    if (['motion', 'offline', 'full'].includes(k)) { o[k] = true; continue; }
    const v = args[++i];
    if (k === 'click' || k === 'eval') o[k].push(v); else o[k] = v;
  }
  return o;
}

const groups = [[]];
for (const a of process.argv.slice(2)) { if (a === '--') groups.push([]); else groups[groups.length - 1].push(a); }
if (!groups[0].length) { console.log('usage: see the header of tools/screenshot/shot.mjs'); process.exit(2); }

let prev = { screen: 'connect', lang: 'ru', theme: 'dark', width: '1280', height: '720', dpr: '1', wait: '600', device: 'Nano MPU-6050' };
const shots = groups.map((g) => { const o = parse(g); const m = { ...prev, ...o, click: o.click, eval: o.eval }; prev = { ...m, out: undefined, clip: undefined, full: undefined, click: [], eval: [] }; return m; });
for (const s of shots) if (!s.out) { console.error('each shot needs an output .png path'); process.exit(2); }

const first = shots[0];
const eng = await launchBrowser({ width: +first.width, height: +first.height });
const ev = (js) => eng.evaluate(js);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let code = 0;
try {
  await eng.reloadCold(eng.startUrl);
  await ev('window.__pgBench.run("boot")');
  let connected = false;
  for (const s of shots) {
    await eng.send('Emulation.setDeviceMetricsOverride', { width: +s.width, height: +s.height, deviceScaleFactor: +s.dpr, mobile: false });
    const B = 'window.__pgBench';
    await ev(`${B}.notify('theme-sync', ${JSON.stringify(s.theme)})`);
    await ev(`(document.querySelector('[data-lang="${s.lang}"]')||{click(){}}).click()`);
    if (s.zoom) await ev(`${B}.notify('font-scale-sync', ${+s.zoom})`);
    if (!s.offline && !connected) {
      await ev(`${B}.pushState({ status: 'online', hz: 200, pingMs: 0, pitch: 0.4, roll: -0.3, yaw: 12, deviceName: ${JSON.stringify(s.device)} }); ${B}.notify('device:connected', true)`);
      connected = true;
    }
    if (s.motion) await ev(`${B}.startMotion()`); else await ev(`${B}.stopStreams()`);
    if (s.screen === 'connect') await ev(`document.getElementById('home').click()`);
    else if (s.screen === 'calibration') await ev(`document.getElementById('home').click(); setTimeout(() => document.getElementById('btn-calibrate')?.click(), 200)`);
    else await ev(`${B}.tab(${JSON.stringify(s.screen)})`);
    await sleep(400);
    for (const c of s.click) await ev(`document.querySelector(${JSON.stringify(c)})?.click()`);
    for (const e of s.eval) await ev(`(async () => { ${e} })()`);
    await sleep(+s.wait);
    let clip;
    if (s.clip || s.full) {
      clip = await ev(`(() => {
        const el = ${s.clip ? `document.querySelector(${JSON.stringify(s.clip)})` : `document.querySelector('.pg-screen:not([hidden]) .pg-scroll, .pg-screen:not([hidden])')`};
        if (!el) return null;
        ${s.full ? `el.style.maxHeight = 'none'; el.style.height = 'auto'; el.style.overflow = 'visible';` : ''}
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: Math.max(1, r.width), height: Math.max(1, ${s.full ? 'el.scrollHeight' : 'r.height'}), scale: 1 };
      })()`);
      if (!clip) { console.error(`${s.out}: element not found (${s.clip || 'screen'})`); code = 1; continue; }
    }
    const { data } = await eng.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    mkdirSync(path.dirname(path.resolve(s.out)), { recursive: true });
    writeFileSync(s.out, Buffer.from(data, 'base64'));
    console.log('saved', s.out);
  }
  const errs = eng.errors();
  if (errs.length) { console.error('page errors:\n  ' + errs.slice(0, 10).join('\n  ')); }
} catch (e) {
  console.error(e.stack || e.message); code = 2;
} finally {
  await eng.close();
}
process.exit(code);
