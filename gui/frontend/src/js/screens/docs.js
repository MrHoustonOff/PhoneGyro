// Docs (design: ScreenDocs): the user guide in the current language, one "##"
// section at a time. Left: search and the sections; centre: the section as
// pg-prose; right: "On this page" from its "###" headings. The guide's own
// #links jump to the section holding that heading.

import { $, esc, setHTML, toggleClass } from '../core/dom.js';
import { openURL } from '../core/bridge.js';
import { t, getLang, onLang } from '../core/i18n.js';
import { render, slug } from '../core/markdown.js';
import { onScreen } from '../shell/router.js';

let sections = [];   // [{ title, id, md, text, ids }]
let loadedLang = '';
let current = 0;
let query = '';

// Split the guide at "## " headings. The intro (before the first one) joins the
// first section; the hand-made table of contents is dropped (the nav is it).
function split(md) {
  const parts = md.replace(/\r/g, '').split(/^(?=## )/m);
  const intro = parts.shift().replace(/^# .*$/m, '').trim();
  const out = [];
  for (const p of parts) {
    const title = p.match(/^## (.*)$/m)[1].trim();
    if (/^(Содержание|Contents|Table of contents)$/i.test(title)) continue;
    const ids = [...p.matchAll(/^#{2,4} (.*)$/gm)].map((m) => slug(m[1]));
    out.push({ title, id: slug(title), md: p, text: p.toLowerCase(), ids });
  }
  if (out.length && intro) out[0].md = out[0].md.replace(/^(## .*\n)/, `$1\n${intro}\n\n`);
  return out;
}

async function load() {
  const lang = getLang() === 'en' ? 'en' : 'ru';
  if (lang === loadedLang) return;
  const res = await fetch(`docs/guide.${lang}.md`);
  sections = split(await res.text());
  loadedLang = lang;
  current = Math.min(current, sections.length - 1);
  renderSection();
}

function renderNav() {
  const q = query.trim().toLowerCase();
  const items = sections.map((s, i) => (q && !s.text.includes(q) ? '' :
    `<button type="button" class="pg-docnav__item${i === current ? ' is-active' : ''}" data-i="${i}"><span class="pg-docnav__num">${i + 1}</span><span>${esc(s.title.replace(/^(Шаг|Step) \d+\.\s*/, ''))}</span></button>`)).join('');
  setHTML($('docs-nav'), items || `<div class="pg-notice"><span>${esc(t('ui.docs_nothing'))}</span></div>`);
}

const CALLOUT = { NOTE: 'ui.callout_note', TIP: 'ui.callout_tip', IMPORTANT: 'ui.callout_important', WARNING: 'ui.callout_important', CAUTION: 'ui.callout_caution' };

function renderSection() {
  const s = sections[current];
  if (!s) return;
  const { html, headings } = render(s.md);
  const prose = $('docs-prose');
  prose.innerHTML = `<div class="pg-overline app-docs-crumb">${esc(t('ui.docs'))} / ${current + 1}</div>` + html;
  prose.querySelectorAll('[data-alert]').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', `<div class="pg-callout__title">${esc(t(CALLOUT[el.dataset.alert] || 'ui.callout_note'))}</div>`);
  });
  const q = query.trim();
  if (q.length > 1) mark(prose, q);   // design: matches highlighted in accent-soft
  const subs = headings.filter((h) => h.level === 3);
  setHTML($('docs-toc'), subs.length ? `<div class="pg-toc__title">${esc(t('ui.docs_on_page'))}</div>`
    + subs.map((h, i) => `<a href="#${esc(h.id)}"${i === 0 ? ' class="is-active"' : ''}>${esc(h.text)}</a>`).join('') : '');
  $('docs-article').scrollTop = 0;
  renderNav();
}

function mark(root, q) {
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walk.nextNode()) { re.lastIndex = 0; if (re.test(walk.currentNode.nodeValue)) hits.push(walk.currentNode); }
  for (const n of hits) {
    const span = document.createElement('span');
    span.innerHTML = esc(n.nodeValue).replace(re, (m) => `<mark class="app-hit">${m}</mark>`);
    n.replaceWith(...span.childNodes);
  }
}

// Scroll to a heading inside docs-article by measuring its offsetTop
// relative to the scrollable container. scrollIntoView is unreliable in
// WebView2 when the target is inside an overflow:auto container — it scrolls
// the viewport instead, which yanks the window to the top.
function scrollToId(id) {
  const article = $('docs-article');
  const el = document.getElementById(id);
  if (!el || el.tagName === 'H2') return;
  // Walk up from the element to the article container, summing offsetTop.
  let top = 0;
  let node = el;
  while (node && node !== article) {
    top += node.offsetTop;
    node = node.offsetParent;
  }
  article.scrollTo({ top: Math.max(0, top - 16), behavior: 'smooth' });
}

// A #link: the section holding that heading, scrolled to it.
function jump(id) {
  const i = sections.findIndex((s) => s.ids.includes(id));
  if (i < 0) return;
  if (i !== current) {
    current = i;
    renderSection(); // resets scrollTop=0 synchronously
    // Wait one frame for the DOM to settle, then scroll to the target.
    requestAnimationFrame(() => scrollToId(id));
    return;
  }
  scrollToId(id);
}

// "On this page": the last heading scrolled past the article's top is active.
function syncToc() {
  const top = $('docs-article').getBoundingClientRect().top + 64;
  let active = null;
  $('docs-prose').querySelectorAll('h3').forEach((h) => { if (h.getBoundingClientRect().top <= top) active = h.id; });
  $('docs-toc').querySelectorAll('a').forEach((a, i) => toggleClass(a, 'is-active', active ? a.getAttribute('href') === '#' + active : i === 0));
}

export function startDocs() {
  $('docs-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    current = +b.dataset.i;
    renderSection();
  });
  $('docs-search').addEventListener('input', (e) => {
    query = e.target.value;
    const q = query.trim().toLowerCase();
    // The open section has no match: open the first one that has.
    if (q && sections[current] && !sections[current].text.includes(q)) {
      const i = sections.findIndex((s) => s.text.includes(q));
      if (i >= 0) current = i;
    }
    renderSection();
  });
  $('docs-gh').onclick = () => openURL('https://github.com/MrHoustonOff/PhoneGyro');
  $('screen-docs').addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    jump(decodeURIComponent(a.getAttribute('href').slice(1)));
  });
  let raf = 0;
  $('docs-article').addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; syncToc(); }); }, { passive: true });
  onScreen((s) => { if (s === 'docs') load(); });
  onLang(() => { if (!$('screen-docs').hidden) load(); });
}
