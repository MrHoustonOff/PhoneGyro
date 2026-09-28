'use strict';

  // ── Modular Font & UI Scale Engine ─────────────────────────────────────────
  const FontScaleManager = {
    scale: parseFloat(localStorage.getItem('gb_font_scale')) || 1.0,

    init() {
      this.apply(this.scale, false, false);

      if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('font-scale-sync', (newScale) => {
          if (typeof newScale === 'number' && Math.abs(this.scale - newScale) > 0.01) {
            this.scale = newScale;
            try {
              localStorage.setItem('gb_font_scale', newScale.toString());
            } catch (e) {}
            document.documentElement.style.zoom = newScale;
            this.syncUI(newScale);
            window.dispatchEvent(new Event('resize'));
            if (typeof HeaderManager !== 'undefined') HeaderManager.update();
          }
        });
      }

      // Keyboard zoom shortcuts: Ctrl + (+), Ctrl + (-), Ctrl + 0
      window.addEventListener('keydown', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;

        // Zoom in: Ctrl + Plus / Equal / NumpadAdd
        if (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === 'Add') {
          e.preventDefault();
          this.zoomIn();
        }
        // Zoom out: Ctrl + Minus / Underscore / NumpadSubtract
        else if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === 'Subtract') {
          e.preventDefault();
          this.zoomOut();
        }
        // Zoom reset: Ctrl + 0
        else if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault();
          this.zoomReset();
        }
      }, { capture: true, passive: false });

      // Mouse wheel zoom: Ctrl + Wheel
      let lastWheelTime = 0;
      window.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const now = performance.now();
          if (now - lastWheelTime < 60) return;
          lastWheelTime = now;
          if (e.deltaY < 0) {
            this.zoomIn();
          } else if (e.deltaY > 0) {
            this.zoomOut();
          }
        }
      }, { passive: false });
    },

    zoomIn() {
      const next = Math.min(1.40, Math.round((this.scale + 0.05) * 100) / 100);
      this.apply(next, true, true);
      this.notifyZoom();
    },

    zoomOut() {
      const next = Math.max(0.80, Math.round((this.scale - 0.05) * 100) / 100);
      this.apply(next, true, true);
      this.notifyZoom();
    },

    zoomReset() {
      this.apply(1.00, true, true);
      this.notifyZoom();
    },

    notifyZoom() {
      const label = I18n?.currentLang === 'ru' ? 'Масштаб' : 'Scale';
      if (typeof showToast === 'function') {
        showToast(`${label}: ${this.scale.toFixed(2)}x`);
      }
    },

    syncUI(val) {
      const slider = document.getElementById('setting-font-scale');
      const badge = document.getElementById('setting-font-scale-badge');
      if (slider) slider.value = val.toFixed(2);
      if (badge) badge.textContent = val.toFixed(2) + 'x';
    },

    apply(scale, saveStorage = true, broadcast = true) {
      const val = Math.max(0.80, Math.min(1.40, Number(scale) || 1.0));
      this.scale = val;
      if (saveStorage) {
        try {
          localStorage.setItem('gb_font_scale', val.toString());
        } catch (e) {}
      }
      document.documentElement.style.zoom = val;
      this.syncUI(val);
      window.dispatchEvent(new Event('resize'));
      if (typeof HeaderManager !== 'undefined') HeaderManager.update();

      if (broadcast) {
        if (window.go && window.go.main && window.go.main.App && window.go.main.App.SetFontScale) {
          window.go.main.App.SetFontScale(val);
        } else {
          fetch('http://127.0.0.1:8080/livedebug/font-scale?value=' + encodeURIComponent(val), { method: 'POST' }).catch(() => {});
        }
      }
    }
  };
