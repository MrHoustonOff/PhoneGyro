// Screenshot / smoke helper for the phone page (web/index.html), served as the Go server does:
// the page with __APP_VERSION__ filled in, /m/<build>/ for fonts and textures, a fake WebSocket.
//   node tools/frontend-bench/phone.mjs --state connected --theme dark --lang en --name phone_on
// Options: --state connected|off|usb|warn|lock|holding   --theme dark|light   --lang ru|en
//          --w 390 --h 844 --dpr 2   --tilt "pitch,roll,alpha" (degrees, default 12,-8,40)   --wait 1200   --name file
// The picture lands in tools/frontend-bench/out/<name>.png; page errors are printed.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { browser, args, sleep, HERE, ROOT } from './lib.mjs';

const { opt } = args();
const WEB = path.join(ROOT, 'web');
const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const mode = opt.state === 'usb' ? 'usb' : 'phone';

const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') {
    const html = readFileSync(path.join(WEB, 'index.html'), 'utf8').replaceAll('__APP_VERSION__', 'test');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
  }
  if (u.pathname === '/api/mode') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ mode })); }
  const m = u.pathname.match(/^\/m\/[^/]+\/(.+)$/);
  const f = m && path.join(WEB, 'assets', m[1]);
  if (f && existsSync(f)) { res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); return res.end(readFileSync(f)); }
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

// A WebSocket that opens at once (unless --state off/usb), answers like the PC and counts frames.
const stub = `
window.__sent = 0;
window.WebSocket = class {
  constructor() { this.readyState = 0; this.bufferedAmount = 0; setTimeout(() => {
    if (${JSON.stringify(opt.state === 'off' || opt.state === 'usb')}) { this.readyState = 3; this.onclose && this.onclose(); return; }
    this.readyState = 1; this.onopen && this.onopen(); }, 80); }
  send() { window.__sent++; }
  close() { this.readyState = 3; this.onclose && this.onclose(); }
};
WebSocket.CONNECTING = 0; WebSocket.OPEN = 1; WebSocket.CLOSED = 3;
localStorage.setItem('gb_theme', ${JSON.stringify(opt.theme || 'dark')});
localStorage.setItem('gb_lang', ${JSON.stringify(opt.lang || 'ru')});
if (!${JSON.stringify(opt.state === 'warn')}) { try { DeviceMotionEvent.requestPermission = undefined; } catch (e) {} }
if (${JSON.stringify(opt.state === 'warn')}) { window.DeviceMotionEvent = class { static requestPermission() { return new Promise(() => {}); } }; }
`;

const W = +(opt.w || 390), H = +(opt.h || 844);
const b = await browser({ width: W, height: H });
const p = await b.page(stub);
await p.S('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +(opt.dpr || 2), mobile: true });
await p.goto(base + '/', 300);

if (opt.state !== 'warn') {
  const [pitch, roll, alpha] = String(opt.tilt || '12,-8,40').split(',').map(Number);
  await p.evaluate(`(() => {
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: ${alpha}, beta: ${pitch}, gamma: ${roll} }));
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: 1, beta: 2, gamma: 3 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 } }));
  })()`);
}
if (opt.state === 'lock' || opt.state === 'holding') {
  await p.evaluate(`document.getElementById('btn-screensaver').click()`);
  if (opt.state === 'holding') await p.evaluate(`document.getElementById('ss-lock-btn').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }))`);
}
await sleep(+(opt.wait || 1200));

const out = path.join(HERE, 'out'); mkdirSync(out, { recursive: true });
const file = path.join(out, (opt.name || `phone_${opt.state || 'connected'}`) + '.png');
writeFileSync(file, await p.screenshot());
console.log(file);
console.log('frames sent:', await p.evaluate('window.__sent'));
const errs = p.errors(); if (errs.length) console.log('ERRORS', errs);
b.close(); srv.close(); process.exit(0);
