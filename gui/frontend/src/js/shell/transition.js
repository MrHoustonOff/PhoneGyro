// Page transition engine: manages sequential fade transitions between screens
// and coordinates chrome (header/footer) fading based on screen requirements.
// Sequential fade: elementsOut fade to 0 -> state switches (DOM changes, callbacks,
// focus) -> elementsIn fade to 1.
// Supports rapid interruption: the newest navigation request takes precedence,
// smoothly continuing from whatever the current computed opacity is without visual
// jumping or stuck states. Respects prefers-reduced-motion.

let activeToken = 0;
let runningTransitions = 0;

export const SCREEN_CONFIG = {
  connect:     { chrome: { header: true,  footer: true  } },
  setup:       { chrome: { header: true,  footer: true  } },
  settings:    { chrome: { header: true,  footer: true  } },
  docs:        { chrome: { header: true,  footer: true  } },
  stats:       { chrome: { header: true,  footer: true  } },
  soon:        { chrome: { header: true,  footer: true  } },
  calibration: { chrome: { header: false, footer: false } },
};

export function getScreenChrome(screen) {
  return SCREEN_CONFIG[screen]?.chrome || { header: true, footer: true };
}

export function isTransitioning() {
  return runningTransitions > 0;
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function getComputedOpacity(el) {
  if (!el || el.hidden) return 0;
  const str = window.getComputedStyle(el).opacity;
  const num = parseFloat(str);
  return isNaN(num) ? 1 : num;
}

function animateOpacity(el, from, to, duration) {
  if (!el) return Promise.resolve();

  // Cancel any prior active animation on this element
  if (el._pgFadeAnim) {
    try { el._pgFadeAnim.cancel(); } catch (_) {}
    el._pgFadeAnim = null;
  }

  const dist = Math.abs(to - from);
  if (duration <= 0 || dist < 0.01) {
    el.style.opacity = to === 1 ? '' : String(to);
    el.style.willChange = '';
    return Promise.resolve();
  }

  // Adjust duration proportionally to the opacity distance
  const adjDuration = Math.round(duration * Math.min(1, Math.max(0.15, dist)));

  el.style.opacity = String(from);
  el.style.willChange = 'opacity';
  const anim = el.animate(
    [{ opacity: from }, { opacity: to }],
    { duration: adjDuration, easing: 'ease', fill: 'forwards' }
  );
  el._pgFadeAnim = anim;

  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      if (el._pgFadeAnim === anim) {
        el._pgFadeAnim = null;
      }
      try { anim.cancel(); } catch (_) {}
      el.style.opacity = to === 1 ? '' : String(to);
      el.style.willChange = '';
      resolve();
    };

    anim.finished.then(done, done);
    // Safety fallback timer in case tab is backgrounded or finished event doesn't fire
    setTimeout(done, adjDuration + 60);
  });
}

/**
 * Focuses a sensible primary element on the target screen.
 */
export function focusScreen(screenEl) {
  if (!screenEl) return;
  const candidate = screenEl.querySelector(
    '.pg-btn--primary:not([disabled]):not([hidden]), ' +
    'button:not([disabled]):not([hidden]):not(.pg-btn-icon), ' +
    'button:not([disabled]):not([hidden]), ' +
    'input:not([disabled]):not([hidden]), ' +
    '[tabindex="0"], ' +
    'h1, h2, .pg-modal__title, .display-lg'
  );
  if (candidate) {
    if (candidate.tabIndex < 0 && !candidate.matches('button, a, input, select, textarea')) {
      candidate.tabIndex = -1;
    }
    try {
      candidate.focus({ preventScroll: true });
    } catch (_) {}
  }
}

/**
 * Runs a sequential page transition.
 *
 * @param {Object} options
 * @param {HTMLElement[]} options.elementsOut - Elements to fade out
 * @param {HTMLElement[]} options.elementsIn - Elements to fade in
 * @param {Function} options.onSwitch - Called between fade-out and fade-in
 * @param {boolean} [options.instant=false] - Skip animations if true
 * @param {number} [options.outDuration=160] - Fade-out duration in ms
 * @param {number} [options.inDuration=210] - Fade-in duration in ms
 * @returns {Promise<void>}
 */
export async function runTransition({
  elementsOut = [],
  elementsIn = [],
  onSwitch,
  instant = false,
  outDuration = 160,
  inDuration = 210,
}) {
  const token = ++activeToken;
  runningTransitions++;

  const cleanUpElements = (els) => {
    for (const el of els) {
      if (el) {
        el.style.opacity = '';
        el.style.pointerEvents = '';
        el.inert = false;
        el.style.willChange = '';
      }
    }
  };

  if (instant || prefersReducedMotion()) {
    try {
      if (onSwitch) onSwitch();
    } finally {
      runningTransitions--;
      cleanUpElements([...elementsOut, ...elementsIn]);
    }
    return;
  }

  try {
    // 1. Disable inputs on transitioning elements
    for (const el of elementsOut) {
      if (el) {
        el.style.pointerEvents = 'none';
        el.inert = true;
      }
    }

    // 2. Phase 1: Fade out from current computed opacity down to 0
    await Promise.all(
      elementsOut.map((el) => {
        const from = getComputedOpacity(el);
        return animateOpacity(el, from, 0, outDuration);
      })
    );

    // If another transition was requested during fade-out, abort this sequence
    if (token !== activeToken) return;

    // Prepare incoming elements with initial opacity 0 and inert before onSwitch reveals them
    for (const el of elementsIn) {
      if (el) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        el.inert = true;
      }
    }

    // 3. Phase 2: Switch (DOM swap, callbacks, focus)
    if (onSwitch) onSwitch();

    if (token !== activeToken) return;

    // 4. Phase 3: Fade in from 0 (or current computed) to 1
    await Promise.all(
      elementsIn.map((el) => {
        const from = getComputedOpacity(el);
        return animateOpacity(el, from, 1, inDuration);
      })
    );

    // If another transition took over during fade-in, let it manage cleanup
    if (token !== activeToken) return;

    // 5. Final cleanup: restore interaction and clear inline styles
    cleanUpElements([...elementsOut, ...elementsIn]);
  } finally {
    runningTransitions--;
    if (runningTransitions === 0) {
      cleanUpElements([...elementsOut, ...elementsIn]);
    }
  }
}

/**
 * Coordinates fading of body, header, and footer based on screen chrome config.
 */
export async function transitionScreens({
  prevChrome = { header: true, footer: true },
  nextChrome = { header: true, footer: true },
  bodyEl,
  headerEl,
  footerEl,
  onSwitch,
  instant = false,
  outDuration = 160,
  inDuration = 210,
}) {
  const headerChanges = prevChrome.header !== nextChrome.header;
  const footerChanges = prevChrome.footer !== nextChrome.footer;

  const elementsOut = [bodyEl];
  if (headerChanges && prevChrome.header && headerEl) elementsOut.push(headerEl);
  if (footerChanges && prevChrome.footer && footerEl) elementsOut.push(footerEl);

  const elementsIn = [bodyEl];
  if (headerChanges && nextChrome.header && headerEl) elementsIn.push(headerEl);
  if (footerChanges && nextChrome.footer && footerEl) elementsIn.push(footerEl);

  return runTransition({
    elementsOut,
    elementsIn,
    onSwitch,
    instant,
    outDuration,
    inDuration,
  });
}
