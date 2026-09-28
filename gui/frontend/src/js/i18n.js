'use strict';

  // ── Modular I18n Engine ─────────────────────────────────────────────────────
  const I18n = {
    currentLang: localStorage.getItem('gb_lang') || 'ru',
    dictionary: {},

    t(key) {
      if (!key) return '';
      const parts = key.split('.');
      let cur = this.dictionary;
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in cur) {
          cur = cur[p];
        } else {
          return key;
        }
      }
      return typeof cur === 'string' ? cur : key;
    },

    applyDOM() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const val = this.t(key);
        if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit')) {
          el.value = val;
        } else if (el.tagName === 'OPTION') {
          el.textContent = val;
        } else {
          el.innerHTML = renderMarkdown(val);
        }
      });

      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = this.t(key);
      });

      const titleKey = document.querySelector('title')?.getAttribute('data-i18n');
      if (titleKey) {
        document.title = this.t(titleKey);
      }

      document.documentElement.lang = this.currentLang;

      // Update segmented control buttons
      document.getElementById('btn-lang-ru')?.classList.toggle('active', this.currentLang === 'ru');
      document.getElementById('btn-lang-en')?.classList.toggle('active', this.currentLang === 'en');
      document.querySelectorAll('#setting-lang-segmented .settings-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-val') === this.currentLang);
      });

      if (typeof AppleSelect !== 'undefined' && AppleSelect.refreshAll) {
        AppleSelect.refreshAll();
      }

      if (typeof AppState !== 'undefined' && AppState.updateModeGlider) {
        setTimeout(() => AppState.updateModeGlider(), 10);
      }
    },

    async setLanguage(lang, broadcast = true) {
      try {
        let jsonStr = '';
        if (window.go && window.go.main && window.go.main.App) {
          jsonStr = await window.go.main.App.GetTranslations(lang);
        }
        this.dictionary = JSON.parse(jsonStr || '{}');
        this.currentLang = lang;
        localStorage.setItem('gb_lang', lang);
        this.applyDOM();
        if (typeof SetupWizard !== 'undefined') {
          SetupWizard.updateI18n();
        }
        if (typeof CalibrationWizard !== 'undefined' && CalibrationWizard.isOpen) {
          if (CalibrationWizard.currentScreen === 'capture') {
            CalibrationWizard._updateStepUI();
          } else if (CalibrationWizard.currentScreen === 'slots') {
            CalibrationWizard.renderSlotList();
          } else if (CalibrationWizard.currentScreen === 'save') {
            CalibrationWizard._renderSaveScreen();
          }
        }
        if (typeof ProfileManager !== 'undefined') {
          ProfileManager.render();
        }
        if (AppState.lastState) {
          AppState.render(AppState.lastState);
        }

        if (broadcast) {
          if (window.go && window.go.main && window.go.main.App && window.go.main.App.SetLang) {
            window.go.main.App.SetLang(lang);
          } else {
            fetch('http://127.0.0.1:8080/livedebug/lang?value=' + encodeURIComponent(lang), { method: 'POST' }).catch(() => {});
          }
        }
      } catch (err) {
        console.error('Failed to set language:', err);
      }
    },

    async init() {
      document.getElementById('btn-lang-ru')?.addEventListener('click', () => this.setLanguage('ru', true));
      document.getElementById('btn-lang-en')?.addEventListener('click', () => this.setLanguage('en', true));
      if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('lang-sync', (newLang) => {
          if (newLang && this.currentLang !== newLang) {
            this.setLanguage(newLang, false);
          }
        });
      }
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.GetLang) {
        try {
          const backendLang = await window.go.main.App.GetLang();
          if (backendLang) {
            this.currentLang = backendLang;
          }
        } catch (e) {}
      }
      await this.setLanguage(this.currentLang, false);
    }
  };
