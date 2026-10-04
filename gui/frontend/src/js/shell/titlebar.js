// Custom title bar of the frameless window (design: TitleBar). Dragging and edge
// resizing are the Wails runtime's (--wails-draggable in the CSS); this wires the
// three buttons, double-click to maximize, the restore icon and the blur dimming.

import { $, setText, show, toggleClass } from '../core/dom.js';
import { call, ready, runtime } from '../core/bridge.js';
import { onLang } from '../core/i18n.js';
import { askMinimize } from '../ui/minimize-dialog.js';

export function startTitlebar() {
  const bar = $('header');
  addEventListener('blur', () => toggleClass(bar, 'is-blur', true));
  addEventListener('focus', () => toggleClass(bar, 'is-blur', false));

  fitDock(bar);

  ready.then(() => {
    const rt = runtime();
    // Wails v2 has no maximize event: ask once the size settles.
    const syncMax = () => Promise.resolve(rt.WindowIsMaximised()).then((m) => toggleClass(bar, 'is-max', m));
    const toggleMax = () => { rt.WindowToggleMaximise(); setTimeout(syncMax, 40); };
    let t = 0;
    addEventListener('resize', () => { clearTimeout(t); t = setTimeout(syncMax, 120); });
    syncMax();

    $('wc-min').onclick = askMinimize; // window or tray, asked every time
    $('wc-max').onclick = toggleMax;
    $('wc-close').onclick = () => call('CloseWindow'); // the "action on window close"
    bar.addEventListener('dblclick', (e) => { if (!e.target.closest('.pg-titlebar__ctl, button, .pg-seg, .pg-tab, .pg-island, a')) toggleMax(); });
  }, () => {});

  call('GetAppVersion').then((v) => {
    if (!v) return;
    setText($('tb-ver'), `v${v.release}.${v.build}`);
    const dev = v.channel !== 'release';
    const chan = $('tb-chan');
    if (chan) { show(chan, dev); if (dev) setText(chan, 'DEV'); }
  });
}

// The dock folds the tab names when the full row does not fit: the nav stays
// centred (grid 1fr auto 1fr), so it needs twice the wider side plus itself.
// Measured, not a fixed breakpoint: the names' width depends on the language
// and the zoom. Only what folding does not resize is watched (the row itself,
// the right-hand controls), else the observer would chase its own change.
function fitDock(bar) {
  const main = $('hdr-main');
  if (!main || typeof ResizeObserver === 'undefined') return;
  const kids = [...main.children];
  const gap = () => parseFloat(getComputedStyle(main).columnGap) || 0;
  const fits = () => {
    const [a, nav, b] = kids.map((el) => el.getBoundingClientRect().width);
    return 2 * Math.max(a, b || 0) + nav + 2 * gap() <= main.clientWidth + 1;
  };
  // full names → icons with the wordmark → icons only
  const fit = () => {
    bar.classList.remove('is-compact', 'is-tiny');
    if (fits()) return;
    bar.classList.add('is-compact');
    if (!fits()) bar.classList.add('is-tiny');
  };
  const ro = new ResizeObserver(fit);
  ro.observe(main);
  if (kids[2]) ro.observe(kids[2]); // rem-sized: follows the zoom
  onLang(() => setTimeout(fit, 0)); // after the new names are in
  document.fonts?.ready.then(fit);
}
