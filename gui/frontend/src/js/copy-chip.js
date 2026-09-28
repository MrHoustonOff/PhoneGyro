'use strict';

  // ── Universal Copy Chip Helper ──────────────────────────────────────────────
  function setupCopyChip(chipId, badgeId, getUrlFn) {
    const chip = document.getElementById(chipId);
    const badge = document.getElementById(badgeId);
    if (!chip || !badge) return;

    chip.addEventListener('click', async () => {
      const url = getUrlFn();
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        const prevKey = badge.getAttribute('data-i18n') || 'qr.copy';
        badge.textContent = I18n.t('qr.copied');
        badge.classList.add('copied');
        clearTimeout(badge._timer);
        badge._timer = setTimeout(() => {
          badge.textContent = I18n.t(prevKey);
          badge.classList.remove('copied');
        }, 1600);
      } catch (e) {
        console.error('Clipboard copy failed:', e);
      }
    });
  }
