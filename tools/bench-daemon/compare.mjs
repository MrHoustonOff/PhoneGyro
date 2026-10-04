#!/usr/bin/env node
// Compares two bench JSON reports stage by stage: node compare.mjs before.json after.json
// A change counts only when it is bigger than the spread (min–max) both reports
// saw across their own runs, and bigger than a small absolute floor; anything
// else is "≈" (noise). Reports from different machines, modes or scales are
// refused unless --force: their numbers do not compare.

import { readFileSync } from 'node:fs';
import { METRICS } from './report.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const [aPath, bPath] = args.filter((a) => !a.startsWith('--'));
if (!aPath || !bPath) { console.error('usage: node compare.mjs before.json after.json [--force]'); process.exit(2); }
const A = JSON.parse(readFileSync(aPath, 'utf8'));
const B = JSON.parse(readFileSync(bPath, 'utf8'));

const same = (k) => JSON.stringify(k(A.meta)) === JSON.stringify(k(B.meta));
const problems = [];
if (!same((m) => m.mode)) problems.push(`mode ${A.meta.mode} vs ${B.meta.mode}`);
if (!same((m) => m.scale)) problems.push(`scale ${A.meta.scale} vs ${B.meta.scale}`);
if (!same((m) => m.machine.cpu)) problems.push('different CPU');
if (!same((m) => m.gpu)) problems.push(`different WebGL renderer (${A.meta.gpu} vs ${B.meta.gpu})`);
if (!same((m) => m.refreshHz && Math.round(m.refreshHz))) problems.push(`refresh ${A.meta.refreshHz} vs ${B.meta.refreshHz} Hz`);
if (problems.length && !force) {
  console.error('Not comparable: ' + problems.join('; ') + '. Use --force to compare anyway.');
  process.exit(2);
}
if ((A.meta.runs < 3 || B.meta.runs < 3) && !force) {
  console.error('A report has fewer than 3 runs: there is no noise band to judge a change by. Re-run with --runs 3 (or --force).');
  process.exit(2);
}

// absolute floors below which a difference is not worth a word
const FLOOR = { fps: 1, p50: 0.5, p95: 17, p99: 17, max: 17, slowPct: 0.5, droppedPct: 0.5, appRaf: 1, script: 1, style: 0.5, layout: 0.5, task: 2, loafMs: 20, cDrop: 2, raster: 5, paint: 5, layerMpx: 1, heap: 0.5, dom: 20, listeners: 10, cores: 0.02, renderCores: 0.02, gpuCores: 0.02, goCores: 0.01, ram: 5, otherLoad: 1000 };

console.log(`before: ${A.meta.machine.git?.rev || '?'} ${A.meta.when}`);
console.log(`after:  ${B.meta.machine.git?.rev || '?'} ${B.meta.when}\n`);
let better = 0, worse = 0;
for (const sb of B.stages) {
  const sa = A.stages.find((s) => s.id === sb.id);
  if (!sa) continue;
  const lines = [];
  if (sa.status === 'INVALID' || sb.status === 'INVALID') { console.log(`${sb.name}: INVALID in one report, skipped`); continue; }
  for (const [k, , label, lowerBetter] of METRICS) {
    const a = sa.metrics[k], b = sb.metrics[k];
    if (!a || !b || k === 'otherLoad') continue;
    const d = b.median - a.median;
    // noise: the larger run-to-run spread, at least the floor and 10 % of the value
    // (frame-time percentiles move in whole frames, so their floor is one 60 Hz frame)
    const band = Math.max(a.max - a.min, b.max - b.min, FLOOR[k] ?? 0, 0.10 * Math.abs(a.median));
    if (Math.abs(d) <= band) continue;
    const good = lowerBetter ? d < 0 : d > 0;
    good ? better++ : worse++;
    const pct = a.median ? ` (${d > 0 ? '+' : ''}${(100 * d / a.median).toFixed(0)}%)` : '';
    lines.push(`  ${good ? 'better' : 'WORSE '}  ${label.padEnd(12)} ${a.median} → ${b.median}${pct}`);
  }
  console.log(`${sb.name}: ${sa.status} → ${sb.status}${lines.length ? '' : '   ≈ no change beyond noise'}`);
  for (const l of lines) console.log(l);
}
console.log(`\n${better} better, ${worse} worse (beyond noise)`);
process.exit(worse ? 1 : 0);
