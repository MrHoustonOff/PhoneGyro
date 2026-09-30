// GyroScene lazy loader: imports Three.js (r128) and the GyroScene vendor module
// only when the 3D stage is first requested. Keeps the launch and idle footprint
// small; cached so subsequent calls don't re-download or re-execute dependencies.

let loaderPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.THREE) return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', (err) => reject(err), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(s);
  });
}

function ensureDependencies() {
  if (!loaderPromise) {
    loaderPromise = (async () => {
      if (typeof window !== 'undefined' && !window.THREE) {
        const threeUrl = new URL('../vendor/three.min.js', import.meta.url).href;
        await loadScript(threeUrl);
      }
      await import('../vendor/gyroscene.js');
    })().catch((err) => {
      loaderPromise = null;
      throw err;
    });
  }
  return loaderPromise;
}

let activeHost = null;

if (typeof window !== 'undefined' && !window.__gyroSceneHooked) {
  const origGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = function (el, pseudo) {
    const cs = origGetComputedStyle.call(window, el, pseudo);
    if (el === document.documentElement && activeHost && activeHost.isConnected) {
      const hostCs = origGetComputedStyle.call(window, activeHost, pseudo);
      return new Proxy(cs, {
        get(target, prop) {
          if (prop === 'getPropertyValue') {
            return (varName) => {
              const hostVal = hostCs.getPropertyValue(varName);
              if (hostVal && hostVal.trim()) return hostVal;
              return target.getPropertyValue(varName);
            };
          }
          const val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        },
      });
    }
    return cs;
  };
  window.__gyroSceneHooked = true;
}

/**
 * Creates and returns a GyroScene 3D stage in hostEl.
 * Lazily loads Three.js and vendor/gyroscene.js on first call.
 * Default glb is src/assets/gamepad.glb.txt.
 */
export async function createGyroScene(hostEl, opts = {}) {
  await ensureDependencies();
  activeHost = hostEl;
  const defaultGlb = new URL('../../assets/gamepad.glb.txt', import.meta.url).href;
  // `still`: no floating bob / idle sway (app option, see tools/design-css/build.py)
  const sceneOpts = { glb: defaultGlb, still: true, ...opts };
  const scene = window.PhoneGyro.createScene(hostEl, sceneOpts);
  if (scene && typeof scene.dispose === 'function') {
    const origDispose = scene.dispose.bind(scene);
    scene.dispose = function () {
      if (activeHost === hostEl) activeHost = null;
      origDispose();
    };
  }
  return scene;
}
