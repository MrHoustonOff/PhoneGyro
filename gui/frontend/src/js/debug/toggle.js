// Debugging switch in the main window. The debug window itself is a separate
// process run by Go (internal/app/debughub.go); here: the collector
// (debug/collect.js) runs while Go's debug hub is active, and Ctrl+Shift+Alt+D
// (only while this window is active) shows or closes the debug window.
// localStorage mirrors the setting so collecting starts before the launch
// animation, without waiting for Go.

import { call, on as onEvent, ready } from '../core/bridge.js';
import { onScreen } from '../shell/router.js';
import { startCollect, stopCollect, flushEarly, debugLog, debugPhase } from './collect.js';

const remember = (v) => { try { localStorage.setItem('pg-debug', v ? '1' : '0'); } catch (e) { /* next start asks Go */ } };

function apply(active) {
  remember(active);
  if (active) startCollect(); else stopCollect();
}

/** Settings → Performance changed the debug window or log setting. */
export function setDebugPanel(v) { remember(v); }

/** First thing at start. */
export function startDebug() {
  let early = false;
  try { early = localStorage.getItem('pg-debug') === '1'; } catch (e) { /* ask Go */ }
  if (early) { startCollect(); debugPhase('page start'); }
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyD')) return;
    e.preventDefault();
    call('ToggleDebugWindow');
  }, true);
  onEvent('debug:active', apply);
  onScreen((s) => debugLog('INFO', `screen: ${s}`));
  ready.then(async () => {
    flushEarly();
    apply(!!(await call('IsDebugActive')));
  }, () => {});
}

/** The UI finished booting (main.js). */
export const debugBooted = () => debugPhase('ui ready');
