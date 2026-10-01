// Main-thread cost of the phone page under 60 Hz sensor events, on the main screen and under the Touch Shield,
// for a git ref (default HEAD) and for the working copy.   node tools/frontend-bench/phone-perf.mjs [ref]
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { browser, sleep, ROOT } from './lib.mjs';

const ref = process.argv[2] || 'HEAD';
const oldHtml = execFileSync('git', ['-C', ROOT, 'show', ref + ':web/index.html'], { maxBuffer: 1 << 26 }).toString('utf8');
const newHtml = readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');

function serve(html) {
  const s = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html.replaceAll('__APP_VERSION__', 't')); }
    if (u.pathname === '/api/mode') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"mode":"phone"}'); }
    const m = u.pathname.match(/^\/m\/[^/]+\/(.+)$/);
    const f = m && path.join(ROOT, 'web', 'assets', m[1]);
    if (f && existsSync(f)) { res.writeHead(200); return res.end(readFileSync(f)); }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
}
const stub = `
window.WebSocket = class {
  constructor() { this.readyState = 0; this.bufferedAmount = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 30); }
  send() {} close() {}
};
WebSocket.CONNECTING = 0; WebSocket.OPEN = 1; WebSocket.CLOSED = 3;
try { DeviceMotionEvent.requestPermission = undefined; } catch (e) {}
`;
async function run(html, locked) {
  const srv = await serve(html);
  const b = await browser({ width: 390, height: 844 });
  const p = await b.page(stub);
  await p.S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await p.goto(`http://127.0.0.1:${srv.address().port}/`, 500);
  if (locked) { await p.evaluate(`document.getElementById('btn-screensaver').click()`); await sleep(500); }
  await p.evaluate(`(() => { let i = 0; window.__iv = setInterval(() => { i++;
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 40 + Math.sin(i / 20) * 30, beta: Math.sin(i / 30) * 40, gamma: Math.cos(i / 25) * 40 }));
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: 5, beta: 6, gamma: 7 }, accelerationIncludingGravity: { x: 1, y: 2, z: 9 } }));
  }, 1000 / 60); })()`);
  await sleep(500);
  const m0 = await p.metrics();
  await sleep(4000);
  const m1 = await p.metrics();
  const d = (k) => (m1[k] - m0[k]) / 4;
  const out = { script_ms_s: +(d('ScriptDuration') * 1000).toFixed(1), style_ms_s: +(d('RecalcStyleDuration') * 1000).toFixed(1), layout_ms_s: +(d('LayoutDuration') * 1000).toFixed(1),
    recalcs_s: +d('RecalcStyleCount').toFixed(0), layouts_s: +d('LayoutCount').toFixed(0), task_ms_s: +(d('TaskDuration') * 1000).toFixed(1) };
  b.close(); srv.close();
  return out;
}
for (const locked of [false, true]) {
  console.log(locked ? '--- Touch Shield on' : '--- main screen', '(60 Hz sensor events)');
  console.log(' old', JSON.stringify(await run(oldHtml, locked)));
  console.log(' new', JSON.stringify(await run(newHtml, locked)));
}
process.exit(0);
