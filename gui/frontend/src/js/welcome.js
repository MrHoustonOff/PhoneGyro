'use strict';

  // ── Welcome Screen (First Launch) Manager ──────────────────────────────────
  const WelcomeManager = {
    isOpen: false,
    initialized: false,

    init() {
      if (this.initialized) return;
      this.initialized = true;

      document.getElementById('btn-welcome-start')?.addEventListener('click', async () => {
        if (window.go && window.go.app && window.go.app.App && window.go.app.App.MarkFirstLaunchDone) {
          try { await window.go.app.App.MarkFirstLaunchDone(); } catch (e) {}
        }
        this.close();
        if (typeof SetupWizard !== 'undefined') {
          SetupWizard.open();
        }
      });

      document.getElementById('btn-welcome-skip')?.addEventListener('click', async () => {
        if (window.go && window.go.app && window.go.app.App && window.go.app.App.MarkFirstLaunchDone) {
          try { await window.go.app.App.MarkFirstLaunchDone(); } catch (e) {}
        }
        this.close();
      });
    },

    async checkFirstLaunch() {
      if (window.go && window.go.app && window.go.app.App && window.go.app.App.IsFirstLaunch) {
        try {
          const isFirst = await window.go.app.App.IsFirstLaunch();
          if (isFirst) {
            this.open();
          }
        } catch (e) {}
      }
    },

    open() {
      this.isOpen = true;
      if (typeof HelpManager !== 'undefined' && HelpManager.isOpen) HelpManager.close(false);
      if (typeof SettingsManager !== 'undefined' && SettingsManager.isOpen) SettingsManager.close(false);
      if (typeof SetupWizard !== 'undefined' && SetupWizard.isOpen) SetupWizard.close();

      const container = document.querySelector('.modular-container');
      if (container) {
        container.classList.add('setup-mode');
        container.classList.remove('setup-mode-wide');
        container.classList.remove('usb-mode');
      }

      const vOff = document.getElementById('view-offline');
      const vOn = document.getElementById('view-online');
      const vUsb = document.getElementById('view-usb-mode');
      const vModeHeader = document.getElementById('card-mode-header');
      const vSet = document.getElementById('view-setup');
      const vHelp = document.getElementById('view-help');
      const vSettings = document.getElementById('view-settings');
      const vWelcome = document.getElementById('view-welcome');

      if (vOff) vOff.style.display = 'none';
      if (vOn) vOn.style.display = 'none';
      if (vUsb) vUsb.style.display = 'none';
      if (vModeHeader) vModeHeader.style.display = 'none';
      if (vSet) vSet.style.display = 'none';
      if (vHelp) vHelp.style.display = 'none';
      if (vSettings) vSettings.style.display = 'none';
      if (vWelcome) vWelcome.style.display = 'flex';
    },

    close(renderState = true) {
      this.isOpen = false;
      const vWelcome = document.getElementById('view-welcome');
      if (vWelcome) vWelcome.style.display = 'none';

      const container = document.querySelector('.modular-container');
      if (container && (!HelpManager?.isOpen && !SettingsManager?.isOpen && !SetupWizard?.isOpen)) {
        container.classList.remove('setup-mode');
        container.classList.remove('setup-mode-wide');
      }

      if (renderState && AppState.lastState) {
        AppState._lastIsOffline = null;
        AppState.render(AppState.lastState);
      }
    }
  };
