// Opens and closes the debug panel. The panel's code (debug/panel.js) is only
// loaded the first time it opens. Ctrl+Shift+Alt+D toggles it while this window
// is active (a page keydown: nothing global). With the setting on it opens at
// once, over the launch animation: the setting is mirrored to localStorage so
// the start does not wait for Go.

import { call } from '../core/bridge.js';

let panel = null;
const load = () => (panel = panel || import('./panel.js'));
const remember = (on) => { try { localStorage.setItem('pg-debug', on ? '1' : '0'); } catch (e) { /* next start waits for Go */ } };

export async function setDebugPanel(on) {
  remember(on);
  if (!on && !panel) return;
  const p = await load();
  if (on) p.openPanel(); else p.closePanel();
}

/** Called first thing at start (before the bridge and the launch animation). */
export function startDebug() {
  addEventListener('keydown', async (e) => {
    if (!(e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyD')) return;
    e.preventDefault();
    const p = await load();
    if (p.isOpen()) p.closePanel(); else p.openPanel();
  }, true);
  let early = false;
  try { early = localStorage.getItem('pg-debug') === '1'; } catch (e) { /* ask Go */ }
  if (early) setDebugPanel(true);
  // Go's setting is the truth: open it if it is on, and keep the mirror right.
  call('GetAppSettings').then((s) => {
    if (!s) return;
    remember(!!s.debugPanel);
    if (s.debugPanel && !early) setDebugPanel(true);
  });
}
