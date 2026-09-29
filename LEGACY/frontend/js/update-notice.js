'use strict';

  // ── Update notice ────────────────────────────────────────────────────────────
  // Shown when the optional update check (gui/internal/app/update_check.go) finds a
  // newer release: links to the exe and the release page, and how to switch over.
  const UpdateNotice = {
    isOpen: false,
    info: null,

    render(info) {
      const title = document.getElementById('update-title');
      if (title) title.textContent = I18n.t('update_notice.title').replace('{version}', info.latest);
      const versions = document.getElementById('update-versions');
      if (versions) versions.textContent = I18n.t('update_notice.versions').replace('{current}', info.current);
      const link = document.getElementById('update-release-link');
      if (link) link.href = info.releaseUrl || '#';
    },

    open(info) {
      const overlay = document.getElementById('update-modal');
      if (!overlay || !info || this.isOpen) return;
      this.isOpen = true;
      this.info = info;
      this.render(info);

      const skip = document.getElementById('update-skip');
      const later = document.getElementById('update-later');
      const download = document.getElementById('update-download');
      if (skip) skip.checked = false;

      setShown(overlay, true);
      overlay.offsetHeight; // reflow for the scale transition
      overlay.classList.add('visible');

      const close = () => {
        this.isOpen = false;
        overlay.classList.remove('visible');
        setTimeout(() => { setShown(overlay, false); }, 180);
        window.removeEventListener('keydown', onKey);
        later?.removeEventListener('click', close);
        download?.removeEventListener('click', onDownload);
        window.go?.app?.App?.CloseUpdateNotice(!!skip?.checked);
      };
      const onDownload = () => {
        const url = info.downloadUrl || info.releaseUrl;
        if (url && window.runtime?.BrowserOpenURL) window.runtime.BrowserOpenURL(url);
        close();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      };
      later?.addEventListener('click', close);
      download?.addEventListener('click', onDownload);
      window.addEventListener('keydown', onKey);
      download?.focus();
    },

    show(info) {
      // The check can finish while the translations are still loading.
      CemuNotice.whenI18nReady(() => this.open(info));
    },

    init() {
      if (this.initialized) return;
      this.initialized = true;
      const register = () => {
        if (!(window.runtime && typeof window.runtime.EventsOn === 'function')) return false;
        window.runtime.EventsOn('update:available', (info) => UpdateNotice.show(info));
        window.go?.app?.App?.PendingUpdate?.().then(info => {
          if (info) UpdateNotice.show(info);
        });
        return true;
      };
      if (!register()) {
        const interval = setInterval(() => { if (register()) clearInterval(interval); }, 40);
        setTimeout(() => clearInterval(interval), 10000);
      }
    },
  };

  UpdateNotice.init();
