// Copy buttons: <button data-copy="id-of-the-element-with-the-text">. One
// delegated listener for all of them; the button turns green for a moment.

import { $ } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { toast } from './toast.js';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // WebView2 can refuse the async clipboard without focus: the old way.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function startCopy() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const src = $(btn.dataset.copy);
    const text = src && src.textContent.trim();
    if (!text || text === '…') return;
    await copyText(text);
    btn.classList.add('is-copied');
    clearTimeout(btn._copyT);
    btn._copyT = setTimeout(() => btn.classList.remove('is-copied'), 1400);
    toast(t('qr.copied'));
  });
}
