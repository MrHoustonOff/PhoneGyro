// Computed-style snapshots: every element (and its ::before/::after) of both
// windows, in several UI states and both themes, for "nothing visible changed".
// node snap.mjs out.json [--ref gitref]      take snapshots (working tree or a ref)
// node snap.mjs --diff a.json b.json [noise1.json noise2.json ...]
//   compare; differences that also show up among the noise snapshots (same
//   build, several runs: animations) are ignored. Exit code 1 on differences.
import { readFileSync, writeFileSync } from 'node:fs';
import { args, backendStub, browser, serve, withTree, FRONTEND, GO_ONLINE } from './lib.mjs';

export const PROPS = ['color', 'background-color', 'background-image', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'border-top-width', 'border-right-width', 'border-bottom-width',
  'border-left-width', 'border-top-style', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius', 'box-shadow', 'text-shadow', 'outline-color',
  'outline-style', 'outline-width', 'opacity', 'filter', 'backdrop-filter', 'transform', 'z-index', 'position',
  'display', 'visibility', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height',
  'text-transform', 'text-align', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top',
  'padding-right', 'padding-bottom', 'padding-left', 'gap', 'animation-name', 'animation-duration',
  'transition-property', 'transition-duration', 'fill', 'stroke', 'caret-color', 'accent-color', 'cursor',
  'pointer-events', 'content', 'min-width', 'max-width', 'flex-direction', 'justify-content', 'align-items',
  'grid-template-columns', 'overflow-x', 'overflow-y', 'white-space', 'user-select', 'inset'];

// Keys are element paths (#id, else tag:index among non-script siblings) plus classes.
const SNAP = `(() => {
  const PROPS = ${JSON.stringify(PROPS)};
  const out = {};
  const key = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.id) { parts.unshift('#' + e.id); break; }
      const p = e.parentElement;
      const sibs = p ? [...p.children].filter(c => !/^(SCRIPT|LINK|STYLE|META)$/.test(c.tagName)) : [e];
      parts.unshift(e.tagName.toLowerCase() + ':' + sibs.indexOf(e));
    }
    return parts.join('>');
  };
  const grab = (cs) => PROPS.map(p => cs.getPropertyValue(p)).join('|');
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const k = key(el) + '.' + [...el.classList].sort().join('.');
    out[k] = grab(getComputedStyle(el));
    for (const ps of ['::before', '::after']) {
      const cs = getComputedStyle(el, ps);
      if (cs.content && cs.content !== 'none' && cs.content !== 'normal') out[k + ps] = grab(cs);
    }
  }
  return JSON.stringify(out);
})()`;

const wait = (ms) => `new Promise(r => setTimeout(r, ${ms}))`;
export const STATES = [
  ['offline', wait(300)],
  ['online', GO_ONLINE],
  ['usb', `(async () => { AppState.setInputMode('usb', true); __emit('state:change', Object.assign(__stateAt('offline', 0), { inputMode: 'usb', usbConnected: false })); await ${wait(600)}; })()`],
  ['calibration', `(async () => { await ${GO_ONLINE}; CalibrationWizard.openToSlot(0); CalibrationWizard.showScreen('confirm'); await ${wait(800)}; })()`],
  ['settings', `(async () => { await ${GO_ONLINE}; SettingsManager.open(); await ${wait(800)}; })()`],
];
const THEME = (t) => `document.documentElement.setAttribute('data-theme', '${t}'); ${wait(400)}`;

export async function takeSnapshots(dir) {
  const srv = await serve(dir);
  const b = await browser();
  const snaps = {};
  try {
    const p = await b.page(backendStub());
    for (const [name, setup] of STATES) {
      await p.goto(`${srv.base}/index.html`);
      await p.evaluate(setup);
      for (const t of ['dark', 'light']) { await p.evaluate(THEME(t)); snaps[`main/${name}/${t}`] = JSON.parse(await p.evaluate(SNAP)); }
    }
    await p.goto(`${srv.base}/livedebug.html`);
    for (const t of ['dark', 'light']) { await p.evaluate(THEME(t)); snaps[`livedebug/${t}`] = JSON.parse(await p.evaluate(SNAP)); }
    return { props: PROPS, snaps, errors: p.errors() };
  } finally { b.close(); srv.close(); }
}

// diffSnapshots(a, b, noise[]) -> [{state, key, prop, from, to}]
export function diffSnapshots(a, b, noise = []) {
  const props = a.props;
  const noisy = new Set();
  for (let i = 0; i < noise.length; i++) for (let j = i + 1; j < noise.length; j++) {
    const x = noise[i], y = noise[j];
    for (const s of Object.keys(x.snaps)) for (const k of Object.keys(x.snaps[s])) {
      const u = (x.snaps[s][k] || '').split('|'), v = ((y.snaps[s] || {})[k] || '').split('|');
      props.forEach((p, n) => { if (u[n] !== v[n]) noisy.add(`${s} ${k} ${p}`); });
    }
  }
  // A running animation changes these from frame to frame: not a difference.
  const animIdx = props.indexOf('animation-name');
  const ANIMATED = new Set(['transform', 'opacity', 'box-shadow', 'filter', 'border-top-color', 'border-right-color',
    'border-bottom-color', 'border-left-color', 'background-color', 'color']);
  const out = [];
  for (const s of Object.keys(a.snaps)) {
    const A = a.snaps[s], B = b.snaps[s] || {};
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
      if (!(k in A) || !(k in B)) { out.push({ state: s, key: k, prop: '*', from: k in A ? 'present' : '-', to: k in B ? 'present' : '-' }); continue; }
      if (A[k] === B[k]) continue;
      const u = A[k].split('|'), v = B[k].split('|');
      const animated = u[animIdx] !== 'none' && u[animIdx] === v[animIdx];
      props.forEach((p, n) => {
        if (u[n] === v[n] || noisy.has(`${s} ${k} ${p}`) || (animated && ANIMATED.has(p))) return;
        out.push({ state: s, key: k, prop: p, from: u[n], to: v[n] });
      });
    }
  }
  return out;
}

export function printDiff(d, limit = 40) {
  for (const x of d.slice(0, limit)) console.log(`${x.state}  ${x.key}\n    ${x.prop}: ${x.from}  ->  ${x.to}`);
  const by = {}; d.forEach(x => { by[x.prop] = (by[x.prop] || 0) + 1; });
  console.log(`\n${d.length} style differences`, d.length ? JSON.stringify(by) : '');
}

if (process.argv[1].endsWith('snap.mjs')) {
  const { pos, opt } = args();
  if (opt.diff) {
    const files = [opt.diff, ...pos].map(f => JSON.parse(readFileSync(f, 'utf8')));
    const d = diffSnapshots(files[0], files[1], files.slice(2));
    printDiff(d);
    process.exit(d.length ? 1 : 0);
  }
  if (!pos[0]) { console.log('usage: node snap.mjs out.json [--ref gitref] | --diff a.json b.json [noise...]'); process.exit(2); }
  const res = opt.ref ? await withTree(opt.ref, takeSnapshots) : await takeSnapshots(FRONTEND);
  writeFileSync(pos[0], JSON.stringify(res));
  console.log('snapshots:', Object.keys(res.snaps).map(k => `${k}=${Object.keys(res.snaps[k]).length}`).join(' '), res.errors.length ? '\nerrors: ' + res.errors.join('\n') : '');
  process.exit(0);
}
