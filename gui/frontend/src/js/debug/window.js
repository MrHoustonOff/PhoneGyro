// The debug window (a separate process, internal/app/debugwin.go). It reads the
// main process's debug hub as a Server-Sent Events stream: the whole history
// first (so the start is there even if this window came up later), then live.
// Six tiles for what matters (big number, verdict, a 2-minute graph each), the
// start timeline, details, and the event log. Drawing happens only when a new
// sample arrives (twice a second), never on a frame loop.

const HIST = 240;   // samples per graph: 2 min at 2 Hz
const LOG_MAX = 400;

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let ui = {}, go = {}, link = {};
let filter = 'all';
const events = [];

const TILES = [
  { id: 'fps', name: 'FPS · main window', unit: 'fps', d: 0, get: () => ui.fps, max: () => 120, v: (x) => (x >= 55 ? 'ok' : x >= 30 ? 'warn' : 'danger') },
  { id: 'p95', name: 'Frame time p95', unit: 'ms', d: 1, get: () => ui.p95, max: (h) => Math.max(34, ...h), v: (x) => (x <= 20 ? 'ok' : x <= 34 ? 'warn' : 'danger') },
  { id: 'cpu', name: 'CPU · app + WebView2', unit: '%', d: 1, get: () => go.cpuPercent, max: (h) => Math.max(10, ...h), v: (x) => (x < 5 ? 'ok' : x < 15 ? 'warn' : 'danger') },
  { id: 'ram', name: 'RAM · app + WebView2', unit: 'MB', d: 0, get: () => go.ramMb, max: (h) => Math.max(200, ...h), v: (x) => (x < 250 ? 'ok' : x < 500 ? 'warn' : 'danger') },
  { id: 'hz', name: 'Sensor rate', unit: 'Hz', d: 0, get: () => link.hz, max: (h) => Math.max(120, ...h), v: (x) => (link.status !== 'online' ? '' : x >= 55 ? 'ok' : x >= 30 ? 'warn' : 'danger') },
  { id: 'ping', name: 'Phone ping', unit: 'ms', d: 0, get: () => (link.ping >= 0 ? link.ping : null), max: (h) => Math.max(40, ...h), v: (x) => (x == null ? '' : x < 20 ? 'ok' : x < 60 ? 'warn' : 'danger') },
];
const hist = Object.fromEntries(TILES.map((t) => [t.id, []]));

const DETAILS = [
  ['Frame p50 / p99 / max', () => `${fmt(ui.p50)} / ${fmt(ui.p99)} / ${fmt(ui.worst, 0)} ms`],
  ['Long tasks (worst)', () => `${ui.longTasks ?? '—'} (${fmt(ui.worstTask, 0)} ms)`],
  ['State events/s · max gap', () => `${fmt(ui.statePerSec, 0)} · ${fmt(ui.maxGap, 0)} ms`],
  ['JS heap · DOM nodes', () => `${fmt(ui.heapJs)} MB · ${ui.dom ?? '—'}`],
  ['IPC round trip', () => `${fmt(ui.ipcMs)} ms`],
  ['Go heap / sys', () => `${fmt(go.heapMb)} / ${fmt(go.sysMb, 0)} MB`],
  ['GC · last pause · CPU', () => `${go.numGc ?? '—'} · ${fmt(go.lastPauseMs, 2)} ms · ${fmt(go.gcCpu, 2)} %`],
  ['Goroutines', () => go.goroutines ?? '—'],
  ['Link', () => `${link.status || '—'} · ${link.input || '—'} · DSU ${link.dsu ?? 0}`],
  ['Window', () => (ui.w ? `${ui.w}×${ui.h} · ${ui.mode} · ${Math.round((ui.zoom || 1) * 100)} %${ui.visible === false ? ' · hidden' : ''}` : '—')],
  ['Debug log', () => (go.logOn ? 'logs/debug.log' : 'off')],
];

function buildTiles() {
  $('tiles').innerHTML = TILES.map((t) => `<div class="pg-stat dbg-tile" data-t="${t.id}">
    <div class="pg-stat__head">${t.name}<span class="pg-badge" data-v>—</span></div>
    <div class="pg-stat__value"><span data-n>—</span><span class="pg-stat__unit">${t.unit}</span></div>
    <div class="pg-spark"><canvas></canvas></div></div>`).join('');
  $('details').innerHTML = DETAILS.map(([k], i) => `<span>${k}</span><b data-d="${i}">—</b>`).join('');
}

function draw(t, canvas) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const data = hist[t.id];
  if (data.length < 2) return;
  const max = t.max(data) || 1, step = W / (HIST - 1), x0 = W - (data.length - 1) * step;
  const color = getComputedStyle(canvas.closest('.dbg-tile')).getPropertyValue('--line-c').trim() || '#888';
  g.beginPath();
  data.forEach((v, i) => { const x = x0 + i * step, y = H - 3 - Math.min(1, v / max) * (H - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.strokeStyle = color; g.lineWidth = 1.6; g.stroke();
  g.lineTo(W, H); g.lineTo(x0, H); g.closePath();
  g.globalAlpha = 0.14; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
  // the axis max, so a graph's scale is readable
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink-3').trim();
  g.font = '10px monospace';
  g.fillText(String(Math.round(max)), 4, 11);
}

function renderTiles() {
  for (const t of TILES) {
    const el = document.querySelector(`[data-t="${t.id}"]`);
    const v = t.get();
    el.querySelector('[data-n]').textContent = fmt(v, t.d);
    const verdict = v == null ? '' : t.v(v);
    const b = el.querySelector('[data-v]');
    b.className = 'pg-badge' + (verdict ? ' pg-badge--' + verdict : '');
    b.textContent = verdict || '—';
    el.dataset.verdict = verdict;
    draw(t, el.querySelector('canvas'));
  }
  DETAILS.forEach(([, fn], i) => { document.querySelector(`[data-d="${i}"]`).textContent = String(fn()); });
  $('uptime').textContent = go.uptimeSec ? `up ${fmt(go.uptimeSec / 60, 1)} min` : '';
}

const push = (id, v) => { hist[id].push(v == null ? 0 : v); if (hist[id].length > HIST) hist[id].shift(); };

function addEvent(t, level, msg) {
  events.push({ t, level, msg });
  if (events.length > LOG_MAX) events.shift();
  if (filter !== 'all' && level !== filter) return;
  const log = $('log');
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  log.insertAdjacentHTML('beforeend', row({ t, level, msg }));
  while (log.childElementCount > LOG_MAX) log.firstElementChild.remove();
  if (stick) log.scrollTop = log.scrollHeight;
}
const row = (e) => `<div class="dbg-ev dbg-ev--${e.level.toLowerCase()}"><span>${(e.t / 1000).toFixed(2)} s</span><b>${e.level}</b><span>${esc(e.msg)}</span></div>`;
function renderLog() {
  $('log').innerHTML = events.filter((e) => filter === 'all' || e.level === filter).map(row).join('');
  $('log').scrollTop = $('log').scrollHeight;
}

function onEvent(ev) {
  if (ev.kind === 'ui') {
    ui = ev.data;
    push('fps', ui.fps); push('p95', ui.p95);
  } else if (ev.kind === 'go') {
    go = ev.data.stats || {}; link = ev.data.link || {};
    push('cpu', go.cpuPercent); push('ram', go.ramMb); push('hz', link.status === 'online' ? link.hz : 0); push('ping', link.ping >= 0 ? link.ping : 0);
    renderTiles();   // one redraw per Go sample: twice a second
  } else if (ev.kind === 'phase') {
    $('phases').insertAdjacentHTML('beforeend', `<li><b>${(ev.t / 1000).toFixed(3)} s</b><span>${esc(ev.data.name)}</span></li>`);
    addEvent(ev.t, 'INFO', 'phase: ' + ev.data.name);
  } else if (ev.kind === 'log') {
    addEvent(ev.t, ev.data.level || 'INFO', ev.data.msg || '');
  }
}

async function main() {
  buildTiles();
  const d = await new Promise((resolve) => {
    (function wait() { const x = window.go && window.go.app && window.go.app.DebugWinApp; x ? resolve(x) : setTimeout(wait, 20); })();
  });
  const port = await d.HubPort();
  const conn = $('conn');
  const src = new EventSource(`http://127.0.0.1:${port}/events`);
  // Every (re)connect replays the whole history: start from empty.
  src.onopen = () => {
    conn.className = 'pg-badge pg-badge--ok pg-badge--dot'; conn.textContent = 'live';
    for (const k in hist) hist[k].length = 0;
    events.length = 0; $('phases').innerHTML = ''; $('log').innerHTML = '';
  };
  src.onerror = () => { conn.className = 'pg-badge pg-badge--warn pg-badge--dot'; conn.textContent = 'reconnecting'; };
  src.onmessage = (m) => {
    try { onEvent(JSON.parse(m.data)); } catch (e) { /* skip a bad line */ }
  };
  $('ontop').onchange = (e) => d.SetOnTop(e.target.checked);
  $('close').onclick = () => d.CloseAndDisable();
  $('filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll('#filter .pg-seg__btn').forEach((x) => x.classList.toggle('is-active', x === b));
    renderLog();
  });
  addEventListener('resize', renderTiles);
}

main();
