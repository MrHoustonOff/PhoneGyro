// Strings come from pkg/i18n (the same files the phone page and the backend use).
// Markup marks what it shows: data-i18n (text), data-i18n-title (tooltip, ui/tooltip.js),
// data-md (text with `code` and **bold**).

import { call, on } from './bridge.js';
import { setText, setHTML, md } from './dom.js';

let dict = {};
let lang = 'ru';
const subs = [];

/** t('status.online') or t('ui.slot_active', { n: 2 }); a missing key returns ''. */
export function t(key, vars) {
  let v = dict;
  for (const part of key.split('.')) v = v && v[part];
  if (typeof v !== 'string') return '';
  if (vars) for (const k in vars) v = v.split('{' + k + '}').join(vars[k]).replace('%d', vars[k]);
  return v;
}

export const getLang = () => lang;
export const onLang = (fn) => subs.push(fn);

export function apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { const v = t(el.dataset.i18n); if (v) setText(el, v); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.dataset.tip = t(el.dataset.i18nTitle); }); // ui/tooltip.js
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-md]').forEach((el) => setHTML(el, md(t(el.dataset.md))));
}

export async function load(next) {
  const raw = await call('GetTranslations', next);
  dict = JSON.parse(raw || '{}');
  lang = next;
  document.documentElement.lang = next;
  apply();
  for (const fn of subs) fn(next);
}

/** Switches the language here and in Go (which tells the phone page). */
export function setLang(next) {
  if (next === lang) return;
  call('SetLang', next);
  load(next);
}

export async function startI18n() {
  on('lang-sync', (l) => { if (l && l !== lang) load(l); });
  await load((await call('GetLang')) || 'ru');
}
