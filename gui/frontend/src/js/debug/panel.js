// Debug panel (Settings → Performance, or Ctrl+Shift+Alt+D while the window is
// active). Loaded only when opened. On top: six tiles for what matters (design
// StatCard: big number, verdict, a 60 s graph each); under "More": the rest.
// Sampled twice a second, drawn on one small canvas per tile, so it does not
// become the load it is looking for. With "debug log" on it writes to
// logs/debug.log (Go WriteDebugLog): a session header, a summary line a second,
// and a line per event worth a look (stall, slow link, JS error, screen change).

import { call } from '../core/bridge.js';
import { getState, stateStats } from '../core/state.js';
import { onScreen } from '../shell/router.js';
import { getZoom } from '../ui/zoom.js';

const TICK_MS = 500;
const HIST = 120;          // samples per graph: 60 s
const LONG_TASK_MS = 50;

let root = null, open = false, headerDone = false;
let raf = 0, tick = 0, logT = 0, observer = null;
let deltas = [], lastFrame = 0;
let longTasks = 0, worstTask = 0, errors = 0;
let lastStateCount = 0, lastTickAt = 0;
let pending = [];
let go = {};
const cur = {};
const trend = { heapJs: [], dom: [] }; // for leak hints (one value a minute)

const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);

// verdict(value) → 'ok' | 'warn' | 'danger' | '' (no verdict)
const TILES = [
  { id: 'fps', name: 'FPS', unit: 'fps', d: 0, get: () => cur.fps, max: () => 120,
    verdict: (v) => (v >= 55 ? 'ok' : v >= 30 ? 'warn' : 'danger') },
  { id: 'p95', name: 'Frame p95', unit: 'ms', d: 1, get: () => cur.p95, max: (h) => Math.max(34, ...h),
    verdict: (v) => (v <= 20 ? 'ok' : v <= 34 ? 'warn' : 'danger') },
  { id: 'cpu', name: 'CPU (app)', unit: '%', d: 1, get: () => go.cpuPercent, max: (h) => Math.max(10, ...h),
    verdict: (v) => (v < 5 ? 'ok' : v < 15 ? 'warn' : 'danger') },
  { id: 'ram', name: 'RAM (app)', unit: 'MB', d: 0, get: () => go.ramMb, max: (h) => Math.max(200, ...h),
    verdict: (v) => (v < 250 ? 'ok' : v < 500 ? 'warn' : 'danger') },
  { id: 'hz', name: 'Sensor', unit: 'Hz', d: 0, get: () => cur.hz, max: (h) => Math.max(120, ...h),
    verdict: (v) => (cur.link !== 'online' ? '' : v >= 55 ? 'ok' : v >= 30 ? 'warn' : 'danger') },
  { id: 'ping', name: 'Ping', unit: 'ms', d: 0, get: () => (cur.ping >= 0 ? cur.ping : null), max: (h) => Math.max(40, ...h),
    verdict: (v) => (v == null ? '' : v < 20 ? 'ok' : v < 60 ? 'warn' : 'danger') },
];
const hist = Object.fromEntries(TILES.map((t) => [t.id, []]));

const MORE = [
  ['UI', [['Worst frame', () => fmt(cur.worst, 0) + ' ms'], ['Frame p50 / p99', () => `${fmt(cur.p50)} / ${fmt(cur.p99)} ms`],
    ['Long tasks', () => cur.longTasks + (cur.worstTask ? ` (max ${fmt(cur.worstTask, 0)} ms)` : '')],
    ['State events/s · max gap', () => `${fmt(cur.statePerSec, 0)} · ${fmt(cur.maxGap, 0)} ms`],
    ['JS heap · DOM nodes', () => `${fmt(cur.heapJs)} MB · ${cur.dom}`], ['IPC round trip', () => fmt(cur.ipcMs) + ' ms'], ['JS errors', () => errors]]],
  ['Go', [['Heap / sys', () => `${fmt(go.heapMb)} / ${fmt(go.sysMb, 0)} MB`], ['GC', () => `${go.numGc} · last ${fmt(go.lastPauseMs, 2)} ms · ${fmt(go.gcCpu, 2)} %`],
    ['Goroutines', () => go.goroutines], ['Uptime', () => fmt((go.uptimeSec || 0) / 60, 1) + ' min']]],
  ['Link · window', [['Status', () => `${cur.link} · ${cur.input} · DSU ${cur.dsu}`], ['Window', () => `${cur.w}×${cur.h} · ${cur.mode} · ${Math.round((cur.zoom || 1) * 100)} %`],
    ['Log', () => (go.logOn ? 'logs/debug.log' : 'off')]]],
];

function build() {
  root = document.createElement('div');
  root.className = 'app-dbg';
  root.innerHTML = `<div class="app-dbg__head"><b>Debug</b><span class="app-dbg__hint">Ctrl+Shift+Alt+D</span>
      <button type="button" class="app-dbg__btn" data-dbg="fold" aria-label="fold">–</button>
      <button type="button" class="app-dbg__btn" data-dbg="close" aria-label="close">×</button></div>
    <div class="app-dbg__body">
      <div class="app-dbg__tiles">${TILES.map((t) => `<div class="pg-stat app-dbg__tile" data-t="${t.id}">
        <div class="pg-stat__head">${t.name}<span class="pg-badge" data-v></span></div>
        <div class="pg-stat__value"><span data-n>—</span><span class="pg-stat__unit">${t.unit}</span></div>
        <div class="pg-spark"><canvas></canvas></div></div>`).join('')}</div>
      <details class="app-dbg__more"><summary>More</summary><div class="app-dbg__grid">${MORE.map(([g, rows]) =>
        `<div class="app-dbg__group">${g}</div>` + rows.map(([k], i) => `<span>${k}</span><b data-k="${g}${i}"></b>`).join('')).join('')}</div></details>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('[data-dbg=close]').onclick = () => closePanel();
  root.querySelector('[data-dbg=fold]').onclick = () => root.classList.toggle('is-folded');
  drag(root.querySelector('.app-dbg__head'));
}

function drag(handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (m) => { root.style.left = Math.max(0, m.clientX - dx) + 'px'; root.style.top = Math.max(0, m.clientY - dy) + 'px'; root.style.right = 'auto'; };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
}

function frame(now) {
  if (lastFrame) deltas.push(now - lastFrame);
  lastFrame = now;
  raf = requestAnimationFrame(frame);
}

async function sample() {
  const now = performance.now();
  const dt = (now - (lastTickAt || now - TICK_MS)) / 1000;
  lastTickAt = now;
  const st = getState() || {};
  const shell = document.getElementById('shell');
  const w = shell ? shell.clientWidth : innerWidth;
  const t0 = performance.now();
  go = (await call('GetDebugStats')) || {};
  const sorted = deltas.slice().sort((a, b) => a - b);
  Object.assign(cur, {
    fps: deltas.length / dt, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), p99: pct(sorted, 0.99), worst: sorted[sorted.length - 1] || 0,
    longTasks, worstTask, ipcMs: performance.now() - t0,
    heapJs: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    dom: document.getElementsByTagName('*').length,
    statePerSec: (stateStats.count - lastStateCount) / dt, maxGap: stateStats.maxGap,
    w, h: shell ? shell.clientHeight : innerHeight, zoom: getZoom(),
    mode: w >= 860 ? 'wide' : w >= 560 ? 'compact' : w >= 400 ? 'sm' : 'xs',
    link: st.status || '—', input: st.inputMode || '—', hz: st.hz, ping: st.pingMs, dsu: st.dsuClients || 0,
  });
  lastStateCount = stateStats.count;
  stateStats.maxGap = 0;
  deltas = []; longTasks = 0; worstTask = 0;
  if (dt >= 0.3) { anomalies(st); for (const t of TILES) push(t.id, t.get()); }
  render();
}

function push(k, v) { hist[k].push(v == null ? 0 : v); if (hist[k].length > HIST) hist[k].shift(); }

function anomalies(st) {
  const visible = document.visibilityState === 'visible';
  if (visible && cur.fps < 30) pending.push(`WARN ui: ${fmt(cur.fps, 0)} fps, p95 ${fmt(cur.p95)} ms, worst ${fmt(cur.worst, 0)} ms`);
  if (st.status === 'online' && cur.maxGap > 300) pending.push(`WARN state: no update from Go for ${fmt(cur.maxGap, 0)} ms`);
  if (st.status === 'online' && st.pingMs > 100) pending.push(`WARN link: ping ${st.pingMs} ms`);
  if (st.status === 'online' && st.hz > 0 && st.hz < 20) pending.push(`WARN link: sensor ${fmt(st.hz, 0)} Hz`);
  if (cur.ipcMs > 50) pending.push(`WARN ipc: a call to Go took ${fmt(cur.ipcMs, 0)} ms`);
}

// One line a minute: memory that only grows is a leak.
let trendAt = 0;
function leakHint() {
  const now = performance.now();
  if (now - trendAt < 60000) return;
  trendAt = now;
  trend.heapJs.push(cur.heapJs || 0);
  trend.dom.push(cur.dom || 0);
  if (trend.heapJs.length > 10) { trend.heapJs.shift(); trend.dom.shift(); }
  const grows = (a) => a.length >= 5 && a.every((v, i) => !i || v >= a[i - 1]) && a[a.length - 1] > a[0] * 1.3;
  if (grows(trend.heapJs)) pending.push(`WARN leak?: JS heap only grows for ${trend.heapJs.length} min (${fmt(trend.heapJs[0])} → ${fmt(cur.heapJs)} MB)`);
  if (grows(trend.dom)) pending.push(`WARN leak?: DOM only grows for ${trend.dom.length} min (${trend.dom[0]} → ${cur.dom} nodes)`);
}

function summary() {
  const c = cur;
  return `ui fps=${fmt(c.fps, 0)} frame p50/p95/p99/max=${fmt(c.p50)}/${fmt(c.p95)}/${fmt(c.p99)}/${fmt(c.worst, 0)}ms long=${c.longTasks} `
    + `state/s=${fmt(c.statePerSec, 0)} gap=${fmt(c.maxGap, 0)}ms js=${fmt(c.heapJs)}MB dom=${c.dom} ipc=${fmt(c.ipcMs)}ms err=${errors} `
    + `| go cpu=${fmt(go.cpuPercent)}% ram=${fmt(go.ramMb, 0)}MB heap=${fmt(go.heapMb)}MB gc=${go.numGc} pause=${fmt(go.lastPauseMs, 2)}ms gor=${go.goroutines} `
    + `| link ${c.link}/${c.input} hz=${fmt(c.hz, 0)} ping=${c.ping} dsu=${c.dsu} | win ${c.w}x${c.h} ${c.mode} zoom=${c.zoom}`;
}

async function flushLog() {
  if (!go.logOn) { pending = []; return; }
  let head = '';
  if (!headerDone) {
    headerDone = true;
    const v = (await call('GetAppVersion')) || {};
    head = (`INFO session: PhoneGyro ${v.display || '?'} · ${navigator.userAgent} · screen ${screen.width}x${screen.height} @${devicePixelRatio}x`
      + ` · theme ${document.documentElement.dataset.theme} · accent ${document.documentElement.dataset.accent} · lang ${document.documentElement.lang}`);
    call('WriteDebugLog', [head]);
  }
  leakHint();
  call('WriteDebugLog', [summary(), ...pending]);
  pending = [];
}

function draw(t, canvas) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const data = hist[t.id];
  if (data.length < 2) return;
  const max = t.max(data) || 1;
  const color = getComputedStyle(canvas.closest('.pg-stat')).getPropertyValue('--line-c').trim() || '#888';
  g.beginPath();
  data.forEach((v, i) => {
    const x = W - (data.length - 1 - i) * (W / (HIST - 1));
    const y = H - 2 - Math.min(1, v / max) * (H - 5);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = color;
  g.lineWidth = 1.6;
  g.stroke();
  g.lineTo(W, H); g.lineTo(W - (data.length - 1) * (W / (HIST - 1)), H); g.closePath();
  g.globalAlpha = 0.12; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
}

function render() {
  for (const t of TILES) {
    const tile = root.querySelector(`[data-t="${t.id}"]`);
    const v = t.get();
    tile.querySelector('[data-n]').textContent = fmt(v, t.d);
    const verdict = v == null ? '' : t.verdict(v);
    const badge = tile.querySelector('[data-v]');
    badge.className = 'pg-badge' + (verdict ? ' pg-badge--' + verdict : '');
    badge.textContent = verdict || '—';
    tile.dataset.verdict = verdict;
    draw(t, tile.querySelector('canvas'));
  }
  const more = root.querySelector('.app-dbg__more');
  if (!more.open) return;
  MORE.forEach(([g, rows]) => rows.forEach(([, fn], i) => {
    const el = more.querySelector(`[data-k="${g}${i}"]`);
    const v = String(fn());
    if (el.textContent !== v) el.textContent = v;
  }));
}

function onError(e) {
  errors++;
  const msg = e.reason ? `unhandled promise: ${e.reason && (e.reason.stack || e.reason)}` : `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`;
  pending.push(`ERROR js: ${String(msg).split('\n').slice(0, 4).join(' | ')}`);
}

export function openPanel() {
  if (open) return;
  open = true;
  if (!root) {
    build();
    onScreen((s) => { if (open) pending.push(`INFO screen: ${s}`); });
  }
  root.hidden = false;
  lastFrame = 0; deltas = []; lastTickAt = 0; lastStateCount = stateStats.count; stateStats.maxGap = 0;
  raf = requestAnimationFrame(frame);
  if ('PerformanceObserver' in window) {
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          longTasks++;
          worstTask = Math.max(worstTask, e.duration);
          if (e.duration >= LONG_TASK_MS * 2) pending.push(`WARN ui: long task ${fmt(e.duration, 0)} ms`);
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) { observer = null; }
  }
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onError);
  tick = setInterval(sample, TICK_MS);
  logT = setInterval(flushLog, 1000);
  sample();
}

export function closePanel() {
  if (!open) return;
  open = false;
  cancelAnimationFrame(raf);
  clearInterval(tick);
  clearInterval(logT);
  if (observer) observer.disconnect();
  observer = null;
  removeEventListener('error', onError);
  removeEventListener('unhandledrejection', onError);
  if (root) root.hidden = true;
}

export const isOpen = () => open;
