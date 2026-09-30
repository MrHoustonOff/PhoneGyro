// Small dialogs on the design's modal sheet (pg-overlay + pg-modal): a title, a
// text and buttons. Built when opened, removed when closed; Esc and the scrim close.

import { esc } from '../core/dom.js';

/**
 * openModal({ title, text, actions: [{ label, kind: 'primary'|'danger'|'', onClick }] })
 * Resolves with the chosen action's index, or -1 when dismissed.
 */
export function openModal({ title, text = '', actions = [] }) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'pg-overlay app-overlay';
    overlay.innerHTML = `<div class="pg-modal" role="dialog" aria-modal="true">
      <div class="pg-modal__head"><div><div class="pg-modal__title">${esc(title)}</div>${text ? `<div class="pg-modal__sub">${esc(text)}</div>` : ''}</div></div>
      <div class="pg-modal__foot">${actions.map((a, i) =>
        `<button type="button" class="pg-btn${a.kind ? ' pg-btn--' + a.kind : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
    const close = (i) => {
      removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (back && back.focus) back.focus();
      if (i >= 0 && actions[i].onClick) actions[i].onClick();
      resolve(i);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(-1); } };
    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) close(+b.dataset.i);
      else if (e.target === overlay) close(-1);
    });
    addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    const last = overlay.querySelector('button[data-i]:last-child');
    if (last) last.focus();
  });
}
