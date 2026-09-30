// One short message at the bottom centre (#toast), replaced by the next one.

import { $ } from '../core/dom.js';

let timer = 0;

export function toast(text, ms = 2200) {
  const el = $('toast');
  if (!el || !text) return;
  el.textContent = text;
  if (el.hidden) {
    el.classList.add('is-off');
    el.hidden = false;
    el.offsetWidth; // start the transition from the hidden pose
  }
  el.classList.remove('is-off');
  clearTimeout(timer);
  timer = setTimeout(() => {
    el.classList.add('is-off');
    timer = setTimeout(() => { el.hidden = true; }, 200);
  }, ms);
}
