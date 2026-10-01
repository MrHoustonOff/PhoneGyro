// Drive the main window through its screens and record, after every step,
// which elements (with an id) are visible: catches show/hide regressions that
// static snapshots cannot see (screens, wizards, dialogs, notices).
// node flows.mjs out.json [--ref gitref]
// node flows.mjs --diff a.json b.json          exit code 1 on differences
import { readFileSync, writeFileSync } from 'node:fs';
import { args, backendStub, browser, serve, withTree, FRONTEND } from './lib.mjs';

const FLOW = `(async () => {
  const W = (ms) => new Promise(r => setTimeout(r, ms));
  const steps = [], errs = [];
  const visible = () => [...document.querySelectorAll('[id]')].filter(e => getComputedStyle(e).getPropertyValue('display') !== 'none' && e.getClientRects().length).map(e => e.id);
  const step = async (name, f) => {
    try { await f(); } catch (e) { errs.push(name + ': ' + String(e)); }
    await W(900); // screen transitions run ~0.6 s
    steps.push({ name, visible: visible() });
  };
  const on = __stateAt('rest', 0); on.pitch = 0; on.roll = 0; on.yaw = 0;
  const off = __stateAt('offline', 0);
  const click = (sel) => document.querySelector(sel)?.click();

  const tab = (t) => click('#nav [data-tab="' + t + '"]');
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  await step('offline', () => __emit('state:change', off));
  await step('online', () => __emit('state:change', on));
  await step('paused', () => __emit('state:change', Object.assign({}, on, { isPaused: true })));
  await step('resumed', () => __emit('state:change', on));
  await step('dsu clients', () => __emit('dsu:status', { count: 1, clients: [{ address: '127.0.0.1:5', ip: '127.0.0.1', port: 5, active: true, process: 'Cemu' }], kicked: [{ address: '127.0.0.1:6', ip: '127.0.0.1', port: 6, process: 'PadTest' }] }));
  await step('dsu none', () => __emit('dsu:status', { count: 0, clients: [], kicked: [] }));
  await step('usb waiting', () => __emit('state:change', Object.assign({}, off, { inputMode: 'usb', usbConnected: false })));
  await step('usb connected', () => __emit('state:change', Object.assign({}, on, { inputMode: 'usb', usbConnected: true, usbPort: 'COM3' })));
  await step('phone again', () => __emit('state:change', on));
  await step('offline again', () => __emit('state:change', off));
  await step('online again', () => __emit('state:change', on));

  await step('profile menu', () => click('#prof-current'));
  await step('profile menu closed', () => click('#prof-current'));
  await step('calibration', () => click('#btn-calibrate'));
  await step('calibration closed', () => click('#cal-x'));
  await step('setup wizard', () => click('#btn-setup'));
  for (let i = 0; i < 6; i++) await step('setup next ' + i, () => click('#wiz-next'));
  await step('setup closed', () => click('#wiz-close'));

  for (const t of ['settings', 'stats', 'docs', 'connect']) await step('screen ' + t, () => tab(t));
  await step('games', () => { tab('settings'); click('#btn-open-games'); });
  await step('games closed', () => click('#btn-games-close'));
  await step('back home', () => tab('connect'));

  await step('cemu notice', () => __emit('cemu:notice', { guardOn: true }));
  await step('cemu notice closed', esc);
  await step('firewall alert', () => __emit('firewall:alert', { state: 'blocked', network: 'public' }));
  await step('firewall alert closed', esc);
  await step('update notice', () => __emit('update:available', { current: '2.0.0', latest: '2.1.0', releaseUrl: 'https://x', downloadUrl: 'https://x' }));
  await step('update notice closed', esc);
  await step('close dialog', () => __emit('app:confirm-close'));
  await step('close dialog cancelled', esc);
  await step('theme toggled', () => click('#btn-theme'));
  await step('theme back', () => click('#btn-theme'));
  return JSON.stringify({ steps, errs });
})()`;

export async function runFlows(dir) {
  const srv = await serve(dir);
  const b = await browser();
  try {
    const p = await b.page(backendStub());
    await p.goto(`${srv.base}/index.html`);
    const res = JSON.parse(await p.evaluate(FLOW));
    res.pageErrors = p.errors();
    return res;
  } finally { b.close(); srv.close(); }
}

export function diffFlows(a, b) {
  const out = [];
  a.steps.forEach((s, i) => {
    const t = b.steps[i];
    if (!t) { out.push(`${i + 1} ${s.name}: missing`); return; }
    const A = new Set(s.visible), B = new Set(t.visible);
    const gone = [...A].filter(x => !B.has(x)), came = [...B].filter(x => !A.has(x));
    if (gone.length || came.length) out.push(`${i + 1} ${s.name}: hidden now [${gone.join(' ')}] shown now [${came.join(' ')}]`);
  });
  return out;
}

if (process.argv[1].endsWith('flows.mjs')) {
  const { pos, opt } = args();
  if (opt.diff) {
    const [a, b] = [opt.diff, pos[0]].map(f => JSON.parse(readFileSync(f, 'utf8')));
    const d = diffFlows(a, b);
    console.log(d.join('\n') || 'same visibility at every step', `\n(${a.steps.length} steps; errors: ${b.errs.length + b.pageErrors.length})`);
    process.exit(d.length ? 1 : 0);
  }
  if (!pos[0]) { console.log('usage: node flows.mjs out.json [--ref gitref] | --diff a.json b.json'); process.exit(2); }
  const res = opt.ref ? await withTree(opt.ref, runFlows) : await runFlows(FRONTEND);
  writeFileSync(pos[0], JSON.stringify(res));
  console.log(`${res.steps.length} steps, errors:`, [...res.errs, ...res.pageErrors]);
  process.exit(0);
}
