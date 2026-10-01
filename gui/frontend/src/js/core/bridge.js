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

const eventRegistry = new Map();

// Streams Go sends only while someone listens: the first listener switches the
// stream on, the last one off (Rule 0: no 60 Hz IPC for a screen nobody shows).
const GATED = { 'ahrs:quat': 'SetQuatStream' };

function dispatchEvent(event, ...args) {
  const set = eventRegistry.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(...args);
    } catch (err) {
      console.error(`Error in event listener for "${event}":`, err);
    }
  }
}

export function on(event, fn) {
  if (typeof fn !== 'function') return;
  let set = eventRegistry.get(event);
  if (!set) {
    set = new Set();
    eventRegistry.set(event, set);
    if (GATED[event]) call(GATED[event], true).catch(() => {});
    if (window.runtime && window.runtime.EventsOn) {
      window.runtime.EventsOn(event, (...args) => dispatchEvent(event, ...args));
    } else {
      ready.then(() => {
        if (window.runtime && window.runtime.EventsOn) {
          window.runtime.EventsOn(event, (...args) => dispatchEvent(event, ...args));
        }
      }, () => {});
    }
  }
  set.add(fn);
}

/** Unsubscribes from a Go event. */
export function off(event, fn) {
  const set = eventRegistry.get(event);
  if (!set) return;

  if (typeof fn === 'function') {
    set.delete(fn);
  } else {
    set.clear();
  }

  if (set.size === 0) {
    eventRegistry.delete(event);
    if (GATED[event]) call(GATED[event], false).catch(() => {});
    if (window.runtime && window.runtime.EventsOff) {
      window.runtime.EventsOff(event);
    } else {
      ready.then(() => {
        if (window.runtime && window.runtime.EventsOff) {
          window.runtime.EventsOff(event);
        }
      }, () => {});
    }
  }
}

/** The Wails runtime (window controls, BrowserOpenURL); only after `ready`. */
export const runtime = () => window.runtime;

/** Opens a link in the system browser. */
export function openURL(url) {
  ready.then(() => window.runtime.BrowserOpenURL(url), () => window.open(url, '_blank'));
}
