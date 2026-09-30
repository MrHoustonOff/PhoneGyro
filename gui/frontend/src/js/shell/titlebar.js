// Custom title bar of the frameless window (design: TitleBar). Dragging and edge
// resizing are the Wails runtime's (--wails-draggable in the CSS); this wires the
// three buttons, double-click to maximize, the restore icon and the blur dimming.

import { $, setText, show, toggleClass } from '../core/dom.js';
import { call, ready, runtime } from '../core/bridge.js';

export function startTitlebar() {
  const bar = $('titlebar');
  addEventListener('blur', () => toggleClass(bar, 'is-blur', true));
  addEventListener('focus', () => toggleClass(bar, 'is-blur', false));

  ready.then(() => {
    const rt = runtime();
    // Wails v2 has no maximize event: ask once the size settles.
    const syncMax = () => Promise.resolve(rt.WindowIsMaximised()).then((m) => toggleClass(bar, 'is-max', m));
    const toggleMax = () => { rt.WindowToggleMaximise(); setTimeout(syncMax, 40); };
    let t = 0;
    addEventListener('resize', () => { clearTimeout(t); t = setTimeout(syncMax, 120); });
    syncMax();

    $('wc-min').onclick = () => rt.WindowMinimise();
    $('wc-max').onclick = toggleMax;
    $('wc-close').onclick = () => call('CloseWindow'); // the "action on window close"
    bar.addEventListener('dblclick', (e) => { if (!e.target.closest('.pg-titlebar__ctl')) toggleMax(); });
  }, () => {});

  call('GetAppVersion').then((v) => {
    if (!v) return;
    setText($('tb-ver'), `v${v.release}.${v.build}`);
    const dev = v.channel !== 'release';
    const chan = $('tb-chan');
    if (chan) { show(chan, dev); if (dev) setText(chan, 'DEV'); }
  });
}
