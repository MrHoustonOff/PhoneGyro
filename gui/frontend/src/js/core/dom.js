// DOM writes that skip no-op changes: the state arrives 15 times a second and
// most of it does not change, so nothing is written (or re-laid out) needlessly.

export const $ = (id) => document.getElementById(id);

export function setText(el, value) {
  const v = value == null ? '' : String(value);
  if (el.textContent !== v) el.textContent = v;
}

export function setHTML(el, html) {
  if (el._html !== html) { el._html = html; el.innerHTML = html; }
}

export function show(el, on) {
  if (el.hidden === !!on) el.hidden = !on;
}

export function toggleClass(el, name, on) {
  if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
}

export function setAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function setVar(el, name, value) {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** The locale strings' markup: `code` and **bold**, everything else escaped. */
export const md = (s) => esc(s).replace(/`([^`]+)`/g, '<span class="pg-code">$1</span>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
