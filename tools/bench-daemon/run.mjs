#!/usr/bin/env node
// PhoneGyro bench: node tools/bench-daemon/run.mjs [--native|--browser] [--quick|--standard|--stress] [--runs N]
// Exit code: 0 all stages valid and on target, 1 a stage missed the target,
// 3 a stage was INVALID (its numbers mean nothing), 2 the bench itself failed.

import readline from 'node:readline';
import { launchBrowser, launchNative } from './engine.mjs';
import { runOnce } from './stages.mjs';
import { aggregate, formatText, saveReport } from './report.mjs';

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
  }
  return o;
}

const HELP = `PhoneGyro bench
  --native            the real PhoneGyro.exe (Go + WebView2) — the numbers that matter [Windows]
  --browser           frontend only, in Chrome/Edge with a mock backend (default off Windows)
  --quick | --standard | --stress   stage set and length (default standard)
  --runs N            repeat N times, each a fresh start; the report gives median (min–max). Default 3
  --real-data         native: use the user's real APPDATA instead of a temporary copy
  --head              browser: visible window (headless otherwise)
  --frontend DIR      browser: serve another frontend (e.g. a git worktree's gui/frontend/src) for A/B
  --width/--height    browser window size (default 1280x720)
  --out DIR           where to write the .txt and .json (default reports/ next to bench.cmd, else ./reports)
  --no-report         print only
Compare two reports: node tools/bench-daemon/compare.mjs before.json after.json`;

async function menu() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n  [1] PhoneGyro.exe, standard, 3 runs (recommended)\n  [2] PhoneGyro.exe, stress, 3 runs\n  [3] PhoneGyro.exe, quick, 1 run\n  [4] browser, standard, 3 runs\n  [0] exit\n`);
  const a = await new Promise((r) => rl.question('  choice: ', r));
  rl.close();
  return ({
    1: { native: true, standard: true, runs: '3' },
    2: { native: true, stress: true, runs: '3' },
    3: { native: true, quick: true, runs: '1' },
    4: { browser: true, standard: true, runs: '3' },
  })[a.trim()] || process.exit(0);
}

async function main() {
  let opt = parseArgs(process.argv.slice(2));
  if (opt.help) { console.log(HELP); return 0; }
  if (process.argv.length <= 2 && process.stdin.isTTY) opt = await menu();
  const native = opt.native ? true : opt.browser ? false : process.platform === 'win32';
  const scale = opt.quick ? 'quick' : opt.stress ? 'stress' : 'standard';
  const runs = Math.max(1, Number(opt.runs || 3));
  const width = Number(opt.width || 1280), height = Number(opt.height || 720);

  console.log(`PhoneGyro bench: ${native ? 'native PhoneGyro.exe' : 'browser'} · ${scale} · ${runs} run(s)`);
  const all = [];
  let meta = null;
  for (let k = 1; k <= runs; k++) {
    const engine = native ? await launchNative({ realData: !!opt['real-data'] }) : await launchBrowser({ width, height, head: !!opt.head, frontendDir: typeof opt.frontend === 'string' ? opt.frontend : undefined });
    try {
      const r = await runOnce(engine, {
        scale,
        onProgress: ({ i, n, stage, phase, result }) => {
          if (phase !== 'done') return;
          const p = result.page;
          const tail = result.status === 'INVALID' ? result.invalid.join('; ') : `${p.fps} fps · p95 ${p.frameMs.p95} ms · slow ${p.slowPct}%${result.proc ? ` · ${result.proc.cores} cores` : ''}`;
          console.log(`  run ${k}/${runs}  [${i}/${n}] ${stage.name.padEnd(40)} ${result.status.padEnd(7)} ${tail}`);
        },
      });
      all.push(r);
      meta = meta || {
        mode: engine.mode, head: engine.head, isolated: engine.isolated, version: engine.version, machine: engine.machine,
        gpu: r.gpu, screen: r.screen, refreshHz: r.refreshHz, vsyncMs: r.vsyncMs, scale, runs,
        when: new Date().toISOString(),
      };
    } finally {
      await engine.close();
    }
  }
  const agg = aggregate(all);
  const text = formatText(agg, meta);
  console.log('\n' + text);
  if (!opt['no-report']) {
    const p = saveReport(text, { meta, stages: agg, raw: all }, typeof opt.out === 'string' ? opt.out : undefined);
    console.log(`\nreport: ${p.txt}\n        ${p.json}`);
  }
  if (agg.some((s) => s.status === 'INVALID')) return 3;
  if (agg.some((s) => s.status === 'FAIL')) return 1;
  return 0;
}

main().then((code) => process.exit(code), (err) => { console.error('\n[bench failed]', err); process.exit(2); });
