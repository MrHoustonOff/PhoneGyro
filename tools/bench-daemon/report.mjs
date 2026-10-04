// Aggregates runs (median and min–max per number) and writes the report:
// a plain-text table for reading and a JSON file with every raw run for tools.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET } from './stages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The numbers a stage is judged and compared by: [key, path, label, lower is better]
export const METRICS = [
  ['fps', 'page.fps', 'fps', false],
  ['p50', 'page.frameMs.p50', 'p50 ms', true],
  ['p95', 'page.frameMs.p95', 'p95 ms', true],
  ['p99', 'page.frameMs.p99', 'p99 ms', true],
  ['max', 'page.frameMs.max', 'max ms', true],
  ['slowPct', 'page.slowPct', 'slow %', true],
  ['droppedPct', 'page.droppedPct', 'drop %', true],
  ['appRaf', 'page.appRafPerSec', 'app rAF/s', true],
  ['script', 'main.scriptMsPerSec', 'script ms/s', true],
  ['style', 'main.styleMsPerSec', 'style ms/s', true],
  ['layout', 'main.layoutMsPerSec', 'layout ms/s', true],
  ['task', 'main.taskMsPerSec', 'task ms/s', true],
  ['loafMs', 'page.loafMs', 'LoAF ms', true],
  ['cDrop', 'compositor.droppedPct', 'comp drop %', true],
  ['raster', 'compositor.rasterMsPerSec', 'raster ms/s', true],
  ['paint', 'compositor.paintMs', 'paint ms', true],
  ['layerMpx', 'layers.mpx', 'layers Mpx', true],
  ['heap', 'heapMb', 'heap MB', true],
  ['dom', 'page.domNodes', 'DOM', true],
  ['listeners', 'jsEventListeners', 'listeners', true],
  ['cores', 'proc.cores', 'CPU cores', true],
  ['renderCores', 'proc.groups.renderer.cores', 'renderer', true],
  ['gpuCores', 'proc.groups.gpu.cores', 'GPU proc', true],
  ['goCores', 'proc.groups.app.cores', 'Go', true],
  ['ram', 'proc.wsMb', 'RAM MB', true],
  ['otherLoad', 'proc.otherLoadPct', 'other load %', true],
];
const BOOT = [
  ['domContentLoaded', 'boot.domContentLoadedMs', 'DOMContentLoaded ms'],
  ['load', 'boot.loadMs', 'load ms'],
  ['fcp', 'boot.firstContentfulPaintMs', 'first paint ms'],
  ['splashGone', 'boot.splashGoneMs', 'splash gone ms'],
];

const get = (o, p) => p.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);

function stats(vals) {
  const v = vals.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { median: +median.toFixed(3), min: v[0], max: v[v.length - 1], n: v.length };
}

export function aggregate(runs) {
  const ids = runs[0]?.stages.map((s) => s.id) || [];
  return ids.map((id) => {
    const per = runs.map((r) => r.stages.find((s) => s.id === id)).filter(Boolean);
    const valid = per.filter((s) => s.status !== 'INVALID');
    const out = { id, name: per[0].name, statuses: per.map((s) => s.status), metrics: {} };
    for (const [k, p] of [...METRICS, ...BOOT]) { const st = stats(valid.map((s) => get(s, p))); if (st) out.metrics[k] = st; }
    out.status = per.some((s) => s.status === 'INVALID') ? 'INVALID'
      : per.some((s) => s.status === 'FAIL') ? 'FAIL'
        : per.every((s) => s.status === 'INFO') ? 'INFO' : 'PASS';
    out.invalid = [...new Set(per.flatMap((s) => s.invalid))];
    out.errors = [...new Set(per.flatMap((s) => s.errors))].slice(0, 10);
    // the slowest frames of the worst run, with the scripts behind them
    const worst = valid.slice().sort((a, b) => (b.page.loafMs || 0) - (a.page.loafMs || 0))[0];
    out.topLoaf = worst ? worst.page.topLoaf.slice(0, 3) : [];
    return out;
  });
}

const fmt = (st) => {
  if (!st) return '—';
  const f = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
  return st.n > 1 && st.min !== st.max ? `${f(st.median)} (${f(st.min)}–${f(st.max)})` : f(st.median);
};

export function formatText(agg, meta) {
  const L = [];
  L.push('PhoneGyro bench');
  L.push(`  when:    ${meta.when}`);
  L.push(`  target:  ${meta.mode}${meta.mode === 'native' ? (meta.isolated ? ' (isolated data copy)' : ' (REAL user data)') : meta.head ? ' (window)' : ' (headless)'} · ${meta.version}`);
  L.push(`  git:     ${meta.machine.git ? `${meta.machine.git.branch}@${meta.machine.git.rev}${meta.machine.git.dirtyGui ? ' +uncommitted gui changes' : ''}` : 'unknown'}`);
  L.push(`  machine: ${meta.machine.cpu} · ${meta.machine.threads} threads · ${meta.machine.ramGb} GB · ${meta.machine.os}`);
  if (meta.machine.gpus) for (const g of [].concat(meta.machine.gpus)) L.push(`  gpu:     ${g.Name} · ${g.CurrentHorizontalResolution}x${g.CurrentVerticalResolution} @ ${g.CurrentRefreshRate} Hz`);
  L.push(`  webgl:   ${meta.gpu}`);
  L.push(`  display: refresh ${meta.refreshHz ?? '?'} Hz measured · ${meta.screen?.inner} css px · dpr ${meta.screen?.dpr}`);
  if (meta.machine.onBattery) L.push('  WARNING: on battery — CPU/GPU clocks are not comparable to a run on AC');
  if (/swiftshader|llvmpipe|software/i.test(meta.gpu || '')) L.push('  WARNING: software WebGL — GPU-bound numbers say nothing about real hardware');
  L.push(`  runs:    ${meta.runs} × ${meta.scale}; numbers are median (min–max) over valid runs`);
  L.push(`  target:  ${TARGET.fps} fps = slow frames (> ${TARGET.slowFrameMs.toFixed(1)} ms) ≤ ${TARGET.maxSlowPct}%; idle: app rAF/s = 0, layout ≤ ${TARGET.idleMaxLayoutMsPerSec} ms/s`);
  L.push('');
  for (const s of agg) {
    L.push(`[${s.status}] ${s.name}   (${s.statuses.join(' ')})`);
    if (s.invalid.length) for (const w of s.invalid) L.push(`    INVALID: ${w}`);
    if (s.id === 'boot') {
      L.push('    ' + BOOT.map(([k, , l]) => `${l} ${fmt(s.metrics[k])}`).join(' · '));
    }
    const rows = METRICS.filter(([k]) => s.metrics[k]);
    for (let i = 0; i < rows.length; i += 6) {
      L.push('    ' + rows.slice(i, i + 6).map(([k, , l]) => `${l} ${fmt(s.metrics[k])}`).join(' · '));
    }
    for (const lf of s.topLoaf) {
      const sc = lf.scripts.map((x) => `${x.fn || x.invoker || '?'} ${x.src} ${x.ms}ms`).join('; ');
      L.push(`    long frame ${lf.ms} ms (style+layout ${lf.styleLayoutMs}, render ${lf.renderMs})${sc ? ': ' + sc : ''}`);
    }
    for (const e of s.errors) L.push(`    page error: ${e.slice(0, 200)}`);
  }
  L.push('');
  L.push('Glossary: slow % = frames over the 60 fps budget; drop % = refresh intervals with no frame; app rAF/s = the app\'s own');
  L.push('requestAnimationFrame requests (the recorder\'s loop not counted); ms/s = main-thread time per second of the stage;');
  L.push('CPU cores = CPU time of PhoneGyro + all its WebView2 processes per second (1.0 = one core busy), split renderer/GPU proc/Go;');
  L.push('heap = JS heap after a forced GC; other load % = the rest of the machine during the stage (high = noisy run).');
  L.push('comp drop % = frames the compositor dropped or showed partly (trace; sees GPU/raster stalls the rAF recorder cannot);');
  L.push('raster ms/s = rasterisation time; layers Mpx = peak area of painted layers during boot, device pixels (GPU memory, blending).');
  return L.join('\n');
}

export function saveReport(text, data, dir) {
  // bench.cmd sets BENCH_DIR: reports go next to it (ignored by git as reports/)
  const out = dir || path.join(process.env.BENCH_DIR || process.cwd(), 'reports');
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const base = path.join(out, `bench-${data.meta.mode}-${data.meta.scale}-${stamp}`);
  writeFileSync(base + '.txt', text + '\n');
  writeFileSync(base + '.json', JSON.stringify(data, null, 1));
  return { txt: base + '.txt', json: base + '.json' };
}

export { HERE };
