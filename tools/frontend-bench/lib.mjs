// Shared plumbing for the frontend bench: serve gui/frontend/src, drive headless
// Chrome over the DevTools protocol, and stand in for the Go backend (Wails
// bindings and events) with fixture data.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const FRONTEND = path.join(ROOT, 'gui', 'frontend', 'src');
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── command line ─────────────────────────────────────────────────────────────
export function args(argv = process.argv.slice(2)) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opt[k] = true; else { opt[k] = next; i++; }
    } else pos.push(argv[i]);
  }
  return { pos, opt };
}

// ── static server ────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// serve(dir) -> { base, close }: the frontend as the app's asset server would give it.
export async function serve(dir = FRONTEND) {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// ── fixtures and the backend stand-in ────────────────────────────────────────
export function fixtures() {
  const read = (f) => JSON.parse(readFileSync(path.join(HERE, 'fixtures', f), 'utf8'));
  return {
    state: read('state.json'),
    settings: read('settings.json'),
    locales: {
      ru: readFileSync(path.join(ROOT, 'pkg', 'i18n', 'locales', 'ru.json'), 'utf8'),
      en: readFileSync(path.join(ROOT, 'pkg', 'i18n', 'locales', 'en.json'), 'utf8'),
    },
  };
}

// backendStub(): page script replacing window.go.app.App (bound methods) and
// window.runtime (events). In the page: __emit(event, data) fires an event,
// __STATE is the fixture state, __benchStart(scenario) streams state (15 Hz) and
// orientation (60 Hz) like the backend does:
//   offline | rest (online, still) | move (online, moving) | dsu (move + two DSU clients)
export function backendStub({ fontScale } = {}) {
  const { state, settings, locales } = fixtures();
  if (fontScale) settings.fontScale = fontScale;
  return `(() => {
  const STATE = ${JSON.stringify(state)};
  const SETTINGS = ${JSON.stringify(settings)};
  const LOCALES = ${JSON.stringify(locales)};
  const reg = {};
  const noop = () => {};
  window.__bench = { emitted: 0, errors: [] };
  window.runtime = new Proxy({
    EventsOn(n, cb) { (reg[n] = reg[n] || []).push(cb); return noop; },
    EventsOnMultiple(n, cb) { (reg[n] = reg[n] || []).push(cb); return noop; },
    EventsOff(n, cb) {
      if (!reg[n]) return;
      if (!cb) { reg[n] = []; return; }
      reg[n] = reg[n].filter((f) => f !== cb);
    },
  }, { get: (t, k) => (k in t ? t[k] : noop) });
  const emit = (n, d) => (reg[n] || []).forEach(cb => { try { cb(d); } catch (e) { window.__bench.errors.push(String(e && e.stack || e)); } });
  window.__emit = emit;
  window.__STATE = STATE;
  window.__SETTINGS = SETTINGS;
  const dsu = (scen, t) => scen === 'dsu' ? [
    { address: '127.0.0.1:50001', ip: '127.0.0.1', port: 50001, lastSeenMs: t % 1000, active: true, connectedAtMs: 1, cemuBias: [Math.sin(t) * 0.01, 0, 0], cemuSamples: t | 0, cemuGuard: true, process: 'Cemu', pid: 42 },
    { address: '127.0.0.1:50002', ip: '127.0.0.1', port: 50002, lastSeenMs: (t * 7) % 1000, active: true, connectedAtMs: 1, cemuBias: null, cemuSamples: 0, cemuGuard: false, process: 'PadTest', pid: 43 },
  ] : [];
  const stateAt = (scen, t) => {
    const s = JSON.parse(JSON.stringify(STATE));
    if (scen === 'offline') { s.status = 'offline'; return s; }
    s.status = 'online'; s.hz = 60; s.pingMs = 12;
    if (scen === 'move' || scen === 'dsu') {
      s.pitch = 20 * Math.sin(t * 1.3); s.roll = 15 * Math.cos(t * 0.9); s.yaw = (t * 30) % 360;
      s.rawRotX = 10 * Math.sin(t); s.rawRotY = 5; s.rawRotZ = 1;
    } else { s.pitch = 0.4; s.roll = -0.3; s.yaw = 12; }
    s.dsuClientList = dsu(scen, t); s.dsuClients = s.dsuClientList.length; s.dsuKickedList = [];
    return s;
  };
  window.__stateAt = stateAt;
  const results = {
    GetState: () => stateAt('offline', 0),
    GetAppSettings: () => window.__SETTINGS || SETTINGS, GetTranslations: (l) => LOCALES[l] || '{}',
    GetLanguages: () => ['ru', 'en'], GetLang: () => 'ru', GetTheme: () => 'dark', GetFontScale: () => SETTINGS.fontScale || 1,
    IsFirstLaunch: () => false, GetHideAuthor: () => false, GetInputMode: () => 'phone',
    GetProfiles: () => STATE.profiles, GetDSUStatus: () => ({ count: 0, clients: [], kicked: [] }),
    GetAppVersion: () => ({ release: '2.0.0', build: '000', channel: 'dev', display: '2.0.0.000-dev' }),
    PendingCemuNotice: () => null, GetResourceStats: () => ({ cpuPercent: 1, ramMb: 50, totalRamMb: 16000, ramPercent: 0.3 }),
    GetCloseAction: () => 'ask', GetAxisAlignStatus: () => ({ pairs: 8, minPairs: 8, known: true, mapping: ['+X -> Pitch', '+Y -> Yaw', '+Z -> Roll'] }), GetWizardMount: () => null,
    StartCapture: () => 'ok',
    StopCapture: (step) => ({ success: true, vector: [step === 1 ? 1 : 0, step === 0 ? 1 : 0, step === 2 ? 1 : 0], axisName: step === 1 ? 'Pitch' : step === 2 ? 'Roll' : 'Rest', confidence: 0.95, peakSpeed: 120 }),
    ValidateCalibration: () => ({ success: true, matrix: [[1,0,0],[0,1,0],[0,0,-1]], det: -1.0, pitchAxis: '+X', yawAxis: '+Y', rollAxis: '-Z' }),
    StartAxisAlign: () => 'ok',
    PreviewMatrix: () => 'ok', ClearPreview: () => 'ok', ResetAHRS: () => 'ok',
    SaveProfile: () => 'ok', SetActiveProfile: () => 'ok',
    GetFirewallStatus: () => ({ state: 'allowed', network: 'private' }),
    GetDataDir: () => 'C:/Users/user/AppData/Roaming/phonegyro'.split('/').join(String.fromCharCode(92)),
  };
  const App = new Proxy({}, { get: (t, k) => (...a) => Promise.resolve((k in t ? t[k] : results[k]) ? (k in t ? t[k] : results[k])(...a) : null) });
  window.go = { app: { App, LiveDebugApp: App } };
  window.__benchStart = (scen) => {
    const t0 = performance.now();
    const t = () => (performance.now() - t0) / 1000;
    if (scen !== 'offline') {
      setInterval(() => { window.__bench.emitted++; emit('state:change', stateAt(scen, t())); }, 66);
      setInterval(() => {
        const a = (scen === 'move' || scen === 'dsu') ? 0.3 * Math.sin(t()) : 0.01;
        emit('ahrs:quat', { q0: Math.cos(a), q1: Math.sin(a), q2: 0, q3: 0 });
      }, 16);
    }
    setInterval(() => emit('resource-stats', { cpuPercent: 1, ramMb: 50, totalRamMb: 16000, ramPercent: 0.3 }), 1500);
  };
})();`;
}

// Brings the main window online past the first-connection sheet (page script).
export const GO_ONLINE = `(async () => {
  const s = __stateAt('rest', 0); s.pitch = 0; s.roll = 0; s.yaw = 0;
  FirstCenterGate.done.phone = true;
  __emit('state:change', s); await new Promise(r => setTimeout(r, 200));
  RecenterManager.close(true); __emit('state:change', s); await new Promise(r => setTimeout(r, 500));
})()`;

// ── Chrome ───────────────────────────────────────────────────────────────────
function findChrome() {
  const c = [process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  const hit = c.find(existsSync);
  if (!hit) throw new Error('Chrome/Edge not found: set CHROME to its executable');
  return hit;
}

// browser({width, height}) -> { page(stub) , close }. page(stub) opens a tab
// with the stub injected before any page script and returns helpers.
export async function browser({ width = 1100, height = 800 } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), 'pg-bench-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--hide-scrollbars', `--window-size=${width},${height}`, '--enable-unsafe-swiftshader', 'about:blank'],
  { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 75 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); }
  }
  if (!ver) { proc.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else listeners.forEach(l => l(m));
  });
  const send = (method, params = {}, sessionId) => new Promise(r => {
    const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  async function page(stub) {
    const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    const errors = [];
    listeners.push((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    });
    await S('Runtime.enable'); await S('Log.enable'); await S('Page.enable'); await S('Performance.enable');
    if (stub) await S('Page.addScriptToEvaluateOnNewDocument', { source: stub });
    const evaluate = async (expression) => {
      const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(expression.slice(0, 80) + ' -> ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return r.result.result.value;
    };
    return {
      S, evaluate,
      // errors, minus what a missing backend causes (Live Debug's HTTP/WS endpoints, favicon)
      errors: () => errors.filter(e => !/favicon\.ico|\/livedebug\/|WebSocket connection/.test(e)),
      goto: async (url, settle = 2500) => { await S('Page.navigate', { url }); await sleep(settle); },
      metrics: async () => Object.fromEntries((await S('Performance.getMetrics')).result.metrics.map(m => [m.name, m.value])),
      screenshot: async () => Buffer.from((await S('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'),
    };
  }
  return {
    page,
    close: () => { try { ws.close(); } catch {} proc.kill(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 1500); },
  };
}

// withTree(ref, fn): runs fn(dir) on gui/frontend/src as it is at a git ref.
export async function withTree(ref, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pg-tree-'));
  const { execFileSync } = await import('node:child_process');
  const tar = execFileSync('git', ['-C', ROOT, 'archive', ref, 'gui/frontend/src'], { maxBuffer: 1 << 30 });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(dir, 'src.tar'), tar);
  execFileSync('tar', ['-xf', 'src.tar'], { cwd: dir });
  try { return await fn(path.join(dir, 'gui', 'frontend', 'src')); } finally { rmSync(dir, { recursive: true, force: true }); }
}
