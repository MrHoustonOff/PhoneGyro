'use strict';

  // ── Delete Profile Confirmation ────────────────────────────────────────────
  const ProfileDeleteDialog = {
    isOpen: false,
    show(slot, name) {
      if (this.isOpen) return;
      const overlay = document.getElementById('profile-delete-modal');
      const title = document.getElementById('profile-delete-title');
      const confirmBtn = document.getElementById('profile-delete-btn-confirm');
      const cancelBtn = document.getElementById('profile-delete-btn-cancel');
      if (!overlay) return;
      this.isOpen = true;

      if (window.I18n && typeof window.I18n.applyDOM === 'function') {
        window.I18n.applyDOM(overlay);
      }
      if (title) {
        title.textContent = (I18n.t('calibration.delete_profile_title') || 'Удалить профиль «{name}»?').replace('{name}', name);
      }

      overlay.style.display = 'flex';
      overlay.offsetHeight; // reflow for the scale-in transition
      overlay.classList.add('visible');

      const cleanup = () => {
        this.isOpen = false;
        overlay.classList.remove('visible');
        setTimeout(() => {
          overlay.style.display = 'none';
        }, 180);
        window.removeEventListener('keydown', onKey);
        confirmBtn?.removeEventListener('click', onConfirm);
        cancelBtn?.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
      };

      const onConfirm = async () => {
        cleanup();
        try {
          const res = await window.go?.main?.App?.DeleteProfile(slot);
          if (res !== 'ok') {
            console.error('Failed to delete profile:', res);
            return;
          }
          showToast((I18n.t('calibration.profile_deleted') || 'Профиль «{name}» удалён').replace('{name}', name));
        } catch (err) {
          console.error('Failed to delete profile:', err);
        }
      };
      const onCancel = () => cleanup();
      const onOverlay = (e) => {
        if (e.target === overlay) cleanup();
      };
      // Escape cancels; Enter is left to the focused button, which starts on Cancel,
      // so a stray Enter never deletes anything.
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
        }
      };

      confirmBtn?.addEventListener('click', onConfirm);
      cancelBtn?.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlay);
      window.addEventListener('keydown', onKey);

      cancelBtn?.focus();
    }
  };

  // ── Apple HIG Pop-up Button & Dropdown Select Manager ──────────────────────
  const AppleSelect = {
    instances: new Map(),
    activeDropdown: null,
    activeTrigger: null,

    init() {
      const selects = document.querySelectorAll('.setting-select, .cal-axis-select');
      selects.forEach(sel => this.attach(sel));

      // Close on document click outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.apple-select-trigger') && !e.target.closest('.apple-select-dropdown')) {
          this.closeAll();
        }
      });

      // Close on scroll or resize
      window.addEventListener('resize', () => this.closeAll(), { passive: true });
      window.addEventListener('wheel', (e) => {
        if (this.activeDropdown && !this.activeDropdown.contains(e.target)) {
          this.closeAll();
        }
      }, { passive: true });

      // Close on Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.activeDropdown) {
          this.closeAll();
        }
      });
    },

    attach(select) {
      if (!select || this.instances.has(select)) return;
      if (select.dataset.appleSelectReady === 'true') return;
      select.dataset.appleSelectReady = 'true';

      // Hide native select visually
      select.classList.add('apple-select-native-hidden');

      // Create Trigger Button
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'apple-select-trigger';
      if (select.id) trigger.id = `select-trigger-${select.id}`;
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');

      const label = document.createElement('span');
      label.className = 'apple-select-label';

      const arrows = document.createElement('span');
      arrows.className = 'apple-select-arrows';
      arrows.innerHTML = `
        <svg viewBox="0 0 10 14" width="9" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="2 5 5 2 8 5"></polyline>
          <polyline points="2 9 5 12 8 9"></polyline>
        </svg>
      `;

      trigger.appendChild(label);
      trigger.appendChild(arrows);

      // Insert trigger right after native select
      select.parentNode.insertBefore(trigger, select.nextSibling);

      // Create Dropdown Container (appended to document.body for zero-clipping)
      const dropdown = document.createElement('div');
      dropdown.className = 'apple-select-dropdown';
      dropdown.setAttribute('role', 'listbox');
      dropdown.style.display = 'none';
      document.body.appendChild(dropdown);

      const syncUI = () => {
        dropdown.innerHTML = '';
        const options = Array.from(select.options);
        const selectedVal = select.value;

        let activeOptText = '';

        options.forEach((opt, idx) => {
          const item = document.createElement('div');
          item.className = 'apple-select-option';
          item.setAttribute('role', 'option');
          item.dataset.value = opt.value;

          const isSelected = (opt.value === selectedVal) || (!selectedVal && idx === select.selectedIndex);
          if (isSelected) {
            item.classList.add('selected');
            item.setAttribute('aria-selected', 'true');
            activeOptText = opt.textContent;
          }

          const check = document.createElement('span');
          check.className = 'apple-select-check';
          check.innerHTML = `
            <svg viewBox="0 0 12 10" width="10" height="8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1.5 5 4.5 8 10.5 1.5"></polyline>
            </svg>
          `;

          const text = document.createElement('span');
          text.className = 'apple-select-opt-text';
          text.textContent = opt.textContent;

          // Optional second line "when to pick it": <option data-desc-i18n="key">.
          const descKey = opt.getAttribute('data-desc-i18n');
          const descText = descKey && window.I18n ? I18n.t(descKey) : '';
          if (descText && descText !== descKey) {
            item.classList.add('has-desc');
            const desc = document.createElement('span');
            desc.className = 'apple-select-opt-desc';
            desc.textContent = descText;
            text.appendChild(desc);
          }

          item.appendChild(check);
          item.appendChild(text);

          item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (select.value !== opt.value) {
              select.value = opt.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              select.dispatchEvent(new Event('input', { bubbles: true }));
            }
            this.closeAll();
            trigger.focus();
          });

          dropdown.appendChild(item);
        });

        if (!activeOptText && select.options[select.selectedIndex]) {
          activeOptText = select.options[select.selectedIndex].textContent;
        }
        label.textContent = activeOptText;
      };

      syncUI();

      // Trigger Click
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.activeDropdown === dropdown) {
          this.closeAll();
        } else {
          this.open(trigger, dropdown);
        }
      });

      // Trigger Keyboard Navigation
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.activeDropdown !== dropdown) {
            this.open(trigger, dropdown);
          } else {
            const items = Array.from(dropdown.querySelectorAll('.apple-select-option'));
            const currentIdx = select.selectedIndex;
            if (e.key === 'ArrowDown' && currentIdx < items.length - 1) {
              select.selectedIndex = currentIdx + 1;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (e.key === 'ArrowUp' && currentIdx > 0) {
              select.selectedIndex = currentIdx - 1;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (e.key === 'Enter' || e.key === ' ') {
              this.closeAll();
            }
          }
        }
      });

      // Intercept select.value property changes
      const proto = HTMLSelectElement.prototype;
      const nativeDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (nativeDescriptor) {
        Object.defineProperty(select, 'value', {
          get() {
            return nativeDescriptor.get.call(this);
          },
          set(val) {
            nativeDescriptor.set.call(this, val);
            syncUI();
          },
          configurable: true
        });
      }

      // Native change listener
      select.addEventListener('change', syncUI);

      this.instances.set(select, { trigger, dropdown, syncUI });
    },

    open(trigger, dropdown) {
      this.closeAll();

      dropdown.style.display = 'block';
      dropdown.style.visibility = 'hidden';
      const zoom = parseFloat(document.documentElement.style.zoom) || (window.FontScaleManager && FontScaleManager.scale) || 1.0;
      const ddRect = dropdown.getBoundingClientRect();
      const dropdownWidth = ddRect.width || (dropdown.offsetWidth * zoom);
      const dropdownHeight = ddRect.height || (dropdown.offsetHeight * zoom);
      dropdown.style.visibility = 'visible';

      const rect = trigger.getBoundingClientRect();
      let left = rect.right - dropdownWidth;
      if (left < 10) left = rect.left;
      if (left + dropdownWidth > window.innerWidth - 10) {
        left = window.innerWidth - dropdownWidth - 10;
      }

      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      let top;
      if (spaceBelow < dropdownHeight + 12 && spaceAbove > dropdownHeight) {
        top = rect.top - dropdownHeight - 5;
        dropdown.classList.add('open-up');
      } else {
        top = rect.bottom + 5;
        dropdown.classList.remove('open-up');
      }

      dropdown.style.left = `${Math.round(left / zoom)}px`;
      dropdown.style.top = `${Math.round(top / zoom)}px`;

      requestAnimationFrame(() => {
        dropdown.classList.add('visible');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
      });

      this.activeDropdown = dropdown;
      this.activeTrigger = trigger;
    },

    closeAll() {
      if (this.activeDropdown) {
        this.activeDropdown.classList.remove('visible');
        const d = this.activeDropdown;
        setTimeout(() => {
          if (!d.classList.contains('visible')) {
            d.style.display = 'none';
          }
        }, 140);
        this.activeDropdown = null;
      }
      if (this.activeTrigger) {
        this.activeTrigger.classList.remove('active');
        this.activeTrigger.setAttribute('aria-expanded', 'false');
        this.activeTrigger = null;
      }
    },

    refreshAll() {
      this.instances.forEach(({ syncUI }) => {
        syncUI();
      });
    }
  };

  // ── Universal Copy Chip Helper ──────────────────────────────────────────────
  function setupCopyChip(chipId, badgeId, getUrlFn) {
    const chip = document.getElementById(chipId);
    const badge = document.getElementById(badgeId);
    if (!chip || !badge) return;

    chip.addEventListener('click', async () => {
      const url = getUrlFn();
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        const prevKey = badge.getAttribute('data-i18n') || 'qr.copy';
        badge.textContent = I18n.t('qr.copied');
        badge.classList.add('copied');
        clearTimeout(badge._timer);
        badge._timer = setTimeout(() => {
          badge.textContent = I18n.t(prevKey);
          badge.classList.remove('copied');
        }, 1600);
      } catch (e) {
        console.error('Clipboard copy failed:', e);
      }
    });
  }

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

      if (viewOffline) viewOffline.style.display = 'none';
      if (viewOnline) viewOnline.style.display = 'none';
      if (viewUsb) viewUsb.style.display = 'none';
      if (cardModeHeader) cardModeHeader.style.display = 'none';
      if (viewSetup) viewSetup.style.display = 'flex';

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
      if (viewSetup) viewSetup.style.display = 'none';

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

      if (selectScreen) selectScreen.style.display = (screen === 'select') ? 'flex' : 'none';
      if (androidScreen) androidScreen.style.display = (screen === 'android') ? 'flex' : 'none';
      if (iosScreen) iosScreen.style.display = (screen === 'ios') ? 'flex' : 'none';

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
          pane.style.display = (i === this.iosStep) ? 'flex' : 'none';
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

  // ── Sound Alerts Manager ───────────────────────────────────────────────────
  const SoundManager = {
    audioCtx: null,
    soundVolumes: {
      connect: 1,
      disconnect: 1,
      dsu: 1,
      recenter: 1,
      goal: 1,
      defeat: 1,
      loss: 1
    },
    _lastPlayTs: { connect: 0, disconnect: 0, dsu: 0, recenter: 0, goal: 0, defeat: 0, loss: 0 },
    _curEffectiveVol: 1,

    getAudioContext() {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    },

    getMode() {
      if (SettingsManager.currentSettings && SettingsManager.currentSettings.soundMode) {
        return SettingsManager.currentSettings.soundMode;
      }
      const sel = document.getElementById('setting-sound-mode');
      return sel?.value || 'cute';
    },

    getMasterVolume() {
      const slider = document.getElementById('setting-sound-volume');
      if (slider) {
        const parsed = parseInt(slider.value, 10);
        if (!isNaN(parsed)) return parsed;
      }
      if (SettingsManager.currentSettings && typeof SettingsManager.currentSettings.soundVolume === 'number') {
        return SettingsManager.currentSettings.soundVolume;
      }
      return 1;
    },

    getVolume(type) {
      const master = this.getMasterVolume();
      if (master <= 0) return 0;
      if (!type) return master;

      let individual = 1;
      const el = document.getElementById(`setting-sound-vol-${type}`);
      if (el) {
        const parsed = parseInt(el.value, 10);
        if (!isNaN(parsed)) individual = parsed;
      } else if (this.soundVolumes && typeof this.soundVolumes[type] === 'number') {
        individual = this.soundVolumes[type];
      } else if (SettingsManager.currentSettings?.soundVolumes && typeof SettingsManager.currentSettings.soundVolumes[type] === 'number') {
        individual = SettingsManager.currentSettings.soundVolumes[type];
      }

      if (individual <= 0) return 0;
      return individual;
    },

    getEffectiveVolume(type, force = false) {
      const master = this.getMasterVolume();
      if (master <= 0 && !force) return 0;
      let ind = this.getVolume(type);
      if (force && ind <= 0) ind = 1;
      if (ind <= 0) return 0;
      const effMaster = (master > 0) ? master : 1;
      return Math.min(3.0, (effMaster * ind) / 1.0);
    },

    async play(type, force = false) {
      const mode = this.getMode();
      const masterVol = this.getMasterVolume();
      if (!force && (mode === 'off' || masterVol <= 0)) return;

      const indVol = this.getVolume(type);
      if (!force && indVol <= 0) return;

      const now = Date.now();
      const minInterval = (type === 'loss') ? 5000 : (type === 'defeat') ? 1200 : (type === 'goal') ? 700 : (type === 'recenter') ? 140 : 600;
      if (!force && this._lastPlayTs[type] && now - this._lastPlayTs[type] < minInterval) {
        return;
      }

      this._lastPlayTs[type] = now;
      this._curEffectiveVol = this.getEffectiveVolume(type, force) || 1.0;

      if (type === 'goal') {
        this.playCuteGoal();
        return;
      }
      if (type === 'loss') {
        if (mode === 'windows') {
          if (window.go?.main?.App?.PlaySystemSound) {
            try { window.go.main.App.PlaySystemSound('loss'); } catch (e) {}
          }
        } else {
          this.playCuteLoss();
        }
        return;
      }
      if (type === 'defeat') {
        if (mode === 'windows') {
          if (window.go?.main?.App?.PlaySystemSound) {
            try { window.go.main.App.PlaySystemSound('defeat'); } catch (e) {}
          }
        } else {
          this.playCuteDefeat();
        }
        return;
      }
      if (type === 'recenter') {
        if (mode === 'windows') {
          if (window.go?.main?.App?.PlaySystemSound) {
            try { window.go.main.App.PlaySystemSound('recenter'); } catch (e) {}
          }
        } else {
          this.playCuteRecenter();
        }
        return;
      }
      if (type === 'dsu') {
        if (mode === 'windows') {
          if (window.go?.main?.App?.PlaySystemSound) {
            try { window.go.main.App.PlaySystemSound('dsu'); } catch (e) {}
          }
        } else {
          this.playCuteDSUConnect();
        }
        return;
      }

      if (mode === 'windows') {
        if (window.go?.main?.App?.PlaySystemSound) {
          try {
            window.go.main.App.PlaySystemSound(type);
          } catch (e) {
            console.warn('PlaySystemSound error:', e);
          }
        }
        return;
      }

      // Synthesized celesta arpeggios via Web Audio API
      if (type === 'connect') {
        this.playCuteConnect();
      } else if (type === 'disconnect') {
        this.playCuteDisconnect();
      }
    },

    playTone(freq, startTime, duration, gainValue = 0.12, type = 'sine') {
      const vol = this._curEffectiveVol || this.getMasterVolume();
      if (vol <= 0) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      const effectiveGain = Math.min(1.0, gainValue * vol);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(effectiveGain, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    },

    playFMBell(freq, startTime, duration, gainVal = 0.16, modRatio = 2.756, modDepth = 2.4) {
      const vol = this._curEffectiveVol || this.getMasterVolume();
      if (vol <= 0) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const modGain = ctx.createGain();
      const mainGain = ctx.createGain();

      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(freq, startTime);

      modulator.type = 'sine';
      modulator.frequency.setValueAtTime(freq * modRatio, startTime);

      modGain.gain.setValueAtTime(freq * modDepth, startTime);
      modGain.gain.exponentialRampToValueAtTime(0.01, startTime + Math.min(duration, 0.14));

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);

      const effectiveGain = Math.min(1.0, gainVal * vol);
      mainGain.gain.setValueAtTime(0.0001, startTime);
      mainGain.gain.exponentialRampToValueAtTime(effectiveGain, startTime + 0.008);
      mainGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      carrier.connect(mainGain);
      mainGain.connect(ctx.destination);

      carrier.start(startTime);
      modulator.start(startTime);
      carrier.stop(startTime + duration);
      modulator.stop(startTime + duration);
    },

    playToneSweep(fromFreq, toFreq, startTime, duration, gainVal = 0.15) {
      const vol = this._curEffectiveVol || this.getMasterVolume();
      if (vol <= 0) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(fromFreq, startTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(10, toFreq), startTime + duration);
      const effectiveGain = Math.min(1.0, gainVal * vol);
      gain.gain.setValueAtTime(effectiveGain, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    },

    playVoidPlunge(startTime, gainVal = 0.28, duration = 0.55) {
      const vol = this._curEffectiveVol || this.getMasterVolume();
      if (vol <= 0) return;
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.65));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2.2;
      filter.frequency.setValueAtTime(2200, startTime);
      filter.frequency.exponentialRampToValueAtTime(240, startTime + duration * 0.88);
      const gain = ctx.createGain();
      const effectiveGain = Math.min(1.0, gainVal * vol);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(effectiveGain, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(startTime);
      noise.stop(startTime + duration);
    },

    playCuteConnect() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Uplifting arpeggio: C5 (523Hz), E5 (659Hz), G5 (784Hz), C6 (1046Hz)
      const notes = [
        { f: 523.25, t: 0.00, d: 0.22, g: 0.13 },
        { f: 659.25, t: 0.07, d: 0.22, g: 0.14 },
        { f: 783.99, t: 0.14, d: 0.24, g: 0.15 },
        { f: 1046.50, t: 0.21, d: 0.38, g: 0.16 }
      ];
      for (const n of notes) {
        this.playTone(n.f, now + n.t, n.d, n.g, 'sine');
      }
    },

    playCuteDisconnect() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Soft descending drop: G5 (784Hz), Eb5 (622Hz), C5 (523Hz)
      const notes = [
        { f: 783.99, t: 0.00, d: 0.18, g: 0.13 },
        { f: 622.25, t: 0.08, d: 0.20, g: 0.12 },
        { f: 523.25, t: 0.17, d: 0.32, g: 0.11 }
      ];
      for (const n of notes) {
        this.playTone(n.f, now + n.t, n.d, n.g, 'sine');
      }
    },

    playCuteLoss() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Quiet two-note sigh (D5 -> B4), well below the disconnect cue: tells the
      // player the link is struggling without startling them mid-game.
      this.playTone(587.33, now + 0.00, 0.30, 0.06, 'sine');
      this.playTone(493.88, now + 0.16, 0.42, 0.05, 'sine');
    },

    playCuteDSUConnect() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Bright crystalline 2-tone FM bell chime:
      // Note 1: E6 (1318.51 Hz) - crisp bright chime
      // Note 2: A6 (1760.00 Hz) - rising resolving bell
      this.playFMBell(1318.51, now + 0.00, 0.26, 0.16, 2.756, 2.2);
      this.playFMBell(1760.00, now + 0.10, 0.44, 0.18, 2.756, 2.2);
    },

    playCuteRecenter() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Tactile electronic crosshair zero-lock snap:
      this.playTone(220, now, 0.035, 0.18, 'triangle');
      this.playTone(880.00, now + 0.015, 0.10, 0.14, 'sine');
      this.playFMBell(1108.73, now + 0.045, 0.22, 0.16, 2.0, 1.5);
    },

    playCuteGoal() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Legendary Zelda Secret / Puzzle Solved Fanfare (8 notes + resolving major chord)
      const melody = [
        { f: 783.99, t: 0.00, d: 0.22, g: 0.16 }, // G5
        { f: 739.99, t: 0.10, d: 0.22, g: 0.16 }, // F#5
        { f: 622.25, t: 0.20, d: 0.22, g: 0.17 }, // D#5
        { f: 440.00, t: 0.30, d: 0.22, g: 0.18 }, // A4
        { f: 415.30, t: 0.40, d: 0.24, g: 0.18 }, // G#4
        { f: 659.25, t: 0.50, d: 0.24, g: 0.19 }, // E5
        { f: 830.61, t: 0.60, d: 0.26, g: 0.20 }, // G#5
        { f: 1046.5, t: 0.70, d: 0.95, g: 0.22 }, // C6 (triumphal resolve)
        // Resolving harmony chord under C6
        { f: 523.25, t: 0.71, d: 0.90, g: 0.13 }, // C5
        { f: 1318.5, t: 0.72, d: 0.85, g: 0.14 }, // E6
        { f: 1567.9, t: 0.73, d: 0.80, g: 0.12 }  // G6
      ];
      for (const n of melody) {
        this.playFMBell(n.f, now + n.t, n.d, n.g, 2.756, 2.4);
      }
    },

    playCuteDefeat() {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Zelda shrine orb plunging into the bottomless abyss:
      // 1. Cascading crystal FM bells (melancholy descending arpeggio, rich & punchy)
      const chimes = [
        { f: 783.99, t: 0.00, d: 0.32, g: 0.24, r: 2.756, m: 2.0 }, // G5
        { f: 622.25, t: 0.10, d: 0.35, g: 0.25, r: 2.756, m: 2.0 }, // Eb5
        { f: 523.25, t: 0.20, d: 0.38, g: 0.26, r: 2.756, m: 2.2 }, // C5
        { f: 415.30, t: 0.30, d: 0.42, g: 0.27, r: 2.756, m: 2.2 }, // Ab4
        { f: 349.23, t: 0.40, d: 0.58, g: 0.28, r: 2.756, m: 2.4 }  // F4
      ];
      for (const n of chimes) {
        this.playFMBell(n.f, now + n.t, n.d, n.g, n.r, n.m);
      }

      // 2. Visceral pitch plunge slide (880Hz -> 180Hz descending whistle glide)
      this.playToneSweep(880, 180, now + 0.02, 0.48, 0.24);

      // 3. Resonant abyss wind plunge (rushing air whoosh)
      this.playVoidPlunge(now + 0.02, 0.28, 0.52);

      // 4. Distant cavern floor impact strike ("DUNNNN" resonant gong)
      this.playFMBell(115, now + 0.44, 0.48, 0.32, 1.5, 2.6);
      this.playTone(95, now + 0.44, 0.35, 0.26, 'sine');
    },

    preview(type) {
      if (type) {
        this.play(type, true);
        return;
      }
      const sel = document.getElementById('setting-sound-mode');
      const mode = sel ? sel.value : this.getMode();
      if (mode === 'off') return;
      if (mode === 'windows') {
        if (window.go?.main?.App?.PlaySystemSound) {
          try { window.go.main.App.PlaySystemSound('connect'); } catch (e) {}
        }
      } else {
        this.playCuteConnect();
      }
    }
  };

  // ── Network Telemetry Mini-Sparkline (Ping & Jitter) ──────────────────────
  const NetSparkline = {
    history: [], // only real RTT samples (state.pingMs), never seeded
    maxLen: 32,
    lastRenderTs: 0,

    push(pingMs) {
      if (typeof pingMs !== 'number' || pingMs < 0) return; // not measured: draw nothing
      this.history.push(pingMs);
      if (this.history.length > this.maxLen) {
        this.history.shift();
      }
      const now = performance.now();
      if (now - this.lastRenderTs >= 250) {
        this.lastRenderTs = now;
        this.render();
      }
    },

    render() {
      this.drawToCanvas('main-net-spark-canvas', 48, 14);
      if (typeof SettingsManager !== 'undefined' && SettingsManager.isOpen) {
        this.drawToCanvas('bench-net-spark-canvas', 60, 15);
      }
    },

    drawToCanvas(canvasId, w, h) {
      const canvas = document.getElementById(canvasId);
      if (!canvas || canvas.offsetParent === null) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const n = this.history.length;
      if (n < 2) {
        ctx.restore();
        return;
      }

      let minVal = 0;
      let maxVal = 16;
      for (let i = 0; i < n; i++) {
        if (this.history[i] > maxVal) maxVal = this.history[i];
      }
      const range = maxVal - minVal || 1;
      const pad = 1.5;
      const availH = h - pad * 2;
      const dx = (w - pad * 2) / (this.maxLen - 1);
      const startX = w - pad - (n - 1) * dx;

      const lastPing = this.history[n - 1];
      let strokeColor = '#30D158'; // Apple Green
      let fillColor = 'rgba(48, 209, 88, 0.22)';
      if (lastPing > 35) {
        strokeColor = '#FF9F0A'; // Apple Orange
        fillColor = 'rgba(255, 159, 10, 0.22)';
      }
      if (lastPing > 75) {
        strokeColor = '#FF453A'; // Apple Red
        fillColor = 'rgba(255, 69, 58, 0.22)';
      }

      ctx.beginPath();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < n; i++) {
        const x = startX + i * dx;
        const norm = (this.history[i] - minVal) / range;
        const y = h - pad - norm * availH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Translucent gradient fill under curve
      ctx.lineTo(startX + (n - 1) * dx, h);
      ctx.lineTo(startX, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, fillColor);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.restore();
    }
  };

  // ── Zelda Target Aim Reticle Mini-Game (30-Sec Target Shoot) ────────────────
  const AimGame = {
    initialized: false,
    isFullscreen: false,
    _placeholder: null,
    gameState: 'idle', // 'idle' | 'ready' | 'playing' | 'gameover'
    score: 0,
    record: parseInt(localStorage.getItem('gb_aim_record') || '0', 10),
    timeLeft: 30.0,
    timerStartTs: 0,
    cachedW: 0,
    cachedH: 0,
    activeTarget: null,
    audioCtx: null,
    vpEl: null,
    targetsLayerEl: null,
    fxLayerEl: null,
    timePillEl: null,
    timerEl: null,
    scoreEl: null,
    recordEl: null,
    hintEl: null,
    gameoverEl: null,
    finalScoreEl: null,
    finalRecordEl: null,
    recordBadgeEl: null,

    init() {
      this.vpEl = document.getElementById('bench-aim-viewport');
      this.targetsLayerEl = document.getElementById('bench-aim-targets-layer');
      this.fxLayerEl = document.getElementById('bench-aim-fx-layer');
      this.timePillEl = document.getElementById('bench-aim-time-pill');
      this.timerEl = document.getElementById('bench-aim-timer');
      this.scoreEl = document.getElementById('bench-aim-score');
      this.recordEl = document.getElementById('bench-aim-record');
      this.hintEl = document.getElementById('bench-aim-fs-hint');
      this.gameoverEl = document.getElementById('bench-aim-gameover');
      this.finalScoreEl = document.getElementById('bench-aim-final-score');
      this.finalRecordEl = document.getElementById('bench-aim-final-record');
      this.recordBadgeEl = document.getElementById('bench-aim-record-badge');

      if (this.recordEl) this.recordEl.textContent = this.record.toString();

      if (this.initialized) {
        this.syncState();
        return;
      }
      this.initialized = true;

      // Fullscreen toggle button
      document.getElementById('btn-bench-aim-fullscreen')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFullscreen();
      });

      // Double-click on viewport to toggle fullscreen
      this.vpEl?.addEventListener('dblclick', (e) => {
        if (e.target.closest('button') || e.target.closest('.bench-aim-gameover-card')) return;
        this.toggleFullscreen();
      });

      // Escape, Spacebar, and Enter key handling
      document.addEventListener('keydown', (e) => {
        if (!this.isFullscreen) return;
        if (e.key === 'Escape') {
          this.setFullscreen(false);
        } else if (e.code === 'Space' || e.key === ' ') {
          if (this.gameState === 'gameover') {
            e.preventDefault();
            this.resetGame();
          } else {
            e.preventDefault();
            TuningBench.recenter();
          }
        } else if (e.key === 'Enter' && this.gameState === 'gameover') {
          e.preventDefault();
          this.resetGame();
        }
      });

      // Play again and exit buttons
      document.getElementById('btn-aim-play-again')?.addEventListener('click', () => {
        this.resetGame();
      });

      document.getElementById('btn-aim-exit')?.addEventListener('click', () => {
        this.setFullscreen(false);
      });

      // Window resize and visibility listeners: guarantee target never disappears
      window.addEventListener('resize', () => {
        this.syncState();
      });

      // Initial target spawn (works both in windowed and fullscreen)
      this.resetGame();
    },

    getBounds() {
      if (this.isFullscreen) {
        const halfW = Math.floor((window.innerWidth || 1280) / 2);
        const halfH = Math.floor((window.innerHeight || 720) / 2);
        return {
          boundX: Math.max(100, halfW - 140),
          boundYTop: Math.max(60, halfH - 160),     // Clearance for top HUD
          boundYBottom: Math.max(60, halfH - 100),
          maxReticleX: Math.max(160, halfW - 50),
          maxReticleY: Math.max(100, halfH - 50)
        };
      } else {
        const vp = this.vpEl || document.getElementById('bench-aim-viewport');
        const w = vp ? (vp.clientWidth || 600) : 600;
        const halfW = Math.floor(w / 2);
        return {
          boundX: Math.max(60, halfW - 80),
          boundYTop: 36,
          boundYBottom: 36,
          maxReticleX: Math.max(100, halfW - 40),
          maxReticleY: 52
        };
      }
    },

    syncState() {
      // Re-bind DOM elements if disconnected
      if (!this.targetsLayerEl || !this.targetsLayerEl.isConnected) {
        this.targetsLayerEl = document.getElementById('bench-aim-targets-layer');
      }
      if (!this.fxLayerEl || !this.fxLayerEl.isConnected) {
        this.fxLayerEl = document.getElementById('bench-aim-fx-layer');
      }
      // If there is no active target or it was lost, spawn one immediately
      if (!this.activeTarget || !this.activeTarget.el || !this.activeTarget.el.isConnected) {
        this.spawnTarget();
      }
    },

    toggleFullscreen() {
      this.setFullscreen(!this.isFullscreen);
    },

    setFullscreen(enable) {
      this.isFullscreen = !!enable;
      const vp = this.vpEl || document.getElementById('bench-aim-viewport');
      const btn = document.getElementById('btn-bench-aim-fullscreen');
      if (!vp) return;

      if (this.isFullscreen) {
        if (!this._placeholder) {
          this._placeholder = document.createElement('div');
          this._placeholder.id = 'bench-aim-placeholder';
          this._placeholder.style.display = 'none';
        }
        if (vp.parentNode && vp.parentNode !== document.body) {
          vp.parentNode.insertBefore(this._placeholder, vp);
          document.body.appendChild(vp);
        }
        vp.classList.add('fullscreen');
        this.startLoop();
        this.resetGame();
      } else {
        vp.classList.remove('fullscreen');
        if (this._placeholder && this._placeholder.parentNode) {
          this._placeholder.parentNode.insertBefore(vp, this._placeholder);
          this._placeholder.parentNode.removeChild(this._placeholder);
          this._placeholder = null;
        }
        this.stopLoop();
        this.resetGame();
      }

      if (btn) {
        const iconExpand = btn.querySelector('.icon-expand');
        const iconCollapse = btn.querySelector('.icon-collapse');
        if (iconExpand) iconExpand.style.display = this.isFullscreen ? 'none' : 'block';
        if (iconCollapse) iconCollapse.style.display = this.isFullscreen ? 'block' : 'none';
        btn.title = this.isFullscreen ? (I18n.t('settings_modal.bench_exit_fullscreen') || 'Свернуть') : (I18n.t('settings_modal.bench_fullscreen') || 'На весь экран');
      }

      TuningBench.recenter();
    },

    startLoop() {
      if (this.rafId) return;
      const loop = (now) => {
        if (!this.isFullscreen) {
          this.rafId = null;
          return;
        }
        this.update(now);
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    },

    stopLoop() {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    },

    resetGame() {
      this.cleanupTargets();
      this.gameState = this.isFullscreen ? 'ready' : 'idle';
      this.score = 0;
      this.timeLeft = 30.0;
      this.timerStartTs = 0;

      if (this.gameoverEl) this.gameoverEl.style.display = 'none';
      if (this.timePillEl) this.timePillEl.classList.remove('urgent');
      if (this.timerEl) this.timerEl.textContent = '30.0';
      if (this.scoreEl) this.scoreEl.textContent = '0';
      if (this.recordEl) this.recordEl.textContent = this.record.toString();
      if (this.hintEl) {
        this.hintEl.textContent = I18n.t('settings_modal.bench_aim_start_hint') || 'Сбейте 1-ю мишень для старта! • [Esc] Выход';
      }

      this.spawnTarget();
    },

    cleanupTargets() {
      if (!this.targetsLayerEl || !this.targetsLayerEl.isConnected) {
        this.targetsLayerEl = document.getElementById('bench-aim-targets-layer');
      }
      if (this.targetsLayerEl) this.targetsLayerEl.innerHTML = '';
      if (!this.fxLayerEl || !this.fxLayerEl.isConnected) {
        this.fxLayerEl = document.getElementById('bench-aim-fx-layer');
      }
      if (this.fxLayerEl) this.fxLayerEl.innerHTML = '';
      this.activeTarget = null;
    },

    cleanupGame() {
      this.cleanupTargets();
      this.gameState = 'idle';
      if (this.gameoverEl) this.gameoverEl.style.display = 'none';
      if (this.timePillEl) this.timePillEl.classList.remove('urgent');
    },

    spawnTarget() {
      if (!this.targetsLayerEl || !this.targetsLayerEl.isConnected) {
        this.targetsLayerEl = document.getElementById('bench-aim-targets-layer');
      }
      if (!this.targetsLayerEl) return;

      const bounds = this.getBounds();

      // Clean up any lingering un-hit targets so strictly 1 active target exists
      const lingering = this.targetsLayerEl.querySelectorAll('.bench-aim-target:not(.hit)');
      lingering.forEach(t => t.remove());

      // Pick a random position not too close to current reticle
      let rx = 0;
      let ry = 0;
      for (let attempt = 0; attempt < 24; attempt++) {
        rx = Math.floor((Math.random() * 2 - 1) * bounds.boundX);
        ry = Math.floor(-bounds.boundYTop + Math.random() * (bounds.boundYTop + bounds.boundYBottom));
        const dist = Math.hypot(rx - TuningBench.reticleX, ry - TuningBench.reticleY);
        if (dist > (this.isFullscreen ? 130 : 60)) break;
      }

      const el = document.createElement('div');
      el.className = 'bench-aim-target';
      // Center-anchored CSS positioning: 100% immune to layout delay, window resizing or CSS zoom
      el.style.left = '50%';
      el.style.top = '50%';
      el.style.marginLeft = (rx - 30) + 'px';
      el.style.marginTop = (ry - 30) + 'px';
      el.innerHTML = `
        <div class="target-ring outer"></div>
        <div class="target-ring middle"></div>
        <div class="target-ring inner"></div>
        <div class="target-bullseye"></div>
      `;

      this.targetsLayerEl.appendChild(el);
      this.activeTarget = {
        x: rx,
        y: ry,
        el: el,
        hitRadius: 36
      };
    },

    checkHit(reticleX, reticleY) {
      if (!this.activeTarget || !this.activeTarget.el || !this.activeTarget.el.isConnected) {
        this.spawnTarget();
        return;
      }
      if (this.gameState === 'gameover') return;

      const dist = Math.hypot(reticleX - this.activeTarget.x, reticleY - this.activeTarget.y);
      if (dist <= this.activeTarget.hitRadius) {
        this.onHit();
      }
    },

    onHit() {
      const target = this.activeTarget;
      if (!target) return;
      this.activeTarget = null;

      // In fullscreen ready state, 1st target hit triggers the 30-sec arcade countdown!
      if (this.isFullscreen && this.gameState === 'ready') {
        this.gameState = 'playing';
        this.timerStartTs = performance.now();
        this.timeLeft = 30.0;
        if (this.hintEl) {
          this.hintEl.textContent = I18n.t('settings_modal.bench_aim_playing_hint') || '30 секунд! Сбивайте мишени • [Пробел] Центр • [Esc] Выход';
        }
      }

      this.score++;
      if (this.scoreEl) this.scoreEl.textContent = this.score.toString();

      if (this.score > this.record) {
        this.record = this.score;
        try {
          localStorage.setItem('gb_aim_record', this.record.toString());
        } catch (e) {}
        if (this.recordEl) this.recordEl.textContent = this.record.toString();
      }

      // Visual and Sound Shot Feedback
      this.playHitSound();

      // Flash reticle
      const reticleEl = TuningBench.reticleDotEl || document.getElementById('bench-reticle-dot');
      if (reticleEl) {
        reticleEl.classList.remove('shot-flash');
        void reticleEl.offsetWidth; // trigger reflow
        reticleEl.classList.add('shot-flash');
        setTimeout(() => reticleEl.classList.remove('shot-flash'), 140);
      }

      // Explode hit target
      if (target.el) {
        target.el.classList.add('hit');
        setTimeout(() => {
          if (target.el && target.el.parentNode) {
            target.el.parentNode.removeChild(target.el);
          }
        }, 220);
      }

      // Center-anchored Floating +1 Popup
      if (!this.fxLayerEl || !this.fxLayerEl.isConnected) {
        this.fxLayerEl = document.getElementById('bench-aim-fx-layer');
      }
      if (this.fxLayerEl) {
        const popup = document.createElement('div');
        popup.className = 'target-floating-score';
        popup.style.left = '50%';
        popup.style.top = '50%';
        popup.style.marginLeft = (target.x - 16) + 'px';
        popup.style.marginTop = (target.y - 16) + 'px';
        popup.textContent = '+1';
        this.fxLayerEl.appendChild(popup);
        setTimeout(() => {
          if (popup.parentNode) popup.parentNode.removeChild(popup);
        }, 500);
      }

      // Immediately spawn next target so user always has a target to shoot
      if (this.gameState !== 'gameover') {
        this.spawnTarget();
      }
    },

    update(now) {
      if (!this.isFullscreen) return;

      if (this.gameState === 'playing') {
        const elapsed = (now - this.timerStartTs) / 1000;
        this.timeLeft = Math.max(0, 30.0 - elapsed);

        if (this.timerEl) {
          this.timerEl.textContent = this.timeLeft.toFixed(1);
        }

        if (this.timePillEl) {
          this.timePillEl.classList.toggle('urgent', this.timeLeft <= 5.0);
        }

        if (this.timeLeft <= 0) {
          this.endGame();
        }
      }
    },

    endGame() {
      this.gameState = 'gameover';
      this.cleanupTargets();

      if (this.timePillEl) this.timePillEl.classList.remove('urgent');
      if (this.timerEl) this.timerEl.textContent = '0.0';

      const isNewRecord = (this.score >= this.record && this.score > 0);

      if (this.recordBadgeEl) {
        this.recordBadgeEl.style.display = isNewRecord ? 'inline-block' : 'none';
      }
      if (this.finalScoreEl) {
        this.finalScoreEl.textContent = this.score.toString();
      }
      if (this.finalRecordEl) {
        this.finalRecordEl.textContent = this.record.toString();
      }
      if (this.gameoverEl) {
        this.gameoverEl.style.display = 'flex';
      }
    },

    playHitSound() {
      try {
        if (typeof SoundManager !== 'undefined') {
          if (SoundManager.getMode() === 'off') return;
          const vol = SoundManager.getEffectiveVolume('goal');
          if (vol <= 0) return;
        }
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!this.audioCtx) this.audioCtx = new AudioContext();
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
        const ctx = this.audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const now = ctx.currentTime;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.07);
        const effVol = (typeof SoundManager !== 'undefined' && SoundManager.getEffectiveVolume) ? SoundManager.getEffectiveVolume('goal') : 1;
        gain.gain.setValueAtTime(0.25 * effVol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.13);
      } catch (e) {}
    }
  };

  // ── Zelda 3D Shrine Platform Mini-Game (Apparatus Simulator) ───────────────
  const PlatformGame = {
    initialized: false,
    renderer: null,
    scene: null,
    camera: null,
    platformGroup: null,
    slabMesh: null,
    slabMat: null,
    pedMid: null,
    pedLow: null,
    gimbalHub: null,
    hubRing: null,
    edgeLine: null,
    runeGroup: null,
    rimGroup: null,
    ballMesh: null,
    holeMesh: null,
    beaconMesh: null,
    score: 0,
    record: parseInt(localStorage.getItem('gb_platform_record') || '0', 10),
    isFullscreen: false,
    isOffline: false,
    pitch: 0, // rad (tilt around X)
    roll: 0,  // rad (tilt around Z)
    yaw: 0,   // rad (turn around Y)
    pitchOffset: 0,
    rollOffset: 0,
    yawOffset: 0,
    lastRawPitch: 0,
    lastRawRoll: 0,
    lastRawYaw: 0,
    ballPos: { x: 0, z: 0 },
    ballVel: { x: 0, z: 0 },
    ballPosY: 0,
    ballVelY: 0,
    isFalling: false,
    holePos: { x: 0.9, z: -0.3 },
    ballRadius: 0.14,
    platformSizeX: 3.4,
    platformSizeZ: 2.1,
    platformThickness: 0.16,
    confettiParticles: [],
    confettiColors: [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x00c7be, 0x32ade6, 0xaf52de, 0xff2d55, 0x00e5ff],
    lastTickTs: 0,
    cachedW: 0,
    cachedH: 0,
    hudElements: null,
    lastHudScore: -1,
    lastHudRecord: -1,
    lastHudTs: 0,
    _placeholder: null,

    syncDimensions(force = false) {
      const canvas = document.getElementById('bench-platform-canvas');
      const vp = document.getElementById('bench-platform-viewport');
      if (!canvas || !this.renderer || !this.camera) return;

      const rect = vp ? vp.getBoundingClientRect() : canvas.getBoundingClientRect();
      const w = Math.floor(rect.width || canvas.clientWidth || (this.isFullscreen ? window.innerWidth : 340));
      const h = Math.floor(rect.height || canvas.clientHeight || (this.isFullscreen ? window.innerHeight : 210));
      if (w <= 0 || h <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (this.renderer.getPixelRatio() !== dpr) {
        this.renderer.setPixelRatio(dpr);
      }

      if (force || w !== this.cachedW || h !== this.cachedH) {
        this.cachedW = w;
        this.cachedH = h;
        this.renderer.setSize(w, h, false);
        const aspect = w / h;
        this.camera.aspect = aspect;

        const fovRad = (this.camera.fov * Math.PI) / 180;
        let dist;
        if (this.isFullscreen) {
          const targetHalfW = this.platformSizeX * 0.62;
          const targetHalfH = this.platformSizeZ * 0.68;
          const distW = targetHalfW / (Math.tan(fovRad / 2) * aspect);
          const distH = targetHalfH / Math.tan(fovRad / 2);
          dist = Math.max(distW, distH, 4.4);
          this.camera.position.set(0, dist * 0.66, dist * 0.86);
        } else {
          // Mini-screen mode: close-up dynamic camera to make platform prominent, detailed & beautiful
          const targetHalfW = this.platformSizeX * 0.50;
          const targetHalfH = this.platformSizeZ * 0.54;
          const distW = targetHalfW / (Math.tan(fovRad / 2) * aspect);
          const distH = targetHalfH / Math.tan(fovRad / 2);
          dist = Math.max(distW, distH, 3.2);
          this.camera.position.set(0, dist * 0.62, dist * 0.80);
        }
        this.camera.lookAt(0, -0.04, 0);
        this.camera.updateProjectionMatrix();
      }
    },

    init() {
      if (this.initialized) return;
      const canvas = document.getElementById('bench-platform-canvas');
      const vp = document.getElementById('bench-platform-viewport');
      if (!canvas || !window.THREE) return;
      this.initialized = true;

      const THREE = window.THREE;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer = renderer;

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          this.syncDimensions(true);
        });
        ro.observe(canvas);
        if (vp) ro.observe(vp);
      }

      const scene = new THREE.Scene();
      this.scene = scene;

      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
      camera.position.set(0, 3.6, 4.4);
      camera.lookAt(0, -0.05, 0);
      this.camera = camera;

      // Studio Lighting: Sheikah Shrine ancient illumination
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
      scene.add(ambientLight);

      const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight.position.set(3.5, 8.0, 5.0);
      scene.add(dirLight);

      const cyanPoint = new THREE.PointLight(0x00e5ff, 1.4, 10);
      cyanPoint.position.set(0, 2.0, 0);
      scene.add(cyanPoint);

      // Platform Root Group (rotates on central gimbal pivot)
      const platformGroup = new THREE.Group();
      scene.add(platformGroup);
      this.platformGroup = platformGroup;

      const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');

      // 1. Main Ancient Sheikah Slate Top Slab
      const slabGeo = new THREE.BoxGeometry(this.platformSizeX, this.platformThickness, this.platformSizeZ);
      const slateMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x2e3644 : 0x151821,
        roughness: 0.65,
        metalness: 0.35
      });
      const slabMesh = new THREE.Mesh(slabGeo, slateMat);
      platformGroup.add(slabMesh);
      this.slabMesh = slabMesh;
      this.slabMat = slateMat;

      // 2. Zelda Underside Tapered Stone Pedestal & Gimbal Hub
      const pedMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x242a36 : 0x0e1017,
        roughness: 0.72,
        metalness: 0.28
      });
      this.pedMat = pedMat;

      const pedMidGeo = new THREE.BoxGeometry(this.platformSizeX * 0.88, 0.08, this.platformSizeZ * 0.88);
      const pedMid = new THREE.Mesh(pedMidGeo, pedMat);
      pedMid.position.y = -this.platformThickness / 2 - 0.04;
      platformGroup.add(pedMid);
      this.pedMid = pedMid;

      const pedLowGeo = new THREE.BoxGeometry(this.platformSizeX * 0.68, 0.10, this.platformSizeZ * 0.68);
      const pedLow = new THREE.Mesh(pedLowGeo, pedMat);
      pedLow.position.y = -this.platformThickness / 2 - 0.13;
      platformGroup.add(pedLow);
      this.pedLow = pedLow;

      // Gimbal Hub & Cyan Energy Ring
      const hubGeo = new THREE.CylinderGeometry(0.30, 0.36, 0.18, 24);
      const hubMat = new THREE.MeshStandardMaterial({
        color: 0x9b752c,
        metalness: 0.88,
        roughness: 0.25
      });
      const gimbalHub = new THREE.Mesh(hubGeo, hubMat);
      gimbalHub.position.y = -this.platformThickness / 2 - 0.24;
      platformGroup.add(gimbalHub);
      this.gimbalHub = gimbalHub;

      const hubRingGeo = new THREE.TorusGeometry(0.32, 0.015, 12, 32);
      const hubRingMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
      const hubRing = new THREE.Mesh(hubRingGeo, hubRingMat);
      hubRing.rotation.x = Math.PI / 2;
      hubRing.position.y = -this.platformThickness / 2 - 0.24;
      platformGroup.add(hubRing);
      this.hubRing = hubRing;

      // 3. Surface Sheikah Runic Circuitry & Border Line
      this.createEdgeLine();
      this.createRunes();

      // 4. Sheikah Ancient Goal Socket (Receptacle)
      const holeGroup = new THREE.Group();

      // Deep void pit
      const holePitGeo = new THREE.CircleGeometry(0.18, 32);
      const holePitMat = new THREE.MeshBasicMaterial({
        color: 0x030508,
        side: THREE.DoubleSide
      });
      const holePit = new THREE.Mesh(holePitGeo, holePitMat);
      holePit.rotation.x = -Math.PI / 2;
      holePit.position.y = this.platformThickness / 2 + 0.002;
      holeGroup.add(holePit);

      // Outer metallic bronze collar
      const collarGeo = new THREE.TorusGeometry(0.19, 0.016, 12, 32);
      const collarMat = new THREE.MeshStandardMaterial({
        color: 0x9b752c,
        metalness: 0.88,
        roughness: 0.28
      });
      const collar = new THREE.Mesh(collarGeo, collarMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = this.platformThickness / 2 + 0.003;
      holeGroup.add(collar);

      // Glowing Sheikah energetic pulse ring
      const holeRimGeo = new THREE.RingGeometry(0.15, 0.19, 32);
      const holeRimMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92
      });
      const holeRim = new THREE.Mesh(holeRimGeo, holeRimMat);
      holeRim.rotation.x = -Math.PI / 2;
      holeRim.position.y = this.platformThickness / 2 + 0.004;
      holeGroup.add(holeRim);

      // Ethereal vertical energy beacon beam rising from the socket
      const beaconGeo = new THREE.CylinderGeometry(0.08, 0.16, 0.9, 16, 1, true);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
      beaconMesh.position.y = this.platformThickness / 2 + 0.45;
      holeGroup.add(beaconMesh);
      this.beaconMesh = beaconMesh;

      platformGroup.add(holeGroup);
      this.holeMesh = holeGroup;
      // In normal mode: hole is hidden (interactive test with borders only)
      holeGroup.visible = false;

      // 5. Ancient Sheikah Protective Borders (Bortiki)
      this.createBorders();

      // 6. Ancient Sheikah Orb (Ball)
      const ballGroup = new THREE.Group();
      const ballGeo = new THREE.SphereGeometry(this.ballRadius, 32, 32);
      const ballMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.22,
        metalness: 0.90
      });
      const ballCore = new THREE.Mesh(ballGeo, ballMat);
      ballGroup.add(ballCore);

      // Equator & meridian cyan energy rings
      const eqRingGeo = new THREE.TorusGeometry(this.ballRadius + 0.002, 0.007, 12, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
      const eqRing = new THREE.Mesh(eqRingGeo, ringMat);
      ballGroup.add(eqRing);

      const merRingGeo = new THREE.TorusGeometry(this.ballRadius + 0.002, 0.007, 12, 32);
      const merRing = new THREE.Mesh(merRingGeo, ringMat);
      merRing.rotation.y = Math.PI / 2;
      ballGroup.add(merRing);

      // Local light attached to ball
      const ballLight = new THREE.PointLight(0x00e5ff, 0.70, 1.2);
      ballGroup.add(ballLight);

      this.ballPosY = this.platformThickness / 2 + this.ballRadius;
      ballGroup.position.set(0, this.ballPosY, 0);
      platformGroup.add(ballGroup);
      this.ballMesh = ballGroup;

      // Fullscreen Toggle and Escape Key
      document.getElementById('btn-bench-platform-fullscreen')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFullscreen();
      });

      canvas.addEventListener('dblclick', () => {
        this.toggleFullscreen();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isFullscreen) {
          this.setFullscreen(false);
        }
      });

      this.recenter();
    },

    createEdgeLine() {
      if (!this.platformGroup || !window.THREE) return;
      if (this.edgeLine) {
        this.platformGroup.remove(this.edgeLine);
        if (this.edgeLine.geometry) this.edgeLine.geometry.dispose();
      }
      const THREE = window.THREE;
      const hx = this.platformSizeX / 2 - 0.04;
      const hz = this.platformSizeZ / 2 - 0.04;
      const y = this.platformThickness / 2 + 0.003;
      const points = [
        new THREE.Vector3(-hx, y, -hz),
        new THREE.Vector3(hx, y, -hz),
        new THREE.Vector3(hx, y, hz),
        new THREE.Vector3(-hx, y, hz),
        new THREE.Vector3(-hx, y, -hz)
      ];
      const edgeGeo = new THREE.BufferGeometry().setFromPoints(points);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.85
      });
      this.edgeLine = new THREE.Line(edgeGeo, edgeMat);
      this.platformGroup.add(this.edgeLine);
    },

    createRunes() {
      if (!this.platformGroup || !window.THREE) return;
      if (this.runeGroup) {
        this.platformGroup.remove(this.runeGroup);
      }
      const THREE = window.THREE;
      const runeGroup = new THREE.Group();
      const y = this.platformThickness / 2 + 0.003;

      // Outer concentric ring
      const ring1Geo = new THREE.RingGeometry(0.32, 0.36, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.60
      });
      const ring1 = new THREE.Mesh(ring1Geo, ringMat);
      ring1.rotation.x = -Math.PI / 2;
      ring1.position.y = y;
      runeGroup.add(ring1);

      // Inner concentric ring
      const ring2Geo = new THREE.RingGeometry(0.18, 0.21, 32);
      const ring2 = new THREE.Mesh(ring2Geo, ringMat);
      ring2.rotation.x = -Math.PI / 2;
      ring2.position.y = y + 0.001;
      runeGroup.add(ring2);

      // Center Sheikah eye dot
      const dotGeo = new THREE.CircleGeometry(0.07, 24);
      const dot = new THREE.Mesh(dotGeo, ringMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.y = y + 0.002;
      runeGroup.add(dot);

      // 4 Radiating Sheikah circuit lines to corners
      const hx = this.platformSizeX / 2 - 0.25;
      const hz = this.platformSizeZ / 2 - 0.25;
      const circuitMat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.50
      });
      const rays = [
        [new THREE.Vector3(0.36, y, 0), new THREE.Vector3(hx, y, 0)],
        [new THREE.Vector3(-0.36, y, 0), new THREE.Vector3(-hx, y, 0)],
        [new THREE.Vector3(0.25, y, 0.25), new THREE.Vector3(hx, y, hz)],
        [new THREE.Vector3(-0.25, y, 0.25), new THREE.Vector3(-hx, y, hz)],
        [new THREE.Vector3(0.25, y, -0.25), new THREE.Vector3(hx, y, -hz)],
        [new THREE.Vector3(-0.25, y, -0.25), new THREE.Vector3(-hx, y, -hz)]
      ];
      for (const pts of rays) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        runeGroup.add(new THREE.Line(lineGeo, circuitMat));
      }

      this.platformGroup.add(runeGroup);
      this.runeGroup = runeGroup;
    },

    createBorders() {
      if (!this.platformGroup || !window.THREE) return;
      if (this.rimGroup) {
        this.platformGroup.remove(this.rimGroup);
        this.rimGroup.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        });
      }
      const THREE = window.THREE;
      const rimGroup = new THREE.Group();
      this.rimGroup = rimGroup;

      const borderH = 0.08;
      const borderThick = 0.07;
      const y = this.platformThickness / 2 + borderH / 2;

      const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');
      const borderMat = new THREE.MeshStandardMaterial({
        color: isLight ? 0x2e3644 : 0x181c26,
        roughness: 0.60,
        metalness: 0.40
      });
      const neonMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });

      const hx = this.platformSizeX / 2;
      const hz = this.platformSizeZ / 2;

      // North (top border along X)
      const nGeo = new THREE.BoxGeometry(this.platformSizeX, borderH, borderThick);
      const nMesh = new THREE.Mesh(nGeo, borderMat);
      nMesh.position.set(0, y, -hz + borderThick / 2);
      rimGroup.add(nMesh);

      // South (bottom border along X)
      const sMesh = new THREE.Mesh(nGeo, borderMat);
      sMesh.position.set(0, y, hz - borderThick / 2);
      rimGroup.add(sMesh);

      // West (left border along Z)
      const sideLength = Math.max(0.1, this.platformSizeZ - borderThick * 2);
      const wGeo = new THREE.BoxGeometry(borderThick, borderH, sideLength);
      const wMesh = new THREE.Mesh(wGeo, borderMat);
      wMesh.position.set(-hx + borderThick / 2, y, 0);
      rimGroup.add(wMesh);

      // East (right border along Z)
      const eMesh = new THREE.Mesh(wGeo, borderMat);
      eMesh.position.set(hx - borderThick / 2, y, 0);
      rimGroup.add(eMesh);

      // Top glowing cyan trim strips on the borders
      const stripY = y + borderH / 2 + 0.001;
      const nStripGeo = new THREE.PlaneGeometry(this.platformSizeX, 0.015);
      const nStrip = new THREE.Mesh(nStripGeo, neonMat);
      nStrip.rotation.x = -Math.PI / 2;
      nStrip.position.set(0, stripY, -hz + borderThick / 2);
      rimGroup.add(nStrip);

      const sStrip = new THREE.Mesh(nStripGeo, neonMat);
      sStrip.rotation.x = -Math.PI / 2;
      sStrip.position.set(0, stripY, hz - borderThick / 2);
      rimGroup.add(sStrip);

      const sideStripGeo = new THREE.PlaneGeometry(0.015, sideLength);
      const wStrip = new THREE.Mesh(sideStripGeo, neonMat);
      wStrip.rotation.x = -Math.PI / 2;
      wStrip.position.set(-hx + borderThick / 2, stripY, 0);
      rimGroup.add(wStrip);

      const eStrip = new THREE.Mesh(sideStripGeo, neonMat);
      eStrip.rotation.x = -Math.PI / 2;
      eStrip.position.set(hx - borderThick / 2, stripY, 0);
      rimGroup.add(eStrip);

      this.platformGroup.add(rimGroup);
      rimGroup.visible = !this.isFullscreen;
    },

    toggleFullscreen() {
      this.setFullscreen(!this.isFullscreen);
    },

    setFullscreen(enable) {
      this.isFullscreen = !!enable;
      const vp = document.getElementById('bench-platform-viewport');
      const btn = document.getElementById('btn-bench-platform-fullscreen');
      if (!vp) return;

      if (this.isFullscreen) {
        if (!this._placeholder) {
          this._placeholder = document.createElement('div');
          this._placeholder.id = 'bench-platform-placeholder';
          this._placeholder.style.display = 'none';
        }
        if (vp.parentNode && vp.parentNode !== document.body) {
          vp.parentNode.insertBefore(this._placeholder, vp);
          document.body.appendChild(vp);
        }
        vp.classList.add('fullscreen');
      } else {
        vp.classList.remove('fullscreen');
        if (this._placeholder && this._placeholder.parentNode) {
          this._placeholder.parentNode.insertBefore(vp, this._placeholder);
          this._placeholder.parentNode.removeChild(this._placeholder);
          this._placeholder = null;
        }
      }

      if (btn) {
        const iconExpand = btn.querySelector('.icon-expand');
        const iconCollapse = btn.querySelector('.icon-collapse');
        if (iconExpand) iconExpand.style.display = this.isFullscreen ? 'none' : 'block';
        if (iconCollapse) iconCollapse.style.display = this.isFullscreen ? 'block' : 'none';
        btn.title = this.isFullscreen ? (I18n.t('settings_modal.bench_exit_fullscreen') || 'Свернуть') : (I18n.t('settings_modal.bench_fullscreen') || 'На весь экран');
      }

      if (this.isFullscreen) {
        this.platformSizeX = 4.4;
        this.platformSizeZ = 2.6;
        this.platformThickness = 0.18;
        this.score = 0;
        if (this.holeMesh) this.holeMesh.visible = true;
        if (this.rimGroup) this.rimGroup.visible = false;
        this.spawnHole();
      } else {
        this.platformSizeX = 3.4;
        this.platformSizeZ = 2.1;
        this.platformThickness = 0.16;
        if (this.holeMesh) this.holeMesh.visible = false;
        if (this.rimGroup) this.rimGroup.visible = true;
      }

      this.rebuildPlatformGeometry();
      this.respawnBall();
      this.syncDimensions(true);
      requestAnimationFrame(() => {
        this.syncDimensions(true);
      });
      setTimeout(() => {
        this.syncDimensions(true);
      }, 60);
      this.updateHud(true);
    },

    rebuildPlatformGeometry() {
      if (!this.slabMesh || !window.THREE) return;
      const THREE = window.THREE;

      if (this.slabMesh.geometry) this.slabMesh.geometry.dispose();
      this.slabMesh.geometry = new THREE.BoxGeometry(this.platformSizeX, this.platformThickness, this.platformSizeZ);

      if (this.pedMid && this.pedMid.geometry) {
        this.pedMid.geometry.dispose();
        this.pedMid.geometry = new THREE.BoxGeometry(this.platformSizeX * 0.88, 0.08, this.platformSizeZ * 0.88);
        this.pedMid.position.y = -this.platformThickness / 2 - 0.04;
      }
      if (this.pedLow && this.pedLow.geometry) {
        this.pedLow.geometry.dispose();
        this.pedLow.geometry = new THREE.BoxGeometry(this.platformSizeX * 0.68, 0.10, this.platformSizeZ * 0.68);
        this.pedLow.position.y = -this.platformThickness / 2 - 0.13;
      }
      if (this.gimbalHub) {
        this.gimbalHub.position.y = -this.platformThickness / 2 - 0.24;
      }
      if (this.hubRing) {
        this.hubRing.position.y = -this.platformThickness / 2 - 0.24;
      }

      this.createEdgeLine();
      this.createRunes();
      this.createBorders();
    },

    updateTheme(theme) {
      const isLight = (theme === 'light');
      if (this.slabMat) {
        this.slabMat.color.setHex(isLight ? 0x2e3644 : 0x151821);
      }
      if (this.pedMat) {
        this.pedMat.color.setHex(isLight ? 0x242a36 : 0x0e1017);
      }
    },

    spawnHole() {
      const marginX = 0.40;
      const marginZ = 0.35;
      const maxSpawnX = (this.platformSizeX / 2) - this.ballRadius - marginX;
      const maxSpawnZ = (this.platformSizeZ / 2) - this.ballRadius - marginZ;

      let randX = 0;
      let randZ = 0;
      let attempts = 0;
      do {
        randX = (Math.random() * 2 - 1) * maxSpawnX;
        randZ = (Math.random() * 2 - 1) * maxSpawnZ;
        attempts++;
      } while (Math.hypot(randX, randZ) < 0.65 && attempts < 25);

      this.holePos = { x: randX, z: randZ };
      if (this.holeMesh) {
        this.holeMesh.position.set(randX, 0, randZ);
      }
    },

    triggerConfetti(posX, posZ) {
      if (!this.platformGroup || !window.THREE) return;
      const THREE = window.THREE;
      const count = 48;
      const geom = new THREE.PlaneGeometry(0.09, 0.05);

      for (let i = 0; i < count; i++) {
        const color = this.confettiColors[Math.floor(Math.random() * this.confettiColors.length)];
        const mat = new THREE.MeshBasicMaterial({
          color: color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 1.0
        });
        const mesh = new THREE.Mesh(geom, mat);
        const yPos = this.platformThickness / 2 + 0.08;
        mesh.position.set(posX, yPos, posZ);

        const angle = Math.random() * Math.PI * 2;
        const speedH = 0.9 + Math.random() * 2.2;
        const speedY = 2.4 + Math.random() * 3.0;

        this.platformGroup.add(mesh);
        this.confettiParticles.push({
          mesh: mesh,
          vx: Math.cos(angle) * speedH,
          vy: speedY,
          vz: Math.sin(angle) * speedH,
          rotSpeedX: (Math.random() - 0.5) * 16,
          rotSpeedY: (Math.random() - 0.5) * 16,
          rotSpeedZ: (Math.random() - 0.5) * 16,
          age: 0,
          life: 1.2 + Math.random() * 0.7
        });
      }
    },

    updateConfetti(dt) {
      if (!this.confettiParticles.length) return;
      const gravity = 8.0;
      for (let i = this.confettiParticles.length - 1; i >= 0; i--) {
        const p = this.confettiParticles[i];
        p.age += dt;
        if (p.age >= p.life) {
          if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
          if (p.mesh.geometry) p.mesh.geometry.dispose();
          if (p.mesh.material) p.mesh.material.dispose();
          this.confettiParticles.splice(i, 1);
          continue;
        }

        p.vy -= gravity * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;

        p.mesh.rotation.x += p.rotSpeedX * dt;
        p.mesh.rotation.y += p.rotSpeedY * dt;
        p.mesh.rotation.z += p.rotSpeedZ * dt;

        const remaining = p.life - p.age;
        if (remaining < 0.35) {
          p.mesh.material.opacity = Math.max(0, remaining / 0.35);
        }
      }
    },

    respawnBall() {
      this.isFalling = false;
      this.ballPos.x = 0;
      this.ballPos.z = 0;
      this.ballPosY = this.platformThickness / 2 + this.ballRadius;
      this.ballVel.x = 0;
      this.ballVel.z = 0;
      this.ballVelY = 0;
      if (this.ballMesh) {
        this.ballMesh.scale.set(1, 1, 1);
        this.ballMesh.position.set(0, this.ballPosY, 0);
        this.ballMesh.rotation.set(0, 0, 0);
      }
    },

    onDisconnect() {
      this.isOffline = true;
      this.isFalling = false;
      this.ballVel.x = 0;
      this.ballVel.z = 0;
      this.ballVelY = 0;
    },

    recenter() {
      this.pitchOffset = this.lastRawPitch || 0;
      this.rollOffset = this.lastRawRoll || 0;
      this.yawOffset = this.lastRawYaw || 0;
      this.pitch = 0;
      this.roll = 0;
      this.yaw = 0;
      this.respawnBall();
      if (this.platformGroup) {
        this.platformGroup.rotation.set(0, 0, 0);
      }
      for (const p of this.confettiParticles) {
        if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
        if (p.mesh.geometry) p.mesh.geometry.dispose();
        if (p.mesh.material) p.mesh.material.dispose();
      }
      this.confettiParticles = [];
      this.spawnHole();
      this.updateHud();
      if (window.go?.main?.App?.ResetAHRS) {
        window.go.main.App.ResetAHRS().catch(() => {});
      }
    },

    animateScore(type) {
      const els = [
        document.getElementById('bench-hud-score'),
        document.getElementById('bench-fs-score')
      ];
      const cls = (type === 'up') ? 'bench-score-up' : 'bench-score-lost';
      els.forEach(el => {
        if (!el) return;
        el.classList.remove('bench-score-up', 'bench-score-lost');
        void el.offsetWidth;
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), 500);
      });
    },

    onFrame(frame) {
      if (!this.initialized || !this.platformGroup) return;
      this.isOffline = false;

      // Absolute AHRS controller attitude (100% drift-free and immune to fast-spin integration drift)
      if (frame && typeof frame.pitch === 'number') {
        const rawP = Number(frame.pitch || 0);
        const rawR = Number(frame.roll || 0);
        const rawY = Number(frame.yaw || 0);

        this.lastRawPitch = rawP;
        this.lastRawRoll = rawR;
        this.lastRawYaw = rawY;

        const deg2rad = Math.PI / 180;
        const targetP = -(rawP - this.pitchOffset) * deg2rad;
        const targetR = -(rawR - this.rollOffset) * deg2rad;
        const targetY = -(rawY - this.yawOffset) * deg2rad;

        // Smooth lerp tracking (snappy 1:1 responsive feel)
        const factor = 0.35;
        this.pitch += (targetP - this.pitch) * factor;
        this.roll += (targetR - this.roll) * factor;
        this.yaw += (targetY - this.yaw) * factor;

        this.platformGroup.rotation.x = this.pitch;
        this.platformGroup.rotation.z = this.roll;
        this.platformGroup.rotation.y = this.yaw;
      }
    },

    onMotion(vx, vy, vz, dt) {
      // Retained for backward compatibility
      if (!this.initialized || !this.platformGroup) return;
      this.isOffline = false;
    },

    updatePhysics(dt) {
      if (!this.platformGroup || !this.ballMesh) return;

      // When disconnected / offline: smoothly return platform to level and ball to center
      if (this.isOffline) {
        const levelSpeed = Math.min(1.0, dt * 6.0);
        this.pitch += (0 - this.pitch) * levelSpeed;
        this.roll += (0 - this.roll) * levelSpeed;
        this.yaw += (0 - this.yaw) * levelSpeed;
        this.platformGroup.rotation.set(this.pitch, this.yaw, this.roll);

        this.ballPos.x += (0 - this.ballPos.x) * levelSpeed;
        this.ballPos.z += (0 - this.ballPos.z) * levelSpeed;
        this.ballVel.x = 0;
        this.ballVel.z = 0;
        this.ballVelY = 0;
        this.isFalling = false;
        this.ballPosY = this.platformThickness / 2 + this.ballRadius;
        this.ballMesh.scale.set(1, 1, 1);
        this.ballMesh.position.set(this.ballPos.x, this.ballPosY, this.ballPos.z);
        this.updateHud();
        return;
      }

      if (this.isFalling) {
        this.ballVelY -= 32.0 * dt;
        this.ballPosY += this.ballVelY * dt;
        this.ballPos.x += this.ballVel.x * dt;
        this.ballPos.z += this.ballVel.z * dt;

        this.ballMesh.rotation.x += 10.0 * dt;
        this.ballMesh.rotation.z += 10.0 * dt;

        this.ballMesh.position.x = this.ballPos.x;
        this.ballMesh.position.y = this.ballPosY;
        this.ballMesh.position.z = this.ballPos.z;

        const progress = Math.min(1.0, Math.max(0.0, -this.ballPosY / 5.0));
        const s = Math.max(0.08, 1.0 - progress * 0.9);
        this.ballMesh.scale.set(s, s, s);

        if (this.ballPosY < -5.0) {
          this.respawnBall();
        }
        return;
      }

      // Gravity acceleration along inclined plane
      const gravity = 25.0;
      const ax = -Math.sin(this.roll) * gravity;
      const az = Math.sin(this.pitch) * gravity;

      this.ballVel.x += ax * dt;
      this.ballVel.z += az * dt;

      if (!this.isFullscreen) {
        // NON-FULLSCREEN MODE: Simple test sphere with protective borders!
        // No hole suction, no scoring, no falling off edges!
        const borderInset = 0.07 + this.ballRadius;
        const limitX = this.platformSizeX / 2 - borderInset;
        const limitZ = this.platformSizeZ / 2 - borderInset;

        if (this.ballPos.x > limitX) {
          this.ballPos.x = limitX;
          this.ballVel.x = -Math.abs(this.ballVel.x) * 0.45;
        } else if (this.ballPos.x < -limitX) {
          this.ballPos.x = -limitX;
          this.ballVel.x = Math.abs(this.ballVel.x) * 0.45;
        }

        if (this.ballPos.z > limitZ) {
          this.ballPos.z = limitZ;
          this.ballVel.z = -Math.abs(this.ballVel.z) * 0.45;
        } else if (this.ballPos.z < -limitZ) {
          this.ballPos.z = -limitZ;
          this.ballVel.z = Math.abs(this.ballVel.z) * 0.45;
        }

        // Rolling surface friction
        const damping = Math.pow(0.95, dt * 60);
        this.ballVel.x *= damping;
        this.ballVel.z *= damping;

        this.ballPos.x += this.ballVel.x * dt;
        this.ballPos.z += this.ballVel.z * dt;

        // Position ball on top of slab
        this.ballPosY = this.platformThickness / 2 + this.ballRadius;
        this.ballMesh.position.x = this.ballPos.x;
        this.ballMesh.position.y = this.ballPosY;
        this.ballMesh.position.z = this.ballPos.z;

        // Non-slip rolling rotation
        this.ballMesh.rotation.z -= (this.ballVel.x * dt) / this.ballRadius;
        this.ballMesh.rotation.x -= (this.ballVel.z * dt) / this.ballRadius;
        return;
      }

      // Suction pull near goal hole
      const distToHole = Math.hypot(this.ballPos.x - this.holePos.x, this.ballPos.z - this.holePos.z);
      if (distToHole < 0.32) {
        const pull = (0.32 - distToHole) * 30.0;
        const angle = Math.atan2(this.holePos.z - this.ballPos.z, this.holePos.x - this.ballPos.x);
        this.ballVel.x += Math.cos(angle) * pull * dt;
        this.ballVel.z += Math.sin(angle) * pull * dt;
      }

      // Goal detection: ball enters hole
      if (distToHole < 0.15) {
        this.score++;
        if (this.score > this.record) {
          this.record = this.score;
          localStorage.setItem('gb_platform_record', this.record.toString());
        }
        this.triggerConfetti(this.holePos.x, this.holePos.z);
        if (typeof SoundManager !== 'undefined' && SoundManager.play) {
          SoundManager.play('goal');
        }
        this.animateScore('up');
        this.spawnHole();
        this.respawnBall();
        this.updateHud();
        return;
      }

      // Rolling surface friction
      const damping = Math.pow(0.95, dt * 60);
      this.ballVel.x *= damping;
      this.ballVel.z *= damping;

      this.ballPos.x += this.ballVel.x * dt;
      this.ballPos.z += this.ballVel.z * dt;

      // Check if ball rolls over the open edge of the platform
      const halfX = this.platformSizeX / 2;
      const halfZ = this.platformSizeZ / 2;
      const contactRadius = this.ballRadius * 0.70;
      const overEdge = (Math.abs(this.ballPos.x) > halfX + contactRadius || Math.abs(this.ballPos.z) > halfZ + contactRadius);

      if (overEdge) {
        if (this.isOffline) {
          this.respawnBall();
          return;
        }
        this.isFalling = true;
        this.ballVelY = -0.8;
        this.ballPosY = this.platformThickness / 2 + this.ballRadius;

        if (typeof SoundManager !== 'undefined' && SoundManager.play) {
          SoundManager.play('defeat');
        }
        if (this.score > 0) {
          this.animateScore('lost');
        }
        this.score = 0;
        this.updateHud();
        return;
      }

      // Position ball on top of slab
      this.ballPosY = this.platformThickness / 2 + this.ballRadius;
      this.ballMesh.position.x = this.ballPos.x;
      this.ballMesh.position.y = this.ballPosY;
      this.ballMesh.position.z = this.ballPos.z;

      // Non-slip rolling rotation
      this.ballMesh.rotation.z -= (this.ballVel.x * dt) / this.ballRadius;
      this.ballMesh.rotation.x -= (this.ballVel.z * dt) / this.ballRadius;
    },

    cacheHudElements() {
      if (this.hudElements) return this.hudElements;
      this.hudElements = {
        score: document.getElementById('bench-hud-score'),
        record: document.getElementById('bench-hud-record'),
        pitch: document.getElementById('bench-hud-pitch'),
        roll: document.getElementById('bench-hud-roll'),
        fsScore: document.getElementById('bench-fs-score'),
        fsRecord: document.getElementById('bench-fs-record')
      };
      return this.hudElements;
    },

    updateHud(force = false) {
      const now = performance.now();
      const els = this.cacheHudElements();

      if (force || this.score !== this.lastHudScore) {
        this.lastHudScore = this.score;
        const scoreLabel = (typeof I18n !== 'undefined' ? I18n.t('settings_modal.bench_score') : '') || 'Счёт';
        if (els.score) els.score.textContent = `${scoreLabel}: ${this.score}`;
        if (els.fsScore) els.fsScore.textContent = this.score.toString();
      }

      if (force || this.record !== this.lastHudRecord) {
        this.lastHudRecord = this.record;
        const recordLabel = (typeof I18n !== 'undefined' ? I18n.t('settings_modal.bench_record') : '') || 'Рекорд';
        if (els.record) els.record.textContent = `${recordLabel}: ${this.record}`;
        if (els.fsRecord) els.fsRecord.textContent = this.record.toString();
      }

      if (force || (now - this.lastHudTs >= 100)) {
        this.lastHudTs = now;
        if (els.pitch) {
          const deg = this.pitch * (180 / Math.PI);
          els.pitch.textContent = `P: ${(deg >= 0 ? '+' : '')}${deg.toFixed(1)}°`;
        }
        if (els.roll) {
          const deg = -this.roll * (180 / Math.PI);
          els.roll.textContent = `R: ${(deg >= 0 ? '+' : '')}${deg.toFixed(1)}°`;
        }
      }
    },

    updateAndRender() {
      if (!this.initialized || !this.renderer || !this.scene || !this.camera) return;

      const now = performance.now();
      const dt = this.lastTickTs ? Math.min(0.05, Math.max(0.001, (now - this.lastTickTs) / 1000)) : 0.016;
      this.lastTickTs = now;

      this.updatePhysics(dt);
      this.updateConfetti(dt);

      if (this.beaconMesh && this.beaconMesh.material) {
        this.beaconMesh.material.opacity = 0.26 + Math.sin(now * 0.005) * 0.12;
      }

      if (this.cachedW <= 0) {
        this.syncDimensions(true);
      }

      this.renderer.render(this.scene, this.camera);
    }
  };

  // ── Real-Time Response Test Bench ──────────────────────────────────────────
  const TuningBench = {
    active: false,
    initialized: false,
    activeGame: localStorage.getItem('gb_bench_active_game') || 'aim', // 'aim' | 'platform'
    dataFeed: localStorage.getItem('gb_bench_data_feed') || 'dsu',     // 'dsu' | 'raw'
    activeAxis: 'x', // 'x' = Pitch, 'y' = Yaw, 'z' = Roll, 'all' = 3 Stacked Graphs
    reticleX: 0,
    reticleY: 0,
    invertX: localStorage.getItem('gb_bench_inv_x') === 'true',
    invertY: localStorage.getItem('gb_bench_inv_y') === 'true',
    maxHistory: 140,
    historyRaw: { x: [], y: [], z: [] },
    historyFilt: { x: [], y: [], z: [] },
    recentRawDev: [],
    recentFiltDev: [],
    lastFrameTs: 0,
    rafId: null,
    cachedCanvasW: 0,
    cachedCanvasH: 0,
    lastDomUpdateTs: 0,
    lastLiveHz: -1,
    reticleDotEl: null,
    hudAimXEl: null,
    hudAimYEl: null,
    stabilityTagEl: null,
    _lastStabilityMode: '',

    syncDimensions(force = false) {
      const canvas = document.getElementById('bench-oscilloscope-canvas');
      if (!canvas) return;
      const targetH = (this.activeAxis === 'all' ? 220 : 95);
      const w = Math.floor(canvas.clientWidth || 340);
      const h = targetH;
      if (force || w !== this.cachedCanvasW || h !== this.cachedCanvasH) {
        this.cachedCanvasW = w;
        this.cachedCanvasH = h;
      }
    },

    init() {
      if (this.initialized) return;
      this.initialized = true;

      // Initialize both Aim and Platform game modules
      AimGame.init();

      // Mini-Game tabs switching ('aim' vs 'platform')
      const gameTabs = document.querySelectorAll('#bench-game-tabs .bench-game-tab');
      gameTabs.forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-game') || 'aim';
          this.switchGame(target);
        });
      });

      // Data feed toggle buttons ('dsu' vs 'raw')
      const btnFeedAim = document.getElementById('btn-bench-feed-aim');
      const btnFeedPlatform = document.getElementById('btn-bench-feed-platform');
      const onToggleFeed = () => {
        this.dataFeed = (this.dataFeed === 'dsu') ? 'raw' : 'dsu';
        localStorage.setItem('gb_bench_data_feed', this.dataFeed);
        this.syncFeedButtons();
      };
      if (btnFeedAim) btnFeedAim.addEventListener('click', onToggleFeed);
      if (btnFeedPlatform) btnFeedPlatform.addEventListener('click', onToggleFeed);
      this.syncFeedButtons();

      // Axis tabs switching (Pitch, Yaw, Roll, All)
      const tabBtns = document.querySelectorAll('#bench-axis-tabs .bench-axis-tab');
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          tabBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.activeAxis = btn.getAttribute('data-axis') || 'x';

          const canvas = document.getElementById('bench-oscilloscope-canvas');
          if (canvas) {
            canvas.classList.toggle('mode-all', this.activeAxis === 'all');
          }
          this.syncDimensions(true);
        });
      });

      // Recenter buttons
      document.getElementById('btn-bench-recenter-aim')?.addEventListener('click', () => {
        this.recenter();
      });
      document.getElementById('btn-bench-recenter-platform')?.addEventListener('click', () => {
        PlatformGame.recenter();
      });
      document.getElementById('btn-bench-recenter')?.addEventListener('click', () => {
        this.recenter();
        PlatformGame.recenter();
      });

      // Window resize listener
      window.addEventListener('resize', () => {
        if (this.active) {
          this.syncDimensions(true);
          if (this.activeGame === 'platform') {
            PlatformGame.syncDimensions(true);
          } else if (this.activeGame === 'aim') {
            AimGame.syncState();
          }
        }
      });

      // Wails 60 Hz telemetry event
      if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('tuning:frame', (frame) => {
          if (typeof RecenterManager !== 'undefined') {
            RecenterManager.onFrame(frame);
          }
          if (this.active) {
            this.onFrame(frame);
          }
        });

        window.runtime.EventsOn('device:disconnected', () => {
          if (this.active) {
            this.setOfflineState();
          }
        });

        window.runtime.EventsOn('device:connected', () => {
          if (this.active) {
            this.setWaitingState();
          }
        });
      }
    },

    switchGame(target) {
      this.activeGame = target;
      localStorage.setItem('gb_bench_active_game', target);

      const gameTabs = document.querySelectorAll('#bench-game-tabs .bench-game-tab');
      gameTabs.forEach(b => b.classList.toggle('active', b.getAttribute('data-game') === target));

      const viewAim = document.getElementById('bench-game-aim');
      const viewPlatform = document.getElementById('bench-game-platform');
      if (viewAim) viewAim.style.display = (target === 'aim') ? 'flex' : 'none';
      if (viewPlatform) viewPlatform.style.display = (target === 'platform') ? 'flex' : 'none';

      this.syncDimensions(true);

      if (target === 'platform') {
        if (typeof AimGame !== 'undefined' && AimGame.isFullscreen) {
          AimGame.setFullscreen(false);
        }
        PlatformGame.init();
        PlatformGame.syncDimensions(true);
        PlatformGame.updateAndRender();
      } else if (target === 'aim') {
        if (typeof PlatformGame !== 'undefined' && PlatformGame.isFullscreen) {
          PlatformGame.setFullscreen(false);
        }
        AimGame.init();
        AimGame.syncState();
      }
    },

    syncFeedButtons() {
      const isRaw = (this.dataFeed === 'raw');
      const label = isRaw ? (I18n.t('settings_modal.bench_feed_raw') || 'Сырой') : (I18n.t('settings_modal.bench_feed_dsu') || 'DSU');
      const btns = [
        document.getElementById('btn-bench-feed-aim'),
        document.getElementById('btn-bench-feed-platform')
      ];
      btns.forEach(btn => {
        if (!btn) return;
        btn.textContent = label;
        btn.classList.toggle('raw', isRaw);
      });
    },

    setOfflineState() {
      const overlay = document.getElementById('bench-offline-overlay');
      if (overlay) overlay.classList.add('visible');

      const livePill = document.getElementById('bench-live-pill');
      if (livePill) livePill.classList.add('offline');

      const liveText = document.getElementById('bench-live-text');
      if (liveText) liveText.textContent = I18n.t('settings_modal.bench_offline') || 'Офлайн';

      const stabilityTag = document.getElementById('bench-stability-tag');
      if (stabilityTag) {
        stabilityTag.textContent = I18n.t('settings_modal.bench_status_offline') || 'Офлайн';
        stabilityTag.className = 'bench-status-tag offline';
      }

      const noiseStat = document.getElementById('bench-noise-stat');
      if (noiseStat) {
        const prefix = I18n.t('settings_modal.bench_noise_stat') || 'Подавление шума';
        noiseStat.textContent = `${prefix}: --%`;
      }

      const fpsStat = document.getElementById('bench-fps-stat');
      if (fpsStat) {
        fpsStat.textContent = '-- Hz';
      }

      if (typeof PlatformGame !== 'undefined' && PlatformGame.onDisconnect) {
        PlatformGame.onDisconnect();
      }
    },

    setWaitingState() {
      const overlay = document.getElementById('bench-offline-overlay');
      if (overlay) overlay.classList.remove('visible');

      const livePill = document.getElementById('bench-live-pill');
      if (livePill) livePill.classList.add('offline');

      const liveText = document.getElementById('bench-live-text');
      if (liveText) liveText.textContent = I18n.t('settings_modal.bench_device_waiting') || 'Ожидание...';

      const stabilityTag = document.getElementById('bench-stability-tag');
      if (stabilityTag) {
        stabilityTag.textContent = I18n.t('settings_modal.bench_status_still') || 'Покой';
        stabilityTag.className = 'bench-status-tag still';
      }

      if (typeof PlatformGame !== 'undefined' && PlatformGame.onDisconnect) {
        PlatformGame.onDisconnect();
      }
    },

    setLiveState(hz) {
      const roundedHz = Math.round(hz || 60);
      const overlay = document.getElementById('bench-offline-overlay');
      if (overlay && overlay.classList.contains('visible')) overlay.classList.remove('visible');

      const livePill = document.getElementById('bench-live-pill');
      if (livePill && livePill.classList.contains('offline')) livePill.classList.remove('offline');

      if (this.lastLiveHz !== roundedHz) {
        this.lastLiveHz = roundedHz;
        const liveText = document.getElementById('bench-live-text');
        if (liveText) {
          const label = I18n.t('settings_modal.bench_live') || 'В эфире';
          liveText.textContent = `${label} ${roundedHz} Hz`;
        }

        if (!this.fpsStatEl) this.fpsStatEl = document.getElementById('bench-fps-stat');
        if (this.fpsStatEl) {
          this.fpsStatEl.textContent = `${roundedHz} Hz`;
        }
      }

      if (typeof PlatformGame !== 'undefined') {
        PlatformGame.isOffline = false;
      }
    },

    start() {
      this.active = true;
      this.reticleX = 0;
      this.reticleY = 0;
      this.switchGame(this.activeGame);
      this.syncFeedButtons();
      this.syncDimensions(true);

      // Pre-fill history arrays with 120 zeroes so lines render continuously
      this.historyRaw = {
        x: new Array(120).fill(0),
        y: new Array(120).fill(0),
        z: new Array(120).fill(0)
      };
      this.historyFilt = {
        x: new Array(120).fill(0),
        y: new Array(120).fill(0),
        z: new Array(120).fill(0)
      };
      this.recentRawDev = [];
      this.recentFiltDev = [];
      this.lastFrameTs = 0;
      this.renderReticle();

      if (typeof NetSparkline !== 'undefined') {
        NetSparkline.render();
      }

      // Check current connection state
      const isOnline = (AppState.lastState && (AppState.lastState.status === 'online' || AppState.lastState.connected));
      if (!isOnline) {
        this.setOfflineState();
      } else {
        this.setWaitingState();
      }

      if (!this.rafId) {
        const loop = () => {
          if (!this.active) {
            this.rafId = null;
            return;
          }
          this.drawOscilloscope();
          if (this.activeGame === 'aim') {
            this.renderReticle();
            if (typeof AimGame !== 'undefined' && AimGame.isFullscreen) {
              AimGame.update(performance.now());
            }
          } else if (this.activeGame === 'platform') {
            PlatformGame.updateAndRender();
          }
          this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
      }
    },

    stop() {
      this.active = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (typeof AimGame !== 'undefined' && AimGame.isFullscreen) {
        AimGame.setFullscreen(false);
      }
      if (typeof PlatformGame !== 'undefined' && PlatformGame.onDisconnect) {
        PlatformGame.onDisconnect();
      }
      const canvas = document.getElementById('bench-oscilloscope-canvas');
      if (canvas) {
        canvas.classList.remove('mode-all');
      }
      this.activeAxis = 'x';
      const tabBtns = document.querySelectorAll('#bench-axis-tabs .bench-axis-tab');
      tabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-axis') === 'x'));
    },

    recenter() {
      this.reticleX = 0;
      this.reticleY = 0;
      this.renderReticle();
    },

    onFrame(frame) {
      if (!frame) return;

      // Extract properties safely handling both lowercase Wails JSON tags and uppercase
      const rawX = (frame.rawX !== undefined) ? frame.rawX : (frame.RawX || 0);
      const rawY = (frame.rawY !== undefined) ? frame.rawY : (frame.RawY || 0);
      const rawZ = (frame.rawZ !== undefined) ? frame.rawZ : (frame.RawZ || 0);
      const outX = (frame.outX !== undefined) ? frame.outX : (frame.OutX || 0);
      const outY = (frame.outY !== undefined) ? frame.outY : (frame.OutY || 0);
      const outZ = (frame.outZ !== undefined) ? frame.outZ : (frame.OutZ || 0);
      const hz = (frame.hz !== undefined) ? frame.hz : (frame.Hz || 60);

      const now = performance.now();
      const dt = this.lastFrameTs ? Math.min(0.05, Math.max(0.001, (now - this.lastFrameTs) / 1000)) : 0.016;
      this.lastFrameTs = now;

      // Active feed selection ('dsu' or 'raw')
      const curX = (this.dataFeed === 'raw') ? rawX : outX;
      const curY = (this.dataFeed === 'raw') ? rawY : outY;
      const curZ = (this.dataFeed === 'raw') ? rawZ : outZ;

      // 1. Numerical Aim Reticle Integration (Zelda mechanics: angular velocity integration)
      const aimSpeed = (typeof AimGame !== 'undefined' && AimGame.isFullscreen) ? Math.max(4.2, (window.innerWidth / 340) * 2.4) : 2.4; // px per degree
      this.reticleX += curY * dt * aimSpeed;
      this.reticleY -= curX * dt * aimSpeed;

      // Dynamic viewport bounds from AimGame
      const bounds = (typeof AimGame !== 'undefined' && AimGame.getBounds) ? AimGame.getBounds() : { maxReticleX: 150, maxReticleY: 52 };
      const maxW = bounds.maxReticleX;
      const maxH = bounds.maxReticleY;
      if (this.reticleX > maxW) this.reticleX = maxW;
      if (this.reticleX < -maxW) this.reticleX = -maxW;
      if (this.reticleY > maxH) this.reticleY = maxH;
      if (this.reticleY < -maxH) this.reticleY = -maxH;

      if (typeof AimGame !== 'undefined' && this.activeGame === 'aim') {
        AimGame.checkHit(this.reticleX, this.reticleY);
      }

      // 2. Absolute Drift-Free Platform Game Motion Tracking
      PlatformGame.onFrame(frame);

      // 3. Oscilloscope Multi-Axis Push (Always tracks Raw vs DSU for direct comparison)
      this.historyRaw.x.push(rawX);
      this.historyRaw.y.push(rawY);
      this.historyRaw.z.push(rawZ);
      this.historyFilt.x.push(outX);
      this.historyFilt.y.push(outY);
      this.historyFilt.z.push(outZ);

      if (this.historyRaw.x.length > this.maxHistory) {
        this.historyRaw.x.shift();
        this.historyRaw.y.shift();
        this.historyRaw.z.shift();
        this.historyFilt.x.shift();
        this.historyFilt.y.shift();
        this.historyFilt.z.shift();
      }

      // 4. Noise Reduction Calculation (RMS deviation comparison in resting/slow window)
      const currentRaw = (this.activeAxis === 'y') ? rawY : (this.activeAxis === 'z') ? rawZ : rawX;
      const currentFilt = (this.activeAxis === 'y') ? outY : (this.activeAxis === 'z') ? outZ : outX;

      this.recentRawDev.push(Math.abs(currentRaw));
      this.recentFiltDev.push(Math.abs(currentFilt));
      if (this.recentRawDev.length > 50) this.recentRawDev.shift();
      if (this.recentFiltDev.length > 50) this.recentFiltDev.shift();

      // 5. Throttled DOM updates (~10 Hz, 100ms) to eliminate layout thrashing
      const speed = Math.sqrt(outX * outX + outY * outY + outZ * outZ);
      if (now - this.lastDomUpdateTs >= 100) {
        this.lastDomUpdateTs = now;
        this.setLiveState(hz);
        this.updateStabilityTag(speed);
        this.updateNoiseReadout(speed);
        if (this.activeGame === 'platform') {
          PlatformGame.updateHud();
        }
      }
    },

    updateStabilityTag(speed) {
      if (!this.stabilityTagEl) this.stabilityTagEl = document.getElementById('bench-stability-tag');
      if (!this.stabilityTagEl) return;

      let mode = 'active';
      let i18nKey = 'settings_modal.bench_status_active';
      let fallback = 'Движение';
      if (speed < 0.12) {
        mode = 'still';
        i18nKey = 'settings_modal.bench_status_still';
        fallback = 'Покой';
      } else if (speed < 3.2) {
        mode = 'aim';
        i18nKey = 'settings_modal.bench_status_aim';
        fallback = 'Прицел';
      }

      if (this._lastStabilityMode !== mode) {
        this._lastStabilityMode = mode;
        this.stabilityTagEl.textContent = I18n.t(i18nKey) || fallback;
        this.stabilityTagEl.className = `bench-status-tag ${mode}`;
      }
    },

    renderReticle() {
      if (!this.reticleDotEl) this.reticleDotEl = document.getElementById('bench-reticle-dot');
      if (!this.hudAimXEl) this.hudAimXEl = document.getElementById('bench-hud-aim-x');
      if (!this.hudAimYEl) this.hudAimYEl = document.getElementById('bench-hud-aim-y');

      if (this.reticleDotEl) {
        this.reticleDotEl.style.transform = `translate(${Math.round(this.reticleX)}px, ${Math.round(this.reticleY)}px)`;
      }
      const aimSpeed = (typeof AimGame !== 'undefined' && AimGame.isFullscreen) ? Math.max(4.2, (window.innerWidth / 340) * 2.4) : 2.4;
      if (this.hudAimXEl) {
        const degX = (this.reticleX / aimSpeed);
        this.hudAimXEl.textContent = `X: ${(degX >= 0 ? '+' : '')}${degX.toFixed(1)}°`;
      }
      if (this.hudAimYEl) {
        const degY = (-this.reticleY / aimSpeed);
        this.hudAimYEl.textContent = `Y: ${(degY >= 0 ? '+' : '')}${degY.toFixed(1)}°`;
      }
    },

    updateNoiseReadout(speed) {
      const noiseEl = document.getElementById('bench-noise-stat');
      if (!noiseEl) return;

      const prefix = I18n.t('settings_modal.bench_noise_reduction') || 'Подавление шума';

      if (this.recentRawDev.length < 20) {
        noiseEl.textContent = `${prefix}: --%`;
        return;
      }

      const avgRaw = this.recentRawDev.reduce((a, b) => a + b, 0) / this.recentRawDev.length;
      const avgFilt = this.recentFiltDev.reduce((a, b) => a + b, 0) / this.recentFiltDev.length;

      if (avgRaw < 0.05 && avgFilt === 0) {
        noiseEl.textContent = `${prefix}: -99%`;
        return;
      }

      if (speed < 2.5 && avgRaw > 0.03) {
        const ratio = Math.max(0, Math.min(0.99, (avgRaw - avgFilt) / avgRaw));
        const pct = Math.round(ratio * 100);
        if (pct > 0) {
          noiseEl.textContent = `${prefix}: -${pct}%`;
        } else {
          noiseEl.textContent = `${prefix}: 0%`;
        }
      } else {
        const zeroLag = I18n.t('settings_modal.bench_zero_lag') || '0-задержка';
        noiseEl.textContent = `${prefix}: ${zeroLag}`;
      }
    },

    drawOscilloscope() {
      const canvas = document.getElementById('bench-oscilloscope-canvas');
      if (!canvas) return;

      // Watchdog: detect if telemetry packets stopped arriving
      const now = performance.now();
      if (this.lastFrameTs && (now - this.lastFrameTs > 1400)) {
        this.setOfflineState();
      }

      const targetH = (this.activeAxis === 'all' ? 220 : 95);
      const w = Math.floor(canvas.clientWidth || 340);
      const h = targetH;
      this.cachedCanvasW = w;
      this.cachedCanvasH = h;

      const dpr = window.devicePixelRatio || 1;
      const pixelW = Math.round(w * dpr);
      const pixelH = Math.round(h * dpr);

      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }

      const ctx = canvas.getContext('2d');
      ctx.save();
      // Complete physical canvas buffer clear to eliminate subpixel ghosting and stretching
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Theme-aware high contrast stroke colors for canvas elements
      const isLight = (document.documentElement.getAttribute('data-theme') === 'light' || document.body.getAttribute('data-theme') === 'light');
      const gridSeparator = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.08)';
      const gridCenter = isLight ? 'rgba(0, 0, 0, 0.32)' : 'rgba(255, 255, 255, 0.18)';
      const gridBounds = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.06)';

      if (this.activeAxis === 'all') {
        // Stacked 3-Axis Oscilloscope Mode
        const trackH = h / 3;
        const axes = ['x', 'y', 'z'];
        const isRu = (typeof I18n !== 'undefined' && I18n.currentLang === 'ru');
        const titles = isRu
          ? ['Pitch (Тангаж · X)', 'Yaw (Рыскание · Y)', 'Roll (Крен · Z)']
          : ['Pitch (X)', 'Yaw (Y)', 'Roll (Z)'];

        for (let k = 0; k < 3; k++) {
          const axis = axes[k];
          const topY = k * trackH;
          const centerY = topY + trackH / 2;

          // Track separator line
          if (k > 0) {
            ctx.beginPath();
            ctx.strokeStyle = gridSeparator;
            ctx.setLineDash([]);
            ctx.lineWidth = 1;
            ctx.moveTo(0, topY);
            ctx.lineTo(w, topY);
            ctx.stroke();
          }

          // Track center zero dashed line
          ctx.beginPath();
          ctx.strokeStyle = gridCenter;
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.moveTo(0, centerY);
          ctx.lineTo(w, centerY);
          ctx.stroke();
          ctx.setLineDash([]);

          const rawArr = this.historyRaw[axis] || [];
          const filtArr = this.historyFilt[axis] || [];
          const n = rawArr.length;

          // Prominent high-contrast Pill Badge for Axis Title
          const title = titles[k];
          ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
          const textMetrics = ctx.measureText(title);
          const badgeW = textMetrics.width + 12;
          const badgeH = 17;
          const badgeX = 8;
          const badgeY = topY + 4;

          ctx.fillStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.12)';
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            if (isLight) {
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          } else {
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
          }

          ctx.fillStyle = isLight ? '#000000' : '#ffffff';
          ctx.fillText(title, badgeX + 6, badgeY + 12);

          // Numeric DSU rate readout on right of track
          const curFilt = filtArr.length ? filtArr[filtArr.length - 1] : 0;
          const liveText = `DSU: ${(curFilt >= 0 ? '+' : '')}${curFilt.toFixed(1)}°/s`;
          ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillStyle = isLight ? '#0062D2' : '#0A84FF';
          const liveMetrics = ctx.measureText(liveText);
          ctx.fillText(liveText, w - liveMetrics.width - 8, badgeY + 12);

          if (n < 2) continue;

          let maxAmp = 8.0;
          for (let i = 0; i < n; i++) {
            const ar = Math.abs(rawArr[i]);
            const af = Math.abs(filtArr[i]);
            if (ar > maxAmp) maxAmp = ar;
            if (af > maxAmp) maxAmp = af;
          }
          const scale = (trackH * 0.38) / maxAmp;
          const dx = w / (this.maxHistory - 1);
          const startX = w - (n - 1) * dx;

          // 1. Filtered DSU trace (Electric Cyan/Blue, drawn first)
          ctx.beginPath();
          ctx.strokeStyle = isLight ? '#0071E3' : '#0A84FF';
          ctx.lineWidth = 2.2;
          for (let i = 0; i < n; i++) {
            const x = startX + i * dx;
            const y = centerY - filtArr[i] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // 2. Raw trace (Apple Orange, drawn on top so sensor noise spikes are clearly visible)
          ctx.beginPath();
          ctx.strokeStyle = isLight ? '#FF9500' : '#FF9F0A';
          ctx.lineWidth = isLight ? 1.6 : 1.4;
          for (let i = 0; i < n; i++) {
            const x = startX + i * dx;
            const y = centerY - rawArr[i] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else {
        // Single Axis Mode (Pitch, Yaw, or Roll)
        const centerY = h / 2;

        // Center reference zero line
        ctx.beginPath();
        ctx.strokeStyle = gridCenter;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();

        // Top and bottom boundary guides
        ctx.beginPath();
        ctx.strokeStyle = gridBounds;
        ctx.setLineDash([2, 4]);
        ctx.moveTo(0, centerY - h * 0.35);
        ctx.lineTo(w, centerY - h * 0.35);
        ctx.moveTo(0, centerY + h * 0.35);
        ctx.lineTo(w, centerY + h * 0.35);
        ctx.stroke();
        ctx.setLineDash([]);

        const rawArr = this.historyRaw[this.activeAxis] || [];
        const filtArr = this.historyFilt[this.activeAxis] || [];
        const n = rawArr.length;

        const isRu = (typeof I18n !== 'undefined' && I18n.currentLang === 'ru');
        let axisTitle = (this.activeAxis === 'y')
          ? (isRu ? 'Yaw (Рыскание · Y)' : 'Yaw (Y)')
          : (this.activeAxis === 'z')
            ? (isRu ? 'Roll (Крен · Z)' : 'Roll (Z)')
            : (isRu ? 'Pitch (Тангаж · X)' : 'Pitch (X)');

        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
        const textMetrics = ctx.measureText(axisTitle);
        const badgeW = textMetrics.width + 12;
        const badgeH = 18;
        const badgeX = 8;
        const badgeY = 6;

        ctx.fillStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.12)';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
          ctx.fill();
          if (isLight) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        } else {
          ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        }

        ctx.fillStyle = isLight ? '#000000' : '#ffffff';
        ctx.fillText(axisTitle, badgeX + 6, badgeY + 13);

        const curFilt = (filtArr && filtArr.length) ? filtArr[filtArr.length - 1] : 0;
        const liveText = `DSU: ${(curFilt >= 0 ? '+' : '')}${curFilt.toFixed(1)}°/s`;
        ctx.font = '600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = isLight ? '#0062D2' : '#0A84FF';
        const liveMetrics = ctx.measureText(liveText);
        ctx.fillText(liveText, w - liveMetrics.width - 8, badgeY + 13);

        if (n >= 2) {
          let maxAmp = 8.0;
          for (let i = 0; i < n; i++) {
            const ar = Math.abs(rawArr[i]);
            const af = Math.abs(filtArr[i]);
            if (ar > maxAmp) maxAmp = ar;
            if (af > maxAmp) maxAmp = af;
          }
          const scale = (h * 0.42) / maxAmp;
          const dx = w / (this.maxHistory - 1);
          const startX = w - (n - 1) * dx;

          // 1. Draw Filtered DSU trace (Apple Cyan/Blue, drawn first)
          ctx.beginPath();
          ctx.strokeStyle = isLight ? '#0071E3' : '#0A84FF';
          ctx.lineWidth = 2.2;
          for (let i = 0; i < n; i++) {
            const x = startX + i * dx;
            const y = centerY - filtArr[i] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // 2. Draw Raw trace (Apple Orange, drawn on top so sensor noise spikes are clearly visible)
          ctx.beginPath();
          ctx.strokeStyle = isLight ? '#FF9500' : '#FF9F0A';
          ctx.lineWidth = isLight ? 1.8 : 1.6;
          for (let i = 0; i < n; i++) {
            const x = startX + i * dx;
            const y = centerY - rawArr[i] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  };

  // ── Settings Module Manager ────────────────────────────────────────────────
  const SettingsManager = {
    isOpen: false,
    initialized: false,
    currentSettings: null,
    hotkeyRecenterKey: 'Ctrl+Shift+R',
    isRecordingHotkey: false,
    hotkeyKeyDownHandler: null,
    autoSaveTimer: null,

    DEFAULTS: {
      dsuPort: 26760,
      dsuMac: '00:13:37:00:00:01',
      httpPort: 8080,
      httpsPort: 8443,
      gyroDeadband: 0.10,
      gyroDeadbandUsb: 0.50,
      gyroSensitivity: 1.00,
      stillnessHint: true,
      disconnectAlert: true,
      silenceDisconnect: true,
      closeAction: 'ask',
      soundMode: 'cute',
      soundVolume: 1,
      soundVolumes: {
        connect: 1,
        disconnect: 1,
        dsu: 1,
        recenter: 1,
        goal: 1,
        defeat: 1,
        loss: 1
      },
      hotkeyRecenterEnabled: true,
      hotkeyRecenterKey: 'Ctrl+Shift+R',
      theme: 'dark',
      lang: 'ru',
      fontScale: 1.00
    },

    async init() {
      if (this.initialized) return;
      this.initialized = true;

      // Global Windows Hotkey Recorder
      document.getElementById('setting-hotkey-recorder')?.addEventListener('click', () => {
        this.startRecordingHotkey();
      });

      document.getElementById('btn-hotkey-clear')?.addEventListener('click', () => {
        this.hotkeyRecenterKey = '';
        this.renderHotkeyBadge('');
        this.updateModifiedIndicators();
        this.autoSave(true);
      });

      document.getElementById('setting-hotkey-recenter-enabled')?.addEventListener('change', (e) => {
        document.getElementById('apple-hotkey-control')?.classList.toggle('disabled', !e.target.checked);
        this.updateModifiedIndicators();
        this.autoSave(true);
      });

      // Header button toggle
      document.getElementById('btn-header-settings')?.addEventListener('click', () => {
        this.toggle();
      });

      // Close / Done button
      document.getElementById('btn-settings-close')?.addEventListener('click', () => {
        this.close();
      });

      // Reset to defaults button
      document.getElementById('btn-settings-reset')?.addEventListener('click', () => {
        this.resetToDefaults();
      });

      // Preview sound button
      document.getElementById('btn-sound-preview')?.addEventListener('click', () => {
        SoundManager.preview();
      });

      // Sound volume slider live preview & auto-save
      const volSlider = document.getElementById('setting-sound-volume');
      const volBadge = document.getElementById('setting-sound-vol-badge');
      if (volSlider) {
        const updateVolUI = () => {
          const val = parseInt(volSlider.value, 10);
          if (volBadge) {
            volBadge.textContent = (val === 0) ? (I18n.t('settings_modal.sound_off') || '0 (Off)') : (val + 'x');
          }
        };
        let previewDebounce = null;
        volSlider.addEventListener('input', () => {
          updateVolUI();
          this.updateModifiedIndicators();
          if (previewDebounce) clearTimeout(previewDebounce);
          previewDebounce = setTimeout(() => {
            SoundManager.preview();
          }, 80);
          this.autoSave(false);
        });
        volSlider.addEventListener('change', () => {
          updateVolUI();
          SoundManager.preview();
          this.autoSave(true);
        });
      }

      // Expandable sound drawer toggle
      const drawerToggleBtn = document.getElementById('btn-sound-details-toggle');
      const drawerRow = document.getElementById('row-sound-details-toggle');
      const soundDrawer = document.getElementById('sound-details-drawer');
      const toggleDrawer = () => {
        if (!soundDrawer) return;
        const tt = document.getElementById('settings-floating-tooltip');
        if (tt) { tt.classList.remove('show'); tt.style.display = 'none'; }
        const isHidden = (soundDrawer.style.display === 'none' || !soundDrawer.classList.contains('open'));
        if (isHidden) {
          soundDrawer.style.display = 'flex';
          void soundDrawer.offsetHeight;
          soundDrawer.classList.add('open');
          drawerToggleBtn?.classList.add('open');
          drawerToggleBtn?.setAttribute('aria-expanded', 'true');
        } else {
          soundDrawer.classList.remove('open');
          drawerToggleBtn?.classList.remove('open');
          drawerToggleBtn?.setAttribute('aria-expanded', 'false');
          setTimeout(() => {
            if (!soundDrawer.classList.contains('open')) {
              soundDrawer.style.display = 'none';
            }
          }, 240);
        }
      };

      drawerToggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDrawer();
      });

      drawerRow?.addEventListener('click', (e) => {
        if (e.target.closest('.setting-infotip') || e.target.closest('#btn-sound-details-toggle')) return;
        toggleDrawer();
      });

      // Individual sound sliders and play buttons
      document.querySelectorAll('.sound-individual-slider').forEach(slider => {
        const soundKey = slider.getAttribute('data-sound');
        const badge = document.getElementById(`setting-sound-badge-${soundKey}`);
        const updateSoundSliderUI = (preview = false) => {
          const val = parseInt(slider.value, 10);
          if (badge) {
            badge.textContent = (val === 0) ? (I18n.t('settings_modal.sound_off') || 'Выкл') : (val + 'x');
          }
          if (SoundManager.soundVolumes) {
            SoundManager.soundVolumes[soundKey] = val;
          }
          if (preview) {
            SoundManager.play(soundKey, true);
          }
        };

        let sliderDebounce = null;
        slider.addEventListener('input', () => {
          updateSoundSliderUI(false);
          this.updateModifiedIndicators();
          if (sliderDebounce) clearTimeout(sliderDebounce);
          sliderDebounce = setTimeout(() => {
            updateSoundSliderUI(true);
          }, 80);
          this.autoSave(false);
        });

        slider.addEventListener('change', () => {
          updateSoundSliderUI(true);
          this.autoSave(true);
        });
      });

      // Sound play preview buttons
      document.querySelectorAll('.btn-sound-detail-play').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const soundKey = btn.getAttribute('data-sound');
          if (soundKey) {
            SoundManager.play(soundKey, true);
          }
        });
      });

      // Theme segmented control clicks
      document.querySelectorAll('#setting-theme-segmented .settings-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#setting-theme-segmented .settings-seg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const val = btn.getAttribute('data-val');
          ThemeManager.apply(val, true);
          this.autoSave(true);
        });
      });

      // Language segmented control clicks
      document.querySelectorAll('#setting-lang-segmented .settings-seg-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          document.querySelectorAll('#setting-lang-segmented .settings-seg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const val = btn.getAttribute('data-val');
          await I18n.setLanguage(val);
          this.autoSave(true);
        });
      });

      // Port inputs
      ['setting-dsu-port', 'setting-http-port', 'setting-https-port'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
          el.classList.remove('error');
          this.updateModifiedIndicators();
          this.autoSave(false);
        });
        el.addEventListener('change', () => {
          this.updateModifiedIndicators();
          this.autoSave(true);
        });
      });

      // Regenerate DSU MAC Address
      document.getElementById('btn-regen-dsu-mac')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-regen-dsu-mac');
        const title = I18n.t('settings_modal.dsu_mac_regen_title') || 'Сгенерировать новый MAC?';
        const message = I18n.t('settings_modal.dsu_mac_regen_confirm') || 'Текущие привязки контроллера в эмуляторах (Cemu, Yuzu) потребуется выбрать заново.';
        const okText = I18n.t('settings_modal.dsu_mac_regen') || 'Сгенерировать';
        const cancelText = I18n.t('settings_modal.btn_cancel') || 'Отмена';

        const confirmed = await showAppleConfirm({ title, message, okText, cancelText });
        if (!confirmed) return;

        try {
          btn?.classList.add('spinning');
          const newMac = await window.go.main.App.RegenerateDSUMAC();
          const macInput = document.getElementById('setting-dsu-mac');
          if (macInput) macInput.value = newMac;
          showToast(I18n.t('settings_modal.dsu_mac_regen_success') || 'MAC-адрес успешно обновлен');
          setTimeout(() => btn?.classList.remove('spinning'), 500);
          this.updateModifiedIndicators();
          this.autoSave(true);
        } catch (err) {
          btn?.classList.remove('spinning');
          console.error('Failed to regenerate MAC:', err);
        }
      });

      // Sensitivity slider and direct numeric input bi-directional sync
      const sensSlider = document.getElementById('setting-gyro-sensitivity');
      const sensNumInput = document.getElementById('setting-gyro-sens-input');
      const sensBadge = document.getElementById('setting-gyro-sens-badge');

      if (sensSlider) {
        sensSlider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value || '1.00');
          if (sensNumInput) sensNumInput.value = val.toFixed(2);
          if (sensBadge) sensBadge.textContent = val.toFixed(2) + 'x';
          this.syncLiveFilter();
          this.autoSave(false);
        });
        sensSlider.addEventListener('change', () => {
          this.autoSave(true);
        });
      }

      if (sensNumInput) {
        const handleManualSens = (e) => {
          let val = parseFloat(e.target.value);
          if (isNaN(val) || val <= 0) val = 1.00;
          if (val > 10.00) val = 10.00;
          if (sensSlider) {
            sensSlider.value = Math.min(2.50, Math.max(0.50, val));
          }
          if (sensBadge) sensBadge.textContent = val.toFixed(2) + 'x';
          this.syncLiveFilter();
          this.autoSave(false);
        };
        sensNumInput.addEventListener('input', handleManualSens);
        sensNumInput.addEventListener('change', (e) => {
          let val = parseFloat(e.target.value);
          if (isNaN(val) || val < 0.10) val = 1.00;
          if (val > 10.00) val = 10.00;
          e.target.value = val.toFixed(2);
          handleManualSens(e);
          this.autoSave(true);
        });
      }

      // Gyro filtering selects live update
      ['setting-gyro-deadband', 'setting-gyro-deadband-usb'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
          this.syncLiveFilter();
          this.autoSave(true);
        });
      });

      // Checkbox toggles
      ['setting-stillness-hint', 'setting-disconnect-alert', 'setting-silence-disconnect'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
          this.autoSave(true);
        });
      });

      // Close action select
      document.getElementById('setting-close-action')?.addEventListener('change', () => {
        this.autoSave(true);
      });

      // Sound mode select
      document.getElementById('setting-sound-mode')?.addEventListener('change', () => {
        this.autoSave(true);
      });

      // Global font & UI scale slider live preview
      const fontScaleSlider = document.getElementById('setting-font-scale');
      const fontScaleBadge = document.getElementById('setting-font-scale-badge');
      if (fontScaleSlider) {
        fontScaleSlider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value || '1.00');
          if (fontScaleBadge) fontScaleBadge.textContent = val.toFixed(2) + 'x';
          FontScaleManager.apply(val, false, true);
          this.autoSave(false);
        });
        fontScaleSlider.addEventListener('change', (e) => {
          const val = parseFloat(e.target.value || '1.00');
          FontScaleManager.apply(val, true, true);
          this.autoSave(true);
        });
      }

      // Initialize Apple-style floating infotips
      this.initTooltips();

      // Initialize real-time response test bench
      TuningBench.init();

      // Load initial settings silently on startup
      await this.fetchSettings();

      // Initialize Apple-styled custom pop-up dropdowns
      if (typeof AppleSelect !== 'undefined') {
        AppleSelect.init();
      }
    },

    renderHotkeyBadge(keyStr) {
      const keysEl = document.getElementById('setting-hotkey-keys');
      if (!keysEl) return;
      keysEl.innerHTML = '';
      if (!keyStr) {
        const emptySpan = document.createElement('span');
        emptySpan.className = 'apple-hotkey-empty';
        emptySpan.setAttribute('data-i18n', 'settings_modal.hotkey_none');
        emptySpan.textContent = I18n.t('settings_modal.hotkey_none') || 'Не назначено';
        keysEl.appendChild(emptySpan);
        return;
      }
      const parts = keyStr.split('+');
      parts.forEach((p, idx) => {
        if (idx > 0) {
          const sep = document.createElement('span');
          sep.className = 'apple-key-sep';
          sep.textContent = '+';
          keysEl.appendChild(sep);
        }
        const kbd = document.createElement('kbd');
        kbd.className = 'apple-key';
        kbd.textContent = p.trim();
        keysEl.appendChild(kbd);
      });
    },

    startRecordingHotkey() {
      if (this.isRecordingHotkey) return;
      this.isRecordingHotkey = true;

      const recorder = document.getElementById('setting-hotkey-recorder');
      const keysEl = document.getElementById('setting-hotkey-keys');
      const labelEl = document.getElementById('setting-hotkey-recording-label');

      recorder?.classList.add('recording');
      if (keysEl) keysEl.style.display = 'none';
      if (labelEl) {
        labelEl.style.display = 'inline';
        labelEl.textContent = I18n.t('settings_modal.hotkey_record_prompt') || 'Нажмите сочетание клавиш...';
      }

      this.hotkeyKeyDownHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Cancel on Escape
        if (e.key === 'Escape') {
          this.stopRecordingHotkey(true);
          return;
        }

        // Clear on Backspace or Delete without modifiers
        if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          this.hotkeyRecenterKey = '';
          this.stopRecordingHotkey(false);
          return;
        }

        // Pure modifier pressed: show modifier in real-time
        const isModifier = ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key);
        if (isModifier) {
          const currentMods = [];
          if (e.ctrlKey) currentMods.push('Ctrl');
          if (e.altKey) currentMods.push('Alt');
          if (e.shiftKey) currentMods.push('Shift');
          if (e.metaKey) currentMods.push('Win');
          if (labelEl && currentMods.length > 0) {
            labelEl.textContent = currentMods.join(' + ') + ' + ...';
          }
          return;
        }

        // Non-modifier key pressed!
        const hasMod = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
        const isFKey = /^F([1-9]|1[0-2])$/.test(e.key) || /^F([1-9]|1[0-2])$/.test(e.code);

        // Validation: Require modifier OR F1-F12
        if (!hasMod && !isFKey) {
          if (labelEl) {
            labelEl.textContent = I18n.t('settings_modal.hotkey_record_modifier_req') || 'Нажмите клавишу с Ctrl, Alt или Shift';
            recorder?.classList.add('shake');
            setTimeout(() => recorder?.classList.remove('shake'), 400);
          }
          return;
        }

        // Resolve canonical key name from e.code
        let keyName = '';
        if (/^Key[A-Z]$/.test(e.code)) {
          keyName = e.code.replace('Key', '');
        } else if (/^Digit[0-9]$/.test(e.code)) {
          keyName = e.code.replace('Digit', '');
        } else if (/^F([1-9]|1[0-2])$/.test(e.code)) {
          keyName = e.code;
        } else if (/^Numpad[0-9]$/.test(e.code)) {
          keyName = 'Num' + e.code.replace('Numpad', '');
        } else {
          switch (e.code) {
            case 'Space': keyName = 'Space'; break;
            case 'Tab': keyName = 'Tab'; break;
            case 'Backquote': keyName = '~'; break;
            case 'Minus': keyName = '-'; break;
            case 'Equal': keyName = '='; break;
            case 'BracketLeft': keyName = '['; break;
            case 'BracketRight': keyName = ']'; break;
            case 'Semicolon': keyName = ';'; break;
            case 'Quote': keyName = "'"; break;
            case 'Comma': keyName = ','; break;
            case 'Period': keyName = '.'; break;
            case 'Slash': keyName = '/'; break;
            case 'Backslash': keyName = '\\'; break;
            case 'NumpadAdd': keyName = 'NumAdd'; break;
            case 'NumpadSubtract': keyName = 'NumSubtract'; break;
            case 'NumpadMultiply': keyName = 'NumMultiply'; break;
            case 'NumpadDivide': keyName = 'NumDivide'; break;
            case 'NumpadDecimal': keyName = 'NumDecimal'; break;
            case 'Home': keyName = 'Home'; break;
            case 'End': keyName = 'End'; break;
            case 'PageUp': keyName = 'PageUp'; break;
            case 'PageDown': keyName = 'PageDown'; break;
            case 'Insert': keyName = 'Insert'; break;
            default:
              if (e.key && e.key.length === 1) {
                keyName = e.key.toUpperCase();
              } else {
                keyName = e.key || '';
              }
          }
        }

        if (!keyName) return;

        const mods = [];
        if (e.ctrlKey) mods.push('Ctrl');
        if (e.altKey) mods.push('Alt');
        if (e.shiftKey) mods.push('Shift');
        if (e.metaKey) mods.push('Win');

        this.hotkeyRecenterKey = [...mods, keyName].join('+');
        this.stopRecordingHotkey(false);
      };

      window.addEventListener('keydown', this.hotkeyKeyDownHandler, { capture: true });

      // Click outside to cancel
      const clickOutsideHandler = (e) => {
        if (!e.target.closest('#setting-hotkey-recorder')) {
          this.stopRecordingHotkey(true);
          document.removeEventListener('pointerdown', clickOutsideHandler);
        }
      };
      setTimeout(() => {
        document.addEventListener('pointerdown', clickOutsideHandler);
      }, 50);
    },

    stopRecordingHotkey(cancelled = false) {
      if (!this.isRecordingHotkey) return;
      this.isRecordingHotkey = false;

      if (this.hotkeyKeyDownHandler) {
        window.removeEventListener('keydown', this.hotkeyKeyDownHandler, { capture: true });
        this.hotkeyKeyDownHandler = null;
      }

      const recorder = document.getElementById('setting-hotkey-recorder');
      const keysEl = document.getElementById('setting-hotkey-keys');
      const labelEl = document.getElementById('setting-hotkey-recording-label');

      recorder?.classList.remove('recording');
      if (keysEl) keysEl.style.display = 'inline-flex';
      if (labelEl) labelEl.style.display = 'none';

      this.renderHotkeyBadge(this.hotkeyRecenterKey);
      if (!cancelled) {
        this.updateModifiedIndicators();
        this.autoSave(true);
      }
    },

    syncLiveFilter() {
      const deadband = parseFloat(document.getElementById('setting-gyro-deadband')?.value || '0.10');
      const deadbandUsb = parseFloat(document.getElementById('setting-gyro-deadband-usb')?.value || '0.50');
      const sensInput = document.getElementById('setting-gyro-sens-input');
      const sensSlider = document.getElementById('setting-gyro-sensitivity');
      const sens = parseFloat(sensInput?.value || sensSlider?.value || '1.00');
      if (window.go?.main?.App?.SetTuningFilterParams) {
        window.go.main.App.SetTuningFilterParams(deadband, deadbandUsb, sens);
      }
    },

    initTooltips() {
      const tooltipEl = document.getElementById('settings-floating-tooltip');
      if (!tooltipEl) return;

      let currentTarget = null;

      const hideTooltip = () => {
        currentTarget = null;
        tooltipEl.classList.remove('show');
        tooltipEl.style.display = 'none';
      };

      const updateTooltipPosition = (targetEl) => {
        if (!targetEl || !targetEl.isConnected) {
          hideTooltip();
          return;
        }
        const rect = targetEl.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          hideTooltip();
          return;
        }

        const zoom = parseFloat(document.documentElement.style.zoom) || (window.FontScaleManager && FontScaleManager.scale) || 1.0;

        // Measure REAL rendered dimensions in viewport space
        const ttRect = tooltipEl.getBoundingClientRect();
        const ttVisualWidth = ttRect.width || (tooltipEl.offsetWidth * zoom);
        const ttVisualHeight = ttRect.height || (tooltipEl.offsetHeight * zoom);

        // Exact horizontal centering on target element in viewport space
        const targetCenterX = rect.left + (rect.width / 2);
        let visualLeft = targetCenterX - (ttVisualWidth / 2);
        const margin = 12;
        if (visualLeft < margin) {
          visualLeft = margin;
        }
        if (visualLeft + ttVisualWidth > window.innerWidth - margin) {
          visualLeft = window.innerWidth - ttVisualWidth - margin;
        }

        // Avoid overlapping the app header (height ~52px)
        const headerEl = document.querySelector('.app-header');
        const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 52;
        const topBoundary = Math.max(margin, headerBottom + 6);

        // Prefer placing 8px above target element in viewport space
        let visualTop = rect.top - ttVisualHeight - 8;
        if (visualTop < topBoundary) {
          // If not enough room above, place 8px below target element
          visualTop = rect.bottom + 8;
        }
        // If bottom extends outside viewport, clamp cleanly
        if (visualTop + ttVisualHeight > window.innerHeight - margin) {
          visualTop = Math.max(topBoundary, window.innerHeight - ttVisualHeight - margin);
        }

        // Convert viewport coordinates to unzoomed CSS coordinates expected by fixed style.left / style.top
        tooltipEl.style.left = Math.round(visualLeft / zoom) + 'px';
        tooltipEl.style.top = Math.round(visualTop / zoom) + 'px';
      };

      const showTooltip = (targetEl) => {
        if (!targetEl || !targetEl.isConnected) return;
        const tipKey = targetEl.getAttribute('data-i18n-tip');
        if (!tipKey) return;
        const text = I18n.t(tipKey) || tipKey;
        if (!text) return;

        currentTarget = targetEl;
        tooltipEl.textContent = text;
        tooltipEl.style.display = 'block';
        tooltipEl.style.visibility = 'hidden';

        updateTooltipPosition(targetEl);

        tooltipEl.style.visibility = 'visible';
        void tooltipEl.offsetWidth;
        tooltipEl.classList.add('show');
      };

      const container = document.getElementById('view-settings');
      if (container) {
        container.querySelectorAll('[data-i18n-tip]').forEach(el => {
          el.addEventListener('mouseenter', () => showTooltip(el));
          el.addEventListener('mouseleave', () => hideTooltip());
          el.addEventListener('click', (e) => {
            if (el.classList.contains('setting-infotip')) {
              e.stopPropagation();
              if (tooltipEl.classList.contains('show') && currentTarget === el) {
                hideTooltip();
              } else {
                showTooltip(el);
              }
            } else {
              hideTooltip();
            }
          });
        });
      }

      // Hide tooltip when scrolling or resizing so it never detaches from the trigger
      const appMain = document.querySelector('.app-main');
      if (appMain) {
        appMain.addEventListener('scroll', hideTooltip, { passive: true });
      }
      window.addEventListener('scroll', hideTooltip, { passive: true });
      window.addEventListener('resize', hideTooltip, { passive: true });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('[data-i18n-tip]') && !e.target.closest('#settings-floating-tooltip')) {
          hideTooltip();
        }
      });
    },

    async fetchSettings() {
      try {
        if (window.go?.main?.App?.GetAppSettings) {
          const s = await window.go.main.App.GetAppSettings();
          if (s) {
            this.currentSettings = s;
            if (typeof s.fontScale === 'number' && s.fontScale > 0) {
              FontScaleManager.apply(s.fontScale, true);
            }
          }
        }
      } catch (err) {
        console.warn('GetAppSettings error:', err);
      }
    },

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    },

    async open() {
      this.isOpen = true;
      this.initialFontScale = (this.currentSettings && typeof this.currentSettings.fontScale === 'number') ? this.currentSettings.fontScale : FontScaleManager.scale;
      if (typeof HelpManager !== 'undefined' && HelpManager.isOpen) HelpManager.close(false);
      if (typeof WelcomeManager !== 'undefined' && WelcomeManager.isOpen) WelcomeManager.close(false);
      if (typeof SetupWizard !== 'undefined' && SetupWizard.isOpen) SetupWizard.close();

      const container = document.querySelector('.modular-container');
      if (container) {
        container.classList.add('setup-mode');
        container.classList.add('setup-mode-wide');
        container.classList.remove('usb-mode');
      }

      const vOff = document.getElementById('view-offline');
      const vOn = document.getElementById('view-online');
      const vUsb = document.getElementById('view-usb-mode');
      const vModeHeader = document.getElementById('card-mode-header');
      const vSet = document.getElementById('view-setup');
      const vHelp = document.getElementById('view-help');
      const vWelcome = document.getElementById('view-welcome');
      const vSettings = document.getElementById('view-settings');

      if (vOff) vOff.style.display = 'none';
      if (vOn) vOn.style.display = 'none';
      if (vUsb) vUsb.style.display = 'none';
      if (vModeHeader) vModeHeader.style.display = 'none';
      if (vSet) vSet.style.display = 'none';
      if (vHelp) vHelp.style.display = 'none';
      if (vWelcome) vWelcome.style.display = 'none';
      if (vSettings) vSettings.style.display = 'flex';

      document.getElementById('btn-header-settings')?.classList.add('active');

      await this.populateUI();

      // Start live test bench telemetry
      if (window.go?.main?.App?.SetTuningActive) {
        window.go.main.App.SetTuningActive(true);
      }
      this.syncLiveFilter();
      TuningBench.start();
    },

    async populateUI() {
      // Refresh current settings from backend
      await this.fetchSettings();
      const s = this.currentSettings || {
        dsuPort: 26760,
        httpPort: 8080,
        httpsPort: 8443,
        gyroDeadzone: 0.10,
        gyroDeadband: 0.10,
        gyroDeadbandUsb: 0.50,
        gyroSensitivity: 1.00,
        stillnessHint: true,
        disconnectAlert: true,
        theme: ThemeManager.theme || 'dark',
        lang: I18n.currentLang || 'ru'
      };

      const dsuInput = document.getElementById('setting-dsu-port');
      if (dsuInput) {
        dsuInput.value = s.dsuPort || 26760;
        dsuInput.classList.remove('error');
      }

      const dsuMacInput = document.getElementById('setting-dsu-mac');
      if (dsuMacInput) {
        dsuMacInput.value = s.dsuMac || '00:13:37:00:00:01';
      }

      const httpInput = document.getElementById('setting-http-port');
      if (httpInput) {
        httpInput.value = s.httpPort || 8080;
        httpInput.classList.remove('error');
      }

      const httpsInput = document.getElementById('setting-https-port');
      if (httpsInput) {
        httpsInput.value = s.httpsPort || 8443;
        httpsInput.classList.remove('error');
      }

      // Gyro Tremor Deadband
      const deadbandSelect = document.getElementById('setting-gyro-deadband');
      if (deadbandSelect) {
        const dbVal = (s.gyroDeadband !== undefined) ? Number(s.gyroDeadband).toFixed(2) : ((s.gyroDeadzone !== undefined) ? Number(s.gyroDeadzone).toFixed(2) : '0.10');
        let matched = false;
        for (const opt of deadbandSelect.options) {
          if (Math.abs(parseFloat(opt.value) - parseFloat(dbVal)) < 0.02) {
            opt.selected = true;
            matched = true;
            break;
          }
        }
        if (!matched && deadbandSelect.options.length > 0) {
          deadbandSelect.value = '0.10';
        }
      }
      const deadbandUsbSelect = document.getElementById('setting-gyro-deadband-usb');
      if (deadbandUsbSelect) {
        const usbVal = Number(s.gyroDeadbandUsb !== undefined ? s.gyroDeadbandUsb : 0.50);
        const opt = Array.from(deadbandUsbSelect.options).find(o => Math.abs(parseFloat(o.value) - usbVal) < 0.02);
        deadbandUsbSelect.value = opt ? opt.value : '0.50';
      }

      // DSU Sensitivity Multiplier
      const sensSlider = document.getElementById('setting-gyro-sensitivity');
      const sensNumInput = document.getElementById('setting-gyro-sens-input');
      const sensBadge = document.getElementById('setting-gyro-sens-badge');
      const sensVal = (s.gyroSensitivity !== undefined && s.gyroSensitivity > 0) ? Number(s.gyroSensitivity).toFixed(2) : '1.00';
      if (sensSlider) sensSlider.value = sensVal;
      if (sensNumInput) sensNumInput.value = sensVal;
      if (sensBadge) sensBadge.textContent = Number(sensVal).toFixed(2) + 'x';

      const stillnessCheckbox = document.getElementById('setting-stillness-hint');
      if (stillnessCheckbox) {
        stillnessCheckbox.checked = (s.stillnessHint !== false);
      }

      const disconnectCheckbox = document.getElementById('setting-disconnect-alert');
      if (disconnectCheckbox) {
        disconnectCheckbox.checked = (s.disconnectAlert !== false);
      }

      const silenceCheckbox = document.getElementById('setting-silence-disconnect');
      if (silenceCheckbox) {
        silenceCheckbox.checked = (s.silenceDisconnect !== false);
      }

      const closeActionSelect = document.getElementById('setting-close-action');
      if (closeActionSelect) {
        closeActionSelect.value = s.closeAction || (s.minimizeToTray ? 'minimize' : 'ask');
      }

      const soundSelect = document.getElementById('setting-sound-mode');
      if (soundSelect) {
        soundSelect.value = s.soundMode || 'cute';
      }

      const volSlider = document.getElementById('setting-sound-volume');
      const volBadge = document.getElementById('setting-sound-vol-badge');
      if (volSlider) {
        const vol = (typeof s.soundVolume === 'number') ? s.soundVolume : 1;
        volSlider.value = vol;
        if (volBadge) volBadge.textContent = (vol === 0) ? (I18n.t('settings_modal.sound_off') || '0 (Off)') : (vol + 'x');
      }

      // Individual sound volumes
      const soundKeys = ['connect', 'disconnect', 'loss', 'dsu', 'recenter', 'goal', 'defeat'];
      const soundVols = s.soundVolumes || SoundManager.soundVolumes || {};
      soundKeys.forEach(key => {
        const slider = document.getElementById(`setting-sound-vol-${key}`);
        const badge = document.getElementById(`setting-sound-badge-${key}`);
        const val = (typeof soundVols[key] === 'number') ? soundVols[key] : 1;
        if (slider) slider.value = val;
        if (badge) badge.textContent = (val === 0) ? (I18n.t('settings_modal.sound_off') || 'Выкл') : (val + 'x');
        if (SoundManager.soundVolumes) SoundManager.soundVolumes[key] = val;
      });

      // Theme segmented control
      const activeTheme = s.theme || ThemeManager.theme || 'dark';
      document.querySelectorAll('#setting-theme-segmented .settings-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-val') === activeTheme);
      });

      // Lang segmented control
      const activeLang = s.lang || I18n.currentLang || 'ru';
      document.querySelectorAll('#setting-lang-segmented .settings-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-val') === activeLang);
      });

      // Global font & UI scale slider
      const scaleVal = (s.fontScale !== undefined && s.fontScale > 0) ? Number(s.fontScale).toFixed(2) : (FontScaleManager.scale ? FontScaleManager.scale.toFixed(2) : '1.00');
      const fontScaleSlider = document.getElementById('setting-font-scale');
      const fontScaleBadge = document.getElementById('setting-font-scale-badge');
      if (fontScaleSlider) fontScaleSlider.value = scaleVal;
      if (fontScaleBadge) fontScaleBadge.textContent = Number(scaleVal).toFixed(2) + 'x';

      // Global Recenter Hotkey
      this.hotkeyRecenterKey = s.hotkeyRecenterKey || 'Ctrl+Shift+R';
      const hkToggle = document.getElementById('setting-hotkey-recenter-enabled');
      if (hkToggle) {
        hkToggle.checked = (s.hotkeyRecenterEnabled !== false);
      }
      document.getElementById('apple-hotkey-control')?.classList.toggle('disabled', hkToggle && !hkToggle.checked);
      this.renderHotkeyBadge(this.hotkeyRecenterKey);

      if (typeof AppleSelect !== 'undefined') {
        AppleSelect.refreshAll();
      }
      this.updateModifiedIndicators();
      this.setSaveStatus('saved');
    },

    setSaveStatus(status) {
      const el = document.getElementById('settings-autosave-status');
      const label = document.getElementById('settings-autosave-label');
      if (!el || !label) return;

      if (status === 'saving') {
        el.className = 'settings-autosave-status saving';
        label.setAttribute('data-i18n', 'settings_modal.saving');
        label.textContent = I18n.t('settings_modal.saving') || 'Сохранение...';
      } else {
        el.className = 'settings-autosave-status saved';
        label.setAttribute('data-i18n', 'settings_modal.saved_auto');
        label.textContent = I18n.t('settings_modal.saved_auto') || 'Все изменения сохранены';
      }
    },

    updateModifiedIndicators() {
      const dsuEl = document.getElementById('setting-dsu-port');
      const dsuMacEl = document.getElementById('setting-dsu-mac');
      const httpEl = document.getElementById('setting-http-port');
      const httpsEl = document.getElementById('setting-https-port');

      const deadbandSelect = document.getElementById('setting-gyro-deadband');
      const sensInput = document.getElementById('setting-gyro-sens-input');
      const sensSlider = document.getElementById('setting-gyro-sensitivity');

      const stillnessCheckbox = document.getElementById('setting-stillness-hint');
      const disconnectCheckbox = document.getElementById('setting-disconnect-alert');
      const silenceCheckbox = document.getElementById('setting-silence-disconnect');
      const closeActionSelect = document.getElementById('setting-close-action');
      const soundModeSelect = document.getElementById('setting-sound-mode');
      const soundVolSlider = document.getElementById('setting-sound-volume');

      const hkToggle = document.getElementById('setting-hotkey-recenter-enabled');
      const fontScaleSlider = document.getElementById('setting-font-scale');

      const activeTheme = document.querySelector('#setting-theme-segmented .settings-seg-btn.active')?.getAttribute('data-val') || ThemeManager.theme || 'dark';
      const activeLang = document.querySelector('#setting-lang-segmented .settings-seg-btn.active')?.getAttribute('data-val') || I18n.currentLang || 'ru';

      const setModified = (key, isModified) => {
        const el = document.querySelector(`[data-setting-key="${key}"]`);
        if (el) {
          el.classList.toggle('is-modified', !!isModified);
        }
      };

      // 1. DSU Port
      const dsuVal = parseInt(dsuEl?.value || '26760', 10);
      setModified('dsuPort', dsuVal !== this.DEFAULTS.dsuPort);

      // 2. DSU MAC
      const macVal = (dsuMacEl?.value || '').trim().toUpperCase();
      setModified('dsuMac', macVal !== '' && macVal !== this.DEFAULTS.dsuMac.toUpperCase());

      // 3. HTTP Port
      const httpVal = parseInt(httpEl?.value || '8080', 10);
      setModified('httpPort', httpVal !== this.DEFAULTS.httpPort);

      // 4. HTTPS Port
      const httpsVal = parseInt(httpsEl?.value || '8443', 10);
      setModified('httpsPort', httpsVal !== this.DEFAULTS.httpsPort);

      // 6. Gyro Deadband
      const dbVal = parseFloat(deadbandSelect?.value || '0.10');
      setModified('gyroDeadband', Math.abs(dbVal - this.DEFAULTS.gyroDeadband) > 0.01);
      const dbUsbVal = parseFloat(document.getElementById('setting-gyro-deadband-usb')?.value || '0.50');
      setModified('gyroDeadbandUsb', Math.abs(dbUsbVal - this.DEFAULTS.gyroDeadbandUsb) > 0.01);

      // 7. Gyro Sensitivity
      const sensVal = parseFloat(sensInput?.value || sensSlider?.value || '1.00');
      setModified('gyroSensitivity', Math.abs(sensVal - this.DEFAULTS.gyroSensitivity) > 0.01);

      // 8. Stillness Hint
      setModified('stillnessHint', !!stillnessCheckbox?.checked !== this.DEFAULTS.stillnessHint);

      // 9. Disconnect Alert
      setModified('disconnectAlert', !!disconnectCheckbox?.checked !== this.DEFAULTS.disconnectAlert);

      // 10. Silence Disconnect
      setModified('silenceDisconnect', !!silenceCheckbox?.checked !== this.DEFAULTS.silenceDisconnect);

      // 11. Close Action
      setModified('closeAction', (closeActionSelect?.value || 'ask') !== this.DEFAULTS.closeAction);

      // 12. Sound Mode
      setModified('soundMode', (soundModeSelect?.value || 'cute') !== this.DEFAULTS.soundMode);

      // 13. Sound Volume
      const volVal = parseInt(soundVolSlider?.value || '1', 10);
      setModified('soundVolume', volVal !== this.DEFAULTS.soundVolume);

      // 14. Individual Sound Volumes & Sound Details Toggle
      let anySoundModified = false;
      ['connect', 'disconnect', 'loss', 'dsu', 'recenter', 'goal', 'defeat'].forEach(k => {
        const slider = document.getElementById(`setting-sound-vol-${k}`);
        const v = parseInt(slider?.value || '1', 10);
        const mod = v !== 1;
        setModified(`soundVol_${k}`, mod);
        if (mod) anySoundModified = true;
      });
      setModified('soundDetails', anySoundModified);

      // 15. Global Hotkey Recenter
      const hkEnabled = !!hkToggle?.checked;
      const hkKey = (this.hotkeyRecenterKey || '').trim();
      const hkModified = (hkEnabled !== this.DEFAULTS.hotkeyRecenterEnabled) || (hkKey !== this.DEFAULTS.hotkeyRecenterKey);
      setModified('hotkeyRecenter', hkModified);

      // 16. Theme
      setModified('theme', activeTheme !== this.DEFAULTS.theme);

      // 17. Language
      setModified('lang', activeLang !== this.DEFAULTS.lang);

      // 18. Font Scale
      const fsVal = parseFloat(fontScaleSlider?.value || '1.00');
      setModified('fontScale', Math.abs(fsVal - this.DEFAULTS.fontScale) > 0.01);
    },

    collectPayload() {
      const dsuEl = document.getElementById('setting-dsu-port');
      const httpEl = document.getElementById('setting-http-port');
      const httpsEl = document.getElementById('setting-https-port');

      const dsuPort = parseInt(dsuEl?.value || '0', 10);
      const httpPort = parseInt(httpEl?.value || '0', 10);
      const httpsPort = parseInt(httpsEl?.value || '0', 10);

      let hasPortError = false;
      if (isNaN(dsuPort) || dsuPort < 1024 || dsuPort > 65535) {
        dsuEl?.classList.add('error');
        hasPortError = true;
      }
      if (isNaN(httpPort) || httpPort < 1024 || httpPort > 65535) {
        httpEl?.classList.add('error');
        hasPortError = true;
      }
      if (isNaN(httpsPort) || httpsPort < 1024 || httpsPort > 65535) {
        httpsEl?.classList.add('error');
        hasPortError = true;
      }
      if (dsuPort === httpPort || dsuPort === httpsPort || httpPort === httpsPort) {
        hasPortError = true;
      }

      if (hasPortError) return null;

      const gyroDeadband = parseFloat(document.getElementById('setting-gyro-deadband')?.value || '0.10');
      const gyroDeadbandUsb = parseFloat(document.getElementById('setting-gyro-deadband-usb')?.value || '0.50');
      const gyroSensInput = document.getElementById('setting-gyro-sens-input');
      const gyroSensSlider = document.getElementById('setting-gyro-sensitivity');
      let gyroSensitivity = parseFloat(gyroSensInput?.value || gyroSensSlider?.value || '1.00');
      if (isNaN(gyroSensitivity) || gyroSensitivity <= 0) gyroSensitivity = 1.00;

      const stillnessHint = !!document.getElementById('setting-stillness-hint')?.checked;
      const disconnectAlert = !!document.getElementById('setting-disconnect-alert')?.checked;
      const silenceDisconnect = !!document.getElementById('setting-silence-disconnect')?.checked;
      const closeAction = document.getElementById('setting-close-action')?.value || 'ask';
      const soundMode = document.getElementById('setting-sound-mode')?.value || 'cute';
      const soundVolume = parseInt(document.getElementById('setting-sound-volume')?.value || '1', 10);
      const fontScale = parseFloat(document.getElementById('setting-font-scale')?.value || '1.00');
      const selectedTheme = document.querySelector('#setting-theme-segmented .settings-seg-btn.active')?.getAttribute('data-val') || ThemeManager.theme || 'dark';
      const selectedLang = document.querySelector('#setting-lang-segmented .settings-seg-btn.active')?.getAttribute('data-val') || I18n.currentLang || 'ru';
      const dsuMac = (document.getElementById('setting-dsu-mac')?.value || '00:13:37:00:00:01').trim();

      const soundVolumes = {};
      ['connect', 'disconnect', 'loss', 'dsu', 'recenter', 'goal', 'defeat'].forEach(key => {
        const slider = document.getElementById(`setting-sound-vol-${key}`);
        const val = parseInt(slider?.value || '1', 10);
        soundVolumes[key] = isNaN(val) ? 1 : val;
      });

      return {
        theme: selectedTheme,
        lang: selectedLang,
        fontScale: (isNaN(fontScale) || fontScale <= 0) ? 1.00 : fontScale,
        activeSlot: (AppState.lastState && AppState.lastState.activeSlot >= 0) ? AppState.lastState.activeSlot : 0,
        firstLaunchDone: true,
        hideAuthor: false,
        dsuPort: dsuPort,
        dsuMac: dsuMac,
        httpPort: httpPort,
        httpsPort: httpsPort,
        gyroDeadzone: isNaN(gyroDeadband) ? 0.10 : gyroDeadband,
        gyroDeadband: isNaN(gyroDeadband) ? 0.10 : gyroDeadband,
        gyroDeadbandUsb: isNaN(gyroDeadbandUsb) ? 0.50 : gyroDeadbandUsb,
        gyroSensitivity: gyroSensitivity,
        stillnessHint: stillnessHint,
        disconnectAlert: disconnectAlert,
        silenceDisconnect: silenceDisconnect,
        closeAction: closeAction,
        minimizeToTray: closeAction === 'minimize',
        soundMode: soundMode,
        soundVolume: isNaN(soundVolume) ? 1 : soundVolume,
        soundVolumes: soundVolumes,
        hotkeyRecenterEnabled: !!document.getElementById('setting-hotkey-recenter-enabled')?.checked,
        hotkeyRecenterKey: this.hotkeyRecenterKey || 'Ctrl+Shift+R'
      };
    },

    autoSave(immediate = false) {
      this.updateModifiedIndicators();

      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
      }

      const doSave = async () => {
        const payload = this.collectPayload();
        if (!payload) return;

        this.setSaveStatus('saving');
        try {
          if (window.go?.main?.App?.SaveAppSettings) {
            await window.go.main.App.SaveAppSettings(payload);
          }
          this.currentSettings = payload;
          SoundManager.soundVolumes = payload.soundVolumes;
          this.setSaveStatus('saved');
        } catch (err) {
          console.error('AutoSave error:', err);
          this.setSaveStatus('saved');
        }
      };

      if (immediate) {
        doSave();
      } else {
        this.setSaveStatus('saving');
        this.autoSaveTimer = setTimeout(doSave, 380);
      }
    },

    resetToDefaults() {
      const dsuInput = document.getElementById('setting-dsu-port');
      if (dsuInput) {
        dsuInput.value = this.DEFAULTS.dsuPort;
        dsuInput.classList.remove('error');
      }

      const dsuMacInput = document.getElementById('setting-dsu-mac');
      if (dsuMacInput) {
        dsuMacInput.value = this.DEFAULTS.dsuMac;
      }

      const httpInput = document.getElementById('setting-http-port');
      if (httpInput) {
        httpInput.value = this.DEFAULTS.httpPort;
        httpInput.classList.remove('error');
      }

      const httpsInput = document.getElementById('setting-https-port');
      if (httpsInput) {
        httpsInput.value = this.DEFAULTS.httpsPort;
        httpsInput.classList.remove('error');
      }

      const deadbandSelect = document.getElementById('setting-gyro-deadband');
      if (deadbandSelect) {
        deadbandSelect.value = '0.10';
      }
      const deadbandUsbSelect = document.getElementById('setting-gyro-deadband-usb');
      if (deadbandUsbSelect) {
        deadbandUsbSelect.value = '0.50';
      }

      const sensSlider = document.getElementById('setting-gyro-sensitivity');
      const sensNumInput = document.getElementById('setting-gyro-sens-input');
      const sensBadge = document.getElementById('setting-gyro-sens-badge');
      if (sensSlider) sensSlider.value = '1.00';
      if (sensNumInput) sensNumInput.value = '1.00';
      if (sensBadge) sensBadge.textContent = '1.00x';

      const stillnessCheckbox = document.getElementById('setting-stillness-hint');
      if (stillnessCheckbox) {
        stillnessCheckbox.checked = true;
      }

      const disconnectCheckbox = document.getElementById('setting-disconnect-alert');
      if (disconnectCheckbox) {
        disconnectCheckbox.checked = true;
      }

      const silenceCheckbox = document.getElementById('setting-silence-disconnect');
      if (silenceCheckbox) {
        silenceCheckbox.checked = true;
      }

      const closeActionSelectReset = document.getElementById('setting-close-action');
      if (closeActionSelectReset) {
        closeActionSelectReset.value = 'ask';
      }

      const soundSelect = document.getElementById('setting-sound-mode');
      if (soundSelect) {
        soundSelect.value = 'cute';
      }

      const volSlider = document.getElementById('setting-sound-volume');
      const volBadge = document.getElementById('setting-sound-vol-badge');
      if (volSlider) {
        volSlider.value = 1;
        if (volBadge) volBadge.textContent = '1x';
      }

      // Reset individual sound sliders
      ['connect', 'disconnect', 'loss', 'dsu', 'recenter', 'goal', 'defeat'].forEach(key => {
        const slider = document.getElementById(`setting-sound-vol-${key}`);
        const badge = document.getElementById(`setting-sound-badge-${key}`);
        if (slider) slider.value = 1;
        if (badge) badge.textContent = '1x';
        if (SoundManager.soundVolumes) SoundManager.soundVolumes[key] = 1;
      });

      const fontScaleSlider = document.getElementById('setting-font-scale');
      const fontScaleBadge = document.getElementById('setting-font-scale-badge');
      if (fontScaleSlider) fontScaleSlider.value = '1.00';
      if (fontScaleBadge) fontScaleBadge.textContent = '1.00x';
      FontScaleManager.apply(1.00, false, true);

      // Global Recenter Hotkey
      this.hotkeyRecenterKey = 'Ctrl+Shift+R';
      const hkToggleReset = document.getElementById('setting-hotkey-recenter-enabled');
      if (hkToggleReset) {
        hkToggleReset.checked = true;
      }
      document.getElementById('apple-hotkey-control')?.classList.remove('disabled');
      this.renderHotkeyBadge(this.hotkeyRecenterKey);

      this.syncLiveFilter();
      if (typeof AppleSelect !== 'undefined') {
        AppleSelect.refreshAll();
      }

      this.updateModifiedIndicators();
      this.autoSave(true);
    },

    async save() {
      await this.autoSave(true);
    },

    close(renderState = true) {
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
        const payload = this.collectPayload();
        if (payload && window.go?.main?.App?.SaveAppSettings) {
          window.go.main.App.SaveAppSettings(payload);
          this.currentSettings = payload;
        }
      }

      this.isOpen = false;
      if (typeof PlatformGame !== 'undefined' && PlatformGame.isFullscreen) {
        PlatformGame.setFullscreen(false);
      }
      if (typeof AimGame !== 'undefined' && AimGame.isFullscreen) {
        AimGame.setFullscreen(false);
      }

      TuningBench.stop();
      if (window.go?.main?.App?.SetTuningActive) {
        window.go.main.App.SetTuningActive(false);
      }

      const vSettings = document.getElementById('view-settings');
      if (vSettings) vSettings.style.display = 'none';

      document.getElementById('btn-header-settings')?.classList.remove('active');

      const container = document.querySelector('.modular-container');
      if (container && (!HelpManager?.isOpen && !WelcomeManager?.isOpen && !SetupWizard?.isOpen)) {
        container.classList.remove('setup-mode');
        container.classList.remove('setup-mode-wide');
      }

      if (renderState && AppState.lastState) {
        AppState._lastIsOffline = null;
        AppState.render(AppState.lastState);
      }
    }
  };

  // ── Welcome Screen (First Launch) Manager ──────────────────────────────────
  const WelcomeManager = {
    isOpen: false,
    initialized: false,

    init() {
      if (this.initialized) return;
      this.initialized = true;

      document.getElementById('btn-welcome-start')?.addEventListener('click', async () => {
        if (window.go && window.go.main && window.go.main.App && window.go.main.App.MarkFirstLaunchDone) {
          try { await window.go.main.App.MarkFirstLaunchDone(); } catch (e) {}
        }
        this.close();
        if (typeof SetupWizard !== 'undefined') {
          SetupWizard.open();
        }
      });

      document.getElementById('btn-welcome-skip')?.addEventListener('click', async () => {
        if (window.go && window.go.main && window.go.main.App && window.go.main.App.MarkFirstLaunchDone) {
          try { await window.go.main.App.MarkFirstLaunchDone(); } catch (e) {}
        }
        this.close();
      });
    },

    async checkFirstLaunch() {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.IsFirstLaunch) {
        try {
          const isFirst = await window.go.main.App.IsFirstLaunch();
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

  // ── Profile Icons Helper ───────────────────────────────────────────────────
  function getProfileIconSVG(iconType, size = 20) {
    if (iconType === 'vertical') {
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="6" y="2" width="12" height="20" rx="2.5"></rect>
        <line x1="12" y1="18" x2="12.01" y2="18" stroke-width="2.5"></line>
        <line x1="10" y1="5" x2="14" y2="5"></line>
      </svg>`;
    }
    if (iconType === 'horizontal') {
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="2" y="6" width="20" height="12" rx="2.5"></rect>
        <line x1="18" y1="12" x2="18.01" y2="12" stroke-width="2.5"></line>
        <line x1="5" y1="10" x2="5" y2="14"></line>
      </svg>`;
    }
    // Default gamepad
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="2" y="6" width="20" height="12" rx="4"></rect>
      <path d="M6 12h4m-2-2v4"></path>
      <circle cx="15" cy="10" r="1" fill="currentColor"></circle>
      <circle cx="18" cy="13" r="1" fill="currentColor"></circle>
    </svg>`;
  }

  // ── Profile Manager ─────────────────────────────────────────────────────────
  const ProfileManager = {
    profiles: [null, null, null, null, null, null],
    activeSlot: 0,
    isDropdownOpen: false,
    _lastProfilesJson: '',
    _lastActiveSlot: -1,

    sync(state) {
      if (!state || !state.profiles) return;
      const slot = (state.activeSlot >= 0 && state.activeSlot < 6) ? state.activeSlot : 0;
      const pJson = JSON.stringify(state.profiles);
      if (pJson === this._lastProfilesJson && slot === this._lastActiveSlot) {
        return;
      }
      this._lastProfilesJson = pJson;
      this._lastActiveSlot = slot;
      this.profiles = state.profiles;
      this.activeSlot = slot;
      this.render();
    },

    render() {
      const activeIdx = this.activeSlot;
      const activeProf = this.profiles[activeIdx] || {
        name: formatSlotName(activeIdx),
        device: 'Unknown',
        icon: 'default'
      };

      // 1. Update Dropdown Trigger
      const triggerIcon = document.getElementById('main-profile-icon');
      const triggerTitle = document.getElementById('main-profile-title');
      const triggerDevice = document.getElementById('main-profile-device');
      const triggerBadge = document.getElementById('main-profile-badge');
      const activeTag = document.getElementById('profile-active-tag');

      if (triggerIcon) {
        triggerIcon.innerHTML = getProfileIconSVG(activeProf.icon || 'default', 22);
      }
      if (triggerTitle) {
        triggerTitle.textContent = activeProf.name || formatSlotName(activeIdx);
      }
      if (triggerDevice) {
        const devName = activeProf.device || I18n.t('calibration.device_unknown') || 'Неизвестно';
        triggerDevice.textContent = (I18n.t('calibration.device_label') || 'Устройство: {device}').replace('{device}', devName);
      }
      if (triggerBadge) {
        triggerBadge.textContent = formatSlotName(activeIdx);
      }
      if (activeTag) {
        activeTag.textContent = `${formatSlotName(activeIdx)} • ${I18n.t('calibration.slot_active') || 'Активен'}`;
      }
      const trigger = document.getElementById('main-profile-trigger');
      if (trigger) {
        trigger.classList.toggle('profile-outdated', !!activeProf.outdated);
        trigger.title = activeProf.outdated
          ? (I18n.t('calibration.outdated_tip') || 'Профиль устарел — требуется перекалибровка')
          : '';
      }
      const outdatedWarning = document.getElementById('profile-outdated-warning');
      if (outdatedWarning) {
        outdatedWarning.style.display = activeProf.outdated ? 'flex' : 'none';
      }
      const calibrateBtn = document.getElementById('btn-open-calibration');
      if (calibrateBtn) {
        calibrateBtn.classList.toggle('profile-outdated-highlight', !!activeProf.outdated);
      }

      // USB mount-tilt correction: switch it off/on without recalibrating.
      const mountRow = document.getElementById('profile-mount-row');
      const mountToggle = document.getElementById('profile-mount-toggle');
      const mount = activeProf.mount;
      const hasMount = !!(mount && mount.status === 'ok');
      if (mountRow) mountRow.style.display = hasMount ? 'flex' : 'none';
      if (hasMount) {
        const mountText = document.getElementById('profile-mount-text');
        if (mountText) {
          mountText.textContent = (I18n.t('calibration.mount_profile_toggle') || 'Компенсация наклона датчика ({tilt}°)')
            .replace('{tilt}', Number(mount.tiltDeg || 0).toFixed(1));
          mountText.title = I18n.t('calibration.mount_profile_tip') || '';
        }
        if (mountToggle) mountToggle.checked = !!mount.enabled;
      }
      if (mountToggle && !this._mountToggleBound) {
        this._mountToggleBound = true;
        mountToggle.addEventListener('change', async () => {
          const want = mountToggle.checked;
          try {
            const res = await window.go?.main?.App?.SetProfileMountEnabled(this.activeSlot, want);
            if (res && res !== 'ok') mountToggle.checked = !want; // not applicable: undo
          } catch (e) {
            mountToggle.checked = !want;
          }
        });
      }

      // 2. Populate Dropdown Menu — only slots that actually hold a profile. Empty
      // slots have nothing to switch to; they only make sense on the save page,
      // where the point is to pick a place to put a new one.
      const menu = document.getElementById('main-profile-menu');
      if (menu) {
        menu.innerHTML = '';
        for (let i = 0; i < 6; i++) {
          const p = this.profiles[i];
          if (!p || !p.name) continue;

          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'profile-dropdown-item' + (i === activeIdx ? ' active' : '') + (p.outdated ? ' profile-outdated' : '');
          item.setAttribute('data-slot', String(i));

          const devName = p.device || I18n.t('calibration.device_unknown') || 'Неизвестно';
          const devText = (I18n.t('calibration.device_label') || 'Устройство: {device}').replace('{device}', devName);
          const outdatedBadge = p.outdated
            ? `<span class="profile-outdated-badge">${I18n.t('calibration.outdated_badge') || 'Устарел'}</span>`
            : '';

          item.innerHTML = `
            <div class="profile-item-left">
              <div class="profile-item-icon">
                ${getProfileIconSVG(p.icon || 'default', 20)}
              </div>
              <div class="profile-item-meta">
                <span class="profile-item-title">${p.name || formatSlotName(i)}${outdatedBadge}</span>
                <span class="profile-item-sub">${formatSlotName(i)} • ${devText}</span>
              </div>
            </div>
            <div class="profile-item-right">
              ${i === activeIdx ? '<span class="profile-item-check">✓</span>' : ''}
              <span class="profile-item-delete" role="button" title="${I18n.t('calibration.delete_profile_tip') || 'Удалить профиль'}">
                <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                  <path d="M2.5 2.5l7 7M9.5 2.5l-7 7"></path>
                </svg>
              </span>
            </div>
          `;

          item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.target.closest('.profile-item-delete')) {
              this.closeDropdown();
              ProfileDeleteDialog.show(i, p.name);
              return;
            }
            this.selectSlot(i);
          });
          menu.appendChild(item);
        }
      }

      // 3. Update Axes description — both matrices as actually stored, never assumed:
      // the calibration matrix (gyro→pad axes) and the learned accelerometer axis map.
      const currentDescEl = document.getElementById('profile-current-desc');
      if (currentDescEl) {
        const axesLabel = I18n.t('calibration.axes_label') || (I18n.currentLang === 'ru' ? 'Оси' : 'Axes');
        const accLabel = I18n.t('calibration.accel_axes_label') || (I18n.currentLang === 'ru' ? 'Акселерометр' : 'Accelerometer');
        const m = (activeProf && activeProf.matrix) || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        const [p, y, r] = matrixAxisLabels(m);
        let line = `${axesLabel}: Pitch ${p} • Yaw ${y} • Roll ${r}`;
        if (activeProf && activeProf.sensorFrame && activeProf.sensorFrame.q) {
          const [ap, ay, ar] = matrixAxisLabels(activeProf.sensorFrame.q);
          line += `  |  ${accLabel}: Pitch ${ap} • Yaw ${ay} • Roll ${ar}`;
        } else {
          line += `  |  ${accLabel}: ${I18n.t('calibration.accel_axes_unset') || 'не определено'}`;
        }
        currentDescEl.textContent = line;
      }
    },

    async selectSlot(slot) {
      this.closeDropdown();
      if (slot === this.activeSlot) return;

      try {
        let result = 'ok';
        if (window.go?.main?.App?.SetActiveProfile) {
          result = await window.go.main.App.SetActiveProfile(slot);
        }
        // Outdated profiles switch normally — the warning banner and highlighted
        // Calibrate button (see render()) do the nudging, not a forced wizard.
        if (result !== 'ok') {
          console.error('Failed to switch profile:', result);
          return;
        }
        this.activeSlot = slot;
        this._lastActiveSlot = slot;
        this.render();

        // Mini animation: ripple glow on dropdown trigger
        const trigger = document.getElementById('main-profile-trigger');
        if (trigger) {
          trigger.classList.remove('switched');
          void trigger.offsetWidth;
          trigger.classList.add('switched');
          setTimeout(() => trigger.classList.remove('switched'), 850);
        }

        const profName = this.profiles[slot]?.name || formatSlotName(slot);
        const msg = (I18n.t('calibration.profile_switched') || 'Профиль применен') + `: ${profName}`;
        showToast(msg);
      } catch (err) {
        console.error('Failed to switch profile:', err);
      }
    },

    toggleDropdown() {
      if (this.isDropdownOpen) {
        this.closeDropdown();
      } else {
        this.openDropdown();
      }
    },

    openDropdown() {
      this.isDropdownOpen = true;
      const trigger = document.getElementById('main-profile-trigger');
      const menu = document.getElementById('main-profile-menu');
      const wrap = document.getElementById('main-profile-dropdown-wrap');
      if (trigger) trigger.classList.add('open');
      if (wrap) wrap.classList.add('open');
      if (menu) {
        menu.classList.add('show');
        setTimeout(() => {
          menu.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
      }
    },

    closeDropdown() {
      this.isDropdownOpen = false;
      const trigger = document.getElementById('main-profile-trigger');
      const menu = document.getElementById('main-profile-menu');
      const wrap = document.getElementById('main-profile-dropdown-wrap');
      if (trigger) trigger.classList.remove('open');
      if (wrap) wrap.classList.remove('open');
      if (menu) menu.classList.remove('show');
    },

    initialized: false,

    init() {
      if (this.initialized) return;
      this.initialized = true;

      // Dropdown toggle
      document.getElementById('main-profile-trigger')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDropdown();
      });

      // Click outside to close
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#main-profile-dropdown-wrap')) {
          this.closeDropdown();
        }
      });

      // Calibrate button in online view
      document.getElementById('btn-open-calibration')?.addEventListener('click', () => {
        CalibrationWizard.openToSlot(this.activeSlot);
      });
    }
  };

  // ── Recenter Manager (In-app 3D Horizon Baseline Reset) ───────────────────
  const RecenterManager = {
    isOpen: false,
    isMeasuring: false,
    forced: false, // first connection (FirstCenterGate): no way out but centering
    _pickerSig: '',
    durationMs: 1000,
    startTime: 0,
    rafId: null,
    latestGyroSpeed: 0,

    // Called on live high-rate sensor frames to track stillness speed (deg/s)
    onFrame(frame) {
      if (!frame) return;
      const rx = Number(frame.RawX != null ? frame.RawX : (frame.rawRotX != null ? frame.rawRotX : 0)) || 0;
      const ry = Number(frame.RawY != null ? frame.RawY : (frame.rawRotY != null ? frame.rawRotY : 0)) || 0;
      const rz = Number(frame.RawZ != null ? frame.RawZ : (frame.rawRotZ != null ? frame.rawRotZ : 0)) || 0;
      this.latestGyroSpeed = Math.sqrt(rx * rx + ry * ry + rz * rz);
    },

    getActiveProfile() {
      const activeIdx = (typeof ProfileManager !== 'undefined' && ProfileManager.activeSlot >= 0) ? ProfileManager.activeSlot : 0;
      const profs = (typeof ProfileManager !== 'undefined' && ProfileManager.profiles) ? ProfileManager.profiles : [];
      return profs[activeIdx] || {
        slot: activeIdx,
        name: formatSlotName(activeIdx),
        device: 'Unknown',
        icon: 'default'
      };
    },

    open(opts = {}) {
      const overlay = document.getElementById('recenter-overlay');
      if (!overlay) return;
      this.isOpen = true;
      this.isMeasuring = false;
      this.forced = !!opts.forced;
      overlay.classList.toggle('recenter-forced', this.forced);
      this.setHeader(this.forced);
      this._pickerSig = '';
      this.renderPicker();
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      overlay.style.display = 'flex';

      const prof = this.getActiveProfile();
      const profName = prof.name || formatSlotName(prof.slot || 0);

      const modalIcon = document.getElementById('recenter-modal-icon');
      if (modalIcon) modalIcon.innerHTML = getProfileIconSVG(prof.icon || 'default', 24);

      const modalName = document.getElementById('recenter-modal-name');
      if (modalName) modalName.textContent = profName;

      this.updatePrompt();

      // Hide moved warning alert
      const alertEl = document.getElementById('recenter-moved-alert');
      if (alertEl) alertEl.style.display = 'none';

      // Reset action button state
      const btn = document.getElementById('btn-recenter-start');
      const btnText = document.getElementById('recenter-btn-text');
      const progress = document.getElementById('recenter-btn-progress');
      const iconEl = document.querySelector('.recenter-btn-action-icon');
      if (iconEl) {
        iconEl.outerHTML = '<svg class="recenter-btn-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="3" x2="12" y2="7"></line><line x1="12" y1="17" x2="12" y2="21"></line><line x1="3" y1="12" x2="7" y2="12"></line><line x1="17" y1="12" x2="21" y2="12"></line><circle cx="12" cy="12" r="2.5" fill="currentColor"></circle></svg>';
      }
      if (btn) {
        btn.className = 'btn-apple-primary btn-recenter-start';
        btn.disabled = false;
      }
      if (btnText) {
        btnText.textContent = I18n.t('recenter.btn_action') || 'Центрировать';
      }
      if (progress) {
        progress.style.width = '0%';
      }
    },

    // close(): the user's ways out (cross, Cancel, Escape, backdrop) do nothing in
    // forced mode; close(true) is for a finished centering or a lost device.
    close(force = false) {
      if (this.forced && !force) return;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.isOpen = false;
      this.isMeasuring = false;
      const overlay = document.getElementById('recenter-overlay');
      if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.remove('recenter-forced');
      }
      if (this.forced) {
        this.forced = false;
        this.setHeader(false);
        this.renderPicker();
      }
    },

    setHeader(forced) {
      const title = document.getElementById('recenter-modal-title');
      const sub = document.getElementById('recenter-modal-subtitle');
      const tKey = forced ? 'recenter.forced_title' : 'recenter.modal_title';
      const sKey = forced ? 'recenter.forced_subtitle' : 'recenter.modal_subtitle';
      if (title) { title.setAttribute('data-i18n', tKey); title.textContent = I18n.t(tKey); }
      if (sub) { sub.setAttribute('data-i18n', sKey); sub.textContent = I18n.t(sKey); }
    },

    updatePrompt() {
      const modalPrompt = document.getElementById('recenter-modal-prompt');
      if (!modalPrompt) return;
      if (this.forced) {
        modalPrompt.textContent = I18n.t('recenter.forced_prompt') || 'Держите устройство так, как будете держать его в игре, и нажмите «Центрировать».';
        return;
      }
      const prof = this.getActiveProfile();
      const profName = prof.name || formatSlotName(prof.slot || 0);
      const rawTmpl = I18n.t('recenter.modal_hold_prompt') || 'Положите телефон в стандартное положение профиля «{name}» и нажмите кнопку ниже.';
      modalPrompt.textContent = rawTmpl.replace('{name}', profName);
    },

    // Profile list of the forced (first-connection) mode. Rebuilt only when the
    // saved profiles or the active one change, so hover/clicks survive the 15 Hz
    // state updates.
    renderPicker() {
      const picker = document.getElementById('recenter-profile-picker');
      const hero = document.querySelector('#recenter-overlay .recenter-hero-card');
      if (!picker) return;
      if (!this.forced) {
        picker.style.display = 'none';
        if (hero) hero.style.display = '';
        return;
      }
      const profs = (typeof ProfileManager !== 'undefined' && ProfileManager.profiles) ? ProfileManager.profiles : [];
      const active = (typeof ProfileManager !== 'undefined') ? ProfileManager.activeSlot : -1;
      const named = [];
      profs.forEach((p, i) => { if (p && p.name) named.push({ p, i }); });
      const sig = JSON.stringify([active, named.map(({ p, i }) => [i, p.name, p.icon, p.device])]);
      if (sig === this._pickerSig) return;
      this._pickerSig = sig;

      if (hero) hero.style.display = 'none';
      picker.style.display = 'flex';
      picker.innerHTML = '';
      const label = document.createElement('span');
      label.className = 'recenter-profile-tag';
      label.textContent = I18n.t('recenter.forced_pick_label') || 'Профиль калибровки';
      picker.appendChild(label);

      if (!named.length) {
        const empty = document.createElement('div');
        empty.className = 'recenter-picker-empty';
        empty.textContent = I18n.t('recenter.forced_no_profiles') || 'Сохранённых профилей нет — после центрирования откалибруйте устройство кнопкой «Калибровать».';
        picker.appendChild(empty);
        return;
      }
      named.forEach(({ p, i }) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'recenter-picker-row' + (i === active ? ' active' : '');
        row.innerHTML = `
          <span class="recenter-picker-icon">${getProfileIconSVG(p.icon || 'default', 18)}</span>
          <span class="recenter-picker-meta">
            <span class="recenter-picker-name"></span>
            <span class="recenter-picker-sub"></span>
          </span>
          <span class="recenter-picker-check">✓</span>`;
        row.querySelector('.recenter-picker-name').textContent = p.name;
        row.querySelector('.recenter-picker-sub').textContent = `${formatSlotName(i)} • ${p.device || ''}`;
        row.addEventListener('click', async () => {
          if (this.isMeasuring) return;
          await ProfileManager.selectSlot(i);
          this.renderPicker();
        });
        picker.appendChild(row);
      });
    },

    startMeasurement() {
      if (this.isMeasuring) return;
      this.isMeasuring = true;

      const btn = document.getElementById('btn-recenter-start');
      const btnText = document.getElementById('recenter-btn-text');
      const progress = document.getElementById('recenter-btn-progress');
      const alertEl = document.getElementById('recenter-moved-alert');

      if (alertEl) alertEl.style.display = 'none';
      if (btn) {
        btn.className = 'btn-apple-primary btn-recenter-start holding';
        btn.disabled = true;
      }
      if (btnText) {
        btnText.textContent = I18n.t('recenter.btn_action_holding') || 'Фиксация...';
      }
      if (progress) {
        progress.style.width = '0%';
      }

      this.startTime = performance.now();

      const loop = (now) => {
        if (!this.isOpen || !this.isMeasuring) return;

        const elapsed = now - this.startTime;
        const ratio = Math.min(1, elapsed / this.durationMs);

        if (progress) {
          progress.style.width = (ratio * 100).toFixed(1) + '%';
        }

        // Stillness check after 100ms grace period: threshold 2.6 deg/s
        if (elapsed > 100 && this.latestGyroSpeed > 2.6) {
          this.failMoved();
          return;
        }

        if (elapsed >= this.durationMs) {
          this.succeed();
          return;
        }

        this.rafId = requestAnimationFrame(loop);
      };

      this.rafId = requestAnimationFrame(loop);
    },

    failMoved() {
      this.isMeasuring = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      const btn = document.getElementById('btn-recenter-start');
      const btnText = document.getElementById('recenter-btn-text');
      const progress = document.getElementById('recenter-btn-progress');
      const alertEl = document.getElementById('recenter-moved-alert');
      const iconEl = document.querySelector('.recenter-btn-action-icon');

      if (iconEl) {
        iconEl.outerHTML = '<svg class="recenter-btn-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="3" x2="12" y2="7"></line><line x1="12" y1="17" x2="12" y2="21"></line><line x1="3" y1="12" x2="7" y2="12"></line><line x1="17" y1="12" x2="21" y2="12"></line><circle cx="12" cy="12" r="2.5" fill="currentColor"></circle></svg>';
      }
      if (progress) progress.style.width = '0%';
      if (btn) {
        btn.className = 'btn-apple-primary btn-recenter-start';
        btn.disabled = false;
      }
      if (btnText) {
        btnText.textContent = I18n.t('recenter.btn_retry') || 'Повторить';
      }
      if (alertEl) {
        alertEl.style.display = 'flex';
      }

      if (typeof SoundManager !== 'undefined' && SoundManager.play) {
        SoundManager.play('defeat');
      }
    },

    succeed() {
      this.isMeasuring = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      const btn = document.getElementById('btn-recenter-start');
      const btnText = document.getElementById('recenter-btn-text');
      const progress = document.getElementById('recenter-btn-progress');
      const alertEl = document.getElementById('recenter-moved-alert');
      const iconEl = document.querySelector('.recenter-btn-action-icon');

      if (alertEl) alertEl.style.display = 'none';
      if (progress) progress.style.width = '100%';
      if (btn) {
        btn.className = 'btn-apple-primary btn-recenter-start success';
        btn.disabled = true;
      }
      if (iconEl) {
        iconEl.outerHTML = '<svg class="recenter-btn-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      }
      if (btnText) {
        btnText.textContent = I18n.t('recenter.status_success') || 'Готово';
      }

      // Reset backend AHRS orientation
      if (window.go?.main?.App?.ResetAHRS) {
        window.go.main.App.ResetAHRS().catch(() => {});
      }

      // Reset 3D scenes if active
      if (typeof Scene3D !== 'undefined' && Scene3D.activeScenes) {
        Object.values(Scene3D.activeScenes).forEach(sc => {
          if (sc && sc.resetQuat) sc.resetQuat();
        });
      }

      // Zero out live Euler angles in HUD
      if (typeof AppState !== 'undefined') {
        AppState.targetPitch = 0;
        AppState.targetRoll = 0;
        AppState.targetYaw = 0;
        AppState.currentPitch = 0;
        AppState.currentRoll = 0;
        AppState.currentYaw = 0;
      }

      if (typeof SoundManager !== 'undefined' && SoundManager.play) {
        SoundManager.play('recenter');
      }

      if (typeof FirstCenterGate !== 'undefined') FirstCenterGate.markDone();

      setTimeout(() => {
        if (this.isOpen) {
          this.close(true);
        }
      }, 550);
    },


    init() {
      // Main screen button
      document.getElementById('btn-main-recenter')?.addEventListener('click', () => {
        this.open();
      });

      // HUD bezel click
      document.getElementById('gyro-hud-bezel')?.addEventListener('click', () => {
        this.open();
      });

      // 1-second center action button in modal
      document.getElementById('btn-recenter-start')?.addEventListener('click', () => {
        this.startMeasurement();
      });

      // Close modal button
      document.getElementById('recenter-close-btn')?.addEventListener('click', () => {
        this.close();
      });

      // Cancel button in modal
      document.getElementById('btn-recenter-cancel')?.addEventListener('click', () => {
        this.close();
      });

      // Overlay backdrop click
      document.getElementById('recenter-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'recenter-overlay') {
          this.close();
        }
      });

      // Escape key
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
        }
      });

      // Listen to backend global Windows hotkey trigger
      if (window.runtime?.EventsOn) {
        // 60 Hz orientation for the live calibration previews (app.go "ahrs:quat").
        window.runtime.EventsOn('ahrs:quat', (q) => {
          if (!q || typeof Scene3D === 'undefined') return;
          for (const id of ['cal-3d-canvas-confirm', 'cal-3d-canvas-manual']) {
            const sc = Scene3D.get(id);
            if (sc && sc.updateQuat) sc.updateQuat(q.q0, q.q1, q.q2, q.q3);
          }
        });

        // Heavy data loss on the active link (gui/lossalert.go decides when).
        window.runtime.EventsOn('link:loss', () => {
          if (typeof SoundManager !== 'undefined') SoundManager.play('loss');
        });
        window.runtime.EventsOn('recenter:triggered', () => {
          if (typeof FirstCenterGate !== 'undefined') FirstCenterGate.markDone();
          if (RecenterManager.forced) RecenterManager.close(true);
          // Reset 3D scenes if active
          if (typeof Scene3D !== 'undefined' && Scene3D.activeScenes) {
            Object.values(Scene3D.activeScenes).forEach(sc => {
              if (sc && sc.resetQuat) sc.resetQuat();
            });
          }

          // Zero out live Euler angles in HUD
          if (typeof AppState !== 'undefined') {
            AppState.targetPitch = 0;
            AppState.targetRoll = 0;
            AppState.targetYaw = 0;
            AppState.currentPitch = 0;
            AppState.currentRoll = 0;
            AppState.currentYaw = 0;
          }

          // Reset Test Bench if active
          if (typeof TuningBench !== 'undefined' && TuningBench.active) {
            TuningBench.recenter();
            if (typeof PlatformGame !== 'undefined') PlatformGame.recenter();
          }

          // Audio feedback chime
          if (typeof SoundManager !== 'undefined' && SoundManager.play) {
            SoundManager.play('recenter');
          }

          // Visual pulse on main recenter button
          const btn = document.getElementById('btn-main-recenter');
          if (btn) {
            btn.classList.add('btn-recenter-hotkey-flash');
            setTimeout(() => btn.classList.remove('btn-recenter-hotkey-flash'), 650);
          }

          // Apple-style toast notification
          const msg = I18n.t('recenter.toast_hotkey') || '🎯 Прицел отцентрирован (Хоткей)';
          showToast(msg);
        });
      }
    }
  };

  // ── Three.js 3D Viewport (Apple Keynote Studio Showcase - Nintendo Gamepad) ──
  const Scene3D = {
    activeScenes: {},
    cachedModel: null,
    loadPromise: null,

    // Preloads and returns the cached centered gamepad model template
    loadGamepadModel() {
      if (this.cachedModel) return Promise.resolve(this.cachedModel);
      if (this.loadPromise) return this.loadPromise;

      this.loadPromise = new Promise((resolve, reject) => {
        if (!window.THREE || !window.THREE.GLTFLoader) {
          const err = new Error('GLTFLoader is not loaded');
          console.error(err);
          reject(err);
          return;
        }

        const loader = new THREE.GLTFLoader();
        loader.load(
          'assets/models/gamepad.glb',
          (gltf) => {
            const raw = gltf.scene;

            // 1. Orient model FIRST: rotate -90 degrees around Y so grips point toward camera (+Z)
            raw.rotation.y = -Math.PI * 0.5;
            raw.updateMatrixWorld(true);

            // 2. Scale to fit viewport heroically (~2.05 units wide)
            const box = new THREE.Box3().setFromObject(raw);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const targetScale = 2.05 / maxDim;
            raw.scale.set(targetScale, targetScale, targetScale);
            raw.updateMatrixWorld(true);

            // 3. Center geometry precisely at origin (0, 0, 0) in world space
            const finalBox = new THREE.Box3().setFromObject(raw);
            const center = finalBox.getCenter(new THREE.Vector3());
            raw.position.sub(center);

            const wrapper = new THREE.Group();
            wrapper.add(raw);
            this.cachedModel = wrapper;
            resolve(wrapper);
          },
          undefined,
          (err) => {
            console.error('Failed to load assets/models/gamepad.glb:', err);
            reject(err);
          }
        );
      });

      return this.loadPromise;
    },

    updateTheme(theme) {
      Object.values(this.activeScenes).forEach(s => {
        if (s && s.applyTheme) s.applyTheme(theme);
      });
    },

    mount(canvasId, options = {}) {
      if (!window.THREE) {
        console.error('Three.js is not loaded');
        return null;
      }
      const canvas = document.getElementById(canvasId);
      if (!canvas) return null;

      if (this.activeScenes[canvasId]) {
        this.activeScenes[canvasId].destroy();
        delete this.activeScenes[canvasId];
      }

      const THREE = window.THREE;
      const isDark = () => document.documentElement.getAttribute('data-theme') !== 'light';

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const scene = new THREE.Scene();

      // Apple Studio Keynote Lighting Themes
      // Controller color is classic Nintendo dark charcoal gray (0x282a30) across both themes
      const THEME_LIGHTING = {
        dark: {
          ambientIntensity: 0.85,
          keyIntensity: 1.25,
          fillColor: 0x8eb6ff,
          fillIntensity: 0.45,
          rimColor: 0x007aff,   // Vibrant Apple electric-blue rim accent on dark background
          rimIntensity: 0.85,
          bounceIntensity: 0.25,
        },
        light: {
          ambientIntensity: 0.95,
          keyIntensity: 1.15,
          fillColor: 0xc8ddff,
          fillIntensity: 0.40,
          rimColor: 0x409cff,   // Subtle sky-blue rim accent on light studio background
          rimIntensity: 0.50,
          bounceIntensity: 0.20,
        }
      };

      const curPreset = isDark() ? THEME_LIGHTING.dark : THEME_LIGHTING.light;

      // Camera: centered on gamepad (0, 0, 0), slightly elevated looking down (~22° angle)
      // Low FOV (27°) and zoomed out ~2x (orbitHRadius = 7.6, orbitY = 3.2)
      const camera = new THREE.PerspectiveCamera(27, 1, 0.2, 50);
      const camTarget = new THREE.Vector3(0, 0, 0);
      const orbitHRadius = 7.6;
      const orbitY = 3.2;
      let currentCamAngle = 0;

      camera.position.set(camTarget.x, orbitY, camTarget.z + orbitHRadius);
      camera.lookAt(camTarget);

      // Studio Lighting
      const ambLight = new THREE.AmbientLight(0xffffff, curPreset.ambientIntensity);
      scene.add(ambLight);

      // Key light: main top-front-right highlight
      const mainLight = new THREE.DirectionalLight(0xffffff, curPreset.keyIntensity);
      mainLight.position.set(3, 7, 4);
      scene.add(mainLight);

      // Fill light: soft cool fill
      const fillLight = new THREE.DirectionalLight(curPreset.fillColor, curPreset.fillIntensity);
      fillLight.position.set(-3, 5, 3);
      scene.add(fillLight);

      // Bounce light: underside definition
      const bounceLight = new THREE.DirectionalLight(0x3a455a, curPreset.bounceIntensity);
      bounceLight.position.set(0, -4, 2);
      scene.add(bounceLight);

      // Rim light: edge silhouette sculpting
      const rimLight = new THREE.DirectionalLight(curPreset.rimColor, curPreset.rimIntensity);
      rimLight.position.set(-2.5, 4.5, -4);
      scene.add(rimLight);

      // High-precision symmetrical grid floor with visible circular radial fading (затухание по кругу)
      function createRadialGridTexture(isDarkMode) {
        const size = 1024;
        const center = size / 2; // 512
        const step = 64; // 8 divisions each side, exactly divides 512!
        const cvs = document.createElement('canvas');
        cvs.width = size;
        cvs.height = size;
        const ctx = cvs.getContext('2d');

        // 1. Draw regular grid lines strictly symmetrically from center
        ctx.strokeStyle = isDarkMode ? 'rgba(148, 163, 184, 0.38)' : 'rgba(100, 116, 139, 0.42)';
        ctx.lineWidth = 1.8;

        ctx.beginPath();
        for (let offset = step; offset < center; offset += step) {
          ctx.moveTo(center + offset, 0); ctx.lineTo(center + offset, size);
          ctx.moveTo(center - offset, 0); ctx.lineTo(center - offset, size);
          ctx.moveTo(0, center + offset); ctx.lineTo(size, center + offset);
          ctx.moveTo(0, center - offset); ctx.lineTo(size, center - offset);
        }
        ctx.stroke();

        // 2. Draw the exact center axes passing directly through origin (0, 0)
        ctx.strokeStyle = isDarkMode ? 'rgba(56, 189, 248, 0.65)' : 'rgba(2, 132, 199, 0.65)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(center, 0); ctx.lineTo(center, size);
        ctx.moveTo(0, center); ctx.lineTo(size, center);
        ctx.stroke();

        // 3. Apply pronounced circular radial fade mask (clearly visible in camera viewport)
        ctx.globalCompositeOperation = 'destination-in';
        const grad = ctx.createRadialGradient(center, center, 0, center, center, center * 0.72);
        grad.addColorStop(0.0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.20, 'rgba(0,0,0,0.95)');
        grad.addColorStop(0.48, 'rgba(0,0,0,0.55)');
        grad.addColorStop(0.72, 'rgba(0,0,0,0.18)');
        grad.addColorStop(0.90, 'rgba(0,0,0,0.02)');
        grad.addColorStop(1.0, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        const tex = new THREE.CanvasTexture(cvs);
        tex.anisotropy = 4;
        return tex;
      }

      let gridTex = createRadialGridTexture(isDark());
      const gridMat = new THREE.MeshBasicMaterial({
        map: gridTex,
        transparent: true,
        depthWrite: false,
        opacity: isDark() ? 0.85 : 0.75
      });
      // 6.4 x 6.4 plane: circular fade boundary (radius ~2.3 units) is 100% visible inside viewport without clipping
      const gridFloor = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), gridMat);
      gridFloor.rotation.x = -Math.PI / 2;
      gridFloor.position.y = -0.65;
      scene.add(gridFloor);

      // Gamepad Group: the single interactive hero object in the scene
      const gamepadGroup = new THREE.Group();
      scene.add(gamepadGroup);

      // Apple soft-touch frosted ultra-matte material: iconic dark gray Nintendo Switch controller
      const appleGamepadMaterial = new THREE.MeshStandardMaterial({
        color: 0x282a30,        // Classic Nintendo dark charcoal slate
        roughness: 0.92,        // Ultra-matte soft-touch finish
        metalness: 0.0,         // Pure dielectric matte polycarbonate
      });

      // Load or instantiate the 3D gamepad model
      let isModelLoaded = false;
      Scene3D.loadGamepadModel().then((template) => {
        if (!renderer) return; // Scene already destroyed
        const clone = template.clone(true);
        clone.traverse((child) => {
          if (child.isMesh) {
            child.material = appleGamepadMaterial;
            child.castShadow = false;
            child.receiveShadow = false;
          }
        });
        gamepadGroup.add(clone);
        isModelLoaded = true;
      }).catch((err) => {
        console.warn('Fallback: Gamepad model load error, creating fallback mesh:', err);
        const fallbackMesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 0.4, 1.0),
          appleGamepadMaterial
        );
        gamepadGroup.add(fallbackMesh);
        isModelLoaded = true;
      });

      // Runtime State
      let mode = options.mode || 'demo'; // 'demo' | 'live'
      let demoStep = options.demoStep || 0; // 0=rest, 1=pitch, 2=roll
      let animId = null;
      let animTime = 0;
      let liveQuat = new THREE.Quaternion();
      let currentQuat = new THREE.Quaternion();
      let lastQuatStreamTs = 0;
      let activeMatrix = null;

      let curW = 0;
      let curH = 0;
      function resize() {
        if (!canvas.parentElement) return;
        const w = Math.floor(canvas.parentElement.clientWidth);
        const h = Math.floor(canvas.parentElement.clientHeight);
        if (w <= 0 || h <= 0) return;
        if (Math.abs(w - curW) < 2 && Math.abs(h - curH) < 2) return;
        curW = w;
        curH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }

      const resizeObs = new ResizeObserver(resize);
      resizeObs.observe(canvas.parentElement);
      resize();

      function animate() {
        animId = requestAnimationFrame(animate);
        animTime += 0.024;

        if (mode === 'demo') {
          if (demoStep === 0) {
            // Step 0: Rest / Stillness (Покой на столе) — camera completely stationary
            currentCamAngle = 0;
            gamepadGroup.quaternion.set(0, 0, 0, 1);
          } else {
            // Camera slowed down by 1.5x (0.35 / 1.5 = 0.2333)
            const targetCamAngle = Math.sin(animTime * 0.2333) * (Math.PI * 0.25);
            currentCamAngle += (targetCamAngle - currentCamAngle) * 0.04;

            // Demo gesture animation
            const cycle = (Math.sin(animTime * 2.2) + 1) / 2; // 0..1
            const ease = cycle * cycle * (3 - 2 * cycle);

            if (demoStep === 1) {
              // Step 1: Tilt forward (Pitch / "Кивни")
              gamepadGroup.quaternion.setFromEuler(new THREE.Euler(-0.45 * ease, 0, 0, 'XYZ'));
            } else if (demoStep === 2) {
              // Step 2: Bank sideways (Roll / "Самолётик")
              gamepadGroup.quaternion.setFromEuler(new THREE.Euler(0, 0, -0.45 * ease, 'XYZ'));
            } else if (demoStep === 3) {
              // Step 3: Axis alignment — smooth hold-to-hold tumble through combined
              // pitch+yaw+roll, pausing briefly at each hold, looping forever.
              //
              // Pure nod/bank (pitch+roll only, no yaw/twist) was tried first and is a
              // real dead end, not just a style choice: tilting about axes confined to
              // a single plane leaves the accelerometer's third axis mathematically
              // undetermined — d(gravity)/dt = h·(ω×g) can't observe it, so the
              // physics in sensoralign.go ties forever between two candidate mappings
              // and never locks (reproduced in gui/sensoralign_test.go-style
              // simulation: pure pitch/roll motion never converges; the same motion
              // with a twist mixed in locks almost immediately). So every hold below
              // combines pitch, yaw AND roll — never a pure single-axis tilt — and the
              // model interpolates directly hold→hold (no snap back through a common
              // "flat" pose) so the transition itself stays a single smooth motion.
              const holds = [
                [ 0.00,  0.00,  0.00],
                [-0.35,  0.24,  0.14],
                [ 0.18, -0.30, -0.28],
                [ 0.30,  0.16,  0.26],
                [-0.20, -0.26,  0.11],
                [ 0.12,  0.32, -0.22]
              ];
              const holdTime = 0.9, moveTime = 1.1, legTime = holdTime + moveTime;
              const cycle = holds.length * legTime;
              const t = animTime % cycle;
              const leg = Math.floor(t / legTime);
              const legT = (t % legTime) / legTime;
              const moveFrac = moveTime / legTime;
              const u = Math.min(1, legT / moveFrac); // 0..1 during the move phase, pinned at 1 during hold
              const ease = u * u * (3 - 2 * u);
              const from = holds[leg];
              const to = holds[(leg + 1) % holds.length];
              const px = from[0] + (to[0] - from[0]) * ease;
              const py = from[1] + (to[1] - from[1]) * ease;
              const rz = from[2] + (to[2] - from[2]) * ease;
              gamepadGroup.quaternion.setFromEuler(new THREE.Euler(px, py, rz, 'XYZ'));
            }
          }
        } else {
          // Smoothly glide camera back to neutral center in live mode
          currentCamAngle += (0 - currentCamAngle) * 0.04;

          // Live motion tracking: 1:1, без сглаживания (как в "теме" и PadTest)
          currentQuat.copy(liveQuat);
          gamepadGroup.quaternion.copy(currentQuat);
        }

        // Apply orbit camera position
        const camX = camTarget.x + Math.sin(currentCamAngle) * orbitHRadius;
        const camZ = camTarget.z + Math.cos(currentCamAngle) * orbitHRadius;
        camera.position.set(camX, orbitY, camZ);
        camera.lookAt(camTarget);

        renderer.render(scene, camera);
      }
      animate();

      function applyThemeMaterials(theme) {
        const p = (theme === 'light') ? THEME_LIGHTING.light : THEME_LIGHTING.dark;
        ambLight.intensity = p.ambientIntensity;
        mainLight.intensity = p.keyIntensity;
        fillLight.color.setHex(p.fillColor);
        fillLight.intensity = p.fillIntensity;
        rimLight.color.setHex(p.rimColor);
        rimLight.intensity = p.rimIntensity;
        bounceLight.intensity = p.bounceIntensity;
        if (gridTex) gridTex.dispose();
        gridTex = createRadialGridTexture(theme === 'dark');
        gridMat.map = gridTex;
        gridMat.opacity = (theme === 'dark') ? 0.75 : 0.65;
        gridMat.needsUpdate = true;
      }

      const instance = {
        applyTheme(theme) {
          applyThemeMaterials(theme);
        },
        setMode(newMode, step = 0) {
          mode = newMode;
          demoStep = step;
          animTime = 0;
        },
        setMatrix(mat) {
          activeMatrix = mat;
        },
        resetQuat() {
          liveQuat.set(0, 0, 0, 1);
          currentQuat.set(0, 0, 0, 1);
          gamepadGroup.quaternion.set(0, 0, 0, 1);
        },
        // 60 Hz orientation stream ("ahrs:quat"): the full app state only
        // arrives at 15 Hz, which made live previews visibly step.
        updateQuat(q0, q1, q2, q3) {
          if (mode !== 'live') return;
          if ([q0, q1, q2, q3].some(v => typeof v !== 'number' || isNaN(v))) return;
          if (q0 === 0 && q1 === 0 && q2 === 0 && q3 === 0) return;
          lastQuatStreamTs = performance.now();
          liveQuat.set(q1, q2, q3, q0);
          liveQuat.normalize();
        },
        updateFromState(state) {
          if (mode !== 'live' || !state) return;
          // The 60 Hz stream is newer than any 15 Hz state snapshot; only fall
          // back to the snapshot when the stream is not arriving.
          if (performance.now() - lastQuatStreamTs < 250) return;

          const q0 = Number(state.ahrsQ0);
          const q1 = Number(state.ahrsQ1);
          const q2 = Number(state.ahrsQ2);
          const q3 = Number(state.ahrsQ3);

          if (!isNaN(q0) && !isNaN(q1) && !isNaN(q2) && !isNaN(q3) &&
              (q0 !== 0 || q1 !== 0 || q2 !== 0 || q3 !== 0)) {
            // Кадр AHRS = кадр three.js (X вправо, Y вверх, Z на зрителя) -- кладём
            // как есть, без ремапа, ровно как в песочнице "тема" (см. gui/ahrs.go).
            liveQuat.set(q1, q2, q3, q0);
            liveQuat.normalize();
          }
        },
        destroy() {
          if (animId) {
            cancelAnimationFrame(animId);
            animId = null;
          }
          if (gridTex) gridTex.dispose();
          if (gridMat) gridMat.dispose();
          resizeObs.disconnect();
          renderer.dispose();
        }
      };

      this.activeScenes[canvasId] = instance;
      return instance;
    },

    get(canvasId) {
      return this.activeScenes[canvasId] || null;
    },

    destroy(canvasId) {
      if (this.activeScenes[canvasId]) {
        this.activeScenes[canvasId].destroy();
        delete this.activeScenes[canvasId];
      }
    }
  };

  // ── Calibration Wizard Controller ───────────────────────────────────────────
  const CalibrationWizard = {
    targetSlot: 0,
    isOpen: false,
    initialized: false,
    isTransitioning: false,
    currentScreen: 'slots', // 'slots' | 'capture' | 'confirm' | 'manual' | 'save'
    captureStep: 0,         // 0=rest, 1=pitch, 2=roll
    capturedVectors: [],    // [[ux, uy, uz], [rx, ry, rz], [fx, fy, fz]]
    lockedAxes: {},         // { [axisIdx]: { role: 'up'|'pitch'|'roll', name: '+Y', confidence: 0.98 } }
    builtMatrix: null,
    isCapturing: false,
    timerInterval: null,
    selectedIcon: 'default',
    isSaveDropdownOpen: false,

    STEPS_CONFIG: [
      {
        titleKey: 'calibration.step0_title',
        descKey: 'calibration.step0_desc',
        captionKey: 'calibration.step0_caption',
        btnKey: 'calibration.step0_btn',
        durationMs: 1600,
        isRest: true
      },
      {
        titleKey: 'calibration.step1_title',
        descKey: 'calibration.step1_desc',
        captionKey: 'calibration.step1_caption',
        btnKey: 'calibration.step1_btn',
        durationMs: 2400,
        isRest: false
      },
      {
        titleKey: 'calibration.step2_title',
        descKey: 'calibration.step2_desc',
        captionKey: 'calibration.step2_caption',
        btnKey: 'calibration.step2_btn',
        durationMs: 2400,
        isRest: false
      },
      {
        titleKey: 'calibration.step3_title',
        descKey: 'calibration.step3_desc',
        captionKey: 'calibration.step3_caption',
        btnKey: 'calibration.step3_btn',
        isAxisAlign: true
      }
    ],

    // Polling handle for the axis-alignment step (GetAxisAlignStatus)
    axisAlignInterval: null,
    axisAlignKnown: false,

    getConnectedDevice() {
      const st = (typeof AppState !== 'undefined' && AppState.lastState) ? AppState.lastState : null;
      if (st && st.deviceName && st.deviceName !== 'Controller' && st.deviceName !== 'Unknown') {
        return st.deviceName;
      }
      // No real name reported (a USB device's TYPE=0x02 frame is optional):
      // "iPhone" is a reasonable phone-mode fallback, but would be actively
      // wrong for an unnamed USB device -- let SaveProfile's own "Unknown"
      // default stand for that case instead of guessing a device it isn't.
      if (typeof AppState !== 'undefined' && AppState.inputMode === 'usb') {
        return (st && st.deviceName) || '';
      }
      return (st && st.deviceName) || 'iPhone';
    },

    updateSubtitleWithDevice() {
      const connectedDev = this.getConnectedDevice();
      const subEl = document.getElementById('cal-modal-subtitle');
      if (subEl) {
        if (connectedDev && connectedDev !== 'Unknown') {
          subEl.textContent = (I18n.t('calibration.subtitle_device') || 'Настройка соответствия осей • {device}').replace('{device}', connectedDev);
        } else {
          subEl.textContent = I18n.t('calibration.subtitle');
        }
      }
    },

    isDisconnectAlertActive: false,
    wasInterruptedByDisconnect: false,

    showDisconnectAlert() {
      if (!this.isOpen || this.isDisconnectAlertActive) return;
      if (SettingsManager.currentSettings && SettingsManager.currentSettings.disconnectAlert === false) return;
      this.isDisconnectAlertActive = true;

      // Add subtle Apple red outline to the modal card only
      const modalEl = document.querySelector('.cal-modal');
      if (modalEl) {
        modalEl.classList.add('cal-modal-disconnected');
        modalEl.scrollTop = 0;
      }

      // If active capture was running, abort countdown/recording safely
      if (this.isCapturing) {
        this.wasInterruptedByDisconnect = true;
        this.isCapturing = false;
        this._resetCaptureTimer();
        this._resetCaptureUI();
        if (window.go?.main?.App) {
          window.go.main.App.StopCapture(this.captureStep).catch(() => {});
        }
      }

      const alertOverlay = document.getElementById('cal-disconnect-overlay');
      if (alertOverlay) {
        alertOverlay.style.display = 'flex';
      }

      if (typeof SoundManager !== 'undefined') {
        SoundManager.play('disconnect');
      }
    },

    hideDisconnectAlert() {
      if (!this.isDisconnectAlertActive) return;
      this.isDisconnectAlertActive = false;

      const modalEl = document.querySelector('.cal-modal');
      if (modalEl) {
        modalEl.classList.remove('cal-modal-disconnected');
      }
      document.body.classList.remove('cal-disconnect-window-alert');

      const alertOverlay = document.getElementById('cal-disconnect-overlay');
      if (alertOverlay) {
        alertOverlay.style.display = 'none';
      }

      if (typeof SoundManager !== 'undefined') {
        SoundManager.play('connect');
      }

      if (this.wasInterruptedByDisconnect) {
        this.wasInterruptedByDisconnect = false;
        const toastMsg = I18n.t('calibration.disconnect_reconnected_toast') || 'Телефон подключен. Нажмите «Запись», чтобы повторить шаг.';
        if (typeof showToast === 'function') {
          showToast(toastMsg);
        }
        this._resetCaptureUI();
      }
    },

    open() {
      if (typeof AppState !== 'undefined') {
        if (AppState.dismissFirstTimeDeviceAlert) AppState.dismissFirstTimeDeviceAlert();
        if (AppState.hideRecalHint) AppState.hideRecalHint(true);
      }
      this.isOpen = true;
      this.hideDisconnectAlert();
      const overlay = document.getElementById('cal-overlay');
      if (overlay) overlay.style.display = 'flex';
      this.updateSubtitleWithDevice();
      this.showScreen('slots');
      this.renderSlotList();
      if (AppState?.lastState?.status === 'offline') {
        this.showDisconnectAlert();
      }
    },

    openToSlot(slot) {
      if (typeof AppState !== 'undefined') {
        if (AppState.dismissFirstTimeDeviceAlert) AppState.dismissFirstTimeDeviceAlert();
        if (AppState.hideRecalHint) AppState.hideRecalHint(true);
      }
      this.isOpen = true;
      this.hideDisconnectAlert();
      this.targetSlot = slot;
      const overlay = document.getElementById('cal-overlay');
      if (overlay) overlay.style.display = 'flex';
      this.updateSubtitleWithDevice();
      this.startCaptureFlow(slot);
      if (AppState?.lastState?.status === 'offline') {
        this.showDisconnectAlert();
      }
    },

    close() {
      this.isOpen = false;
      this.hideDisconnectAlert();
      const overlay = document.getElementById('cal-overlay');
      if (overlay) overlay.style.display = 'none';
      this._resetCaptureTimer();
      this._stopAxisAlignPoll();
      ['cal-3d-canvas', 'cal-3d-canvas-confirm', 'cal-3d-canvas-manual'].forEach(id => Scene3D.destroy(id));
      this.currentScreen = 'slots';
      if (window.go?.main?.App) {
        window.go.main.App.ClearPreview().catch(() => {});
      }
    },

    showScreen(screen) {
      this.currentScreen = screen;
      const screens = ['cal-screen-slots', 'cal-screen-capture', 'cal-screen-confirm', 'cal-screen-manual', 'cal-screen-save'];
      screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === `cal-screen-${screen}`) ? 'block' : 'none';
      });

      if (screen === 'capture') {
        this._updateStepUI();
        Scene3D.mount('cal-3d-canvas', { mode: 'demo', demoStep: this.captureStep });
      } else if (screen === 'confirm') {
        for (let i = 0; i < 5; i++) {
          const pill = document.getElementById(`step-pill-${i}`);
          if (pill) {
            pill.classList.remove('active', 'completed');
            if (i < 4) pill.classList.add('completed');
            else if (i === 4) pill.classList.add('active');
          }
        }
        this._renderConfirmDetails();
        const s = Scene3D.mount('cal-3d-canvas-confirm', { mode: 'live' });
        if (s) {
          if (this.builtMatrix) s.setMatrix(this.builtMatrix);
          s.resetQuat();
        }
        if (window.go?.main?.App) {
          if (this.builtMatrix) {
            window.go.main.App.PreviewMatrix(this.builtMatrix)
              .then(() => this._renderMountCard())
              .catch(() => {});
          } else {
            this._renderMountCard();
          }
          window.go.main.App.ResetAHRS().catch(() => {});
        }
      } else if (screen === 'manual') {
        const s = Scene3D.mount('cal-3d-canvas-manual', { mode: 'live' });
        if (s) s.resetQuat();
        if (window.go?.main?.App) {
          window.go.main.App.ResetAHRS().catch(() => {});
        }
        this._buildManualMatrix();
      } else if (screen === 'save') {
        this._renderSaveScreen();
      }
    },


    renderSlotList() {
      const list = document.getElementById('cal-slot-list');
      if (!list) return;
      list.innerHTML = '';

      for (let i = 0; i < 6; i++) {
        const p = ProfileManager.profiles[i];
        const card = document.createElement('div');
        card.className = 'cal-slot-card' + (p && p.active ? ' active' : '');

        const info = document.createElement('div');
        info.className = 'cal-slot-card-info';

        const numEl = document.createElement('span');
        numEl.className = 'cal-slot-card-num';
        numEl.textContent = formatSlotName(i);

        const nameEl = document.createElement('span');
        nameEl.className = 'cal-slot-card-name';
        nameEl.textContent = (p && p.name) ? p.name : (I18n.t('calibration.slot_empty') || 'Пустой слот');

        info.appendChild(numEl);
        info.appendChild(nameEl);

        const connectedDev = this.getConnectedDevice();
        const pDev = (p && p.device && p.device !== 'Unknown') ? p.device : (p && p.name ? '' : connectedDev);
        if (pDev) {
          const devEl = document.createElement('span');
          devEl.className = 'cal-slot-card-dev';
          devEl.style.fontSize = '11px';
          devEl.style.opacity = '0.6';
          devEl.textContent = (I18n.t('calibration.device_label') || 'Устройство: {device}').replace('{device}', pDev);
          info.appendChild(devEl);
        }
        card.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'cal-slot-card-actions';

        const btnCal = document.createElement('button');
        btnCal.type = 'button';
        btnCal.className = 'btn-apple-primary cal-btn-sm';
        btnCal.textContent = (p && p.name) ? (I18n.t('calibration.btn_recalibrate') || 'Перекалибровать') : (I18n.t('calibration.btn_calibrate_short') || I18n.t('calibration.btn_calibrate') || 'Калибровать');
        btnCal.addEventListener('click', () => this.startCaptureFlow(i));
        actions.appendChild(btnCal);

        card.appendChild(actions);
        list.appendChild(card);
      }
    },

    startCaptureFlow(slot) {
      this.targetSlot = slot;
      this.captureStep = 0;
      this.capturedVectors = [];
      this.lockedAxes = {};
      this.axisAlignKnown = false;
      this._stopAxisAlignPoll();
      // Calibrating means recalibrating: never trust a mapping learned in a previous
      // session for this slot. Forget it immediately so step 4 always re-earns it from
      // scratch instead of silently reusing (possibly stale/wrong) old data.
      if (window.go?.main?.App) {
        window.go.main.App.StartAxisAlign(true).catch(() => {});
      }
      this.showScreen('capture');
      this.updateTelemetry(AppState.lastState);
    },

    _updateStepUI() {
      const cfg = this.STEPS_CONFIG[this.captureStep];
      if (!cfg) return;
      this._stopAxisAlignPoll();

      // 1. Progress Pills (5 total: Rest, Pitch, Roll, Align, Confirm)
      for (let i = 0; i < 5; i++) {
        const pill = document.getElementById(`step-pill-${i}`);
        if (pill) {
          pill.classList.remove('active', 'completed');
          if (i < this.captureStep) pill.classList.add('completed');
          else if (i === this.captureStep) pill.classList.add('active');
        }
      }

      // 2. Titles and instructions
      const titleEl = document.getElementById('cal-step-title');
      const descEl = document.getElementById('cal-step-desc');
      const captionEl = document.getElementById('cal-3d-caption');

      if (titleEl) titleEl.innerHTML = renderMarkdown(I18n.t(cfg.titleKey));
      if (descEl) descEl.innerHTML = renderMarkdown(I18n.t(cfg.descKey));
      if (captionEl) captionEl.textContent = I18n.t(cfg.captionKey) || '';

      // 3. Reset capture UI
      this._resetCaptureUI();
      this.updateTelemetry(AppState.lastState);

      // 4. Update global forward button in footer: always visible, disabled if step not passed yet
      const btnForward = document.getElementById('cal-capture-forward');
      if (btnForward) {
        btnForward.style.display = 'inline-flex';
        if (this.captureStep === 0) {
          btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
          btnForward.disabled = !this.capturedVectors[0];
        } else if (this.captureStep === 1) {
          btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
          btnForward.disabled = !this.capturedVectors[1];
        } else if (this.captureStep === 2) {
          btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
          btnForward.disabled = !(this.builtMatrix || this.capturedVectors[2]);
        } else if (this.captureStep === 3) {
          btnForward.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
          btnForward.disabled = !this.axisAlignKnown;
        }
      }

      // 5. Update 3D scene demo
      const s = Scene3D.get('cal-3d-canvas');
      if (s) s.setMode('demo', this.captureStep);

      // 6. The axis-alignment step has its own live-polling flow instead of a
      // fixed-duration capture (see startAxisAlignSequence / _pollAxisAlign).
      if (cfg.isAxisAlign) {
        this._enterAxisAlignStep();
      }
    },

    _showPhase(phase) {
      const pCapture = document.getElementById('cal-phase-capture');
      const pResult = document.getElementById('cal-phase-result');
      if (phase === 'capture') {
        if (pCapture) {
          pCapture.style.display = 'flex';
          pCapture.classList.remove('fade-in');
          void pCapture.offsetWidth;
          pCapture.classList.add('fade-in');
        }
        if (pResult) pResult.style.display = 'none';
      } else {
        if (pCapture) pCapture.style.display = 'none';
        if (pResult) {
          pResult.style.display = 'flex';
          pResult.classList.remove('fade-in');
          void pResult.offsetWidth;
          pResult.classList.add('fade-in');
        }
      }
    },

    updateTelemetry(state) {
      if (!state) return;
      const vals = [state.rawRotX || 0, state.rawRotY || 0, state.rawRotZ || 0];

      for (let i = 0; i < 3; i++) {
        const capsule = document.getElementById(`axis-capsule-${i}`);
        const tag = document.getElementById(`axis-tag-${i}`);
        const valEl = document.getElementById(`axis-val-${i}`);
        const fillEl = document.getElementById(`axis-fill-${i}`);
        if (!capsule || !tag || !valEl || !fillEl) continue;

        const locked = this.lockedAxes[i];
        if (locked && locked.status === 'predicted') {
          capsule.classList.remove('locked');
          capsule.classList.add('predicted');
          const roleName = I18n.t(`calibration.axis_${locked.role}`) || locked.role;
          const pct = Math.round((locked.confidence || 0.5) * 100);
          const predLabel = (I18n.t('calibration.axis_predicted') || '{n}% • Прогноз').replace('{n}', pct);
          tag.textContent = `~ ${roleName}: ${locked.name}`;
          valEl.textContent = predLabel;
          fillEl.style.width = `${pct}%`;
        } else if (locked) {
          capsule.classList.remove('predicted');
          capsule.classList.add('locked');
          const roleName = I18n.t(`calibration.axis_${locked.role}`) || locked.role;
          tag.textContent = `+ ${roleName}: ${locked.name}`;
          valEl.textContent = `${Math.round((locked.confidence || 0.95) * 100)}%`;
          fillEl.style.width = '100%';
        } else {
          capsule.classList.remove('locked', 'predicted');
          tag.textContent = '—';
          const v = vals[i];
          valEl.textContent = `${v >= 0 ? '+' : ''}${Math.round(v)}°/с`;
          const fillPct = Math.min(100, Math.round((Math.abs(v) / 120) * 100));
          fillEl.style.width = `${fillPct}%`;
        }
      }
    },

    _resetCaptureUI() {
      this.isCapturing = false;
      this._resetCaptureTimer();
      this._showPhase('capture');

      const btnStart = document.getElementById('btn-start-capture');
      const btnText = document.getElementById('btn-capture-text');
      const timerContainer = document.getElementById('cal-timer-container');
      const statusText = document.getElementById('cal-status-text');
      const statusDot = document.getElementById('cal-status-dot');
      const speedBadge = document.getElementById('cal-speed-badge');

      if (timerContainer) timerContainer.style.display = 'none';
      if (speedBadge) speedBadge.style.display = 'none';

      if (statusText) statusText.textContent = I18n.t('calibration.ready') || 'Готов к записи';
      if (statusDot) statusDot.className = 'status-pulse-dot';

      if (btnStart) {
        btnStart.classList.remove('counting-down', 'recording', 'listening');
        btnStart.disabled = false;
      }
      const cfg = this.STEPS_CONFIG[this.captureStep];
      if (btnText && cfg) {
        btnText.textContent = I18n.t(cfg.btnKey);
      }
    },

    _resetCaptureTimer() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    },

    async startCaptureSequence() {
      if (this.isCapturing) return;
      this.isCapturing = true;

      const cfg = this.STEPS_CONFIG[this.captureStep];
      const btnStart = document.getElementById('btn-start-capture');
      const btnText = document.getElementById('btn-capture-text');
      const timerContainer = document.getElementById('cal-timer-container');
      const progressBar = document.getElementById('cal-progress-bar');
      const timerCountdown = document.getElementById('cal-timer-countdown');
      const statusText = document.getElementById('cal-status-text');
      const statusDot = document.getElementById('cal-status-dot');
      const speedBadge = document.getElementById('cal-speed-badge');

      if (btnStart) {
        btnStart.classList.add('counting-down');
        btnStart.disabled = true;
      }

      // 1. Prominent countdown directly on the button: 2.. 1..
      if (statusDot) statusDot.className = 'status-pulse-dot countdown';
      if (statusText) statusText.textContent = I18n.t('calibration.preparing') || 'Приготовьтесь...';

      for (let c = 2; c >= 1; c--) {
        const txt = `${c}...`;
        if (btnText) btnText.textContent = txt;
        await new Promise(r => setTimeout(r, 650));
        if (!this.isCapturing) return;
      }

      // 2. Start recording in Go backend
      if (btnStart) {
        btnStart.classList.remove('counting-down');
        btnStart.classList.add('recording');
        const recText = cfg.isRest
          ? (I18n.t('calibration.btn_recording_rest') || 'ИЗМЕРЕНИЕ ГРАВИТАЦИИ...')
          : (I18n.t('calibration.btn_recording') || 'ИДЁТ ЗАПИСЬ ЖЕСТА...');
        if (btnText) btnText.textContent = recText;
      }

      if (statusText) {
        statusText.textContent = cfg.isRest
          ? (I18n.t('calibration.status_recording_rest') || 'Телефон должен лежать неподвижно...')
          : (I18n.t('calibration.status_recording') || 'Наклоняйте телефон сейчас!');
      }
      if (statusDot) statusDot.className = 'status-pulse-dot active';
      if (timerContainer) timerContainer.style.display = 'block';
      if (speedBadge) speedBadge.style.display = 'inline-block';

      if (window.go?.main?.App) {
        await window.go.main.App.StartCapture();
      }

      const totalDurationMs = cfg.durationMs || 2400;
      const startTime = Date.now();

      this.timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, (elapsed / totalDurationMs) * 100);
        const remaining = Math.max(0, (totalDurationMs - elapsed) / 1000).toFixed(1);

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (timerCountdown) timerCountdown.textContent = `${remaining}с`;

        if (AppState.lastState) {
          const rx = AppState.lastState.rawRotX || 0;
          const ry = AppState.lastState.rawRotY || 0;
          const rz = AppState.lastState.rawRotZ || 0;
          const speed = Math.sqrt(rx*rx + ry*ry + rz*rz);
          if (speedBadge) speedBadge.textContent = `${Math.round(speed)}°/с`;
        }

        if (elapsed >= totalDurationMs) {
          this._resetCaptureTimer();
          this._finishCapture();
        }
      }, 35);
    },

    async _finishCapture() {
      this.isCapturing = false;

      let result = { success: false, errorMsg: I18n.t('calibration.no_signal') || 'Нет соединения' };
      if (window.go?.main?.App) {
        result = await window.go.main.App.StopCapture(this.captureStep);
      }

      const resultIcon = document.getElementById('result-icon');
      const resultTitle = document.getElementById('result-title');
      const resultSubtext = document.getElementById('result-subtext');
      const btnNext = document.getElementById('btn-next-step');
      const btnRetry = document.getElementById('btn-retry-step');
      const btnForward = document.getElementById('cal-capture-forward');

      if (result.success) {
        if (this.captureStep === 0) {
          this.capturedVectors[0] = [0, 0, 0];
          if (resultIcon) {
            resultIcon.textContent = '✓';
            resultIcon.className = 'result-badge-icon success';
          }
          if (resultTitle) {
            resultTitle.textContent = I18n.t('calibration.capture_success_title') || 'Покой зафиксирован!';
          }
          if (resultSubtext) {
            resultSubtext.innerHTML = '';
          }
          if (btnNext) {
            btnNext.style.display = 'inline-flex';
            btnNext.textContent = I18n.t('calibration.btn_next_step') || 'Следующий шаг →';
          }
          if (btnForward) {
            btnForward.style.display = 'inline-flex';
            btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
            btnForward.disabled = false;
          }
          if (btnRetry) {
            btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
          }
          this._showPhase('result');
          return;
        }

        if (this.captureStep === 1) {
          this.capturedVectors[1] = result.vector;
          this.lockedAxes[result.axisIdx] = {
            role: 'pitch',
            name: result.axisName,
            confidence: result.confidence,
            status: 'locked'
          };
          this.updateTelemetry(AppState.lastState);

          if (resultIcon) {
            resultIcon.textContent = '✓';
            resultIcon.className = 'result-badge-icon success';
          }
          if (resultTitle) {
            resultTitle.textContent = I18n.t('calibration.capture_success_title') || 'Жест успешно распознан!';
          }
          if (resultSubtext) {
            const pct = Math.round((result.confidence || 0.95) * 100);
            const spd = Math.round(result.peakSpeed || 80);
            const tmpl = I18n.t('calibration.res_gesture') || 'Ось: **{axis}** • Точность: **{pct}%** • Скорость: **{spd}°/с**';
            resultSubtext.innerHTML = renderMarkdown(tmpl.replace('{axis}', result.axisName).replace('{pct}', pct).replace('{spd}', spd));
          }
          if (btnNext) {
            btnNext.style.display = 'inline-flex';
            btnNext.textContent = I18n.t('calibration.btn_next_step') || 'Следующий шаг →';
          }
          if (btnForward) {
            btnForward.style.display = 'inline-flex';
            btnForward.textContent = I18n.t('calibration.btn_next') || 'Далее →';
            btnForward.disabled = false;
          }
          if (btnRetry) {
            btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
          }
          this._showPhase('result');
          return;
        }

        // Step 2 (Roll) completed: we have both Pitch and Roll, run validation!
        if (this.captureStep === 2) {
          this.capturedVectors[2] = result.vector;
          this.lockedAxes[result.axisIdx] = {
            role: 'roll',
            name: result.axisName,
            confidence: result.confidence,
            status: 'locked'
          };
          this.updateTelemetry(AppState.lastState);

          let valRes = { success: true };
          if (window.go?.main?.App) {
            valRes = await window.go.main.App.ValidateCalibration(
              this.capturedVectors[1], // Pitch
              this.capturedVectors[2]  // Roll
            );
          }

          if (valRes.success) {
            this.builtMatrix = valRes.matrix;

            // Lock calculated Yaw axis in telemetry strip
            const axes = ['X', 'Y', 'Z'];
            for (let ax = 0; ax < 3; ax++) {
              if (!this.lockedAxes[ax]) {
                const yawName = valRes.yawAxis || `+${axes[ax]}`;
                this.lockedAxes[ax] = {
                  role: 'yaw',
                  name: yawName,
                  confidence: 1.0,
                  status: 'locked'
                };
              }
            }
            this.updateTelemetry(AppState.lastState);

            if (resultIcon) {
              resultIcon.textContent = '✓';
              resultIcon.className = 'result-badge-icon success';
            }
            if (resultTitle) {
              resultTitle.textContent = I18n.t('calibration.capture_success_title') || 'Калибровка завершена!';
            }
            if (resultSubtext) {
              const tmpl = I18n.t('calibration.res_all_done') || 'Калибровка завершена: P: **{p}** • Y: **{y}** • R: **{r}**';
              resultSubtext.innerHTML = renderMarkdown(
                tmpl.replace('{p}', valRes.pitchAxis)
                    .replace('{y}', valRes.yawAxis)
                    .replace('{r}', valRes.rollAxis)
              );
            }
            if (btnNext) {
              btnNext.style.display = 'inline-flex';
              btnNext.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
            }
            if (btnForward) {
              btnForward.style.display = 'inline-flex';
              btnForward.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
              btnForward.disabled = false;
            }
            if (btnRetry) {
              btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
            }
            this._showPhase('result');
            return;
          } else {
            if (resultIcon) {
              resultIcon.textContent = '!';
              resultIcon.className = 'result-badge-icon error';
            }
            if (resultTitle) {
              resultTitle.textContent = I18n.t('calibration.capture_fail_title') || 'Ошибка калибровки';
            }
            if (resultSubtext) {
              const errKey = valRes.errorCode ? ('calibration.' + valRes.errorCode) : '';
              const locErr = errKey ? I18n.t(errKey) : '';
              resultSubtext.innerHTML = renderMarkdown((locErr && locErr !== errKey) ? locErr : (valRes.errorMsg || I18n.t('calibration.err_axes_inconsistent') || 'Оси не согласуются друг с другом.'));
            }
            if (btnNext) btnNext.style.display = 'none';
            if (btnRetry) btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
            this._showPhase('result');
            return;
          }
        }
      } else {
        if (resultIcon) {
          resultIcon.textContent = '!';
          resultIcon.className = 'result-badge-icon error';
        }
        if (resultTitle) {
          resultTitle.textContent = I18n.t('calibration.capture_fail_title') || 'Движение не распознано';
        }
        if (resultSubtext) {
          const errKey = result.errorCode ? ('calibration.' + result.errorCode) : '';
          const locErr = errKey ? I18n.t(errKey) : '';
          resultSubtext.innerHTML = renderMarkdown((locErr && locErr !== errKey) ? locErr : (result.errorMsg || I18n.t('calibration.err_motion_record') || 'Ошибка записи движения'));
        }
        if (btnNext) btnNext.style.display = 'none';
        if (btnRetry) btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
        this._showPhase('result');
      }
    },

    // ── Step 3: Explicit accelerometer↔gyro axis alignment ─────────────────────
    // Unlike steps 0-2 (fixed-duration buffered capture), this step polls the live
    // physics-based aligner (gui/sensoralign.go) while the user keeps tilting the
    // phone, and reports success the moment it locks a confident mapping.

    async _enterAxisAlignStep() {
      this._stopAxisAlignPoll();
      // Deliberately NOT asking the backend for status here: its scratch aligner
      // (wizardAlign) is fed every incoming frame from the moment the wizard opens
      // (startCaptureFlow), so by the time the user reaches this step it can already
      // look "known" purely from Pitch/Roll's own big tilts in steps 1-2 -- before
      // the user has actually done this step once. Always require the real capture;
      // this.axisAlignKnown only turns true from a genuinely completed run of
      // startAxisAlignSequence (or stays false after Retry resets it).
      const btnForward = document.getElementById('cal-capture-forward');
      if (btnForward && this.captureStep === 3) btnForward.disabled = !this.axisAlignKnown;

      if (this.axisAlignKnown) {
        let status = { known: false, pairs: 0, minPairs: 6, mapping: [] };
        if (window.go?.main?.App) {
          try { status = await window.go.main.App.GetAxisAlignStatus(); } catch (e) {}
        }
        this._showAxisAlignResult(true, status, /*alreadyKnown=*/true);
      }
    },

    async startAxisAlignSequence() {
      if (this.isCapturing) return;
      this.isCapturing = true;

      const btnStart = document.getElementById('btn-start-capture');
      const btnText = document.getElementById('btn-capture-text');
      const timerContainer = document.getElementById('cal-timer-container');
      const statusText = document.getElementById('cal-status-text');
      const statusDot = document.getElementById('cal-status-dot');
      const speedBadge = document.getElementById('cal-speed-badge');
      const progressBar = document.getElementById('cal-progress-bar');
      const timerCountdown = document.getElementById('cal-timer-countdown');

      if (btnStart) {
        // A status, not an action: the step listens to your motion by itself.
        btnStart.classList.add('listening');
        btnStart.disabled = true;
      }
      if (btnText) btnText.textContent = I18n.t('calibration.align_recording_btn') || 'СЛУШАЕМ ДВИЖЕНИЯ…';
      if (statusText) statusText.textContent = I18n.t('calibration.align_status_recording') || 'Наклоняйте телефон в разные стороны и замирайте между наклонами';
      if (statusDot) statusDot.className = 'status-pulse-dot active';
      if (timerContainer) timerContainer.style.display = 'block';
      if (speedBadge) speedBadge.style.display = 'inline-block';
      if (progressBar) progressBar.style.width = '0%';

      // Forget any prior, possibly-wrong mapping only on an explicit redo (Retry);
      // a fresh profile has nothing to forget, so this is always safe here.
      if (window.go?.main?.App) {
        await window.go.main.App.StartAxisAlign(true);
      }

      const startTime = Date.now();
      const timeoutMs = 20000;

      this.axisAlignInterval = setInterval(async () => {
        if (!window.go?.main?.App) return;
        let status;
        try { status = await window.go.main.App.GetAxisAlignStatus(); } catch (e) { return; }
        if (!this.isCapturing) return;

        const pct = Math.min(100, Math.round((status.pairs / Math.max(1, status.minPairs)) * 100));
        if (progressBar) progressBar.style.width = `${pct}%`;
        // minPairs is only the minimum: past it the backend keeps collecting until
        // one axis mapping clearly wins. Say so instead of showing "12/6".
        const refining = status.pairs >= status.minPairs;
        if (timerCountdown) {
          timerCountdown.textContent = refining
            ? (I18n.t('calibration.align_counter_refining') || 'уточняем…')
            : `${status.pairs}/${status.minPairs}`;
        }
        if (statusText) {
          statusText.textContent = refining
            ? (I18n.t('calibration.align_status_refining') || 'Данных хватает — уточняем. Сделайте ещё пару движений в других направлениях')
            : (I18n.t('calibration.align_status_recording') || 'Наклоняйте телефон в разные стороны и замирайте между наклонами');
        }

        if (AppState.lastState) {
          const rx = AppState.lastState.rawRotX || 0;
          const ry = AppState.lastState.rawRotY || 0;
          const rz = AppState.lastState.rawRotZ || 0;
          const speed = Math.sqrt(rx*rx + ry*ry + rz*rz);
          if (speedBadge) speedBadge.textContent = `${Math.round(speed)}°/с`;
        }

        if (status.known) {
          this._stopAxisAlignPoll();
          this.isCapturing = false;
          this.axisAlignKnown = true;
          this._showAxisAlignResult(true, status, false);
          return;
        }

        if (Date.now() - startTime >= timeoutMs) {
          this._stopAxisAlignPoll();
          this.isCapturing = false;
          this._showAxisAlignResult(false, status, false);
        }
      }, 200);
    },

    _stopAxisAlignPoll() {
      if (this.axisAlignInterval) {
        clearInterval(this.axisAlignInterval);
        this.axisAlignInterval = null;
      }
    },

    _showAxisAlignResult(success, status, alreadyKnown) {
      const resultIcon = document.getElementById('result-icon');
      const resultTitle = document.getElementById('result-title');
      const resultSubtext = document.getElementById('result-subtext');
      const btnNext = document.getElementById('btn-next-step');
      const btnRetry = document.getElementById('btn-retry-step');
      const btnForward = document.getElementById('cal-capture-forward');

      if (success) {
        if (resultIcon) {
          resultIcon.textContent = '✓';
          resultIcon.className = 'result-badge-icon success';
        }
        if (resultTitle) {
          resultTitle.textContent = alreadyKnown
            ? (I18n.t('calibration.align_already_title') || 'Оси уже определены')
            : (I18n.t('calibration.align_success_title') || 'Оси определены!');
        }
        if (resultSubtext) {
          const mapping = (status.mapping || []).join(', ');
          const tmpl = alreadyKnown
            ? (I18n.t('calibration.align_already_desc') || 'Сохранено ранее: **{mapping}**')
            : (I18n.t('calibration.align_success_desc') || 'Акселерометр совмещён с гироскопом: **{mapping}**');
          resultSubtext.innerHTML = renderMarkdown(tmpl.replace('{mapping}', mapping));
        }
        if (btnNext) {
          btnNext.style.display = 'inline-flex';
          btnNext.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
        }
        if (btnForward) {
          btnForward.style.display = 'inline-flex';
          btnForward.textContent = I18n.t('calibration.btn_to_confirm') || 'Перейти к проверке →';
          btnForward.disabled = false;
        }
        if (btnRetry) {
          btnRetry.textContent = I18n.t('calibration.btn_recalibrate_align') || 'Определить заново';
        }
      } else {
        if (resultIcon) {
          resultIcon.textContent = '!';
          resultIcon.className = 'result-badge-icon error';
        }
        if (resultTitle) {
          resultTitle.textContent = I18n.t('calibration.align_fail_title') || 'Не удалось определить оси';
        }
        if (resultSubtext) {
          resultSubtext.innerHTML = renderMarkdown(I18n.t('calibration.align_fail_desc') ||
            'Слишком мало уверенных наклонов. Наклоняйте телефон более резко в разные стороны (вперёд, вбок, по диагонали) и на секунду замирайте между наклонами.');
        }
        if (btnNext) btnNext.style.display = 'none';
        if (btnRetry) btnRetry.textContent = I18n.t('calibration.btn_retry') || 'Повторить';
      }
      this._showPhase('result');
    },

    nextStep() {
      if (this.isTransitioning) return;
      this.isTransitioning = true;
      setTimeout(() => { this.isTransitioning = false; }, 300);

      if (this.captureStep < 3) {
        this.captureStep++;
        this._updateStepUI();
      } else {
        this.showScreen('confirm');
      }
    },

    _det3(m) {
      return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
           - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
           + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    },

    _renderConfirmDetails() {
      const axes = ['X', 'Y', 'Z'];
      const m = this.builtMatrix || [[1,0,0],[0,1,0],[0,0,-1]];
      const axisStr = (row) => {
        for (let c = 0; c < 3; c++) {
          if (m[row][c] > 0.5) return `+${axes[c]}`;
          if (m[row][c] < -0.5) return `-${axes[c]}`;
        }
        return '?';
      };

      const chipP = document.getElementById('chip-pitch');
      const chipY = document.getElementById('chip-yaw');
      const chipR = document.getElementById('chip-roll');
      if (chipP) chipP.textContent = `Pitch: ${axisStr(0)}`;
      if (chipY) chipY.textContent = `Yaw: ${axisStr(1)}`;
      if (chipR) chipR.textContent = `Roll: ${axisStr(2)}`;

      const det = this._det3(m);
      const detStatus = document.getElementById('confirm-det-status');
      if (detStatus) {
        detStatus.textContent = (Math.abs(det + 1.0) < 0.05)
          ? I18n.t('calibration.matrix_det_ok')
          : I18n.t('calibration.matrix_det_err');
      }
    },

    _buildManualMatrix() {
      const pitchAxis = parseInt(document.getElementById('man-pitch-axis')?.value || '0', 10);
      const yawAxis   = parseInt(document.getElementById('man-yaw-axis')?.value   || '1', 10);
      const rollAxis  = parseInt(document.getElementById('man-roll-axis')?.value  || '2', 10);
      const pitchInv  = document.getElementById('man-pitch-inv')?.checked ? -1 : 1;
      const yawInv    = document.getElementById('man-yaw-inv')?.checked   ? -1 : 1;
      const rollInv   = document.getElementById('man-roll-inv')?.checked  ? -1 : 1;

      const mat = [[0,0,0],[0,0,0],[0,0,0]];
      mat[0][pitchAxis] = pitchInv; // Row 0 = Pitch (RotX)
      mat[1][yawAxis]   = yawInv;   // Row 1 = Yaw (RotY)
      mat[2][rollAxis]  = rollInv;  // Row 2 = Roll (RotZ)

      const det = this._det3(mat);
      const isValid = (Math.abs(det + 1.0) < 0.05);

      const statusEl = document.getElementById('cal-manual-status-text');
      const dotEl = document.getElementById('cal-manual-dot');
      const nextBtn = document.getElementById('cal-manual-next');

      if (statusEl) {
        statusEl.textContent = isValid
          ? I18n.t('calibration.matrix_det_ok')
          : I18n.t('calibration.manual_invalid');
      }
      if (dotEl) dotEl.className = 'status-dot-sm' + (isValid ? ' ok' : ' error');
      if (nextBtn) nextBtn.disabled = !isValid;

      if (isValid) {
        this.builtMatrix = mat;
        const s = Scene3D.get('cal-3d-canvas-manual');
        if (s) s.setMatrix(mat);
        if (window.go?.main?.App) {
          window.go.main.App.PreviewMatrix(mat).catch(() => {});
        }
      }
    },

    _renderSaveScreen() {
      const slot = this.targetSlot;
      const targetProf = ProfileManager.profiles[slot] || {
        name: formatSlotName(slot),
        device: 'Unknown',
        icon: 'default'
      };

      const connectedDevice = this.getConnectedDevice();
      const finalDevice = (connectedDevice && connectedDevice !== 'Unknown')
        ? connectedDevice
        : (targetProf.device && targetProf.device !== 'Unknown' ? targetProf.device : 'iPhone');

      // 1. Icon Selection: preserve or default to target profile's icon
      if (!this.selectedIcon) {
        this.selectedIcon = targetProf.icon || 'default';
      }
      this._updateIconCards(this.selectedIcon);

      // 2. Trigger Info
      const triggerIcon = document.getElementById('cal-save-trigger-icon');
      const triggerTitle = document.getElementById('cal-save-trigger-title');
      const triggerDevice = document.getElementById('cal-save-trigger-device');
      const triggerBadge = document.getElementById('cal-save-trigger-badge');
      const deviceText = document.getElementById('cal-save-device-text');

      if (triggerIcon) {
        triggerIcon.innerHTML = getProfileIconSVG(targetProf.icon || this.selectedIcon || 'default', 22);
      }
      const slotIsEmpty = !targetProf.name;
      if (triggerTitle) {
        // An empty slot must never read like an existing profile's name (§3: no
        // magic) — it's a slot number plus a clear "new" marker, not a name yet.
        triggerTitle.textContent = slotIsEmpty
          ? `${formatSlotName(slot)} — ${I18n.t('calibration.new_profile_marker') || 'новый профиль'}`
          : targetProf.name;
      }
      const devLabelKey = slotIsEmpty ? 'calibration.device_label_preview' : 'calibration.device_label';
      const devLabelFallback = slotIsEmpty ? 'Устройство при сохранении: {device}' : 'Устройство: {device}';
      const devLabel = (I18n.t(devLabelKey) || devLabelFallback).replace('{device}', finalDevice);
      if (triggerDevice) {
        triggerDevice.textContent = devLabel;
      }
      if (triggerBadge) {
        triggerBadge.textContent = formatSlotName(slot);
      }
      if (deviceText) {
        deviceText.textContent = devLabel;
      }

      // 3. Name Input
      const nameInput = document.getElementById('cal-name-input');
      if (nameInput) {
        const defaultName = (targetProf && targetProf.name && !targetProf.name.startsWith('Слот') && !targetProf.name.startsWith('Slot'))
          ? targetProf.name
          : `${finalDevice} ${slot + 1}`;
        nameInput.value = defaultName;
        setTimeout(() => nameInput.select(), 50);
      }

      // 4. Overwrite Warning Block (Always visible inline warning notice)
      const warnEl = document.getElementById('cal-save-warning');
      const warnText = document.getElementById('cal-save-warning-text');
      if (warnEl) warnEl.style.display = 'flex';
      if (warnText) {
        warnText.textContent = I18n.t('calibration.save_overwrite_note') || 'Внимание: если выбранный слот уже содержит профиль, он будет перезаписан.';
      }

      // 5. Populate Save Dropdown Menu
      const menu = document.getElementById('cal-save-dropdown-menu');
      if (menu) {
        menu.innerHTML = '';
        for (let i = 0; i < 6; i++) {
          const p = ProfileManager.profiles[i] || { name: formatSlotName(i), device: 'Unknown', icon: 'default' };
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'profile-dropdown-item' + (i === slot ? ' active' : '') + (p.outdated ? ' profile-outdated' : '');
          item.setAttribute('data-slot', String(i));

          const pDev = p.device || I18n.t('calibration.device_unknown') || 'Неизвестно';
          const pDevText = (I18n.t('calibration.device_label') || 'Устройство: {device}').replace('{device}', pDev);
          const pOutdatedBadge = p.outdated
            ? `<span class="profile-outdated-badge">${I18n.t('calibration.outdated_badge') || 'Устарел'}</span>`
            : '';

          item.innerHTML = `
            <div class="profile-item-left">
              <div class="profile-item-icon">
                ${getProfileIconSVG(p.icon || 'default', 20)}
              </div>
              <div class="profile-item-meta">
                <span class="profile-item-title">${p.name || formatSlotName(i)}${pOutdatedBadge}</span>
                <span class="profile-item-sub">${formatSlotName(i)} • ${pDevText}</span>
              </div>
            </div>
            ${i === slot ? '<span class="profile-item-check">✓</span>' : ''}
          `;

          item.addEventListener('click', (e) => {
            e.stopPropagation();
            this.targetSlot = i;
            this.selectedIcon = p.icon || 'default';
            this.closeSaveDropdown();
            this._renderSaveScreen();
          });

          menu.appendChild(item);
        }
      }
    },

    _updateIconCards(iconType) {
      this.selectedIcon = iconType;
      const cards = document.querySelectorAll('.cal-icon-card');
      cards.forEach(card => {
        if (card.getAttribute('data-icon') === iconType) {
          card.classList.add('selected');
        } else {
          card.classList.remove('selected');
        }
      });
      const triggerIcon = document.getElementById('cal-save-trigger-icon');
      if (triggerIcon) {
        triggerIcon.innerHTML = getProfileIconSVG(iconType, 22);
      }
    },

    toggleSaveDropdown() {
      if (this.isSaveDropdownOpen) {
        this.closeSaveDropdown();
      } else {
        this.openSaveDropdown();
      }
    },

    openSaveDropdown() {
      this.isSaveDropdownOpen = true;
      const trigger = document.getElementById('cal-save-dropdown-trigger');
      const menu = document.getElementById('cal-save-dropdown-menu');
      const wrap = document.getElementById('cal-save-dropdown-wrap');
      if (trigger) trigger.classList.add('open');
      if (wrap) wrap.classList.add('open');
      if (menu) {
        menu.classList.add('show');
        setTimeout(() => {
          menu.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
      }
    },

    closeSaveDropdown() {
      this.isSaveDropdownOpen = false;
      const trigger = document.getElementById('cal-save-dropdown-trigger');
      const menu = document.getElementById('cal-save-dropdown-menu');
      const wrap = document.getElementById('cal-save-dropdown-wrap');
      if (trigger) trigger.classList.remove('open');
      if (wrap) wrap.classList.remove('open');
      if (menu) menu.classList.remove('show');
    },

    retryCurrentStep() {
      // 1. Clear recorded vector for current step
      this.capturedVectors[this.captureStep] = null;

      // 2. Clear locked axis corresponding to this step
      if (this.captureStep === 0) {
        // Rest: no axis locked
      } else if (this.captureStep === 1) {
        // Pitch: remove pitch locked axis
        for (const k in this.lockedAxes) {
          if (this.lockedAxes[k].role === 'pitch') {
            delete this.lockedAxes[k];
          }
        }
      } else if (this.captureStep === 2) {
        // Roll: remove roll and computed yaw
        for (const k in this.lockedAxes) {
          if (this.lockedAxes[k].role === 'roll' || this.lockedAxes[k].role === 'yaw') {
            delete this.lockedAxes[k];
          }
        }
        this.builtMatrix = null;
      } else if (this.captureStep === 3) {
        // Axis alignment: forget the wrong guess and start a fresh determination
        this.axisAlignKnown = false;
        this._stopAxisAlignPoll();
        if (window.go?.main?.App) {
          window.go.main.App.StartAxisAlign(true).catch(() => {});
        }
      }

      // 3. Reset step pill: active, remove completed
      const pill = document.getElementById(`step-pill-${this.captureStep}`);
      if (pill) {
        pill.classList.remove('completed');
        pill.classList.add('active');
      }

      // 4. Disable forward button in footer
      const btnForward = document.getElementById('cal-capture-forward');
      if (btnForward) {
        btnForward.disabled = true;
      }

      // 5. Reset capture controls and update telemetry
      this._resetCaptureUI();
      this.updateTelemetry(AppState.lastState);
    },

    // Поправка на наклон установки датчика (только USB): бэкенд считает её в
    // PreviewMatrix по покою + жесту «вперёд»; здесь только показать и дать выключить.
    async _renderMountCard() {
      const card = document.getElementById('cal-mount-card');
      if (!card) return;
      let m = null;
      try { m = await window.go?.main?.App?.GetWizardMount(); } catch (e) {}
      if (!m) {
        card.style.display = 'none';
        return;
      }
      const signed = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
      const text = I18n.t('calibration.mount_' + m.status)
        .replace('{tilt}', m.tiltDeg.toFixed(1))
        .replace('{fwd}', signed(m.forwardDeg))
        .replace('{right}', signed(m.rightDeg))
        .replace('{check}', m.checkDeg.toFixed(1));
      document.getElementById('cal-mount-text').textContent = text;
      const row = document.getElementById('cal-mount-toggle-row');
      if (row) row.style.display = (m.status === 'ok') ? '' : 'none';
      const toggle = document.getElementById('cal-mount-toggle');
      if (toggle) toggle.checked = !!m.enabled;
      card.style.display = '';
    },

    async save() {
      const slot = this.targetSlot;
      const name = document.getElementById('cal-name-input')?.value.trim()
        || formatSlotName(slot);
      const mat = this.builtMatrix;
      if (!mat || slot < 0) return;

      const device = this.getConnectedDevice();
      const icon = this.selectedIcon || 'default';

      if (window.go?.main?.App) {
        const result = await window.go.main.App.SaveProfile(slot, name, device, icon, mat);
        if (result === 'ok') {
          await window.go.main.App.SetActiveProfile(slot);
          this.close();
          const savedMsg = (I18n.t('calibration.profile_saved') || 'Профиль «{name}» успешно сохранён').replace('{name}', name);
          showToast(savedMsg);
        } else {
          showToast(result);
        }
      }
    },

    init() {
      if (this.initialized) return;
      this.initialized = true;

      // Close button
      document.getElementById('cal-close-btn')?.addEventListener('click', () => this.close());
      document.getElementById('btn-cancel-cal-disconnect')?.addEventListener('click', () => this.close());

      // Start Capture button
      document.getElementById('btn-start-capture')?.addEventListener('click', () => {
        if (this.STEPS_CONFIG[this.captureStep]?.isAxisAlign) {
          this.startAxisAlignSequence();
        } else {
          this.startCaptureSequence();
        }
      });

      // Mount tilt correction toggle (confirm screen)
      document.getElementById('cal-mount-toggle')?.addEventListener('change', (e) => {
        window.go?.main?.App?.SetWizardMountEnabled(e.target.checked).catch(() => {});
      });

      // Retry step
      document.getElementById('btn-retry-step')?.addEventListener('click', () => {
        this.retryCurrentStep();
      });

      // Next step
      document.getElementById('btn-next-step')?.addEventListener('click', () => {
        this.nextStep();
      });

      // Capture back: returns to previous step or closes wizard if at step 0
      document.getElementById('cal-capture-back')?.addEventListener('click', () => {
        if (this.isTransitioning) return;
        this._resetCaptureTimer();
        this._stopAxisAlignPoll();
        if (this.captureStep > 0) {
          this.captureStep--;
          this._updateStepUI();
        } else {
          this.close();
        }
      });

      // Capture forward: navigates to next step or confirm screen
      document.getElementById('cal-capture-forward')?.addEventListener('click', () => {
        if (this.isTransitioning) return;
        if (this.captureStep === 2 && !this.builtMatrix && this.capturedVectors[1] && this.capturedVectors[2]) {
          if (window.go?.main?.App) {
            window.go.main.App.ValidateCalibration(this.capturedVectors[1], this.capturedVectors[2]).then(valRes => {
              if (valRes.success) this.builtMatrix = valRes.matrix;
              this.nextStep();
            });
            return;
          }
        }
        if (this.captureStep < 3) {
          this.nextStep();
        } else {
          this.showScreen('confirm');
        }
      });

      // Step pills click navigation
      for (let i = 0; i < 5; i++) {
        const pill = document.getElementById(`step-pill-${i}`);
        if (!pill) continue;
        pill.addEventListener('click', () => {
          if (i === 0) {
            this.captureStep = 0;
            this.showScreen('capture');
          } else if (i === 1) {
            if (this.capturedVectors[0]) {
              this.captureStep = 1;
              this.showScreen('capture');
            }
          } else if (i === 2) {
            if (this.capturedVectors[1]) {
              this.captureStep = 2;
              this.showScreen('capture');
            }
          } else if (i === 3) {
            if (this.builtMatrix || (this.capturedVectors[1] && this.capturedVectors[2])) {
              this.captureStep = 3;
              this.showScreen('capture');
            }
          } else if (i === 4) {
            if (this.builtMatrix || (this.capturedVectors[1] && this.capturedVectors[2])) {
              this.showScreen('confirm');
            }
          }
        });
      }

      // Jump to manual setup
      document.getElementById('cal-jump-manual')?.addEventListener('click', () => {
        this.showScreen('manual');
      });

      // Confirm yes -> save
      document.getElementById('btn-confirm-yes')?.addEventListener('click', () => {
        this.showScreen('save');
      });

      // Confirm no -> manual
      document.getElementById('btn-confirm-no')?.addEventListener('click', () => {
        this.showScreen('manual');
      });

      // Confirm restart
      document.getElementById('btn-confirm-restart')?.addEventListener('click', () => {
        this.startCaptureFlow(this.targetSlot);
      });

      // Confirm back: returns to step 2 (Roll) in capture screen
      document.getElementById('cal-confirm-back')?.addEventListener('click', () => {
        this.captureStep = 2;
        this.showScreen('capture');
      });

      // Recenter 3D orientation (Button, Canvas click, or Space key)
      const doRecenterConfirm = () => {
        if (window.go?.main?.App?.ResetAHRS) {
          window.go.main.App.ResetAHRS().catch(() => {});
        }
        const scConfirm = Scene3D.get('cal-3d-canvas-confirm');
        if (scConfirm && scConfirm.resetQuat) scConfirm.resetQuat();
        const scManual = Scene3D.get('cal-3d-canvas-manual');
        if (scManual && scManual.resetQuat) scManual.resetQuat();
      };

      document.getElementById('btn-confirm-recenter')?.addEventListener('click', doRecenterConfirm);
      document.getElementById('btn-manual-recenter')?.addEventListener('click', doRecenterConfirm);

      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && CalibrationWizard.isOpen &&
            (CalibrationWizard.currentScreen === 'confirm' || CalibrationWizard.currentScreen === 'manual')) {
          const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
          if (activeTag !== 'input' && activeTag !== 'textarea') {
            e.preventDefault();
            doRecenterConfirm();
          }
        }
      });

      // Copy Calibration Full Report helper
      const copyCalReportHandler = async (btn) => {
        try {
          let report = '';
          if (window.go?.main?.App?.CopyCalibrationReport) {
            report = await window.go.main.App.CopyCalibrationReport();
          } else if (window['go']?.['main']?.['App']?.['CopyCalibrationReport']) {
            report = await window['go']['main']['App']['CopyCalibrationReport']();
          }
          if (!report) report = 'No calibration report data available';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(report);
          } else {
            const ta = document.createElement('textarea');
            ta.value = report;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          if (btn) {
            const orig = btn.textContent;
            btn.textContent = I18n.t('calibration.report_copied') || 'Отчет скопирован!';
            setTimeout(() => { btn.textContent = orig; }, 1800);
          }
          showToast(I18n.t('calibration.report_copied_toast') || 'Полный отчет теста скопирован в буфер обмена!');
        } catch (err) {
          console.error('Copy report failed:', err);
          showToast((I18n.t('calibration.report_copy_err') || 'Ошибка копирования: ') + err);
        }
      };


      // Manual controls changes
      ['man-pitch-axis','man-roll-axis','man-yaw-axis','man-pitch-inv','man-roll-inv','man-yaw-inv'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => this._buildManualMatrix());
      });
      document.getElementById('cal-manual-back')?.addEventListener('click', () => {
        this.showScreen('confirm');
      });
      document.getElementById('cal-manual-next')?.addEventListener('click', () => {
        if (this.builtMatrix) this.showScreen('save');
      });

      // Save form
      document.getElementById('cal-save-back')?.addEventListener('click', () => {
        this.showScreen('confirm');
      });
      document.getElementById('btn-do-save')?.addEventListener('click', () => {
        this.save();
      });

      // Save slot dropdown toggle
      document.getElementById('cal-save-dropdown-trigger')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSaveDropdown();
      });

      // Close save dropdown on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#cal-save-dropdown-wrap')) {
          this.closeSaveDropdown();
        }
      });

      // Icon selector cards
      document.querySelectorAll('.cal-icon-card').forEach(card => {
        card.addEventListener('click', () => {
          const icon = card.getAttribute('data-icon') || 'default';
          this._updateIconCards(icon);
        });
      });

      // Spacebar to trigger capture when in capture screen
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && this.currentScreen === 'capture' && !this.isCapturing) {
          const activeEl = document.activeElement;
          if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
          e.preventDefault();
          this.startCaptureSequence();
        }
      });
    }
  };

  // ── App State & UI Manager ──────────────────────────────────────────────────
  // ── First connection: centre before playing ────────────────────────────────
  // The first time a device (phone, USB controller) streams in this app session,
  // the centering sheet opens in forced mode: pick the profile and centre, no
  // other way out. Once per input mode per launch — a Wi-Fi blip or a replugged
  // cable does not ask again. Any centering (button, hotkey) counts.
  const FirstCenterGate = {
    done: {},

    mode() {
      return (AppState.lastState && AppState.lastState.inputMode) || AppState.inputMode || 'phone';
    },

    markDone() {
      this.done[this.mode()] = true;
    },

    onState(state) {
      const mode = state.inputMode || 'phone';
      const online = state.status && state.status !== 'offline';
      if (!online) {
        if (RecenterManager.forced) RecenterManager.close(true); // device gone: ask again when it returns
        return;
      }
      if (RecenterManager.forced) {
        RecenterManager.renderPicker(); // profiles may change while it is open
        return;
      }
      if (this.done[mode] || RecenterManager.isOpen) return;
      if (!(state.hz > 0)) return; // wait for real sensor data (e.g. iOS permission)
      if (CalibrationWizard?.isOpen || SetupWizard?.isOpen || HelpManager?.isOpen ||
          SettingsManager?.isOpen || WelcomeManager?.isOpen) return;
      RecenterManager.open({ forced: true });
    }
  };

  const AppState = {
    initialized: false,
    _lastStatus: '',
    _lastIsOffline: null,
    _lastQrCode: '',
    _lastBadgeKey: '',
    _lastPauseState: null,
    lastState: null,
    currentUrl: '',
    _calCaptureCb: null,
    _alertTriggeredForDevice: null,
    _alertTimeout: null,
    _alertActive: false,
    _stillnessStart: 0,
    _lastStillP: 0,
    _lastStillR: 0,
    _recalHintShown: false,
    _recalHintDismissedTs: 0,
    _reconnectCooldownTs: 0,
    _recalHintTimer: null,
    targetPitch: 0,
    targetRoll: 0,
    targetYaw: 0,
    currentPitch: 0,
    currentRoll: 0,
    currentYaw: 0,
    _inclinometerLoopRunning: false,

    startInclinometerLoop() {
      if (this._inclinometerLoopRunning) return;
      this._inclinometerLoopRunning = true;

      const bubble = document.getElementById('gyro-bubble');
      const yawGroup = document.getElementById('gyro-yaw-group');
      const hudStatus = document.getElementById('hud-level-status');
      const maxR = 40.0;

      const step = () => {
        // Pause SVG DOM updates when Settings is open or when device is offline (inclinometer hidden)
        if ((typeof SettingsManager !== 'undefined' && SettingsManager.isOpen) || (this.lastState && this.lastState.status === 'offline')) {
          requestAnimationFrame(step);
          return;
        }

        // Exponential lerp smoothing for 60/120/144Hz buttery smooth fluid movement
        const factor = 0.22;
        this.currentPitch += (this.targetPitch - this.currentPitch) * factor;
        this.currentRoll += (this.targetRoll - this.currentRoll) * factor;

        // Wrap-around shortest angle distance for yaw needle
        let diffYaw = (this.targetYaw - this.currentYaw) % 360;
        if (diffYaw > 180) diffYaw -= 360;
        if (diffYaw < -180) diffYaw += 360;
        this.currentYaw += diffYaw * factor;

        if (bubble && yawGroup) {
          // Pitch: tilt forward (p > 0) -> bubble forward (up, -Y in SVG); tilt backward (p < 0) -> bubble backward (down, +Y)
          const offsetY = Math.max(-maxR, Math.min(maxR, -this.currentPitch * 0.9));
          // Roll: tilt right (r > 0) -> bubble right (+X in SVG); tilt left (r < 0) -> bubble left (-X)
          const offsetX = Math.max(-maxR, Math.min(maxR, this.currentRoll * 0.9));

          bubble.setAttribute('cx', (60 + offsetX).toFixed(2));
          bubble.setAttribute('cy', (60 + offsetY).toFixed(2));

          // Snap to glowing green level state if within 3.0 degrees
          const isLevel = Math.abs(this.currentPitch) <= 3.0 && Math.abs(this.currentRoll) <= 3.0;
          bubble.classList.toggle('level', isLevel);
          if (hudStatus) {
            hudStatus.classList.toggle('level', isLevel);
          }

          // Rotate compass pointer around center (60, 60) with Yaw
          yawGroup.setAttribute('transform', `rotate(${this.currentYaw.toFixed(2)} 60 60)`);
        }

        requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    },

    findEmptyOrActiveSlot() {
      const profiles = (this.lastState && this.lastState.profiles) || ProfileManager.profiles || [];
      for (let i = 0; i < 6; i++) {
        const p = profiles[i];
        if (!p || !p.name || p.name.startsWith('Слот') || p.name.startsWith('Slot')) {
          return i;
        }
      }
      return (this.lastState && this.lastState.activeSlot >= 0) ? this.lastState.activeSlot : 0;
    },

    checkFirstTimeDeviceAlert(state) {
      const dev = (state.deviceName || '').trim();
      if (!dev || dev === 'Controller' || dev === 'Unknown') {
        return;
      }

      if (this._alertTriggeredForDevice === dev) {
        return;
      }
      this._alertTriggeredForDevice = dev;

      // Check if ANY profile is calibrated for this device
      const profiles = state.profiles || ProfileManager.profiles || [];
      const hasProfile = profiles.some(p => {
        if (!p || !p.name) return false;
        const pDev = (p.device || '').trim().toLowerCase();
        return pDev === dev.toLowerCase() && pDev !== 'unknown';
      });

      if (!hasProfile) {
        this.triggerFirstTimeDeviceAlert(dev);
      }
    },

    triggerFirstTimeDeviceAlert(device) {
      this.clearFirstTimeDeviceAlert(false);
      this._alertActive = true;

      const card = document.querySelector('.apple-card');
      const banner = document.getElementById('first-connect-banner');
      const calBtn = document.getElementById('btn-open-calibration');
      const progressBar = document.getElementById('first-connect-progress-bar');

      if (card) card.classList.add('first-device-alert-active');
      if (calBtn) calBtn.classList.add('highlight-pulse');

      if (banner) {
        banner.classList.remove('fade-out');
        // Force reflow so smooth CSS transition begins from initial state
        void banner.offsetHeight;
        banner.classList.add('show');
        if (progressBar) {
          progressBar.style.transition = 'none';
          progressBar.style.width = '100%';
          void progressBar.offsetWidth;
          // Increased lifetime 2x: 20 seconds
          progressBar.style.transition = 'width 20s linear';
          progressBar.style.width = '0%';
        }
      }

      this._alertTimeout = setTimeout(() => {
        this.dismissFirstTimeDeviceAlert();
      }, 20000); // 20 seconds lifetime (2x previous 10s)
    },

    dismissFirstTimeDeviceAlert() {
      if (!this._alertActive) return;
      this._alertActive = false;
      if (this._alertTimeout) {
        clearTimeout(this._alertTimeout);
        this._alertTimeout = null;
      }

      const card = document.querySelector('.apple-card');
      const banner = document.getElementById('first-connect-banner');
      const calBtn = document.getElementById('btn-open-calibration');

      if (card) card.classList.remove('first-device-alert-active');
      if (calBtn) calBtn.classList.remove('highlight-pulse');
      if (banner) {
        banner.classList.remove('show');
        banner.classList.add('fade-out');
        setTimeout(() => {
          if (!this._alertActive) {
            banner.classList.remove('fade-out');
          }
        }, 700);
      }
    },

    clearFirstTimeDeviceAlert(resetTriggered = true) {
      if (resetTriggered) this._alertTriggeredForDevice = null;
      this.dismissFirstTimeDeviceAlert();
    },

    checkStillnessRecalHint(p, r, state) {
      if (!state || state.status === 'offline' || state.isPaused) {
        this.hideRecalHint(true);
        return;
      }
      if (CalibrationWizard?.isOpen || SetupWizard?.isOpen || HelpManager?.isOpen || SettingsManager?.isOpen || WelcomeManager?.isOpen) {
        this.hideRecalHint(true);
        return;
      }

      // Check if cooldown is active (45 seconds after user dismiss or timeout)
      const now = Date.now();
      if (this._recalHintDismissedTs && (now - this._recalHintDismissedTs < 45000)) {
        return;
      }
      // Check if settling cooldown is active after reconnect or waking from sleep (3.5 seconds)
      if (this._reconnectCooldownTs && (now - this._reconnectCooldownTs < 3500)) {
        return;
      }

      // Calculate angular delta from last frame
      const deltaP = Math.abs(p - this._lastStillP);
      const deltaR = Math.abs(r - this._lastStillR);
      this._lastStillP = p;
      this._lastStillR = r;

      // Stillness threshold: phone resting on desk produces tiny sensor noise (< 0.12 deg)
      const isMotionless = deltaP < 0.12 && deltaR < 0.12;

      if (isMotionless) {
        if (!this._stillnessStart) {
          this._stillnessStart = now;
        } else if (now - this._stillnessStart >= 2200) {
          // Resting motionless for > 2.2s. Check if tilted significantly (> 10 deg)
          const isOffCenter = Math.abs(p) > 10.0 || Math.abs(r) > 10.0;
          if (isOffCenter && !this._recalHintShown) {
            this.showRecalHint();
          }
        }
      } else {
        // Device is being moved
        this._stillnessStart = 0;
        if (this._recalHintShown) {
          this.hideRecalHint(false);
        }
      }
    },

    showRecalHint() {
      if (this._recalHintShown) return;
      if (SettingsManager.currentSettings && SettingsManager.currentSettings.stillnessHint === false) return;
      this._recalHintShown = true;
      const el = document.getElementById('level-recal-hint');
      const calBtn = document.getElementById('btn-open-calibration');
      if (el) {
        el.style.display = 'block';
        void el.offsetHeight;
        el.classList.add('visible');
      }
      if (calBtn) {
        calBtn.classList.add('highlight-pulse');
      }
      if (this._recalHintTimer) clearTimeout(this._recalHintTimer);
      this._recalHintTimer = setTimeout(() => {
        this.hideRecalHint(false);
      }, 10000);
    },

    hideRecalHint(immediate = false) {
      if (!this._recalHintShown && !immediate) return;
      this._recalHintShown = false;
      this._recalHintDismissedTs = Date.now();
      if (this._recalHintTimer) {
        clearTimeout(this._recalHintTimer);
        this._recalHintTimer = null;
      }
      const el = document.getElementById('level-recal-hint');
      const calBtn = document.getElementById('btn-open-calibration');
      if (calBtn && !this._alertActive) {
        calBtn.classList.remove('highlight-pulse');
      }
      if (el) {
        el.classList.remove('visible');
        if (immediate) {
          el.style.display = 'none';
        } else {
          setTimeout(() => {
            if (!this._recalHintShown) {
              el.style.display = 'none';
            }
          }, 350);
        }
      }
    },

    _lastDsuCount: null,
    _lastDsuClientsJson: '',

    updateDSU(count, clients) {
      count = typeof count === 'number' ? count : (Array.isArray(clients) ? clients.length : 0);
      clients = Array.isArray(clients) ? clients : [];
      const clientsJson = JSON.stringify(clients);

      if (this._lastDsuCount === count && this._lastDsuClientsJson === clientsJson) {
        return;
      }
      const prevDsuCount = this._lastDsuCount;
      this._lastDsuCount = count;
      this._lastDsuClientsJson = clientsJson;

      if (prevDsuCount !== null && count > prevDsuCount) {
        if (typeof SoundManager !== 'undefined' && SoundManager.play) {
          SoundManager.play('dsu');
        }
      }

      const isOnline = count > 0;
      const clientWord = isOnline 
        ? (count === 1 ? (I18n.t('status.dsu_connected') || 'Эмулятор подключен') : (I18n.t('status.dsu_connected_plural') || 'Подключено эмуляторов: %d').replace('%d', count))
        : (I18n.t('status.dsu_waiting') || 'Ожидание эмуляторов');

      const updateBanner = (prefix) => {
        const banner = document.getElementById(`${prefix}-dsu-banner`);
        const dot = document.getElementById(`${prefix}-dsu-dot`);
        const chip = document.getElementById(`${prefix}-dsu-chip`);
        const idleRow = document.getElementById(`${prefix}-dsu-idle-row`);
        const clientsList = document.getElementById(`${prefix}-dsu-clients-list`);

        if (!banner || !chip) return;

        banner.className = `dsu-home-banner ${isOnline ? 'active' : 'warning'}`;
        chip.className = `dsu-home-chip ${isOnline ? 'green' : 'amber'}`;
        chip.textContent = clientWord;

        if (dot) {
          dot.style.backgroundColor = isOnline ? '#34C759' : '#FF9F0A';
          dot.className = `status-dot ${isOnline ? 'online' : ''}`;
        }

        if (isOnline) {
          if (idleRow) idleRow.style.display = 'none';
          if (clientsList) {
            clientsList.style.display = 'flex';
            clientsList.innerHTML = clients.map(c => {
              const addr = c.address || (c.ip + ':' + c.port);
              const isAct = c.active !== false;
              return `<div class="dsu-home-client-tag">
                <div class="dsu-home-client-left">
                  <span class="dsu-client-pulse ${isAct ? 'green' : 'amber'}"></span>
                  <span class="dsu-client-addr">${addr}</span>
                </div>
                <span class="dsu-client-status-badge ${isAct ? 'green' : 'amber'}">${isAct ? 'ACTIVE' : 'IDLE'}</span>
              </div>`;
            }).join('');
          }
        } else {
          if (idleRow) idleRow.style.display = 'flex';
          if (clientsList) {
            clientsList.style.display = 'none';
            clientsList.innerHTML = '';
          }
        }
      };

      updateBanner('offline');
      updateBanner('online');
      updateBanner('usb');
    },

    _lastUsbConnected: null,
    _lastUsbPort: null,

    updateUsbStatus(connected, port) {
      connected = !!connected;
      port = port || '';
      if (this._lastUsbConnected === connected && this._lastUsbPort === port) {
        return;
      }
      this._lastUsbConnected = connected;
      this._lastUsbPort = port;

      const pill = document.getElementById('usb-status-pill');
      const text = document.getElementById('usb-status-pill-text');
      if (!pill || !text) return;

      pill.classList.toggle('waiting', !connected);
      pill.classList.toggle('connected', connected);
      text.textContent = connected
        ? (I18n.t('usb_mode.status_connected') || 'IMU-устройство подключено ({port})').replace('{port}', port)
        : (I18n.t('usb_mode.status_scanning') || 'Поиск USB IMU-устройства...');
    },

    inputMode: 'phone',

    setInputMode(mode, fromBackend = false) {
      if (mode !== 'usb') mode = 'phone';
      const prevMode = this.inputMode;
      this.inputMode = mode;

      const btnPhone = document.getElementById('btn-mode-phone');
      const btnUsb = document.getElementById('btn-mode-usb');
      if (btnPhone) {
        btnPhone.classList.toggle('active', mode === 'phone');
        btnPhone.setAttribute('aria-selected', mode === 'phone' ? 'true' : 'false');
      }
      if (btnUsb) {
        btnUsb.classList.toggle('active', mode === 'usb');
        btnUsb.setAttribute('aria-selected', mode === 'usb' ? 'true' : 'false');
      }

      this.updateModeGlider();

      this._lastStatus = null;
      this._lastIsOffline = null;

      if (!fromBackend && window.go?.main?.App?.SetInputMode) {
        window.go.main.App.SetInputMode(mode).catch(console.error);
      }

      const card = document.querySelector('.apple-card');
      const isSwitching = prevMode && prevMode !== mode;

      if (isSwitching && card) {
        // Measure start height to smoothly morph card size without jarring jumps
        const startHeight = card.offsetHeight;
        card.style.height = `${startHeight}px`;
        card.classList.add('morphing');

        if (this.lastState) {
          this.render(this.lastState);
        }

        const targetHeight = card.scrollHeight;
        if (startHeight !== targetHeight) {
          void card.offsetHeight; // force reflow
          card.style.transition = 'height 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
          card.style.height = `${targetHeight}px`;

          let cleaned = false;
          const cleanHeight = () => {
            if (cleaned) return;
            cleaned = true;
            card.removeEventListener('transitionend', onEnd);
            card.style.height = '';
            card.style.transition = '';
            card.classList.remove('morphing');
          };
          const onEnd = (e) => {
            if (e.target === card && e.propertyName === 'height') {
              cleanHeight();
            }
          };
          card.addEventListener('transitionend', onEnd);
          setTimeout(cleanHeight, 350);
        } else {
          card.style.height = '';
          card.classList.remove('morphing');
        }
      } else {
        if (this.lastState) {
          this.render(this.lastState);
        }
      }
    },

    // morphToView animates the card's height across a view swap instead of an
    // abrupt display:none/flex snap -- same recipe setInputMode already uses
    // for the phone/USB tab switch, reused here for the offline<->online (and
    // USB waiting<->connected) transition so connecting always feels smooth.
    morphToView(applyFn) {
      const card = document.querySelector('.apple-card');
      if (!card) {
        applyFn();
        return;
      }
      const startHeight = card.offsetHeight;
      card.style.height = `${startHeight}px`;
      card.classList.add('morphing');
      applyFn();
      const targetHeight = card.scrollHeight;
      if (startHeight === targetHeight) {
        card.style.height = '';
        card.classList.remove('morphing');
        return;
      }
      void card.offsetHeight; // force reflow
      card.style.transition = 'height 0.32s cubic-bezier(0.16, 1, 0.3, 1)';
      card.style.height = `${targetHeight}px`;
      let cleaned = false;
      const cleanHeight = () => {
        if (cleaned) return;
        cleaned = true;
        card.removeEventListener('transitionend', onEnd);
        card.style.height = '';
        card.style.transition = '';
        card.classList.remove('morphing');
      };
      const onEnd = (e) => {
        if (e.target === card && e.propertyName === 'height') cleanHeight();
      };
      card.addEventListener('transitionend', onEnd);
      setTimeout(cleanHeight, 350);
    },

    updateModeGlider() {
      const pill = document.getElementById('card-mode-pill') || document.querySelector('.main-mode-pill');
      if (pill) {
        pill.setAttribute('data-mode', this.inputMode);
      }
    },

    render(state) {
      this.lastState = state;
      if (!state) return;

      if (state.inputMode && state.inputMode !== this.inputMode) {
        this.setInputMode(state.inputMode, true);
      }

      if (typeof state.dsuClients !== 'undefined' || typeof state.dsuClientList !== 'undefined') {
        this.updateDSU(state.dsuClients, state.dsuClientList);
      }

      if (typeof state.usbConnected !== 'undefined') {
        this.updateUsbStatus(state.usbConnected, state.usbPort);
      }

      if (window._liveDebugWin && !window._liveDebugWin.closed && window._liveDebugWin.updateFromState) {
        try {
          window._liveDebugWin.updateFromState(state);
        } catch (e) {}
      }

      const viewOffline = document.getElementById('view-offline');
      const viewOnline = document.getElementById('view-online');
      const viewUsb = document.getElementById('view-usb-mode');
      const cardModeHeader = document.getElementById('card-mode-header');
      const badgeStatus = document.getElementById('badge-status');
      const statusText = document.getElementById('status-text');
      const btnPause = document.getElementById('btn-pause-resume');
      const linkLiveDebug = document.getElementById('link-live-debug');

      // Populate QR codes and URLs for Android and iOS Setup screens
      const imgQrAndroid = document.getElementById('img-qr-android');
      if (state.qrCode && imgQrAndroid && imgQrAndroid.src !== state.qrCode) {
        imgQrAndroid.src = state.qrCode;
      }
      const linkUrlAndroidText = document.getElementById('link-url-android-text');
      if (linkUrlAndroidText && state.gamepadUrl) {
        linkUrlAndroidText.textContent = state.gamepadUrl;
      }

      const imgQrSetup = document.getElementById('img-qr-setup');
      if (state.setupQrCode && imgQrSetup && imgQrSetup.src !== state.setupQrCode) {
        imgQrSetup.src = state.setupQrCode;
      }
      const linkUrlSetupText = document.getElementById('link-url-setup-text');
      if (linkUrlSetupText && state.setupUrl) {
        linkUrlSetupText.textContent = state.setupUrl;
      }

      const isWizardOpen = !!(SetupWizard?.isOpen || HelpManager?.isOpen || SettingsManager?.isOpen || WelcomeManager?.isOpen || CalibrationWizard?.isOpen);
      if (cardModeHeader) {
        cardModeHeader.style.display = isWizardOpen ? 'none' : 'flex';
      }

      // Mode Branch: Stationary USB Controller Mode, before a device is found.
      // Once state.usbConnected flips true we deliberately fall through to the
      // exact same "connected" rendering phone mode uses below (view-online,
      // the LEVEL HUD, profiles module, DSU banner) instead of a bespoke USB
      // view -- GetState()/GetProfiles()/etc. already resolve to the USB bank
      // on their own, so reusing that view is both correct and free.
      if (this.inputMode === 'usb' && !state.usbConnected) {
        const enteringWaiting = this._lastStatus !== 'waiting_usb';
        if (viewOffline) viewOffline.style.display = 'none';
        if (!isWizardOpen) {
          if (enteringWaiting) {
            this.morphToView(() => {
              if (viewOnline) viewOnline.style.display = 'none';
              if (viewUsb) viewUsb.style.display = 'flex';
            });
            if (viewUsb) {
              viewUsb.classList.remove('view-fade-in');
              void viewUsb.offsetWidth;
              viewUsb.classList.add('view-fade-in');
            }
          } else {
            if (viewOnline) viewOnline.style.display = 'none';
            if (viewUsb) viewUsb.style.display = 'flex';
          }
        }
        if (linkLiveDebug) linkLiveDebug.style.display = 'none';
        this.hideRecalHint(true);

        if (enteringWaiting) {
          this._lastStatus = 'waiting_usb';
          if (badgeStatus) badgeStatus.className = 'status-capsule waiting-usb';
          if (statusText) {
            statusText.setAttribute('data-i18n', 'status.waiting_usb');
            statusText.innerHTML = renderMarkdown(I18n.t('status.waiting_usb'));
          }
        }

        // Author signature visibility
        const authorSig = document.getElementById('author-signature');
        const helpAuthorSig = document.getElementById('help-author-sig');
        const setupAuthorSig = document.getElementById('setup-author-sig');
        if (state.hideAuthor) {
          if (authorSig) authorSig.style.display = 'none';
          if (helpAuthorSig) helpAuthorSig.style.display = 'none';
          if (setupAuthorSig) setupAuthorSig.style.display = 'none';
        } else {
          if (authorSig) authorSig.style.display = '';
          if (helpAuthorSig) helpAuthorSig.style.display = '';
          if (setupAuthorSig) setupAuthorSig.style.display = '';
        }
        return;
      }

      // There's a brief gap between the USB transport connecting
      // (state.usbConnected) and the pipeline processing its first frame
      // (state.status flips to "online"). Keep showing the USB waiting view
      // through that gap instead of ever flashing the phone QR screen below.
      if (this.inputMode === 'usb' && state.status === 'offline') {
        if (viewOnline) viewOnline.style.display = 'none';
        if (viewOffline) viewOffline.style.display = 'none';
        if (viewUsb && !isWizardOpen) viewUsb.style.display = 'flex';
        return;
      }
      if (viewUsb) viewUsb.style.display = 'none';

      // Status capsule: only mutate DOM when status actually changes
      if (this._lastStatus !== state.status) {
        this._lastStatus = state.status;
        badgeStatus.className = `status-capsule ${state.status}`;
        statusText.setAttribute('data-i18n', `status.${state.status}`);
        statusText.innerHTML = renderMarkdown(I18n.t(`status.${state.status}`));
      }

      // If controller just connected while setup was open, auto-close setup to show controller!
      if (state.status !== 'offline' && SetupWizard.isOpen) {
        SetupWizard.close();
      }

      const isOffline = (state.status === 'offline');
      if (this._lastIsOffline !== isOffline) {
        const prevOffline = this._lastIsOffline;
        this._lastIsOffline = isOffline;
        if (prevOffline !== null && typeof SoundManager !== 'undefined') {
          if (!isOffline) {
            SoundManager.play('connect');
          } else {
            SoundManager.play('disconnect');
          }
        }
        if (!isOffline) {
          this._reconnectCooldownTs = Date.now();
          this._stillnessStart = 0;
        }
        const wizardBlocksView = SetupWizard?.isOpen || HelpManager?.isOpen || SettingsManager?.isOpen || WelcomeManager?.isOpen;
        if (isOffline) {
          if (!wizardBlocksView) {
            this.morphToView(() => {
              viewOffline.style.display = 'flex';
              viewOnline.style.display = 'none';
            });
            viewOffline.classList.remove('view-fade-in');
            void viewOffline.offsetWidth;
            viewOffline.classList.add('view-fade-in');
          }
          if (linkLiveDebug) linkLiveDebug.style.display = 'none';
        } else {
          if (!wizardBlocksView) {
            this.morphToView(() => {
              viewOffline.style.display = 'none';
              viewOnline.style.display = 'flex';
            });
            viewOnline.classList.remove('view-fade-in');
            void viewOnline.offsetWidth;
            viewOnline.classList.add('view-fade-in');
          }
          if (linkLiveDebug) linkLiveDebug.style.display = 'inline-flex';
        }
      }

      if (!isOffline && state.deviceName) {
        this.checkFirstTimeDeviceAlert(state);
      } else if (isOffline) {
        this.clearFirstTimeDeviceAlert(true);
      }

      if (CalibrationWizard?.isOpen) {
        if (isOffline) {
          CalibrationWizard.showDisconnectAlert();
        } else if (CalibrationWizard.isDisconnectAlertActive) {
          CalibrationWizard.hideDisconnectAlert();
        }
      }

      if (isOffline) {
        this.hideRecalHint(true);
        this.targetPitch = 0;
        this.targetRoll = 0;
        this.targetYaw = 0;
        const imgQr = document.getElementById('img-qr');
        if (state.qrCode && this._lastQrCode !== state.qrCode) {
          this._lastQrCode = state.qrCode;
          if (imgQr) imgQr.src = state.qrCode;
        }

        if (this.currentUrl !== (state.gamepadUrl || '')) {
          this.currentUrl = state.gamepadUrl || '';
          const linkUrlText = document.getElementById('link-url-text');
          if (linkUrlText) linkUrlText.textContent = this.currentUrl || '...';
        }
      } else {
        // State 2 & 3: Online or Paused
        if (!SetupWizard?.isOpen && !HelpManager?.isOpen && !SettingsManager?.isOpen && !WelcomeManager?.isOpen) {
          viewOffline.style.display = 'none';
          viewOnline.style.display = 'flex';
        }
        if (linkLiveDebug) linkLiveDebug.style.display = 'inline-flex';

        const deviceIconWrap = document.getElementById('device-icon-wrap');
        const deviceStatusBadge = document.getElementById('device-status-badge');
        const isUsbSource = this.inputMode === 'usb';
        deviceIconWrap?.classList.toggle('usb-source', isUsbSource);

        const deviceNameEl = document.getElementById('device-name');
        if (isUsbSource) {
          // Device self-identifies via the protocol's optional TYPE=0x02
          // frame (see PhoneGyro_hardware_protocol docs/PROTOCOL.md); the
          // backend defaults deviceName to the generic "Controller" when a
          // device never sends one, so fall back to a friendlier label here.
          const portLabel = state.usbPort ? ` (${state.usbPort})` : '';
          const knownName = (state.deviceName && state.deviceName !== 'Controller')
            ? state.deviceName
            : (I18n.t('usb_mode.connected_name') || 'USB-контроллер');
          deviceNameEl.textContent = knownName + portLabel;
        } else {
          deviceNameEl.textContent = state.deviceName || 'Controller';
        }
        document.getElementById('device-hz').textContent = `${Math.round(state.hz || 60)} Hz`;

        // Ping/network-quality pills are meaningless over a wired USB link --
        // repurpose them to show the port and a plain "direct connection"
        // label instead of a fabricated latency number.
        const pingTxt = document.getElementById('device-ping-txt');
        const netSpark = document.getElementById('main-net-spark-canvas');
        const networkHealthEl = document.getElementById('network-health');
        if (isUsbSource) {
          if (pingTxt) pingTxt.textContent = state.usbPort || 'USB';
          else {
            const devPing = document.getElementById('device-ping');
            if (devPing) devPing.textContent = state.usbPort || 'USB';
          }
          if (netSpark) netSpark.style.display = 'none';
          if (networkHealthEl) {
            networkHealthEl.removeAttribute('data-i18n');
            networkHealthEl.textContent = I18n.t('usb_mode.direct_connection') || 'Прямое USB-подключение';
          }
        } else {
          // Real round-trip time of the phone link (server PING/PONG, 1/s);
          // -1 until the first answer arrives.
          const pingVal = (typeof state.pingMs === 'number') ? state.pingMs : -1;
          const pingLabel = pingVal >= 0 ? `${pingVal} ms` : '—';
          if (pingTxt) {
            pingTxt.textContent = pingLabel;
          } else {
            const devPing = document.getElementById('device-ping');
            if (devPing) devPing.textContent = pingLabel;
          }
          if (netSpark) netSpark.style.display = '';
          const qualityKey = pingVal < 0 ? 'calibration.network_quality_measuring'
            : pingVal < 40 ? 'calibration.network_quality_optimal'
            : pingVal < 100 ? 'calibration.network_quality_fair'
            : 'calibration.network_quality_poor';
          if (networkHealthEl && networkHealthEl.getAttribute('data-i18n') !== qualityKey) {
            networkHealthEl.setAttribute('data-i18n', qualityKey);
            networkHealthEl.innerHTML = renderMarkdown(I18n.t(qualityKey));
          }
          const benchPing = document.getElementById('bench-net-ping');
          if (benchPing) {
            benchPing.textContent = pingLabel;
          }
          if (typeof NetSparkline !== 'undefined') {
            NetSparkline.push(pingVal);
          }
        }
        document.getElementById('device-time').textContent = state.connectedTime || '00:00:00';

        // Update target Euler angles (P, R, Y) for continuous RAF lerp smoothing loop
        if (state.isPaused) {
          this.targetPitch = 0;
          this.targetRoll = 0;
          this.targetYaw = 0;
        } else {
          this.targetPitch = Number(state.pitch) || 0;
          this.targetRoll = Number(state.roll) || 0;
          this.targetYaw = Number(state.yaw) || 0;
        }

        const p = this.targetPitch;
        const r = this.targetRoll;
        const y = this.targetYaw;

        const isWaiting = (state.hz === 0 && Math.abs(p) < 0.001 && Math.abs(r) < 0.001 && Math.abs(y) < 0.001);
        const badgeKey = state.isPaused ? 'paused' : (isWaiting ? 'waiting' : 'online');

        if (state.isPaused) {
          this.hideRecalHint(true);
        } else {
          this.checkStillnessRecalHint(p, r, state);
        }

        if (this._lastBadgeKey !== badgeKey) {
          this._lastBadgeKey = badgeKey;
          if (deviceIconWrap) deviceIconWrap.className = `device-icon-wrap ${state.isPaused ? 'paused' : 'online'}`;
          if (deviceStatusBadge) {
            if (badgeKey === 'paused') {
              deviceStatusBadge.className = 'device-status-badge paused';
              deviceStatusBadge.setAttribute('data-i18n', 'status.paused');
              deviceStatusBadge.innerHTML = renderMarkdown(I18n.t('status.paused'));
            } else if (badgeKey === 'waiting') {
              deviceStatusBadge.className = 'device-status-badge waiting';
              deviceStatusBadge.setAttribute('data-i18n', 'status.waiting_sensors');
              deviceStatusBadge.innerHTML = renderMarkdown(I18n.t('status.waiting_sensors') || 'ожидание датчиков...');
            } else {
              deviceStatusBadge.className = 'device-status-badge online';
              deviceStatusBadge.setAttribute('data-i18n', 'status.online');
              deviceStatusBadge.innerHTML = renderMarkdown(I18n.t('status.online'));
            }
          }
        }

        if (this._lastPauseState !== state.isPaused) {
          this._lastPauseState = state.isPaused;
          if (state.isPaused) {
            btnPause.setAttribute('data-i18n', 'controls.resume');
            btnPause.innerHTML = renderMarkdown(I18n.t('controls.resume'));
            btnPause.classList.add('paused');
          } else {
            btnPause.setAttribute('data-i18n', 'controls.pause');
            btnPause.innerHTML = renderMarkdown(I18n.t('controls.pause'));
            btnPause.classList.remove('paused');
          }
        }
      }

      // Sync profile slots display
      ProfileManager.sync(state);

      // First connection of this device in this session: centre first.
      FirstCenterGate.onState(state);

      // Feed calibration wizard if actively capturing
      if (this._calCaptureCb) {
        this._calCaptureCb(state);
      }

      // Feed 3-axis telemetry strip in calibration wizard
      if (CalibrationWizard.isOpen && CalibrationWizard.currentScreen === 'capture') {
        CalibrationWizard.updateTelemetry(state);
      }

      // Feed Three.js confirm/manual scenes with live orientation
      const confirmScene = Scene3D.get('cal-3d-canvas-confirm');
      if (confirmScene) confirmScene.updateFromState(state);
      const manualScene = Scene3D.get('cal-3d-canvas-manual');
      if (manualScene) manualScene.updateFromState(state);

      // Author signature visibility
      const authorSig = document.getElementById('author-signature');
      const helpAuthorSig = document.getElementById('help-author-sig');
      const setupAuthorSig = document.getElementById('setup-author-sig');
      if (state.hideAuthor) {
        if (authorSig) authorSig.style.display = 'none';
        if (helpAuthorSig) helpAuthorSig.style.display = 'none';
        if (setupAuthorSig) setupAuthorSig.style.display = 'none';
      } else {
        if (authorSig) authorSig.style.display = '';
        if (helpAuthorSig) helpAuthorSig.style.display = '';
        if (setupAuthorSig) setupAuthorSig.style.display = '';
      }
    },

    async init() {
      if (this.initialized) return;
      this.initialized = true;
      this.startInclinometerLoop();

      // Pause button action with debounce guard
      let pauseBusy = false;
      document.getElementById('btn-pause-resume')?.addEventListener('click', async () => {
        if (pauseBusy) return;
        pauseBusy = true;
        try {
          if (window.go && window.go.main && window.go.main.App) {
            const newState = await window.go.main.App.TogglePause();
            this.render(newState);
          }
        } catch (err) {
          console.error('TogglePause error:', err);
        } finally {
          setTimeout(() => { pauseBusy = false; }, 250);
        }
      });

      // Mode segmented control buttons (Smartphone vs USB Controller)
      document.getElementById('btn-mode-phone')?.addEventListener('click', () => {
        if (this.inputMode !== 'phone') {
          if (typeof SoundManager !== 'undefined' && SoundManager.play) {
            SoundManager.play('click');
          }
          this.setInputMode('phone');
        }
      });
      document.getElementById('btn-mode-usb')?.addEventListener('click', () => {
        if (this.inputMode !== 'usb') {
          if (typeof SoundManager !== 'undefined' && SoundManager.play) {
            SoundManager.play('click');
          }
          this.setInputMode('usb');
        }
      });

      window.addEventListener('resize', () => this.updateModeGlider());
      setTimeout(() => this.updateModeGlider(), 60);

      // Master setup button
      document.getElementById('btn-master-setup')?.addEventListener('click', () => {
        SetupWizard.open();
      });

      // Default offline QR copy chip
      setupCopyChip('chip-url', 'url-copy-badge', () => this.currentUrl);

      // First-connect banner click: open calibration directly to recommended slot
      document.getElementById('first-connect-banner')?.addEventListener('click', (e) => {
        if (e.target.closest('#btn-dismiss-first-connect')) {
          this.dismissFirstTimeDeviceAlert();
          return;
        }
        const targetSlot = this.findEmptyOrActiveSlot();
        CalibrationWizard.openToSlot(targetSlot);
      });

      document.getElementById('btn-dismiss-first-connect')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissFirstTimeDeviceAlert();
      });

      // Recalibration hint banner dismiss
      document.getElementById('btn-recal-hint-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideRecalHint(false);
      });

      // Recalibration hint banner click: opens calibration wizard directly
      document.getElementById('level-recal-hint')?.addEventListener('click', (e) => {
        if (e.target.closest('#btn-recal-hint-close')) return;
        this.hideRecalHint(true);
        const slot = (this.lastState && this.lastState.activeSlot >= 0) ? this.lastState.activeSlot : 0;
        CalibrationWizard.openToSlot(slot);
      });

      // Open separate 3D LiveDebug window from stats header button
      const onOpenStats = (e) => {
        if (e) e.preventDefault();
        if (window.go?.main?.App?.OpenLiveDebugWindow) {
          window.go.main.App.OpenLiveDebugWindow();
        } else {
          window.open('http://127.0.0.1:8080/livedebug', '_blank');
        }
      };
      document.getElementById('btn-header-stats')?.addEventListener('click', onOpenStats);
      document.getElementById('link-live-debug')?.addEventListener('click', onOpenStats);

      // Listen for real-time state changes from Wails backend
      if (window.runtime && window.runtime.EventsOn) {
        window.runtime.EventsOn('state:change', (state) => {
          if (typeof RecenterManager !== 'undefined' && state) {
            RecenterManager.onFrame({ RawX: state.rawRotX, RawY: state.rawRotY, RawZ: state.rawRotZ });
          }
          this.render(state);
        });
        window.runtime.EventsOn('device:connection-lost', () => {
          if (typeof CalibrationWizard !== 'undefined' && CalibrationWizard.isOpen) {
            CalibrationWizard.showDisconnectAlert();
          }
        });
        window.runtime.EventsOn('device:connected', () => {
          AppState._reconnectCooldownTs = Date.now();
          AppState._stillnessStart = 0;
          if (typeof CalibrationWizard !== 'undefined' && CalibrationWizard.isOpen) {
            CalibrationWizard.hideDisconnectAlert();
          }
        });
        window.runtime.EventsOn('device:disconnected', () => {
          if (typeof PlatformGame !== 'undefined' && PlatformGame.onDisconnect) {
            PlatformGame.onDisconnect();
          }
        });
        window.runtime.EventsOn('device:visibility', (visible) => {
          if (visible) {
            AppState._reconnectCooldownTs = Date.now();
            AppState._stillnessStart = 0;
          }
          if (typeof CalibrationWizard !== 'undefined' && CalibrationWizard.isOpen) {
            if (!visible) {
              CalibrationWizard.showDisconnectAlert();
            } else {
              CalibrationWizard.hideDisconnectAlert();
            }
          }
        });
        window.runtime.EventsOn('dsu:status', (payload) => {
          try {
            const data = (typeof payload === 'string') ? JSON.parse(payload) : payload;
            if (data) {
              AppState.updateDSU(data.count, data.clients);
            }
          } catch (e) {}
        });
        window.runtime.EventsOn('input-mode-changed', (mode) => {
          if (mode && mode !== AppState.inputMode) {
            AppState.setInputMode(mode, true);
          }
        });
      }

      // Initial state load
      if (window.go && window.go.main && window.go.main.App) {
        const state = await window.go.main.App.GetState();
        this.render(state);
        if (window.go.main.App.GetInputMode) {
          window.go.main.App.GetInputMode().then((m) => {
            if (m && m !== AppState.inputMode) {
              AppState.setInputMode(m, true);
            }
          }).catch(() => {});
        }
        if (window.go.main.App.GetDSUStatus) {
          window.go.main.App.GetDSUStatus().then((dsu) => {
            if (dsu) {
              AppState.updateDSU(dsu.count, dsu.clients);
            }
          }).catch(() => {});
        }
      }
    }
  };

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
