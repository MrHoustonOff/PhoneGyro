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
      if (window.go?.app?.App?.GetResourceStats) {
        window.go.app.App.GetResourceStats().then((stats) => {
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
