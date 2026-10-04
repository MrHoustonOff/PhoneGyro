// Docs (design: ScreenDocs): the documentation in the current language. The
// outline is docs/SUMMARY.md (a nested list of links to name.ru.md; the page
// loaded is name.<lang>.md). Left: search and the pages; centre: one page as
// pg-prose; right: "On this page" from its "##" / "###" headings. Links work
// three ways: #heading (any page), name.ru.md#heading (as on GitHub) and http(s).

import { $, esc, setHTML, toggleClass } from '../core/dom.js';
import { openURL } from '../core/bridge.js';
import { t, getLang, onLang } from '../core/i18n.js';
import { render, slug } from '../core/markdown.js';
import { onScreen, go } from '../shell/router.js';

let outline = null;   // [{ depth, title, name }] from SUMMARY.md
let pages = [];       // [{ name, depth, title, parent, md, text, ids, state }] state: '' | 'fallback' | 'missing'
let loadedLang = '';
let loading = null;
let current = 0;
let query = '';

async function fetchText(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

function parseSummary(md) {
  const out = [];
  for (const line of md.replace(/\r/g, '').split('\n')) {
    const m = line.match(/^(\s*)[-*]\s+\[([^\]]+)\]\(([\w-]+)\.\w+\.md\)\s*$/);
    if (m) out.push({ depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2), title: m[2], name: m[3] });
  }
  return out;
}

// A page missing in the current language falls back to Russian, then to a stub.
async function loadPage(item, lang) {
  let md = await fetchText(`docs/${item.name}.${lang}.md`);
  let state = '';
  if (md == null && lang !== 'ru') { md = await fetchText(`docs/${item.name}.ru.md`); state = 'fallback'; }
  if (md == null) { md = ''; state = 'missing'; }
  md = md.replace(/\r/g, '');
  const h1 = md.match(/^# (.*)$/m);
  const title = h1 ? h1[1].trim() : item.title;
  if (!h1) md = `# ${title}\n\n${md}`;
  const ids = [...md.matchAll(/^#{1,4} (.*)$/gm)].map((m) => slug(m[1]));
  return { ...item, title, md, text: md.toLowerCase(), ids, state };
}

function load() {
  const lang = getLang() === 'en' ? 'en' : 'ru';
  if (lang === loadedLang) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    if (!outline) outline = parseSummary(await fetchText('docs/SUMMARY.md') || '');
    const keep = pages[current] && pages[current].name;
    pages = await Promise.all(outline.map((it) => loadPage(it, lang)));
    pages.forEach((p, i) => { p.parent = p.depth ? pages.slice(0, i).reverse().find((q) => q.depth < p.depth) : null; });
    loadedLang = lang;
    const k = pages.findIndex((p) => p.name === keep);
    current = k >= 0 ? k : Math.min(current, pages.length - 1);
    renderPage();
  })().finally(() => { loading = null; });
  return loading;
}

function renderNav() {
  const q = query.trim().toLowerCase();
  let n = 0;
  const items = pages.map((p, i) => {
    if (!p.depth) n++;
    if (q && !p.text.includes(q)) return '';
    return `<button type="button" class="pg-docnav__item${i === current ? ' is-active' : ''}" data-i="${i}" data-depth="${p.depth}"><span class="pg-docnav__num">${p.depth ? '' : n}</span><span>${esc(p.title)}</span></button>`;
  }).join('');
  setHTML($('docs-nav'), items || `<div class="pg-notice"><span>${esc(t('ui.docs_nothing'))}</span></div>`);
}

const CALLOUT = { NOTE: 'ui.callout_note', TIP: 'ui.callout_tip', IMPORTANT: 'ui.callout_important', WARNING: 'ui.callout_important', CAUTION: 'ui.callout_caution' };

function renderPage() {
  const s = pages[current];
  if (!s) { setHTML($('docs-prose'), `<div class="pg-notice"><span>${esc(t('ui.docs_nothing'))}</span></div>`); setHTML($('docs-toc'), ''); renderNav(); return; }
  const { html, headings } = render(s.md);
  const prose = $('docs-prose');
  const crumb = [t('ui.docs'), ...(s.parent ? [s.parent.title] : [])].map(esc).join(' / ');
  const note = s.state ? `<div class="pg-callout pg-callout--warn app-docs-note">${esc(t(s.state === 'missing' ? 'ui.docs_missing' : 'ui.docs_untranslated'))}</div>` : '';
  prose.innerHTML = `<div class="pg-overline app-docs-crumb">${crumb}</div>` + note + html;
  prose.querySelectorAll('[data-alert]').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', `<div class="pg-callout__title">${esc(t(CALLOUT[el.dataset.alert] || 'ui.callout_note'))}</div>`);
  });
  const q = query.trim();
  if (q.length > 1) mark(prose, q);   // design: matches highlighted in accent-soft
  const subs = headings.filter((h) => h.level === 2 || h.level === 3);
  setHTML($('docs-toc'), subs.length ? `<div class="pg-toc__title">${esc(t('ui.docs_on_page'))}</div>`
    + subs.map((h, i) => `<a href="#${esc(h.id)}" data-lvl="${h.level}"${i === 0 ? ' class="is-active"' : ''}>${esc(h.text)}</a>`).join('') : '');
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
  if (!el) return;
  // Walk up from the element to the article container, summing offsetTop.
  let top = 0;
  let node = el;
  while (node && node !== article) {
    top += node.offsetTop;
    node = node.offsetParent;
  }
  article.scrollTo({ top: Math.max(0, top - 16), behavior: 'smooth' });
}

// Shows page i, then scrolls to a heading on it (if given).
function show(i, id) {
  if (i < 0) return;
  if (i !== current) {
    current = i;
    renderPage(); // resets scrollTop=0 synchronously
    // Wait one frame for the DOM to settle, then scroll to the target.
    if (id) requestAnimationFrame(() => scrollToId(id));
    return;
  }
  if (id) scrollToId(id);
}

// A #link: the heading on this page, else on the first page that has it.
function jump(id) {
  const here = pages[current] && pages[current].ids.includes(id);
  show(here ? current : pages.findIndex((p) => p.ids.includes(id)), id);
}

// A link to another file: name.ru.md#heading, shown in the current language.
function jumpFile(name, id) {
  const i = pages.findIndex((p) => p.name === name);
  show(i, id && pages[i] && pages[i].ids.includes(id) ? id : '');
}

// "On this page": the last heading scrolled past the article's top is active.
function syncToc() {
  const top = $('docs-article').getBoundingClientRect().top + 64;
  let active = null;
  $('docs-prose').querySelectorAll('h2, h3').forEach((h) => { if (h.getBoundingClientRect().top <= top) active = h.id; });
  $('docs-toc').querySelectorAll('a').forEach((a, i) => toggleClass(a, 'is-active', active ? a.getAttribute('href') === '#' + active : i === 0));
}

/** Opens the guide scrolled to a heading (its slug), e.g. from a dialog that points at instructions. */
export async function openDocsAt(id) {
  go('docs');
  await load();
  jump(id);
}

export function startDocs() {
  $('docs-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    current = +b.dataset.i;
    renderPage();
  });
  $('docs-search').addEventListener('input', (e) => {
    query = e.target.value;
    const q = query.trim().toLowerCase();
    // The open section has no match: open the first one that has.
    if (q && pages[current] && !pages[current].text.includes(q)) {
      const i = pages.findIndex((p) => p.text.includes(q));
      if (i >= 0) current = i;
    }
    renderPage();
  });
  $('docs-gh').onclick = () => openURL('https://github.com/MrHoustonOff/PhoneGyro');
  $('screen-docs').addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    let m;
    if (href.startsWith('#')) jump(decodeURIComponent(href.slice(1)));
    else if (/^https?:/i.test(href)) openURL(href);
    else if ((m = href.match(/^([\w-]+)\.\w+\.md(?:#(.*))?$/))) jumpFile(m[1], m[2] ? decodeURIComponent(m[2]) : '');
    else return;
    e.preventDefault();
  });
  let raf = 0;
  $('docs-article').addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; syncToc(); }); }, { passive: true });
  onScreen((s) => { if (s === 'docs') load(); });
  onLang(() => { if (!$('screen-docs').hidden) load(); });
}
