// Starts what the bench measures and talks to it over the DevTools protocol:
//   - native: the real PhoneGyro.exe (Go backend + WebView2) with remote debugging,
//     on a throwaway copy of the user's data (APPDATA points into a temp folder);
//   - browser: Chrome/Edge on the frontend files with the mock backend.
// In both, the harness is installed for new documents and the page is reloaded,
// so the boot stage measures a real cold page start with the recorder in place.

import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { generateHarnessScript } from './harness.mjs';

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const FRONTEND_DIR = path.join(ROOT, 'gui', 'frontend', 'src');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

export function findSystemBrowser() {
  const c = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/opt/pw-browsers/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean).find(existsSync);
  if (!c) throw new Error('Chrome/Edge not found (set CHROME=path).');
  return c;
}

export function findPhoneGyroBinary() {
  const c = [
    process.env.PHONEGYRO_BIN,
    path.join(process.cwd(), 'PhoneGyro.exe'),
    path.join(HERE, 'PhoneGyro.exe'),
    path.join(ROOT, 'PhoneGyro.exe'),
    path.join(ROOT, 'gui', 'build', 'bin', 'PhoneGyro.exe'),
  ].filter(Boolean).find(existsSync);
  if (!c) throw new Error('PhoneGyro.exe not found: put it next to bench.cmd, set PHONEGYRO_BIN, or `wails build` in gui/.');
  return c;
}

function createAssetServer(dir = FRONTEND_DIR) {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  })));
}

// ── CDP ──────────────────────────────────────────────────────────────────────
async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else for (const l of listeners) l(msg);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  return { send, listeners, close: () => { try { ws.close(); } catch (_) {} } };
}

async function waitJSON(url, pick, tries = 100, gap = 200) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) { const v = pick(await r.json()); if (v) return v; }
    } catch (_) {}
    await sleep(gap);
  }
  return null;
}

// The page API every stage uses, on one CDP session.
async function pageAPI(cdp, sessionId, isNative) {
  const S = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  cdp.listeners.push((msg) => {
    if (sessionId && msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('exception: ' + (d.exception?.description || d.text));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });
  await S('Runtime.enable');
  await S('Page.enable');
  await S('Performance.enable');
  await S('HeapProfiler.enable').catch(() => {});
  await S('Page.addScriptToEvaluateOnNewDocument', { source: generateHarnessScript({ isNative }) });

  const evaluate = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval [${expression.slice(0, 60)}]: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  return {
    evaluate,
    async metrics() {
      const { metrics } = await S('Performance.getMetrics');
      return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    },
    // Heap after a full GC: what the page really keeps.
    async heapAfterGC() {
      await S('HeapProfiler.collectGarbage').catch(() => {});
      const h = await S('Runtime.getHeapUsage').catch(() => null);
      return h ? +(h.usedSize / 1048576).toFixed(2) : null;
    },
    async reloadCold(url) {
      const loaded = new Promise((res) => {
        const l = (m) => { if (m.method === 'Page.loadEventFired' && (!sessionId || m.sessionId === sessionId)) { cdp.listeners.splice(cdp.listeners.indexOf(l), 1); res(); } };
        cdp.listeners.push(l);
      });
      if (url) await S('Page.navigate', { url }); else await S('Page.reload', { ignoreCache: true });
      await Promise.race([loaded, sleep(15000)]);
    },
    traceDuring: (fn) => traceDuring(S, cdp, sessionId, fn),
    send: S,
    // Largest total of painted composited layers seen while fn runs, in device
    // megapixels: GPU memory and blending work that does not depend on the GPU.
    async layerPeakDuring(fn) {
      let peak = 0, peakLayers = 0;
      const dpr = await evaluate('devicePixelRatio');
      const l = (m) => {
        if (m.method !== 'LayerTree.layerTreeDidChange' || !m.params.layers || (sessionId && m.sessionId !== sessionId)) return;
        const drawn = m.params.layers.filter((x) => x.drawsContent);
        const a = drawn.reduce((s, x) => s + x.width * x.height, 0) * dpr * dpr;
        if (a > peak) { peak = a; peakLayers = drawn.length; }
      };
      cdp.listeners.push(l);
      await S('LayerTree.enable');
      try { return { value: await fn(), layerMpx: +(peak / 1e6).toFixed(1), layers: peakLayers }; } finally {
        await S('LayerTree.disable').catch(() => {});
        cdp.listeners.splice(cdp.listeners.indexOf(l), 1);
      }
    },
    on: (fn) => cdp.listeners.push((m) => { if (!sessionId || m.sessionId === sessionId) fn(m); }),
    errors: () => errors.filter((e) => !/favicon\.ico|\/livedebug\//.test(e)),
  };
}

// Compositor/GPU side of the frames, which the in-page recorder cannot see: a
// trace of the run counts frames the display really got (presented) and lost
// (dropped), and sums paint (main thread), raster (raster threads / GPU process)
// and GPU-process work.
const TRACE_CATS = ['disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'devtools.timeline'].join(',');
async function traceDuring(S, cdp, sessionId, fn) {
  const events = [];
  const onMsg = (m) => {
    if (m.method === 'Tracing.dataCollected' && (!sessionId || m.sessionId === sessionId)) events.push(...m.params.value);
  };
  cdp.listeners.push(onMsg);
  const done = new Promise((res) => {
    const l = (m) => { if (m.method === 'Tracing.tracingComplete' && (!sessionId || m.sessionId === sessionId)) { cdp.listeners.splice(cdp.listeners.indexOf(l), 1); res(); } };
    cdp.listeners.push(l);
  });
  await S('Tracing.start', { traceConfig: { includedCategories: TRACE_CATS.split(','), recordMode: 'recordAsMuchAsPossible' }, transferMode: 'ReportEvents' });
  let value;
  try { value = await fn(); } finally {
    await S('Tracing.end');
    await Promise.race([done, sleep(20000)]);
    cdp.listeners.splice(cdp.listeners.indexOf(onMsg), 1);
  }
  return { value, trace: summarizeTrace(events) };
}

export function summarizeTrace(events) {
  const sum = {};
  const add = (k, us) => { sum[k] = (sum[k] || 0) + us / 1000; };
  let presented = 0, dropped = 0, partial = 0, noUpdate = 0, checker = 0;
  const states = {};
  for (const e of events) {
    if (e.name === 'PipelineReporter' && e.ph === 'b') {
      const fr = e.args?.frame_reporter || e.args?.chrome_frame_reporter || {};
      const st = fr.state;
      if (fr.checkerboarded_needs_raster || fr.has_missing_content) checker++;
      states[st] = (states[st] || 0) + 1;
      if (st === 'STATE_PRESENTED_ALL') presented++;
      else if (st === 'STATE_PRESENTED_PARTIAL') partial++;
      else if (st === 'STATE_DROPPED') dropped++;
      else if (st === 'STATE_NO_UPDATE_DESIRED') noUpdate++;
    }
    if (e.ph !== 'X' || !e.dur) continue;
    if (e.name === 'Paint') add('paintMs', e.dur);
    else if (e.name === 'RasterTask') add('rasterMs', e.dur);
    else if (e.name === 'GpuRasterization' || e.name === 'GPUTask') add(e.name === 'GPUTask' ? 'gpuTaskMs' : 'gpuRasterMs', e.dur);
    else if (e.name === 'UpdateLayerTree' || e.name === 'Layerize') add('layerizeMs', e.dur);
    else if (e.name === 'Commit') add('commitMs', e.dur);
    else if (e.name === 'ImageDecodeTask' || e.name === 'Decode Image') add('decodeMs', e.dur);
  }
  for (const k of Object.keys(sum)) sum[k] = +sum[k].toFixed(1);
  const shown = presented + partial + dropped;
  return {
    presented, partial, dropped, noUpdate, checkerboarded: checker,
    droppedPct: shown ? +(100 * (dropped + partial) / shown).toFixed(1) : null,
    ...sum,
  };
}

// ── Windows process sampler ─────────────────────────────────────────────────
// One PowerShell for the whole run (Add-Type compiles once). Each sample: the
// app's process tree (PhoneGyro.exe → msedgewebview2 browser → renderer, GPU,
// utility), CPU time and memory per process, the System Idle time (machine
// load) and which process owns the foreground window.
const PS_SAMPLER = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class PgFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $root = [int]$line
  $t = [DateTime]::UtcNow.Ticks
  $all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime,HandleCount,ThreadCount
  $kids = @{}; $byId = @{}; $idle = 0
  foreach ($p in $all) {
    $id = [int]$p.ProcessId
    if ($id -eq 0) { $idle = [double]$p.KernelModeTime + [double]$p.UserModeTime; continue }
    $byId[$id] = $p
    $pp = [int]$p.ParentProcessId
    if (-not $kids.ContainsKey($pp)) { $kids[$pp] = New-Object System.Collections.ArrayList }
    [void]$kids[$pp].Add($p)
  }
  $out = New-Object System.Collections.ArrayList
  $stack = New-Object System.Collections.Stack
  if ($byId.ContainsKey($root)) { $stack.Push($byId[$root]) }
  while ($stack.Count -gt 0) {
    $p = $stack.Pop()
    $type = 'app'
    if ($p.Name -like 'msedgewebview2*') {
      if ($p.CommandLine -match '--type=([a-z-]+)') { $type = $Matches[1] } else { $type = 'webview-browser' }
    }
    [void]$out.Add(@{ pid = [int]$p.ProcessId; name = $p.Name; type = $type; ws = [double]$p.WorkingSetSize; priv = [double]$p.PrivatePageCount; cpu = [double]$p.KernelModeTime + [double]$p.UserModeTime; handles = [int]$p.HandleCount; threads = [int]$p.ThreadCount })
    if ($kids.ContainsKey([int]$p.ProcessId)) { foreach ($c in $kids[[int]$p.ProcessId]) { if ([int]$c.ProcessId -ne [int]$p.ProcessId) { $stack.Push($c) } } }
  }
  $fp = [uint32]0
  [void][PgFg]::GetWindowThreadProcessId([PgFg]::GetForegroundWindow(), [ref]$fp)
  $j = @{ t = $t; idle = $idle; fg = [int]$fp; procs = $out } | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($j)
  [Console]::Out.Flush()
}
`;

function startSampler() {
  if (process.platform !== 'win32') return null;
  // the script goes in the command line, so stdin carries only our requests
  const encoded = Buffer.from(PS_SAMPLER, 'utf16le').toString('base64');
  const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'ignore'] });
  const rl = readline.createInterface({ input: ps.stdout });
  const waiting = [];
  rl.on('line', (l) => {
    const w = waiting.shift();
    if (!w) return;
    try { w(JSON.parse(l)); } catch (_) { w(null); }
  });
  return {
    sample(pid) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => { const i = waiting.indexOf(done); if (i >= 0) waiting.splice(i, 1); resolve(null); }, 10000);
        const done = (v) => { clearTimeout(timer); resolve(v); };
        waiting.push(done);
        ps.stdin.write(pid + '\r\n');
      });
    },
    close() { try { ps.stdin.end(); ps.kill(); } catch (_) {} },
  };
}

/** CPU and memory between two samples of the same tree. */
export function procDelta(a, b) {
  if (!a || !b) return null;
  const wallS = (b.t - a.t) / 1e7;
  if (wallS <= 0) return null;
  const ncpu = os.cpus().length;
  const prev = new Map((a.procs || []).map((p) => [p.pid, p]));
  const groups = {};
  let treeCpu = 0;
  for (const p of b.procs || []) {
    const g = p.type === 'app' ? 'app' : p.type === 'renderer' ? 'renderer' : p.type === 'gpu-process' ? 'gpu' : 'webviewOther';
    const was = prev.get(p.pid);
    const cpu = was ? Math.max(0, p.cpu - was.cpu) / 1e7 : 0; // seconds; a process born mid-stage counts from 0
    groups[g] = groups[g] || { cores: 0, wsMb: 0, privMb: 0, procs: 0, handles: 0, threads: 0 };
    groups[g].cores += cpu / wallS;
    groups[g].wsMb += p.ws / 1048576;
    groups[g].privMb += p.priv / 1048576;
    groups[g].procs++;
    groups[g].handles += p.handles;
    groups[g].threads += p.threads;
    treeCpu += cpu;
  }
  for (const g of Object.values(groups)) for (const k of ['cores', 'wsMb', 'privMb']) g[k] = +g[k].toFixed(k === 'cores' ? 3 : 1);
  const busy = 1 - (b.idle - a.idle) / 1e7 / (wallS * ncpu);
  const mine = treeCpu / wallS / ncpu;
  return {
    wallSec: +wallS.toFixed(2),
    cores: +(treeCpu / wallS).toFixed(3),           // CPU time of the whole app tree per second (1.0 = one core busy)
    cpuPctOfMachine: +(100 * mine).toFixed(1),
    otherLoadPct: +(100 * Math.max(0, busy - mine)).toFixed(1), // everything else on the machine (the sampler included)
    wsMb: +Object.values(groups).reduce((s, g) => s + g.wsMb, 0).toFixed(1),
    privMb: +Object.values(groups).reduce((s, g) => s + g.privMb, 0).toFixed(1),
    groups,
    foreground: b.fg,
  };
}

// ── Machine description (who produced the numbers) ──────────────────────────
async function machineInfo() {
  const info = { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model?.trim(), threads: os.cpus().length, ramGb: +(os.totalmem() / 2 ** 30).toFixed(1) };
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command',
        '$v = Get-CimInstance Win32_VideoController | Select-Object Name,CurrentRefreshRate,CurrentHorizontalResolution,CurrentVerticalResolution,DriverVersion; ' +
        '$b = Get-CimInstance Win32_Battery | Select-Object -First 1 BatteryStatus; ' +
        '$pp = (powercfg /getactivescheme) -join " "; ' +
        '@{ gpus = @($v); onBattery = ($b -and $b.BatteryStatus -eq 1); powerPlan = $pp } | ConvertTo-Json -Compress -Depth 3'], { timeout: 15000 });
      Object.assign(info, JSON.parse(stdout.trim()));
    } catch (_) {}
  }
  try {
    const rev = (await execFileAsync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'])).stdout.trim();
    const dirty = (await execFileAsync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'gui'])).stdout.trim() !== '';
    const branch = (await execFileAsync('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    info.git = { rev, branch, dirtyGui: dirty };
  } catch (_) {}
  return info;
}

// ── Launchers ───────────────────────────────────────────────────────────────
export async function launchBrowser({ width = 1280, height = 720, head = false, frontendDir } = {}) {
  const server = await createAssetServer(frontendDir);
  const profile = mkdtempSync(path.join(os.tmpdir(), 'pg-bench-'));
  const port = 9400 + Math.floor(Math.random() * 500);
  const proc = spawn(findSystemBrowser(), [
    head ? '' : '--headless=new',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--window-size=${width},${height}`, '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    process.getuid && process.getuid() === 0 ? '--no-sandbox' : '',
    'about:blank',
  ].filter(Boolean), { stdio: 'ignore' });
  const version = await waitJSON(`http://127.0.0.1:${port}/json/version`, (v) => v);
  if (!version) { proc.kill(); throw new Error('browser DevTools did not answer'); }
  const cdp = await connectCDP(version.webSocketDebuggerUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
  const page = await pageAPI(cdp, sessionId, false);
  return {
    mode: 'browser', head, version: version.Browser, ...page,
    startUrl: `${server.origin}/index.html`,
    machine: await machineInfo(),
    sampleProc: async () => null,
    async close() {
      cdp.close();
      try { proc.kill(); } catch (_) {}
      server.close();
      await sleep(800);
      try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

/**
 * Native: real PhoneGyro.exe. Unless realData is set, APPDATA is a temp folder
 * seeded with a copy of the user's settings, profiles and certificates (so the
 * run sees the same UI without writing to it) and a fresh WebView2 profile.
 */
export async function launchNative({ realData = false } = {}) {
  const exe = findPhoneGyroBinary();
  // single instance: an already running PhoneGyro would get our window
  try { await execFileAsync('taskkill', ['/F', '/T', '/IM', 'PhoneGyro.exe']); await sleep(800); } catch (_) {}

  let appData = process.env.APPDATA;
  let tmp = null;
  if (!realData) {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'pg-bench-appdata-'));
    const src = path.join(process.env.APPDATA || '', 'phonegyro');
    const dst = path.join(tmp, 'phonegyro');
    mkdirSync(dst, { recursive: true });
    for (const f of ['settings.json', 'profiles.json', 'ca', 'usb']) {
      const p = path.join(src, f);
      if (existsSync(p)) try { cpSync(p, path.join(dst, f), { recursive: true }); } catch (_) {}
    }
    // no onboarding, no network check, no popups in the run
    const sp = path.join(dst, 'settings.json');
    let s = {};
    try { s = JSON.parse(readFileSync(sp, 'utf8')); } catch (_) {}
    Object.assign(s, { firstLaunchDone: true, checkUpdates: false });
    writeFileSync(sp, JSON.stringify(s, null, 1));
    appData = tmp;
  }

  const port = 9222 + Math.floor(Math.random() * 500);
  // WebView2 reads extra browser flags from this variable for any host app,
  // so the debugging port needs no support in PhoneGyro itself
  const proc = spawn(exe, ['--bench'], {
    stdio: 'ignore',
    env: { ...process.env, APPDATA: appData, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  });
  const target = await waitJSON(`http://127.0.0.1:${port}/json`,
    (ts) => ts.find((t) => t.type === 'page' && /wails\.localhost|wails:\/\//.test(t.url)), 100, 200);
  if (!target) {
    try { proc.kill(); } catch (_) {}
    throw new Error(`no WebView2 DevTools on port ${port} (WebView2 did not open the debugging port; is PhoneGyro.exe starting at all?)`);
  }
  const version = await waitJSON(`http://127.0.0.1:${port}/json/version`, (v) => v, 5);
  const cdp = await connectCDP(target.webSocketDebuggerUrl);
  const page = await pageAPI(cdp, undefined, true);

  // bring the window to the front: an occluded WebView2 throttles rAF
  execFileAsync('powershell', ['-NoProfile', '-Command',
    `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);' -Name F -Namespace W; ` +
    `$p = Get-Process -Id ${proc.pid}; if ($p.MainWindowHandle -ne 0) { [W.F]::SetForegroundWindow($p.MainWindowHandle) }`]).catch(() => {});

  const sampler = startSampler();
  return {
    mode: 'native', version: version?.Browser || 'WebView2', exe, isolated: !realData, pid: proc.pid, ...page,
    startUrl: null,
    machine: await machineInfo(),
    sampleProc: async () => (sampler ? sampler.sample(proc.pid) : null),
    async close() {
      sampler?.close();
      cdp.close();
      try { await execFileAsync('taskkill', ['/F', '/T', '/PID', String(proc.pid)]); } catch (_) {}
      if (tmp) { await sleep(1500); try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
    },
  };
}
