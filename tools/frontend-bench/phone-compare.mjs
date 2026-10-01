// Regression check for the phone page: the same sensor events go through web/index.html at a git ref
// (default HEAD) and through the working copy; the binary frames sent to the PC must be identical.
//   node tools/frontend-bench/phone-compare.mjs [ref]
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
window.__frames = [];
window.__t = 5000; performance.now = () => window.__t;
window.WebSocket = class {
  constructor() { this.readyState = 0; this.bufferedAmount = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 30); }
  send(d) { if (d instanceof ArrayBuffer) window.__frames.push(Array.from(new Uint8Array(d.slice(0)))); }
  close() { this.readyState = 3; this.onclose && this.onclose(); }
};
WebSocket.CONNECTING = 0; WebSocket.OPEN = 1; WebSocket.CLOSED = 3;
try { DeviceMotionEvent.requestPermission = undefined; } catch (e) {}
`;

async function run(html) {
  const srv = await serve(html);
  const b = await browser({ width: 390, height: 844 });
  const p = await b.page(stub);
  await p.goto(`http://127.0.0.1:${srv.address().port}/`, 400);
  // The same stream of sensor events, paced so every event can become a frame.
  const seq = [[40, 12, -8, 10, 20, 30], [41, 13, -7, -5, 8, 12], [43, 20, -2, 40, -30, 5], [350, -60, 80, 0, 0, 0], [10, 5, 5, 100, 100, 100]];
  for (const [a, be, g, ra, rb, rg] of seq) {
    await p.evaluate(`(() => {
      window.__t += 16;
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: ${a}, beta: ${be}, gamma: ${g} }));
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: ${ra}, beta: ${rb}, gamma: ${rg} }, accelerationIncludingGravity: { x: 1.5, y: -2.5, z: 9.1 } }));
    })()`);
    await sleep(25);
  }
  const frames = await p.evaluate('window.__frames');
  const errors = p.errors();
  b.close(); srv.close();
  return { frames, errors };
}

const f32 = (arr, off) => new DataView(Uint8Array.from(arr).buffer).getFloat32(off, true);
const u32 = (arr, off) => new DataView(Uint8Array.from(arr).buffer).getUint32(off, true);
const A = await run(oldHtml);
const B = await run(newHtml);
console.log('frames old/new:', A.frames.length, B.frames.length, 'errors new:', B.errors);
const n = Math.min(A.frames.length, B.frames.length);
let bad = 0;
for (let i = 0; i < n; i++) {
  const a = A.frames[i], b2 = B.frames[i];
  if (a.length !== 58 || b2.length !== 58) { console.log('length', i, a.length, b2.length); bad++; continue; }
  const diffs = [];
  for (const off of [8, 12, 16]) if (Math.abs(f32(a, off) - f32(b2, off)) > 0.05) diffs.push('rate@' + off + ' ' + f32(a, off) + ' vs ' + f32(b2, off));
  for (const off of [20, 24, 28, 32, 36, 40, 44]) if (Math.abs(f32(a, off) - f32(b2, off)) > 1e-6) diffs.push('f32@' + off + ' ' + f32(a, off) + ' vs ' + f32(b2, off));
  for (const off of [48, 50, 54]) if (u32(a, off) !== u32(b2, off)) diffs.push('u32@' + off + ' ' + u32(a, off) + ' vs ' + u32(b2, off));
  if (diffs.length) { bad++; console.log('frame', i, diffs.join('; ')); }
}
console.log(bad === 0 && n > 0 ? 'FRAMES MATCH' : 'MISMATCH', n);
process.exit(0);
