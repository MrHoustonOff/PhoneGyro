'use strict';

  // ── Initial Setup Wizard Manager ───────────────────────────────────────────
  const SetupWizard = {
    isOpen: false,
    initialized: false,
    currentScreen: 'select', // 'select' | 'android' | 'ios'
    iosStep: 1,

    init() {
      if (this.initialized) return;
      this.initialized = true;

      // Platform select buttons
      document.getElementById('btn-platform-ios')?.addEventListener('click', () => {
        this.showScreen('ios');
      });
      document.getElementById('btn-platform-android')?.addEventListener('click', () => {
        this.showScreen('android');
      });

      // Close button on select screen
      document.getElementById('btn-setup-close')?.addEventListener('click', () => {
        this.close();
      });

      // Android screen navigation
      document.getElementById('btn-android-back')?.addEventListener('click', () => {
        this.showScreen('select');
      });
      document.getElementById('btn-android-finish')?.addEventListener('click', () => {
        this.close();
      });

      // iOS screen navigation
      document.getElementById('btn-ios-back')?.addEventListener('click', () => {
        if (this.iosStep > 1) {
          this.setIosStep(this.iosStep - 1);
        } else {
          this.showScreen('select');
        }
      });

      document.getElementById('btn-ios-next')?.addEventListener('click', () => {
        if (this.iosStep < 6) {
          this.setIosStep(this.iosStep + 1);
        } else {
          this.close();
        }
      });

      // Step dots click navigation
      document.querySelectorAll('.wizard-dot').forEach(dot => {
        dot.addEventListener('click', () => {
          const targetStep = parseInt(dot.getAttribute('data-step'), 10);
          if (targetStep >= 1 && targetStep <= 6) {
            this.setIosStep(targetStep);
          }
        });
      });

      // Bind copy chips for Android and iOS screens
      setupCopyChip('chip-url-android', 'url-copy-badge-android', () => AppState.lastState?.gamepadUrl || '');
      setupCopyChip('chip-url-setup', 'url-copy-badge-setup', () => AppState.lastState?.setupUrl || '');
    },

    open() {
      this.isOpen = true;
      if (typeof HelpManager !== 'undefined' && HelpManager.isOpen) HelpManager.close(false);
      if (typeof SettingsManager !== 'undefined' && SettingsManager.isOpen) SettingsManager.close(false);
      if (typeof WelcomeManager !== 'undefined' && WelcomeManager.isOpen) WelcomeManager.close(false);

      const container = document.querySelector('.modular-container');
      if (container) {
        container.classList.add('setup-mode');
        container.classList.remove('setup-mode-wide');
        container.classList.remove('usb-mode');
      }
      const viewOffline = document.getElementById('view-offline');
      const viewOnline = document.getElementById('view-online');
      const viewUsb = document.getElementById('view-usb-mode');
      const cardModeHeader = document.getElementById('card-mode-header');
      const viewSetup = document.getElementById('view-setup');

      if (viewOffline) setShown(viewOffline, false);
      if (viewOnline) setShown(viewOnline, false);
      if (viewUsb) setShown(viewUsb, false);
      if (cardModeHeader) setShown(cardModeHeader, false);
      if (viewSetup) setShown(viewSetup, true);

      this.showScreen('select');
    },

    close() {
      this.isOpen = false;
      const container = document.querySelector('.modular-container');
      if (container && (!HelpManager?.isOpen && !SettingsManager?.isOpen && !WelcomeManager?.isOpen)) {
        container.classList.remove('setup-mode');
        container.classList.remove('setup-mode-wide');
      }
      const viewSetup = document.getElementById('view-setup');
      if (viewSetup) setShown(viewSetup, false);

      if (AppState.lastState) {
        AppState._lastIsOffline = null;
        AppState.render(AppState.lastState);
      }
    },

    showScreen(screen) {
      this.currentScreen = screen;
      const selectScreen = document.getElementById('setup-screen-select');
      const androidScreen = document.getElementById('setup-screen-android');
      const iosScreen = document.getElementById('setup-screen-ios');

      if (selectScreen) setShown(selectScreen, screen === 'select');
      if (androidScreen) setShown(androidScreen, screen === 'android');
      if (iosScreen) setShown(iosScreen, screen === 'ios');

      const container = document.querySelector('.modular-container');
      if (container) {
        container.classList.add('setup-mode');
        if (screen === 'select') {
          container.classList.remove('setup-mode-wide');
        } else {
          container.classList.add('setup-mode-wide');
        }
      }

      if (screen === 'ios') {
        // The step screenshots are lazy so startup does not decode them; once
        // the iOS guide is open, fetch all six so "Next" shows them at once.
        document.querySelectorAll('#setup-screen-ios img[loading="lazy"]').forEach(img => { img.loading = 'eager'; });
        this.setIosStep(this.iosStep || 1);
      }
    },

    setIosStep(step) {
      this.iosStep = Math.max(1, Math.min(6, step));

      // Update step counter text: e.g. "Шаг 1 из 6" / "Step 1 of 6"
      const counterEl = document.getElementById('ios-step-counter');
      if (counterEl) {
        const tpl = I18n.t('setup.step_x_of_y') || 'Шаг {x} из {y}';
        counterEl.innerHTML = renderMarkdown(tpl.replace('{x}', this.iosStep).replace('{y}', '6'));
      }

      // Update step title: "setup.ios_stepX_title"
      const titleEl = document.getElementById('ios-step-title');
      if (titleEl) {
        titleEl.innerHTML = renderMarkdown(I18n.t(`setup.ios_step${this.iosStep}_title`));
      }

      // Toggle panes
      for (let i = 1; i <= 6; i++) {
        const pane = document.getElementById(`ios-step-pane-${i}`);
        if (pane) {
          setShown(pane, i === this.iosStep);
        }
      }

      // Toggle dots
      document.querySelectorAll('.wizard-dot').forEach(dot => {
        const s = parseInt(dot.getAttribute('data-step'), 10);
        dot.classList.toggle('active', s === this.iosStep);
      });

      // Update next/finish button label
      const btnNext = document.getElementById('btn-ios-next');
      if (btnNext) {
        if (this.iosStep === 6) {
          btnNext.setAttribute('data-i18n', 'setup.btn_finish');
          btnNext.innerHTML = renderMarkdown(I18n.t('setup.btn_finish'));
        } else {
          btnNext.setAttribute('data-i18n', 'setup.btn_next');
          btnNext.innerHTML = renderMarkdown(I18n.t('setup.btn_next'));
        }
      }
    },

    updateI18n() {
      if (this.currentScreen === 'ios') {
        this.setIosStep(this.iosStep);
      }
    }
  };
