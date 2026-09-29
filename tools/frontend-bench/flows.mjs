// Drive the main window through its screens and record, after every step,
// which elements (with an id) are visible: catches show/hide regressions that
// static snapshots cannot see (wizards, dialogs, sheets, settings, bench, guides).
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
    await W(250);
    steps.push({ name, visible: visible() });
  };
  const on = __stateAt('rest', 0); on.pitch = 0; on.roll = 0; on.yaw = 0;
  const off = __stateAt('offline', 0);
  const click = (sel) => document.querySelector(sel)?.click();

  await step('offline', () => __emit('state:change', off));
  await step('first connection sheet', () => { FirstCenterGate.done.phone = false; __emit('state:change', on); });
  await step('sheet closed', () => RecenterManager.close(true));
  await step('online', () => { FirstCenterGate.done.phone = true; __emit('state:change', on); });
  await step('paused', () => __emit('state:change', Object.assign({}, on, { isPaused: true })));
  await step('resumed', () => __emit('state:change', on));
  await step('recal hint', () => AppState.showRecalHint());
  await step('recal hint hidden', () => AppState.hideRecalHint(true));
  await step('dsu clients', () => __emit('dsu:status', { count: 1, clients: [{ address: '127.0.0.1:5', ip: '127.0.0.1', port: 5, active: true, process: 'Cemu' }], kicked: [{ address: '127.0.0.1:6', ip: '127.0.0.1', port: 6, process: 'PadTest' }] }));
  await step('dsu none', () => __emit('dsu:status', { count: 0, clients: [], kicked: [] }));
  await step('usb mode', () => AppState.setInputMode('usb', true));
  await step('usb waiting', () => __emit('state:change', Object.assign({}, off, { inputMode: 'usb', usbConnected: false })));
  await step('usb connected', () => __emit('state:change', Object.assign({}, on, { inputMode: 'usb', usbConnected: true, usbPort: 'COM3' })));
  await step('phone mode', () => AppState.setInputMode('phone', true));
  await step('offline again', () => __emit('state:change', off));
  await step('online again', () => __emit('state:change', on));

  await step('calibration open', () => CalibrationWizard.open());
  await step('calibration slot 2', () => CalibrationWizard.openToSlot(1));
  for (const sc of ['capture', 'confirm', 'manual', 'save', 'slots', 'capture']) await step('calibration ' + sc, () => CalibrationWizard.showScreen(sc));
  for (let i = 0; i < 4; i++) await step('capture step ' + i, () => { CalibrationWizard.captureStep = i; CalibrationWizard.showScreen('capture'); });
  await step('calibration disconnect alert', () => CalibrationWizard.showDisconnectAlert());
  await step('calibration alert hidden', () => CalibrationWizard.hideDisconnectAlert());
  await step('calibration save dropdown', () => CalibrationWizard.openSaveDropdown && CalibrationWizard.openSaveDropdown());
  await step('calibration save dropdown closed', () => CalibrationWizard.closeSaveDropdown && CalibrationWizard.closeSaveDropdown());
  await step('calibration closed', () => CalibrationWizard.close());

  await step('settings', () => SettingsManager.open());
  await step('settings tabs', () => document.querySelectorAll('[data-tab], .settings-tab, .settings-nav-item, .settings-sidebar button').forEach(b => b.click()));
  await step('bench platform', () => TuningBench.switchGame && TuningBench.switchGame('platform'));
  await step('bench aim', () => TuningBench.switchGame && TuningBench.switchGame('aim'));
  await step('aim fullscreen', () => AimGame.toggleFullscreen());
  await step('aim windowed', () => AimGame.toggleFullscreen());
  await step('device lost', () => __emit('device:disconnected'));
  await step('device back', () => __emit('device:connected'));
  await step('settings closed', () => SettingsManager.close());

  await step('help', () => HelpManager.open());
  await step('help tabs', () => document.querySelectorAll('#help-overlay button, .help-tab').forEach(b => { if (!/close/i.test(b.id)) b.click(); }));
  await step('help closed', () => HelpManager.close());
  await step('welcome', () => WelcomeManager.open());
  for (let i = 0; i < 6; i++) await step('welcome next ' + i, () => click('#welcome-overlay [id*=next]'));
  await step('welcome closed', () => WelcomeManager.close());
  await step('setup', () => SetupWizard.open());
  for (const sc of ['android', 'select', 'ios']) await step('setup ' + sc, () => SetupWizard.showScreen(sc));
  for (let i = 1; i <= 6; i++) await step('ios step ' + i, () => SetupWizard.setIosStep(i));
  await step('setup closed', () => SetupWizard.close());

  await step('recenter', () => RecenterManager.open({}));
  await step('recenter closed', () => RecenterManager.close(true));
  await step('recenter forced', () => RecenterManager.open({ forced: true }));
  await step('recenter forced closed', () => RecenterManager.close(true));
  await step('profile menu', () => ProfileManager.openDropdown());
  await step('profile menu closed', () => ProfileManager.closeDropdown());
  await step('close dialog', () => AppleCloseDialog.show());
  await step('close dialog cancelled', () => click('.apple-dialog-overlay [id*=cancel]'));
  await step('delete dialog', () => ProfileDeleteDialog.show(1, 'X'));
  await step('delete dialog cancelled', () => document.querySelectorAll('.apple-dialog-overlay button').forEach(b => { if (/cancel/i.test(b.id + b.className)) b.click(); }));
  await step('cemu notice', () => CemuNotice.show({ guardOn: true }));
  await step('cemu notice closed', () => click('#cemu-notice-modal button'));
  await step('confirm', () => { const p = showAppleConfirm({ title: 't', message: 'm' }); setTimeout(() => click('.apple-dialog-overlay button'), 50); return p; });
  await step('theme toggled', () => ThemeManager.toggle());
  await step('theme back', () => ThemeManager.toggle());
  await step('toast', () => showToast('x'));
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
