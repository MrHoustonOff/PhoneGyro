'use strict';

  // ── Apple Theme Manager ─────────────────────────────────────────────────────
  const ThemeManager = {
    theme: localStorage.getItem('gb_theme') || 'dark',

    init() {
      this.apply(this.theme, true);
      document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
        this.toggle();
      });

      if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('theme-sync', (newTheme) => {
          if (newTheme && this.theme !== newTheme) {
            this.theme = newTheme;
            localStorage.setItem('gb_theme', newTheme);
            this.apply(newTheme, false);
          }
        });
      }
    },

    toggle() {
      this.theme = (this.theme === 'dark') ? 'light' : 'dark';
      localStorage.setItem('gb_theme', this.theme);
      this.apply(this.theme, true);
    },

    apply(theme, broadcast = true) {
      document.documentElement.setAttribute('data-theme', theme);
      const sunIcon = document.getElementById('icon-theme-sun');
      const moonIcon = document.getElementById('icon-theme-moon');

      if (theme === 'dark') {
        if (sunIcon) sunIcon.style.display = 'block';
        if (moonIcon) moonIcon.style.display = 'none';
      } else {
        if (sunIcon) sunIcon.style.display = 'none';
        if (moonIcon) moonIcon.style.display = 'block';
      }

      if (typeof Scene3D !== 'undefined' && Scene3D.updateTheme) {
        Scene3D.updateTheme(theme);
      }
      if (typeof PlatformGame !== 'undefined' && PlatformGame.updateTheme) {
        PlatformGame.updateTheme(theme);
      }
      if (typeof NetSparkline !== 'undefined' && NetSparkline.render) {
        NetSparkline.render();
      }
      if (typeof TuningBench !== 'undefined' && TuningBench.drawOscilloscope && TuningBench.active) {
        TuningBench.drawOscilloscope();
      }

      document.querySelectorAll('#setting-theme-segmented .settings-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-val') === theme);
      });

      if (broadcast) {
        if (window.go && window.go.main && window.go.main.App && window.go.main.App.SetTheme) {
          window.go.main.App.SetTheme(theme);
        } else {
          fetch('http://127.0.0.1:8080/livedebug/theme?value=' + encodeURIComponent(theme), { method: 'POST' }).catch(() => {});
        }
      }
    }
  };
