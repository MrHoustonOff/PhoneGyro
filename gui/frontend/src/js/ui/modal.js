// Small dialogs on the design's modal sheet (pg-overlay + pg-modal): a title, a
// text and buttons. Built when opened, removed when closed; Esc and the scrim close.

import { esc } from '../core/dom.js';

/**
 * openModal({ title, text, check, actions: [{ label, kind: 'primary'|'danger'|'', onClick }] })
 * body: optional trusted HTML (locale text through md()) under the title.
 * check: optional label of a toggle ("remember my choice"); onClick(checked) gets its state.
 * Resolves with the chosen action's index, or -1 when dismissed.
 */
export function openModal({ title, text = '', body = '', check = '', actions = [] }) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'pg-overlay app-overlay';
    overlay.innerHTML = `<div class="pg-modal" role="dialog" aria-modal="true">
      <div class="pg-modal__head"><div><div class="pg-modal__title">${esc(title)}</div>${text ? `<div class="pg-modal__sub">${esc(text)}</div>` : ''}</div></div>
      ${body ? `<div class="pg-modal__body app-modal-text">${body}</div>` : ''}
      ${check ? `<div class="pg-modal__body"><label class="app-check"><span class="pg-toggle"><input type="checkbox"><span class="pg-toggle__track"></span></span>${esc(check)}</label></div>` : ''}
      <div class="pg-modal__foot">${actions.map((a, i) =>
        `<button type="button" class="pg-btn${a.kind ? ' pg-btn--' + a.kind : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
    const close = (i) => {
      removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (back && back.focus) back.focus();
      const box = overlay.querySelector('.app-check input');
      if (i >= 0 && actions[i].onClick) actions[i].onClick(!!(box && box.checked));
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
