// The Go side: bound methods (window.go.app.App) and events (window.runtime).
// Wails injects both while the page loads, so everything waits on `ready`.

const hasBridge = () => !!(window.go && window.go.app && window.go.app.App && window.runtime);

/** Resolves once the Wails bridge is there (rejects after 10 s outside the app). */
export const ready = new Promise((resolve, reject) => {
  if (hasBridge()) return resolve();
  const t0 = performance.now();
  (function poll() {
    if (hasBridge()) resolve();
    else if (performance.now() - t0 > 10000) reject(new Error('no Wails bridge'));
    else setTimeout(poll, 16);
  })();
});

/** Calls a bound Go method: call('SetTheme', 'dark'). Unknown methods resolve to undefined. */
export async function call(method, ...args) {
  await ready;
  const fn = window.go.app.App[method];
  return fn ? fn(...args) : undefined;
}

/** Subscribes to a Go event. */
export function on(event, fn) {
  ready.then(() => window.runtime.EventsOn(event, fn), () => {});
}

/** Unsubscribes from a Go event. */
export function off(event, ...args) {
  ready.then(() => {
    if (window.runtime && window.runtime.EventsOff) {
      window.runtime.EventsOff(event, ...args);
    }
  }, () => {});
}

/** The Wails runtime (window controls, BrowserOpenURL); only after `ready`. */
export const runtime = () => window.runtime;

/** Opens a link in the system browser. */
export function openURL(url) {
  ready.then(() => window.runtime.BrowserOpenURL(url), () => window.open(url, '_blank'));
}
