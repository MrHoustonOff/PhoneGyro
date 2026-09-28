'use strict';

  // ── Delete Profile Confirmation ────────────────────────────────────────────
  const ProfileDeleteDialog = {
    isOpen: false,
    show(slot, name) {
      if (this.isOpen) return;
      const overlay = document.getElementById('profile-delete-modal');
      const title = document.getElementById('profile-delete-title');
      const confirmBtn = document.getElementById('profile-delete-btn-confirm');
      const cancelBtn = document.getElementById('profile-delete-btn-cancel');
      if (!overlay) return;
      this.isOpen = true;

      if (window.I18n && typeof window.I18n.applyDOM === 'function') {
        window.I18n.applyDOM(overlay);
      }
      if (title) {
        title.textContent = (I18n.t('calibration.delete_profile_title') || 'Удалить профиль «{name}»?').replace('{name}', name);
      }

      overlay.style.display = 'flex';
      overlay.offsetHeight; // reflow for the scale-in transition
      overlay.classList.add('visible');

      const cleanup = () => {
        this.isOpen = false;
        overlay.classList.remove('visible');
        setTimeout(() => {
          overlay.style.display = 'none';
        }, 180);
        window.removeEventListener('keydown', onKey);
        confirmBtn?.removeEventListener('click', onConfirm);
        cancelBtn?.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
      };

      const onConfirm = async () => {
        cleanup();
        try {
          const res = await window.go?.main?.App?.DeleteProfile(slot);
          if (res !== 'ok') {
            console.error('Failed to delete profile:', res);
            return;
          }
          showToast((I18n.t('calibration.profile_deleted') || 'Профиль «{name}» удалён').replace('{name}', name));
        } catch (err) {
          console.error('Failed to delete profile:', err);
        }
      };
      const onCancel = () => cleanup();
      const onOverlay = (e) => {
        if (e.target === overlay) cleanup();
      };
      // Escape cancels; Enter is left to the focused button, which starts on Cancel,
      // so a stray Enter never deletes anything.
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
        }
      };

      confirmBtn?.addEventListener('click', onConfirm);
      cancelBtn?.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlay);
      window.addEventListener('keydown', onKey);

      cancelBtn?.focus();
    }
  };
