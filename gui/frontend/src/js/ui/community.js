// The community window: asks, once or twice, for a star on GitHub. Go decides
// when (internal/community, app/community.go) and raises "community:prompt";
// the answer goes back with CommunityAnswer, which also spends the ask. Built on
// the modal sheet (pg-overlay + pg-modal) and the design's own pieces:
// pg-callout, pg-btn and pg-link.

import { on, call, openURL } from '../core/bridge.js';
import { esc } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { getCurrentScreen, onScreen } from '../shell/router.js';
import { queueNotice } from './notices.js';

const REPO = 'https://github.com/MrHoustonOff/PhoneGyro';
const STAR = '<svg class="app-comm__st" viewBox="0 0 24 24"><path d="M12 2.6l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.3 6 20.7l1.3-6.6-4.9-4.6 6.7-.8z" stroke-linejoin="round"/></svg>';
const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
// static rings of the hero: size (rem), opacity, entrance delay
const RINGS = [[9.375, 0.9, 0.05], [13.125, 0.6, 0.15], [18.125, 0.4, 0.25], [24.375, 0.22, 0.35]];
// screens where a game or a flow holds the user: the window waits until they leave
const BUSY = ['calibration', 'games', 'setup'];

let open = false;

function markup() {
  return `<section class="pg-modal app-comm" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="app-comm-title" aria-describedby="app-comm-sub">
    <button type="button" class="pg-btn-icon app-comm__x" data-a="later" aria-label="${esc(t('community.close'))}">${X}</button>
    <div class="app-comm__top" aria-hidden="true">
      ${RINGS.map(([s, o, d]) => `<span class="app-comm__ring" style="--s:${s}rem;--o:${o};--d:${d}s"></span>`).join('')}
      <span class="app-comm__dash"><b></b><b></b></span>
      <div class="app-comm__core">${STAR}<i></i><i></i><i></i></div>
    </div>
    <div class="app-comm__body">
      <h2 class="pg-modal__title app-comm__title" id="app-comm-title">${esc(t('community.title'))}</h2>
      <p class="pg-modal__sub app-comm__sub" id="app-comm-sub">${esc(t('community.sub'))}</p>
      <p class="pg-callout app-comm__main"><b>${esc(t('community.main_b'))}</b> ${esc(t('community.main'))}</p>
      <div class="app-comm__acts">
        <button type="button" class="pg-btn pg-btn--lg app-comm__star" data-a="star">${STAR}<span>${esc(t('community.star'))}</span></button>
        <button type="button" class="pg-btn pg-btn--lg app-comm__later" data-a="later">${esc(t('community.later'))}</button>
      </div>
      <button type="button" class="pg-link app-comm__never" data-a="never">${esc(t('community.never'))}</button>
    </div>
  </section>`;
}

// Resolves with the action once the window is gone.
function openWindow() {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'pg-overlay app-overlay app-comm-overlay';
    overlay.innerHTML = markup();
    const box = overlay.querySelector('.app-comm');
    let done = false;
    open = true;

    const close = (action, delay = 0) => {
      if (done) return;
      done = true;
      removeEventListener('keydown', onKey, true);
      setTimeout(() => {
        box.classList.add('is-out');
        setTimeout(() => {
          overlay.remove();
          open = false;
          if (back && back.focus) back.focus();
          resolve(action);
        }, 300);
      }, delay);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close('later'); return; }
      if (e.key !== 'Tab') return;
      const f = [...box.querySelectorAll('button')];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i < 0 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    };
    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || done) return;
      if (b.dataset.a === 'star') {
        box.classList.add('is-starred');
        openURL(REPO);
        close('star', 1100);
      } else close(b.dataset.a);
    });
    addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    box.focus({ preventScroll: true });
  });
}

// Waits while the user is calibrating, playing or in the setup wizard.
function whenFree() {
  return new Promise((resolve) => {
    if (!BUSY.includes(getCurrentScreen())) { resolve(); return; }
    onScreen((screen) => { if (!BUSY.includes(screen)) resolve(); });
  });
}

let asked = false; // the event and the Pending call can both come: one window

function prompt() {
  if (asked) return;
  asked = true;
  whenFree().then(() => queueNotice(() => openWindow().then((action) => { asked = false; return call('CommunityAnswer', action); })));
}

// The dev-build preview (Settings): the same window, nothing counted.
export function previewCommunity() {
  if (!open) openWindow();
}

export function startCommunity() {
  on('community:prompt', prompt);
  call('PendingCommunityPrompt').then((p) => p && prompt()).catch(() => {});
}
