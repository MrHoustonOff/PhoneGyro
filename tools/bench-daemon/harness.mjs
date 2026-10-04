// The in-page part of the bench: a frame/rAF/long-frame recorder, the data the
// app is fed (mock backend in browser mode, mock events over the real bridge in
// native mode) and the scenarios. Injected before any page script runs
// (Page.addScriptToEvaluateOnNewDocument), in both modes.
//
// Honesty rules the code below keeps:
//   - every UI action is done once, by the path a user takes (a click), or by the
//     app's own contract event when there is no button — never both;
//   - each scenario checks that it reached the state it claims and returns the
//     checks; a stage whose checks fail is reported INVALID, not as numbers;
//   - the page's visibility and focus are never faked: they are recorded, and a
//     hidden or unfocused window invalidates the stage;
//   - events go through the same JSON path the Go side uses (wails.EventsNotify).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

function loadFixtures() {
  const readJSON = (p, fallback) => {
    try { return JSON.parse(readFileSync(path.join(ROOT, p), 'utf8')); } catch (_) { return fallback; }
  };
  const readText = (p) => {
    try { return readFileSync(path.join(ROOT, p), 'utf8'); } catch (_) { return '{}'; }
  };
  return {
    state: readJSON('tools/frontend-bench/fixtures/state.json', { status: 'online', deviceName: 'iPhone', hz: 60, pingMs: 12 }),
    settings: readJSON('tools/frontend-bench/fixtures/settings.json', { theme: 'dark', lang: 'ru', fontScale: 1, firstLaunchDone: true }),
    locales: { ru: readText('pkg/i18n/locales/ru.json'), en: readText('pkg/i18n/locales/en.json') },
  };
}

export function generateHarnessScript({ isNative = false } = {}) {
  const { state, settings, locales } = loadFixtures();
  return `(() => {
if (window.__pgBench) return;
const IS_NATIVE = ${Boolean(isNative)};
const FIXTURE_STATE = ${JSON.stringify(state)};
const FIXTURE_SETTINGS = ${JSON.stringify(settings)};
const FIXTURE_LOCALES = ${JSON.stringify(locales)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

window.__pgNoPopups = true; // the app's own switch (same as --bench): no first-connect sheets

// ── Recorder ────────────────────────────────────────────────────────────────
// Our rAF loop stamps every frame the page produces. The app's own rAF use is
// counted separately (requests per second): with the recorder's loop running,
// "the page draws at 60 fps" says nothing about whether the app keeps a loop
// alive. The app's callback is passed through untouched, so long-frame
// attribution still names the app's function and file.
const nativeRAF = window.requestAnimationFrame.bind(window);
const nativeCAF = window.cancelAnimationFrame.bind(window);
const app = { calls: 0 };
window.requestAnimationFrame = function (cb) { app.calls++; return nativeRAF(cb); };

let rec = null;
function onFrame(now) {
  if (!rec) return;
  if (rec.last > 0) rec.deltas.push(now - rec.last);
  rec.last = now;
  rec.raf = nativeRAF(onFrame);
}

// The boot stage starts with the document: record from the first frame.
start('boot');

// When the splash leaves the DOM (the app is usable), to the millisecond.
let splashGoneAt = 0;
new MutationObserver((_, mo) => {
  if (document.readyState !== 'loading' && !document.getElementById('splash')) { splashGoneAt = performance.now(); mo.disconnect(); }
}).observe(document, { childList: true, subtree: true });

const loafs = [];
const longTasks = [];
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) loafs.push(e); })
    .observe({ type: 'long-animation-frame', buffered: false });
} catch (_) {}
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push({ start: e.startTime, dur: e.duration }); })
    .observe({ type: 'longtask', buffered: false });
} catch (_) {}

function visibility() {
  return { visible: document.visibilityState === 'visible', focused: document.hasFocus() };
}

function start(name) {
  if (rec) nativeCAF(rec.raf);
  rec = { name, deltas: [], last: 0, t0: performance.now(), app0: { ...app }, vis: [visibility()] };
  rec.raf = nativeRAF(onFrame);
  return true;
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function end(vsyncMs, slowMs = 1000 / 60 * 1.25) {
  if (!rec) return null;
  nativeCAF(rec.raf);
  const r = rec; rec = null;
  const t1 = performance.now();
  const dur = (t1 - r.t0) / 1000;
  r.vis.push(visibility());
  const d = r.deltas;
  const s = d.slice().sort((a, b) => a - b);
  const n = d.length;
  const mean = n ? d.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(d.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  // Missed vsyncs: a delta of k refresh intervals means k-1 frames were not drawn.
  const vs = vsyncMs > 0 ? vsyncMs : 0;
  let missed = 0;
  if (vs) for (const v of d) missed += Math.max(0, Math.round(v / vs) - 1);
  const over = (ms) => d.filter((v) => v > ms).length;

  const lf = loafs.filter((e) => e.startTime >= r.t0 && e.startTime < t1);
  loafs.length = 0;
  const lt = longTasks.filter((e) => e.start >= r.t0 && e.start < t1);
  longTasks.length = 0;
  const top = lf.slice().sort((a, b) => b.duration - a.duration).slice(0, 5).map((e) => ({
    ms: +e.duration.toFixed(1),
    blockingMs: +(e.blockingDuration || 0).toFixed(1),
    renderMs: e.renderStart ? +(e.startTime + e.duration - e.renderStart).toFixed(1) : 0,
    styleLayoutMs: e.styleAndLayoutStart ? +(e.startTime + e.duration - e.styleAndLayoutStart).toFixed(1) : 0,
    scripts: (e.scripts || []).slice().sort((a, b) => b.duration - a.duration).slice(0, 3).map((sc) => ({
      ms: +sc.duration.toFixed(1),
      invoker: String(sc.invoker || '').slice(0, 80),
      fn: sc.sourceFunctionName || '',
      src: String(sc.sourceURL || '').replace(/^.*\\/(?=[^/]+$)/, '') + (sc.sourceCharPosition >= 0 ? ':' + sc.sourceCharPosition : ''),
    })),
  }));

  return {
    durationSec: +dur.toFixed(3),
    frames: n,
    fps: dur > 0 ? +(n / dur).toFixed(1) : 0,
    frameMs: { mean: +mean.toFixed(2), sd: +sd.toFixed(2), p50: +pct(s, 0.5).toFixed(2), p95: +pct(s, 0.95).toFixed(2), p99: +pct(s, 0.99).toFixed(2), max: +(s[n - 1] || 0).toFixed(1) },
    missedVsyncs: missed,
    droppedPct: vs && n + missed > 0 ? +(100 * missed / (n + missed)).toFixed(1) : null,
    slowFrames: over(slowMs),
    slowPct: n ? +(100 * over(slowMs) / n).toFixed(1) : 100,
    over16_7: over(16.7 + 0.5),
    over33_3: over(33.4),
    over50: over(50),
    over100: over(100),
    appRafPerSec: +((app.calls - r.app0.calls) / dur).toFixed(1),
    longTasks: lt.length,
    longTaskMs: +lt.reduce((a, e) => a + e.dur, 0).toFixed(1),
    loafCount: lf.length,
    loafMs: +lf.reduce((a, e) => a + e.duration, 0).toFixed(1),
    topLoaf: top,
    domNodes: document.getElementsByTagName('*').length,
    visibility: r.vis,
  };
}

// ── Events into the app ─────────────────────────────────────────────────────
const listeners = new Map();
function notify(name, ...data) {
  const msg = JSON.stringify({ name, data });
  if (IS_NATIVE) { window.wails.EventsNotify(msg); return; }
  const m = JSON.parse(msg);
  const set = listeners.get(m.name);
  if (set) for (const cb of [...set]) { try { cb(...m.data); } catch (err) { console.error('bench event ' + m.name + ':', err); } }
}

// ── State the app is shown ──────────────────────────────────────────────────
let st = clone(FIXTURE_STATE);
let settingsCur = clone(FIXTURE_SETTINGS);
function pushState(patch) {
  st = Object.assign(st, patch);
  notify('state:change', clone(st));
}

// Calls the scenarios answer instead of the backend, in both modes: a native
// run must not record captures into the real backend or save profiles.
const calMock = {
  StartCapture: () => 'ok',
  StopCapture: (step) => ({
    success: true,
    vector: [step === 1 ? 1 : 0, step === 0 ? 1 : 0, step === 2 ? 1 : 0],
    axisIdx: step === 1 ? 0 : step === 2 ? 2 : -1,
    axisName: step === 1 ? '+X' : step === 2 ? '+Z' : '',
    confidence: 0.98,
    peakSpeed: 115,
  }),
  ValidateCalibration: () => ({ success: true, matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], det: 1, pitchAxis: '+X', yawAxis: '+Y', rollAxis: '+Z' }),
  StartAxisAlign: () => 'ok',
  GetAxisAlignStatus: () => ({ pairs: 8, minPairs: 8, known: true, mapping: ['+X', '+Y', '+Z'] }),
  GetWizardMount: () => ({ status: 'ok', tiltDeg: 1.2, forwardDeg: 0.8, rightDeg: -0.4, checkDeg: 0.1, enabled: true }),
  PreviewMatrix: () => 'ok',
  ClearPreview: () => 'ok',
  ResetAHRS: () => 'ok',
  SaveProfile: () => 'ok',
  SetActiveProfile: (slot) => { st.activeSlot = slot; return 'ok'; },
  GetState: () => clone(st),
};

if (!IS_NATIVE) {
  window.runtime = {
    EventsOn(name, cb) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(cb);
      return () => listeners.get(name)?.delete(cb);
    },
    EventsOnMultiple(name, cb) { return this.EventsOn(name, cb); },
    EventsOff(name) { listeners.delete(name); },
    EventsEmit(name, ...a) { notify(name, ...a); },
    BrowserOpenURL() {}, WindowSetTitle() {}, WindowFullscreen() {}, WindowUnfullscreen() {},
    WindowMinimise() {}, WindowUnminimise() {}, WindowClose() {}, WindowShow() {}, WindowHide() {},
    WindowToggleMaximise() {}, WindowIsMaximised: () => Promise.resolve(false),
  };
  const backend = Object.assign({
    GetAppSettings: () => clone(settingsCur),
    SaveAppSettings: (s) => { settingsCur = Object.assign(settingsCur, s); return 'ok'; },
    GetTranslations: (lang) => FIXTURE_LOCALES[lang] || '{}',
    GetLanguages: () => ['ru', 'en'],
    GetLang: () => settingsCur.lang || 'ru',
    GetTheme: () => settingsCur.theme || 'dark',
    GetFontScale: () => settingsCur.fontScale || 1,
    IsFirstLaunch: () => false,
    IsNoPopups: () => true,
    GetHideAuthor: () => false,
    GetInputMode: () => 'phone',
    GetProfiles: () => st.profiles || [],
    GetDSUStatus: () => ({ count: (st.dsuClientList || []).length, clients: st.dsuClientList || [], kicked: [] }),
    GetAppVersion: () => ({ release: '0.0.0', build: '0', channel: 'bench', display: 'bench' }),
    GetResourceStats: () => ({ cpuPercent: 0.5, ramMb: 45, totalRamMb: 16384, ramPercent: 0.3 }),
    GetFirewallStatus: () => ({ state: 'allowed', network: 'private' }),
    GetUpdateStatus: () => ({ state: 'off' }),
    GetDataDir: () => 'C:/bench',
  }, calMock);
  const App = new Proxy(backend, {
    get: (t, p) => (...a) => Promise.resolve(p in t ? t[p](...a) : null),
  });
  window.go = { app: { App, LiveDebugApp: App } };
}

// Native: wait for Wails' bindings, then answer the calibration calls and
// GetState ourselves (the real backend has no device; its state would fight ours).
function patchNative() {
  const A = window.go && window.go.app && window.go.app.App;
  if (!A) return false;
  for (const [k, fn] of Object.entries(calMock)) A[k] = (...a) => Promise.resolve(fn(...a));
  return true;
}

// Patch as soon as the bindings appear: the app's first GetState must be ours.
let patched = false;
if (IS_NATIVE) (function poll() { if (patchNative()) patched = true; else setTimeout(poll, 0); })();

// ── Scenario helpers ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const shown = (id) => { const e = $(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
async function waitFor(fn, ms, step = 25) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
  return !!fn();
}
function check(checks, name, ok, detail) { checks.push({ name, ok: !!ok, ...(detail !== undefined ? { detail } : {}) }); }
const navigate = (screen) => window.dispatchEvent(new CustomEvent('pg:navigate', { detail: { screen } }));
const calAct = (action, opts) => window.dispatchEvent(new CustomEvent('pg:calibration', { detail: { action, opts } }));
function clickAct(act) {
  const b = document.querySelector('#screen-calibration [data-act="' + act + '"]');
  if (!b || b.disabled) return false;
  b.click();
  return true;
}
function tab(name) {
  const b = document.querySelector('#nav [data-tab="' + name + '"]');
  if (b) { b.click(); return true; }
  navigate(name);
  return false;
}

// Sensor streams the way Go sends them: state at 15 Hz, quaternion at 60 Hz.
let streams = [];
function stopStreams() { for (const id of streams) clearInterval(id); streams = []; }
function startMotion() {
  stopStreams();
  const t0 = performance.now();
  const T = () => (performance.now() - t0) / 1000;
  const clients = [
    { address: '127.0.0.1:51000', ip: '127.0.0.1', port: 51000, active: true, process: 'Cemu', pid: 1042 },
    { address: '127.0.0.1:51001', ip: '127.0.0.1', port: 51001, active: true, process: 'PadTest', pid: 1043 },
  ];
  let n = 0;
  streams.push(setInterval(() => {
    const t = T(), j = () => (Math.random() - 0.5) * 0.3;
    pushState({
      status: 'online', hz: 60, pingMs: 12, dsuClients: clients.length, dsuClientList: clients,
      pitch: +(22.5 * Math.sin(t * 1.5) + j()).toFixed(2),
      roll: +(18 * Math.cos(t * 1.1) + j()).toFixed(2),
      yaw: +(((t * 45) % 360) + j()).toFixed(2),
      rawRotX: +(15 * Math.sin(t * 2) + j()).toFixed(1),
      rawRotY: +(10 * Math.cos(t * 1.8) + j()).toFixed(1),
      rawRotZ: +(5 * Math.sin(t * 0.7) + j()).toFixed(1),
    });
  }, 66));
  streams.push(setInterval(() => {
    const t = T(), p = 0.3 * Math.sin(t * 1.5), r = 0.25 * Math.cos(t * 1.1), y = 0.4 * Math.sin(t * 0.8);
    const cy = Math.cos(y / 2), sy = Math.sin(y / 2), cp = Math.cos(p / 2), sp = Math.sin(p / 2), cr = Math.cos(r / 2), sr = Math.sin(r / 2);
    n++;
    notify('ahrs:quat', { q0: cr * cp * cy + sr * sp * sy, q1: sr * cp * cy - cr * sp * sy, q2: cr * sp * cy + sr * cp * sy, q3: cr * cp * sy - sr * sp * cy });
  }, 16));
  return () => n;
}
function startTuning() {
  const t0 = performance.now();
  streams.push(setInterval(() => {
    const t = (performance.now() - t0) / 1000, nz = (a) => (Math.random() - 0.5) * a;
    const raw = [12 * Math.sin(t * 2.5) + nz(2), 8 * Math.cos(t * 1.8) + nz(1.5), 3 * Math.sin(t * 0.9) + nz(0.8)];
    const filt = [10 * Math.sin(t * 2.5), 7 * Math.cos(t * 1.8), 2.5 * Math.sin(t * 0.9)];
    notify('tuning:frame', { t: t * 1000, raw, filt, speed: Math.hypot(...raw) });
  }, 16));
}
const rest = { status: 'online', hz: 60, pingMs: 12, pitch: 0.4, roll: -0.3, yaw: 12, rawRotX: 0, rawRotY: 0, rawRotZ: 0, dsuClients: 0, dsuClientList: [] };

// ── Scenarios: each returns its checks ──────────────────────────────────────
const scenarios = {
  async boot() {
    const c = [];
    check(c, 'bridge', await waitFor(() => window.go && window.go.app && window.runtime, 10000));
    if (IS_NATIVE) check(c, 'backend calls answered by the bench', await waitFor(() => patched, 5000));
    check(c, 'splash removed', await waitFor(() => !$('splash'), 15000, 50));
    check(c, 'connect screen shown', await waitFor(() => shown('screen-connect'), 3000));
    await sleep(400);
    return c;
  },
  async connect(ms) {
    const c = [];
    pushState({ ...rest, deviceName: 'iPhone 15 Pro' });
    notify('device:connected', true);
    await sleep(ms);
    check(c, 'device card shows the device', ($('dev-name')?.textContent || '').includes('iPhone 15 Pro'));
    return c;
  },
  async calibrate() {
    const c = [];
    $('btn-calibrate')?.click();
    check(c, 'calibration screen open', await waitFor(() => shown('screen-calibration'), 3000));
    let steps = 0;
    for (let i = 0; i < 4; i++) {
      if (!await waitFor(() => clickAct('capture'), 3000)) break;
      // the step is done when its Next button becomes enabled (rest 2.9 s, gestures 3.7 s)
      const nextOk = await waitFor(() => { const b = document.querySelector('#screen-calibration [data-act="next"]'); return b && !b.disabled; }, 8000, 50);
      if (!nextOk) break;
      steps++;
      clickAct('next');
      await sleep(300);
    }
    check(c, 'all 4 steps recorded', steps === 4, steps + '/4');
    check(c, '3D scene canvas present', !!document.querySelector('#screen-calibration canvas'));
    await sleep(1000); // the verify view with the 3D stage
    calAct('close', { instant: true });
    tab('connect');
    check(c, 'back on connect', await waitFor(() => shown('screen-connect') && !shown('screen-calibration'), 3000));
    await sleep(300);
    return c;
  },
  async motion(ms) {
    const c = [];
    const quats = startMotion();
    await sleep(ms);
    stopStreams();
    pushState(rest);
    check(c, 'quaternions sent', quats() > ms / 25, quats());
    return c;
  },
  async tuning(ms) {
    const c = [];
    tab('settings');
    check(c, 'settings shown', await waitFor(() => shown('screen-settings'), 3000));
    const card = $('set-bench-card');
    const head = card && card.querySelector('.app-bench-card__head');
    if (card && card.classList.contains('is-collapsed') && head) head.click();
    check(c, 'response graph unfolded', await waitFor(() => card && !card.classList.contains('is-collapsed'), 2000));
    pushState(rest);
    await sleep(300);
    startTuning();
    await sleep(ms);
    stopStreams();
    if (card && !card.classList.contains('is-collapsed') && head) head.click();
    tab('connect');
    await waitFor(() => shown('screen-connect'), 3000);
    await sleep(300);
    return c;
  },
  // Stats & 3D under motion: the page with the most live drawing (3D view,
  // charts, tiles), fed as Go does (quat 60 Hz, state 15 Hz, tuning 60 Hz).
  async stats(ms) {
    const c = [];
    tab('stats');
    check(c, 'stats shown', await waitFor(() => shown('screen-stats'), 3000));
    const quats = startMotion();
    startTuning();
    check(c, '3D view mounted', await waitFor(() => !!document.querySelector('#stats-3d-canvas-host canvas'), 5000));
    await sleep(ms);
    stopStreams();
    pushState(rest);
    // a busy page delays our 16 ms timer as it would delay Go's events: report
    // the rate it got, invalid only if the stream did not run at all
    check(c, 'quaternion stream ran', quats() > 10, Math.round(quats() / (ms / 1000)) + '/s of 60');
    $('home')?.click();
    await waitFor(() => shown('screen-connect'), 3000);
    await sleep(300);
    return c;
  },
  async disconnect(downMs) {
    const c = [];
    pushState({ status: 'offline', hz: 0, pingMs: -1, dsuClients: 0, dsuClientList: [] });
    await sleep(downMs);
    pushState({ ...rest });
    notify('device:connected', true);
    await sleep(800);
    check(c, 'connect screen shown', shown('screen-connect'));
    return c;
  },
  async pages(screens, gapMs) {
    const c = [];
    let reached = 0;
    for (const s of screens) {
      if (s === 'connect') $('home')?.click(); else tab(s);
      if (await waitFor(() => shown('screen-' + s), gapMs + 400, 10)) reached++;
      await sleep(gapMs);
    }
    check(c, 'every screen shown', reached === screens.length, reached + '/' + screens.length);
    if (!shown('screen-connect')) { $('home')?.click(); await waitFor(() => shown('screen-connect'), 2000); }
    return c;
  },
  async reflow(cycles) {
    const c = [];
    const theme0 = document.documentElement.dataset.theme;
    let flips = 0;
    for (let i = 0; i < cycles; i++) {
      for (const th of ['light', 'dark']) {
        notify('theme-sync', th);
        await sleep(350);
        if (document.documentElement.dataset.theme === th) flips++;
      }
      for (const z of [1.15, 1]) { notify('font-scale-sync', z); await sleep(350); }
    }
    if (theme0) notify('theme-sync', theme0);
    await sleep(200);
    check(c, 'theme switched each time', flips === cycles * 2, flips + '/' + cycles * 2);
    return c;
  },
  // Settles the screen before the idle window opens.
  async idlePrep() {
    stopStreams();
    pushState(rest);
    await sleep(1000);
    return [];
  },
  // Connected and still: Go's heartbeat keeps sending the same state at 15 Hz.
  // Rule 0: nothing changes, so the app should do (almost) nothing.
  async idle(ms) {
    const c = [];
    streams.push(setInterval(() => notify('state:change', clone(st)), 66));
    await sleep(ms);
    stopStreams();
    check(c, 'connect screen shown', shown('screen-connect'));
    return c;
  },
};

window.__pgBench = {
  start,
  end,
  // for tools/screenshot: the same Go-side events and state the scenarios use
  notify,
  pushState,
  tab,
  startMotion,
  stopStreams,
  async run(name, ...args) { return scenarios[name](...args); },
  // vsync estimate from a quiet second: median delta
  async vsync(ms = 1000) {
    start('vsync');
    await sleep(ms);
    const r = rec.deltas.slice().sort((a, b) => a - b);
    nativeCAF(rec.raf); rec = null;
    return r.length ? r[Math.floor(r.length / 2)] : 0;
  },
  bootTimes() {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      domContentLoadedMs: +(nav.domContentLoadedEventEnd || 0).toFixed(1),
      loadMs: +(nav.loadEventEnd || 0).toFixed(1),
      firstContentfulPaintMs: fcp ? +fcp.startTime.toFixed(1) : null,
      splashGoneMs: splashGoneAt ? +splashGoneAt.toFixed(1) : null,
    };
  },
  gpu() {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const v = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : 'no webgl');
      gl && gl.getExtension('WEBGL_lose_context')?.loseContext();
      return String(v);
    } catch (e) { return 'error: ' + e.message; }
  },
  screen() {
    return { w: screen.width, h: screen.height, dpr: devicePixelRatio, inner: innerWidth + 'x' + innerHeight };
  },
};
})();`;
}
