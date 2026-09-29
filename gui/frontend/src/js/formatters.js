'use strict';

  // ── Profile Slot Formatter ──────────────────────────────────────────────────
  // Fetched once: the version is fixed for the life of the running process.
  async function initFooterVersion() {
    const el = document.getElementById('footer-version');
    if (!el || !window.go?.app?.App?.GetAppVersion) return;
    try {
      const v = await window.go.app.App.GetAppVersion();
      el.innerHTML = `<span>${v.release}.${v.build}</span><span class="footer-version-channel ${v.channel}">${v.channel}</span>`;
      el.title = `PhoneGyro ${v.release} • build ${v.build} • ${v.channel}`;
    } catch (e) {
      setShown(el, false);
    }
  }

  function formatSlotName(idx) {
    const prefix = I18n.t('calibration.slot_prefix') || (I18n.currentLang === 'ru' ? 'Слот' : 'Slot');
    return `${prefix} ${idx + 1}`;
  }

  // When a profile was calibrated: { short: "29 Sept", full: "29 September 2026, 23:40 · v2.0.2…" },
  // or null for profiles saved before the date was kept. Neutral on purpose: a
  // calibration does not age, the date only tells profiles apart.
  function formatCalibrationDate(p) {
    if (!p || !p.calibratedAt) return null;
    const d = new Date(p.calibratedAt * 1000);
    const locale = I18n.currentLang === 'en' ? 'en-GB' : 'ru-RU';
    const thisYear = d.getFullYear() === new Date().getFullYear();
    const short = d.toLocaleDateString(locale, thisYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    const when = d.toLocaleString(locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const full = (I18n.t('calibration.calibrated_on_full') || 'Откалиброван {date}').replace('{date}', when)
      + (p.calibratedWith ? ` · ${(I18n.t('calibration.calibrated_with') || 'версия {version}').replace('{version}', p.calibratedWith)}` : '');
    return { short, full };
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
