// Opens and closes the debug panel. The panel's code (debug/panel.js) is only
// loaded the first time it opens. Ctrl+Shift+Alt+D toggles it while this window
// is active (a page keydown: nothing global); the setting opens it at start.

import { call } from '../core/bridge.js';

let panel = null;
const load = () => (panel = panel || import('./panel.js'));

export async function setDebugPanel(on) {
  if (!on && !panel) return;
  const p = await load();
  if (on) p.openPanel(); else p.closePanel();
}

export function startDebug() {
  addEventListener('keydown', async (e) => {
    if (!(e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyD')) return;
    e.preventDefault();
    const p = await load();
    if (p.isOpen()) p.closePanel(); else p.openPanel();
  }, true);
  call('GetAppSettings').then((s) => { if (s && s.debugPanel) setDebugPanel(true); });
}
