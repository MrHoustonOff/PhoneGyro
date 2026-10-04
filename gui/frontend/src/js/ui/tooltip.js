// Tooltips in the design's style instead of the system's: any element with
// data-tip="…" (set directly, or from a string key through data-i18n-title,
// see core/i18n.js). One element for the whole app, one delegated listener.
// Multi-line text keeps its line breaks.

const DELAY = 280;   // ms before showing, like a native tooltip
let tip = null;
let target = null;
let timer = 0;

function place() {
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const gap = 8;
  let top = r.top - t.height - gap;
  if (top < 4) top = r.bottom + gap;                         // no room above: below
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(6, Math.min(innerWidth - t.width - 6, left));
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function show() {
  const text = target && target.dataset.tip;
  if (!text) return;
  tip.textContent = text;
  tip.hidden = false;
  place();
  tip.classList.add('is-on');
}

function hide() {
  clearTimeout(timer);
  target = null;
  if (tip) { tip.classList.remove('is-on'); tip.hidden = true; }
}

export function startTooltips() {
  tip = document.createElement('div');
  tip.className = 'app-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el === target) return;
    hide();
    if (!el || !el.dataset.tip) return;
    target = el;
    timer = setTimeout(show, DELAY);
  });
  document.addEventListener('mouseout', (e) => {
    if (target && !target.contains(e.relatedTarget)) hide();
  });
  addEventListener('mousedown', hide, true);
  addEventListener('scroll', hide, true);
  addEventListener('blur', hide);
}
