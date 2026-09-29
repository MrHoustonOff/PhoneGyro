'use strict';

  // ── Authentic Apple HIG Confirmation Modal ──────────────────────────────────
  function showAppleConfirm({ title, message, okText, cancelText }) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('apple-confirm-modal');
      const titleEl = document.getElementById('apple-confirm-title');
      const msgEl = document.getElementById('apple-confirm-message');
      const okBtn = document.getElementById('apple-confirm-ok');
      const cancelBtn = document.getElementById('apple-confirm-cancel');

      if (!overlay || !okBtn || !cancelBtn) {
        resolve(true);
        return;
      }

      if (titleEl) titleEl.textContent = title || '';
      if (msgEl) msgEl.textContent = message || '';
      if (okText) okBtn.textContent = okText;
      if (cancelText) cancelBtn.textContent = cancelText;

      setShown(overlay, true);
      overlay.offsetHeight; // force reflow for smooth scale & opacity
      overlay.classList.add('visible');

      const cleanup = (result) => {
        overlay.classList.remove('visible');
        setTimeout(() => {
          setShown(overlay, false);
        }, 180);
        window.removeEventListener('keydown', onKey);
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
        resolve(result);
      };

      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onOverlay = (e) => {
        if (e.target === overlay) cleanup(false);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') cleanup(false);
        else if (e.key === 'Enter') cleanup(true);
      };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlay);
      window.addEventListener('keydown', onKey);
    });
  }
