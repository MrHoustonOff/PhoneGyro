'use strict';

  // ── Authentic Apple HIG Close/Minimize Dialog ──────────────────────────────
  const AppleCloseDialog = {
    isOpen: false,
    show() {
      if (this.isOpen) return;
      const overlay = document.getElementById('apple-close-modal');
      const rememberCheckbox = document.getElementById('apple-close-remember');
      const minBtn = document.getElementById('apple-close-btn-minimize');
      const quitBtn = document.getElementById('apple-close-btn-quit');
      const cancelBtn = document.getElementById('apple-close-btn-cancel');

      if (!overlay) return;
      this.isOpen = true;

      if (window.I18n && typeof window.I18n.applyDOM === 'function') {
        window.I18n.applyDOM(overlay);
      }

      if (rememberCheckbox) rememberCheckbox.checked = false;

      overlay.style.display = 'flex';
      overlay.offsetHeight; // reflow for smooth Apple scale transition
      overlay.classList.add('visible');

      const cleanup = () => {
        this.isOpen = false;
        overlay.classList.remove('visible');
        setTimeout(() => {
          overlay.style.display = 'none';
        }, 180);
        window.removeEventListener('keydown', onKey);
        minBtn?.removeEventListener('click', onMin);
        quitBtn?.removeEventListener('click', onQuit);
        cancelBtn?.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
      };

      const onMin = async () => {
        const remember = !!rememberCheckbox?.checked;
        cleanup();
        if (remember) {
          const sel = document.getElementById('setting-close-action');
          if (sel) sel.value = 'minimize';
        }
        if (window.go?.app?.App?.ConfirmCloseChoice) {
          await window.go.app.App.ConfirmCloseChoice('minimize', remember);
        }
      };

      const onQuit = async () => {
        const remember = !!rememberCheckbox?.checked;
        cleanup();
        if (remember) {
          const sel = document.getElementById('setting-close-action');
          if (sel) sel.value = 'quit';
        }
        if (window.go?.app?.App?.ConfirmCloseChoice) {
          await window.go.app.App.ConfirmCloseChoice('quit', remember);
        }
      };

      const onCancel = () => cleanup();

      const onOverlay = (e) => {
        if (e.target === overlay) cleanup();
      };

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onMin();
        }
      };

      minBtn?.addEventListener('click', onMin);
      quitBtn?.addEventListener('click', onQuit);
      cancelBtn?.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlay);
      window.addEventListener('keydown', onKey);

      minBtn?.focus();
    },

    init() {
      if (this.initialized) return;
      this.initialized = true;

      const register = () => {
        if (window.runtime && typeof window.runtime.EventsOn === 'function') {
          window.runtime.EventsOn('app:confirm-close', () => {
            AppleCloseDialog.show();
          });
          return true;
        }
        return false;
      };

      if (!register()) {
        const interval = setInterval(() => {
          if (register()) {
            clearInterval(interval);
          }
        }, 40);
        setTimeout(() => clearInterval(interval), 10000);
      }
    }
  };

  AppleCloseDialog.init();
