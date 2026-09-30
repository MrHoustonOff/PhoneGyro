// Debug panel (Settings → Performance, or Ctrl+Shift+Alt+D while the window is
// active). Loaded only when opened. Everything it measures is sampled at most a
// few times a second and drawn on one canvas, so it does not become the load it
// is looking for. With "debug log" on it writes one summary line a second and a
// line per anomaly to logs/debug.log (Go WriteDebugLog).

import { call } from '../core/bridge.js';
import { getState, stateStats } from '../core/state.js';
import { getZoom } from '../ui/zoom.js';

const TICK_MS = 500;       // numbers and graph
const LOG_MS = 1000;       // summary line
const HIST = 120;          // graph samples (60 s)
const LONG_TASK_MS = 50;   // what the browser reports as a long task

let root = null;
let open = false;
let raf = 0, tick = 0, logT = 0;
let frames = 0, worstFrame = 0, lastFrame = 0;
let longTasks = 0, worstTask = 0, observer = null;
let lastStateCount = 0, lastTickAt = 0;
let pending = [];          // log lines waiting for the next flush
let go = {};               // last GetDebugStats
let ipcMs = 0;
const hist = { fps: [], cpu: [], heap: [] };
const cur = {};

const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

function build() {
  root = document.createElement('div');
  root.className = 'app-dbg';
  root.innerHTML = `<div class="app-dbg__head"><b>Debug</b><span class="app-dbg__hint">Ctrl+Shift+Alt+D</span>
    <button type="button" class="app-dbg__btn" data-dbg="fold" aria-label="fold">–</button>
    <button type="button" class="app-dbg__btn" data-dbg="close" aria-label="close">×</button></div>
    <div class="app-dbg__body"><canvas class="app-dbg__graph" width="400" height="90"></canvas>
    <div class="app-dbg__legend"><i style="--c:var(--accent)"></i>FPS <i style="--c:var(--info)"></i>CPU % <i style="--c:var(--warn)"></i>Go heap MB</div>
    <div class="app-dbg__grid"></div></div>`;
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
  frames++;
  if (lastFrame) worstFrame = Math.max(worstFrame, now - lastFrame);
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
  ipcMs = performance.now() - t0;
  Object.assign(cur, {
    fps: frames / dt, worstFrame, longTasks, worstTask,
    heapJs: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    dom: document.getElementsByTagName('*').length,
    statePerSec: (stateStats.count - lastStateCount) / dt,
    ipcMs, w, h: shell ? shell.clientHeight : innerHeight, zoom: getZoom(),
    mode: w >= 860 ? 'wide' : w >= 560 ? 'compact' : w >= 400 ? 'sm' : 'xs',
    link: st.status || '—', input: st.inputMode || '—', hz: st.hz, ping: st.pingMs, dsu: st.dsuClients || 0,
  });
  lastStateCount = stateStats.count;
  frames = 0; worstFrame = 0; longTasks = 0; worstTask = 0;
  push('fps', cur.fps); push('cpu', go.cpuPercent); push('heap', go.heapMb);
  if (dt >= 0.3) anomalies(st); // the first sample right at opening has no frames yet
  render();
  draw();
}

function push(k, v) { hist[k].push(v || 0); if (hist[k].length > HIST) hist[k].shift(); }

// Lines worth a look later: a stalled frame, a slow link, lost sensor rate.
function anomalies(st) {
  if (cur.fps < 30 && document.visibilityState === 'visible') pending.push(`WARN ui: ${fmt(cur.fps, 0)} fps, worst frame ${fmt(cur.worstFrame, 0)} ms`);
  if (st.status === 'online' && st.pingMs > 100) pending.push(`WARN link: ping ${st.pingMs} ms`);
  if (st.status === 'online' && st.hz > 0 && st.hz < 20) pending.push(`WARN link: sensor ${fmt(st.hz, 0)} Hz`);
  if (cur.ipcMs > 50) pending.push(`WARN ipc: GetDebugStats took ${fmt(cur.ipcMs, 0)} ms`);
}

function summary() {
  const c = cur;
  return `ui fps=${fmt(c.fps, 0)} worst=${fmt(c.worstFrame, 0)}ms long=${c.longTasks} js=${fmt(c.heapJs)}MB dom=${c.dom} state/s=${fmt(c.statePerSec, 0)} ipc=${fmt(c.ipcMs)}ms `
    + `| go cpu=${fmt(go.cpuPercent)}% ram=${fmt(go.ramMb, 0)}MB heap=${fmt(go.heapMb)}MB gc=${go.numGc} pause=${fmt(go.lastPauseMs, 2)}ms gor=${go.goroutines} `
    + `| link ${c.link}/${c.input} hz=${fmt(c.hz, 0)} ping=${c.ping} dsu=${c.dsu} | win ${c.w}x${c.h} ${c.mode} zoom=${c.zoom}`;
}

function flushLog() {
  if (!go.logOn) { pending = []; return; }
  call('WriteDebugLog', [summary(), ...pending]);
  pending = [];
}

const ROWS = [
  ['UI', [['FPS', () => fmt(cur.fps, 0)], ['Worst frame', () => fmt(cur.worstFrame, 0) + ' ms'], ['Long tasks', () => cur.longTasks + (cur.worstTask ? ` (max ${fmt(cur.worstTask, 0)} ms)` : '')],
    ['JS heap', () => fmt(cur.heapJs) + ' MB'], ['DOM nodes', () => cur.dom], ['State events/s', () => fmt(cur.statePerSec, 0)], ['IPC round trip', () => fmt(cur.ipcMs) + ' ms']]],
  ['Go', [['CPU (app + WebView2)', () => fmt(go.cpuPercent) + ' %'], ['RAM', () => fmt(go.ramMb, 0) + ' MB'], ['Heap / sys', () => `${fmt(go.heapMb)} / ${fmt(go.sysMb, 0)} MB`],
    ['GC', () => `${go.numGc} · last ${fmt(go.lastPauseMs, 2)} ms · ${fmt(go.gcCpu, 2)} %`], ['Goroutines', () => go.goroutines], ['Uptime', () => fmt((go.uptimeSec || 0) / 60, 1) + ' min']]],
  ['Link', [['Status', () => `${cur.link} · ${cur.input}`], ['Sensor', () => fmt(cur.hz, 0) + ' Hz'], ['Ping', () => (cur.ping >= 0 ? cur.ping + ' ms' : '—')], ['DSU clients', () => cur.dsu]]],
  ['Window', [['Size', () => `${cur.w}×${cur.h} · ${cur.mode}`], ['Zoom', () => Math.round((cur.zoom || 1) * 100) + ' %'], ['Log', () => (go.logOn ? 'logs/debug.log' : 'off')]]],
];

function render() {
  const grid = root.querySelector('.app-dbg__grid');
  if (!grid.firstChild) {
    grid.innerHTML = ROWS.map(([g, rows]) => `<div class="app-dbg__group">${g}</div>` + rows.map(([k], i) => `<span>${k}</span><b data-k="${g}${i}"></b>`).join('')).join('');
  }
  ROWS.forEach(([g, rows]) => rows.forEach(([, fn], i) => {
    const el = grid.querySelector(`[data-k="${g}${i}"]`);
    const v = String(fn());
    if (el.textContent !== v) el.textContent = v;
  }));
}

function draw() {
  const cv = root.querySelector('canvas');
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const line = (data, max, color) => {
    if (data.length < 2) return;
    g.strokeStyle = css.getPropertyValue(color).trim();
    g.lineWidth = 1.5;
    g.beginPath();
    data.forEach((v, i) => {
      const x = W - (data.length - 1 - i) * (W / (HIST - 1));
      const y = H - 2 - Math.min(1, v / max) * (H - 4);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  };
  line(hist.fps, 120, '--accent');
  line(hist.cpu, Math.max(10, ...hist.cpu), '--info');
  line(hist.heap, Math.max(16, ...hist.heap), '--warn');
}

export function openPanel() {
  if (open) return;
  open = true;
  if (!root) build();
  root.hidden = false;
  lastFrame = 0; frames = 0; lastTickAt = 0; lastStateCount = stateStats.count;
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
  tick = setInterval(sample, TICK_MS);
  logT = setInterval(flushLog, LOG_MS);
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
  if (root) root.hidden = true;
}

export const isOpen = () => open;
