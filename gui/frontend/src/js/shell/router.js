// Which screen the body shows. The header tabs open their screen and a second
// click goes back home; screens that are not moved over yet show "coming soon".

import { $, show, toggleClass, setText } from '../core/dom.js';
import { t, onLang } from '../core/i18n.js';

const SCREENS = ['connect', 'setup', 'soon'];
const TAB_TITLES = { settings: 'nav.settings', stats: 'nav.stats', docs: 'ui.docs' };
let tab = null;
const subs = [];

/** go('connect' | 'setup') or go('soon', 'settings'). */
export function go(screen, tabName = null) {
  for (const s of SCREENS) show($('screen-' + s), s === screen);
  tab = tabName;
  document.querySelectorAll('#nav .pg-tab').forEach((b) => toggleClass(b, 'is-active', b.dataset.tab === tab));
  if (screen === 'soon') {
    setText($('soon-title'), t(TAB_TITLES[tab]));
    show($('soon-settings'), tab === 'settings');
  }
  $('body').scrollTop = 0;
  for (const fn of subs) fn(screen);
}

export const onScreen = (fn) => subs.push(fn);

export function startRouter() {
  $('nav').addEventListener('click', (e) => {
    const b = e.target.closest('.pg-tab');
    if (!b) return;
    if (tab === b.dataset.tab) go('connect');
    else go('soon', b.dataset.tab);
  });
  onLang(() => { if (tab) setText($('soon-title'), t(TAB_TITLES[tab])); });
}
