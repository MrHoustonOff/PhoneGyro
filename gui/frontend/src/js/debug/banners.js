// ── DEV-only: Banner Trigger Panel ──────────────────────────────────────────
// Appears only in non-release builds (channel !== 'release').
// Renders a floating panel in the bottom-right corner with one button per
// banner/notice so you can fire them on-demand without real device events.
//
// Banners covered:
//   1. hint-recal    — «Устройство требует калибровки» (stillness + off-centre)
//   2. hint-new      — «Новое устройство, нет профилей» (first connect, no profiles)
//   3. setup screen  — «Первый запуск / Начальная настройка» (ScreenSetup)
//   4. update modal  — «Вышло обновление» (notices.js)
//   5. cemu modal    — «Подключён Cemu» (notices.js)
//   6. firewall modal — «Брандмауэр заблокировал» (notices.js)

import { go } from '../shell/router.js';
import { toggleClass } from '../core/dom.js';
import { call } from '../core/bridge.js';
import { cemu, firewall, update } from '../ui/notices.js';
import { debugHints } from '../screens/connect/cal-hints.js';

// The dialogs are the app's real ones (ui/notices.js, screens/connect/cal-hints.js),
// fed with made-up payloads, so what you see here is what the user sees.

const showCemu = () => cemu({ guardOn: true, prUrl: 'https://github.com/cemu-project/Cemu/pull/1' });
const showFirewall = () => firewall({ network: 'public' });
async function showUpdate() {
  const v = await call('GetAppVersion');
  const releaseUrl = 'https://github.com/MrHoustonOff/PhoneGyro/releases';
  update({ current: (v && v.release) || '2.0.0', latest: '9.9.0', releaseUrl, downloadUrl: releaseUrl });
}
const showRecal = () => debugHints.recal();
const showNew = () => debugHints.newDevice();
const showSetup = () => go('setup');

// ── Panel builder ─────────────────────────────────────────────────────────────

const BTN_ROWS = [
  { id: 'dbg-recal',    label: '🔧 Калибровка (мягкая)',      fn: showRecal,    title: 'hint-recal: stillness + off-centre banner' },
  { id: 'dbg-new',      label: '🆕 Новое устройство',          fn: showNew,      title: 'hint-new: urgent first-connect banner (нет профилей)' },
  { id: 'dbg-setup',    label: '🚀 Первый запуск',             fn: showSetup,    title: 'ScreenSetup: initial setup wizard' },
  { id: 'dbg-update',   label: '🔄 Вышло обновление',          fn: showUpdate,   title: 'update:available modal' },
  { id: 'dbg-cemu',     label: '🎮 Подключён Cemu',            fn: showCemu,     title: 'cemu:notice modal' },
  { id: 'dbg-firewall', label: '🔥 Брандмауэр заблокировал',  fn: showFirewall, title: 'firewall:alert modal (network=public)' },
];

let panelEl = null;
let isOpen = false;

function buildPanel() {
  const style = document.createElement('style');
  style.textContent = `
    #dbg-banner-panel {
      position: fixed;
      bottom: 2.75rem;
      right: 0.5rem;
      z-index: 9999;
      background: var(--surface-2, #1a1a2e);
      border: 1px solid var(--line-subtle, #333);
      border-radius: 0.625rem;
      box-shadow: 0 4px 24px rgba(0,0,0,0.55);
      width: 14rem;
      font-family: inherit;
      overflow: hidden;
      transition: opacity 0.15s, transform 0.15s;
    }
    #dbg-banner-panel.is-hidden {
      opacity: 0;
      transform: translateY(0.5rem) scale(0.96);
      pointer-events: none;
    }
    .dbg-bp__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.375rem 0.625rem;
      border-bottom: 1px solid var(--line-subtle, #333);
      background: color-mix(in srgb, var(--accent, #f59e0b) 12%, transparent);
    }
    .dbg-bp__title {
      font-weight: 600;
      color: var(--accent, #f59e0b);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-size: 0.6875rem;
    }
    .dbg-bp__close {
      background: none;
      border: none;
      color: var(--ink-3, #888);
      cursor: pointer;
      font-size: 0.75rem;
      padding: 0 0.125rem;
      line-height: 1;
    }
    .dbg-bp__close:hover { color: var(--ink-1, #fff); }
    .dbg-bp__list {
      display: flex;
      flex-direction: column;
      padding: 0.25rem 0;
    }
    .dbg-bp__btn {
      display: block;
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      padding: 0.3125rem 0.625rem;
      color: var(--ink-1, #f0f0f0);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.75rem;
      transition: background 0.1s;
    }
    .dbg-bp__btn:hover { background: rgba(255,255,255,0.07); }
    .dbg-bp__btn:active { background: rgba(255,255,255,0.13); }
    #dbg-banner-toggle.is-dbg-active { color: var(--accent, #f59e0b); }
  `;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'dbg-banner-panel';
  el.setAttribute('aria-label', 'DEV: Banner Triggers');
  el.innerHTML = `
    <div class="dbg-bp__head">
      <span class="dbg-bp__title">DEV Banners</span>
      <button class="dbg-bp__close" id="dbg-bp-close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="dbg-bp__list">
      ${BTN_ROWS.map((r) => `
        <button class="dbg-bp__btn" data-dbg="${r.id}" type="button" title="${r.title}">
          ${r.label}
        </button>`).join('')}
    </div>`;
  document.body.appendChild(el);
  return el;
}

// ── Toggle helpers ────────────────────────────────────────────────────────────

function openPanel() {
  isOpen = true;
  toggleClass(panelEl, 'is-hidden', false);
  const btn = document.getElementById('dbg-banner-toggle');
  if (btn) btn.classList.add('is-dbg-active');
}

function closePanel() {
  isOpen = false;
  toggleClass(panelEl, 'is-hidden', true);
  const btn = document.getElementById('dbg-banner-toggle');
  if (btn) btn.classList.remove('is-dbg-active');
}

// ── Public init ───────────────────────────────────────────────────────────────

export function startBannerTriggers() {
  panelEl = buildPanel();
  toggleClass(panelEl, 'is-hidden', true); // start closed

  // Close button inside panel.
  document.getElementById('dbg-bp-close').onclick = closePanel;

  // Delegate banner buttons.
  panelEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dbg]');
    if (!btn) return;
    const row = BTN_ROWS.find((r) => r.id === btn.dataset.dbg);
    if (row && row.fn) row.fn();
  });

  // Wire footer toggle button (rendered in index.html).
  const toggleBtn = document.getElementById('dbg-banner-toggle');
  if (toggleBtn) {
    toggleBtn.onclick = () => (isOpen ? closePanel() : openPanel());
  }
}
