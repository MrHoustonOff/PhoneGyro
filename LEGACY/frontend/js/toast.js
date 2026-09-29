'use strict';

  // ── Toast Utility ───────────────────────────────────────────────────────────
  function showToast(text) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2000);
  }
