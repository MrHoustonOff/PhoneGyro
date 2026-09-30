// Which screen the body shows. Header tabs open their screen and a second
// click goes back home; screens that are not moved over yet show "coming soon".
// Uses transitionScreens to execute smooth, sequential fade transitions without
// flickering, layout shifts, or stuck states.

import { $, show, toggleClass, setText } from '../core/dom.js';
import { t, onLang } from '../core/i18n.js';
import {
  transitionScreens,
  SCREEN_CONFIG,
  getScreenChrome,
  focusScreen,
  isTransitioning,
} from './transition.js';

const TAB_TITLES = { settings: 'nav.settings', stats: 'nav.stats', docs: 'ui.docs' };
let currentScreen = 'connect';
let tab = null;
const subs = [];

export const getCurrentScreen = () => currentScreen;
export const getCurrentTab = () => tab;

/**
 * Navigate to a screen with sequential fade transition.
 *
 * @param {string} screen - 'connect' | 'setup' | 'settings' | 'docs' | 'soon' | 'calibration'
 * @param {string|Object} [tabOrOpts=null] - Tab name (string) or options object
 * @param {Object} [maybeOpts={}] - Options if tab name was passed
 * @returns {Promise<void>}
 */
export function go(screen, tabOrOpts = null, maybeOpts = {}) {
  let tabName = null;
  let opts = {};
  if (tabOrOpts && typeof tabOrOpts === 'object') {
    opts = tabOrOpts;
    tabName = opts.tab ?? null;
  } else {
    tabName = tabOrOpts;
    opts = maybeOpts || {};
  }

  // If already on the screen and no transition is running, scroll to top and avoid redundant animation
  if (currentScreen === screen && tab === tabName && !isTransitioning() && !opts.force) {
    const bodyEl = $('body');
    if (bodyEl) bodyEl.scrollTop = 0;
    return Promise.resolve();
  }

  const prevScreen = currentScreen;
  const targetScreen = screen;
  const prevChrome = getScreenChrome(prevScreen);
  const nextChrome = getScreenChrome(targetScreen);

  const bodyEl = $('body');
  const headerEl = $('header');
  const footerEl = $('footer');
  const shellEl = $('shell');

  const onSwitch = () => {
    currentScreen = targetScreen;
    tab = tabName;

    // Show/hide screen elements
    const allScreens = new Set([
      ...Object.keys(SCREEN_CONFIG),
      'connect', 'setup', 'settings', 'docs', 'stats', 'soon', 'calibration', 'games',
    ]);
    for (const s of allScreens) {
      const el = $('screen-' + s);
      if (el) show(el, s === targetScreen);
    }

    // Toggle chrome shell class and header/footer elements
    if (shellEl) {
      toggleClass(shellEl, 'has-no-chrome', !nextChrome.header && !nextChrome.footer);
      toggleClass(shellEl, 'is-screen-stats', targetScreen === 'stats');
      toggleClass(shellEl, 'is-screen-games', targetScreen === 'games');
    }
    toggleClass(document.documentElement, 'is-calibrating', targetScreen === 'calibration');
    if (headerEl) show(headerEl, !!nextChrome.header);
    if (footerEl) show(footerEl, !!nextChrome.footer);

    // Navigation tabs & home button
    document.querySelectorAll('#nav .pg-tab').forEach((b) => {
      toggleClass(b, 'is-active', b.dataset.tab === tab);
    });
    const homeBtn = $('home');
    if (homeBtn) toggleClass(homeBtn, 'is-home', targetScreen === 'connect');

    if (targetScreen === 'soon') {
      setText($('soon-title'), t(TAB_TITLES[tab]));
    }

    if (bodyEl) bodyEl.scrollTop = 0;

    // Focus sensible candidate on the new screen
    const targetEl = $('screen-' + targetScreen);
    focusScreen(targetEl);

    // Call screen listeners between phases
    for (const fn of subs) {
      try { fn(targetScreen); } catch (err) { console.error('onScreen error:', err); }
    }
  };

  return transitionScreens({
    prevChrome,
    nextChrome,
    bodyEl,
    headerEl,
    footerEl,
    onSwitch,
    instant: opts.instant ?? false,
  });
}

export const onScreen = (fn) => subs.push(fn);

export function startRouter() {
  $('nav').addEventListener('click', (e) => {
    const b = e.target.closest('.pg-tab');
    if (!b) return;
    if (tab === b.dataset.tab) go('connect');
    else if (b.dataset.tab === 'settings' || b.dataset.tab === 'docs' || b.dataset.tab === 'stats') go(b.dataset.tab, b.dataset.tab);
    else go('soon', b.dataset.tab);
  });
  $('home').onclick = () => {
    if (currentScreen !== 'connect' || tab !== null) {
      go('connect');
    } else {
      const body = $('body');
      if (body) body.scrollTop = 0;
    }
  };
  toggleClass($('home'), 'is-home', true);
  onLang(() => { if (tab) setText($('soon-title'), t(TAB_TITLES[tab])); });
}
