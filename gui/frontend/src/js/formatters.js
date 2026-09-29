'use strict';

  // ── Profile Slot Formatter ──────────────────────────────────────────────────
  // Fetched once: the version is fixed for the life of the running process.
  async function initFooterVersion() {
    const el = document.getElementById('footer-version');
    if (!el || !window.go?.main?.App?.GetAppVersion) return;
    try {
      const v = await window.go.app.App.GetAppVersion();
      el.innerHTML = `<span>${v.release}.${v.build}</span><span class="footer-version-channel ${v.channel}">${v.channel}</span>`;
      el.title = `PhoneGyro ${v.release} • build ${v.build} • ${v.channel}`;
    } catch (e) {
      el.style.display = 'none';
    }
  }

  function formatSlotName(idx) {
    const prefix = I18n.t('calibration.slot_prefix') || (I18n.currentLang === 'ru' ? 'Слот' : 'Slot');
    return `${prefix} ${idx + 1}`;
  }

  // Reads a signed-permutation 3x3 matrix (calibration matrix or accelerometer axis
  // map) as three "which raw axis, which sign" labels — same explicit reading for
  // both, no separate logic per matrix kind (§3: show what's actually stored).
  function matrixAxisLabels(m) {
    const axes = ['X', 'Y', 'Z'];
    return [0, 1, 2].map((row) => {
      for (let c = 0; c < 3; c++) {
        if (m[row][c] > 0.5) return `+${axes[c]}`;
        if (m[row][c] < -0.5) return `-${axes[c]}`;
      }
      return '?';
    });
  }
