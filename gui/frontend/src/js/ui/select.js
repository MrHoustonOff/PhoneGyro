// Dropdowns in the design's style. The native <select class="pg-select"> stays
// in the DOM as the value holder (its change event is what the screens listen
// to); a compact button shows the short value and opens a styled list.
// The short value is the option's text before " (" — "0.10°/s (Standard)" →
// "0.10°/s" — so long option names do not squeeze the row's label.

const CHEV = '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>';
let open = null; // { sel, btn, menu }

const shortText = (opt) => (opt ? opt.textContent.split(' (')[0] : '');

function close() {
  if (!open) return;
  open.menu.remove();
  open.btn.setAttribute('aria-expanded', 'false');
  open = null;
}

function openMenu(sel, btn) {
  close();
  const menu = document.createElement('div');
  menu.className = 'app-menu app-select__menu';
  menu.setAttribute('role', 'listbox');
  menu.innerHTML = [...sel.options].map((o) =>
    `<button type="button" class="app-menu__item${o.value === sel.value ? ' is-active' : ''}" role="option" data-value="${o.value}"></button>`).join('');
  [...menu.children].forEach((b, i) => { b.textContent = sel.options[i].textContent; });
  document.body.appendChild(menu);
  // Fixed to the viewport so no card clips it; opens upward when there is no room below.
  const r = btn.getBoundingClientRect();
  const w = Math.max(r.width, menu.offsetWidth);
  const h = menu.offsetHeight;
  const below = innerHeight - r.bottom - 8 >= h;
  menu.style.minWidth = r.width + 'px';
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  menu.style.top = (below ? r.bottom + 6 : r.top - h - 6) + 'px';
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-value]');
    if (!item) return;
    sel.value = item.dataset.value;
    btn.firstChild.textContent = shortText(sel.selectedOptions[0]);
    const full = sel.selectedOptions[0].textContent;
    btn.dataset.tip = full !== btn.firstChild.textContent ? full : '';
    close();
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  btn.setAttribute('aria-expanded', 'true');
  open = { sel, btn, menu };
  const active = menu.querySelector('.is-active');
  if (active) active.focus();
}

/** Puts a styled button in front of every native select under root. */
export function enhanceSelects(root) {
  root.querySelectorAll('select.pg-select:not([data-enh])').forEach((sel) => {
    sel.dataset.enh = '1';
    sel.hidden = true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pg-select app-select';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<span></span>${CHEV}`;
    btn.firstChild.textContent = shortText(sel.selectedOptions[0]);
    const full = sel.selectedOptions[0] && sel.selectedOptions[0].textContent;
    if (full && full !== btn.firstChild.textContent) btn.dataset.tip = full;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (open && open.btn === btn) close(); else openMenu(sel, btn);
    });
    sel.after(btn);
  });
}

export function startSelects() {
  document.addEventListener('click', (e) => { if (open && !open.menu.contains(e.target)) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // a scroll inside the open list (it scrolls its active item into view) must not close it
  addEventListener('scroll', (e) => { if (open && e.target instanceof Node && open.menu.contains(e.target)) return; close(); }, true);
  addEventListener('resize', close);
}
