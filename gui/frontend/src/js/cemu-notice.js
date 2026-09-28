'use strict';

  // ── Cemu notice ──────────────────────────────────────────────────────────────
  // Temporary, see gui/cemu_notice.go: shown every time a Cemu instance
  // subscribes (until "don't show again"), explains Cemu's gyro bias bug and the
  // drift guard that works around it.
  const CemuNotice = {
    isOpen: false,

    // Fills the parts that depend on the moment: the guard's state and the link.
    render(notice) {
      const state = document.getElementById('cemu-notice-state');
      if (state) {
        const on = notice.guardOn !== false;
        state.classList.toggle('is-off', !on);
        state.innerHTML = renderMarkdown(I18n.t(on ? 'cemu_notice.guard_on' : 'cemu_notice.guard_off'));
      }
      const pr = document.getElementById('cemu-notice-pr');
      if (pr) {
        pr.innerHTML = notice.prUrl
          ? renderMarkdown(I18n.t('cemu_notice.pr').replace('{url}', notice.prUrl))
          : renderMarkdown(I18n.t('cemu_notice.pr_none'));
      }
    },

    // whenI18nReady runs fn once the translations are loaded: Cemu usually
    // subscribes while the window is still starting.
    whenI18nReady(fn) {
      const ready = () => I18n.dictionary && Object.keys(I18n.dictionary).length > 0;
      if (ready()) return fn();
      let tries = 0;
      const timer = setInterval(() => {
        if (ready() || ++tries > 200) {
          clearInterval(timer);
          fn();
        }
      }, 50);
    },

    show(notice) {
      this.whenI18nReady(() => this.open(notice));
    },

    open(notice) {
      const overlay = document.getElementById('cemu-notice-modal');
      if (!overlay || !notice) return;
      this.render(notice);
      if (this.isOpen) return; // another Cemu instance: the open notice is refreshed
      this.isOpen = true;

      const hide = document.getElementById('cemu-notice-hide');
      const closeBtn = document.getElementById('cemu-notice-close');
      if (hide) hide.checked = false;

      overlay.style.display = 'flex';
      overlay.offsetHeight; // reflow for the scale transition
      overlay.classList.add('visible');

      const close = () => {
        this.isOpen = false;
        overlay.classList.remove('visible');
        setTimeout(() => { overlay.style.display = 'none'; }, 180);
        window.removeEventListener('keydown', onKey);
        closeBtn?.removeEventListener('click', close);
        window.go?.main?.App?.CloseCemuNotice(!!hide?.checked);
      };
      const onKey = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          close();
        }
      };
      closeBtn?.addEventListener('click', close);
      window.addEventListener('keydown', onKey);
      closeBtn?.focus();
    },

    init() {
      if (this.initialized) return;
      this.initialized = true;
      const register = () => {
        if (!(window.runtime && typeof window.runtime.EventsOn === 'function')) return false;
        window.runtime.EventsOn('cemu:notice', (notice) => CemuNotice.show(notice));
        // Cemu usually subscribes before the window has loaded.
        window.go?.main?.App?.PendingCemuNotice?.().then(notice => {
          if (notice) CemuNotice.show(notice);
        });
        return true;
      };
      if (!register()) {
        const interval = setInterval(() => { if (register()) clearInterval(interval); }, 40);
        setTimeout(() => clearInterval(interval), 10000);
      }
    },
  };

  CemuNotice.init();
