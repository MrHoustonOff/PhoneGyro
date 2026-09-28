'use strict';

  // ── Process Resource Monitor (RAM) ─────────────────────────────────────────
  const ResourceMonitor = {
    lastStats: null,

    init() {
      // Listen for periodic updates from Go backend (resmon)
      if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('resource-stats', (stats) => {
          this.update(stats);
        });
      }

      // Initial query if available
      if (window.go?.main?.App?.GetResourceStats) {
        window.go.main.App.GetResourceStats().then((stats) => {
          if (stats && stats.ramMb > 0) {
            this.update(stats);
          }
        }).catch(() => {});
      }
    },

    update(stats) {
      if (!stats) return;
      this.lastStats = stats;

      const ramMb = typeof stats.ramMb === 'number' ? stats.ramMb : 0;
      const totalRamMb = typeof stats.totalRamMb === 'number' ? stats.totalRamMb : 0;
      const ramPct = typeof stats.ramPercent === 'number' ? stats.ramPercent : 0;

      // Update RAM text with integer MB
      const ramValEl = document.getElementById('footer-ram-val');
      const ramPctEl = document.getElementById('footer-ram-pct');
      const itemRam = document.getElementById('footer-metric-ram');

      const ramWholeMb = Math.round(ramMb);
      if (ramValEl) {
        ramValEl.textContent = `${ramWholeMb} MB`;
      }
      if (ramPctEl) {
        ramPctEl.textContent = '';
      }

      if (itemRam && totalRamMb > 0) {
        itemRam.title = `${ramWholeMb} MB / ${Math.round(totalRamMb)} MB`;
      }
    }
  };

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    ThemeManager.init();
    FontScaleManager.init();
    HeaderManager.init();
    if (typeof AppleSelect !== 'undefined') {
      AppleSelect.init();
    }

    let ready = false;
    let pollWails = null;
    let fallbackTimer = null;

    const startApp = async () => {
      if (ready) return;
      ready = true;
      if (pollWails) clearInterval(pollWails);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      HeaderManager.update();
      await I18n.init();
      initFooterVersion();
      ProfileManager.init();
      RecenterManager.init();
      SetupWizard.init();
      HelpManager.init();
      SettingsManager.init();
      AppleCloseDialog.init();
      if (typeof AppleSelect !== 'undefined') {
        AppleSelect.init();
      }
      WelcomeManager.init();
      CalibrationWizard.init();
      AppState.init();
      HeaderManager.update();
      if (typeof NetSparkline !== 'undefined') NetSparkline.render();
      ResourceMonitor.init();
      await WelcomeManager.checkFirstLaunch();
    };

    pollWails = setInterval(() => {
      if (window.go && window.go.main && window.go.main.App) {
        startApp();
      }
    }, 40);

    fallbackTimer = setTimeout(startApp, 1500);
  });
