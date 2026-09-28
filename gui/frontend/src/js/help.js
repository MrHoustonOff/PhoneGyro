'use strict';

  // ── Help & Reference Module Manager ─────────────────────────────────────────
  const HelpManager = {
    isOpen: false,
    initialized: false,

    init() {
      if (this.initialized) return;
      this.initialized = true;

      document.getElementById('btn-header-help')?.addEventListener('click', () => {
        this.toggle();
      });

      document.getElementById('btn-help-close')?.addEventListener('click', () => {
        this.close();
      });

      document.getElementById('btn-help-to-setup')?.addEventListener('click', () => {
        this.close();
        if (typeof SetupWizard !== 'undefined') {
          SetupWizard.open();
        }
      });
    },

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    },

    open() {
      this.isOpen = true;
      if (typeof SettingsManager !== 'undefined' && SettingsManager.isOpen) SettingsManager.close(false);
      if (typeof WelcomeManager !== 'undefined' && WelcomeManager.isOpen) WelcomeManager.close(false);
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
      const vSettings = document.getElementById('view-settings');
      const vWelcome = document.getElementById('view-welcome');
      const vHelp = document.getElementById('view-help');

      if (vOff) vOff.style.display = 'none';
      if (vOn) vOn.style.display = 'none';
      if (vUsb) vUsb.style.display = 'none';
      if (vModeHeader) vModeHeader.style.display = 'none';
      if (vSet) vSet.style.display = 'none';
      if (vSettings) vSettings.style.display = 'none';
      if (vWelcome) vWelcome.style.display = 'none';
      if (vHelp) vHelp.style.display = 'flex';

      document.getElementById('btn-header-help')?.classList.add('active');
    },

    close(renderState = true) {
      this.isOpen = false;
      const vHelp = document.getElementById('view-help');
      if (vHelp) vHelp.style.display = 'none';

      document.getElementById('btn-header-help')?.classList.remove('active');

      const container = document.querySelector('.modular-container');
      if (container && (!SettingsManager?.isOpen && !WelcomeManager?.isOpen && !SetupWizard?.isOpen)) {
        container.classList.remove('setup-mode');
        container.classList.remove('setup-mode-wide');
      }

      if (renderState && AppState.lastState) {
        AppState._lastIsOffline = null;
        AppState.render(AppState.lastState);
      }
    }
  };
