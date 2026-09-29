'use strict';

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
      cemuDriftGuard: true,
      checkUpdates: false,
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
        if (tt) { tt.classList.remove('show'); setShown(tt, false); }
        const isHidden = (soundDrawer.hidden || !soundDrawer.classList.contains('open'));
        if (isHidden) {
          setShown(soundDrawer, true);
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
              setShown(soundDrawer, false);
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

      // Data folder: where settings, profiles, certificates and logs live.
      const dataDirInput = document.getElementById('setting-data-dir');
      window.go?.app?.App?.GetDataDir?.().then((dir) => {
        if (dataDirInput && dir) {
          dataDirInput.value = dir;
          dataDirInput.title = dir;
        }
      }).catch(() => {});
      document.getElementById('btn-open-data-dir')?.addEventListener('click', () => {
        window.go?.app?.App?.OpenDataDir?.().catch(() => {});
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
          const newMac = await window.go.app.App.RegenerateDSUMAC();
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
      ['setting-stillness-hint', 'setting-disconnect-alert', 'setting-silence-disconnect', 'setting-cemu-drift-guard', 'setting-check-updates'].forEach(id => {
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
      if (keysEl) setShown(keysEl, false);
      if (labelEl) {
        setShown(labelEl, true);
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
      if (keysEl) setShown(keysEl, true);
      if (labelEl) setShown(labelEl, false);

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
      if (window.go?.app?.App?.SetTuningFilterParams) {
        window.go.app.App.SetTuningFilterParams(deadband, deadbandUsb, sens);
      }
    },

    initTooltips() {
      const tooltipEl = document.getElementById('settings-floating-tooltip');
      if (!tooltipEl) return;

      let currentTarget = null;

      const hideTooltip = () => {
        currentTarget = null;
        tooltipEl.classList.remove('show');
        setShown(tooltipEl, false);
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
        setShown(tooltipEl, true);
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
        if (window.go?.app?.App?.GetAppSettings) {
          const s = await window.go.app.App.GetAppSettings();
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
      FirewallUI.refresh();
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

      if (vOff) setShown(vOff, false);
      if (vOn) setShown(vOn, false);
      if (vUsb) setShown(vUsb, false);
      if (vModeHeader) setShown(vModeHeader, false);
      if (vSet) setShown(vSet, false);
      if (vHelp) setShown(vHelp, false);
      if (vWelcome) setShown(vWelcome, false);
      if (vSettings) setShown(vSettings, true);

      document.getElementById('btn-header-settings')?.classList.add('active');

      await this.populateUI();

      // Start live test bench telemetry
      if (window.go?.app?.App?.SetTuningActive) {
        window.go.app.App.SetTuningActive(true);
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

      const cemuGuardCheckbox = document.getElementById('setting-cemu-drift-guard');
      if (cemuGuardCheckbox) {
        cemuGuardCheckbox.checked = (s.cemuDriftGuard !== false);
      }

      const checkUpdatesCheckbox = document.getElementById('setting-check-updates');
      if (checkUpdatesCheckbox) {
        checkUpdatesCheckbox.checked = !!s.checkUpdates;
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
      setModified('cemuDriftGuard', !!document.getElementById('setting-cemu-drift-guard')?.checked !== this.DEFAULTS.cemuDriftGuard);
      setModified('checkUpdates', !!document.getElementById('setting-check-updates')?.checked !== this.DEFAULTS.checkUpdates);

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
      const cemuDriftGuard = !!document.getElementById('setting-cemu-drift-guard')?.checked;
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
        cemuDriftGuard: cemuDriftGuard,
        checkUpdates: !!document.getElementById('setting-check-updates')?.checked,
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
          if (window.go?.app?.App?.SaveAppSettings) {
            await window.go.app.App.SaveAppSettings(payload);
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

      const cemuGuardCheckbox = document.getElementById('setting-cemu-drift-guard');
      if (cemuGuardCheckbox) {
        cemuGuardCheckbox.checked = true;
      }

      const checkUpdatesReset = document.getElementById('setting-check-updates');
      if (checkUpdatesReset) {
        checkUpdatesReset.checked = false;
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
        if (payload && window.go?.app?.App?.SaveAppSettings) {
          window.go.app.App.SaveAppSettings(payload);
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
      if (window.go?.app?.App?.SetTuningActive) {
        window.go.app.App.SetTuningActive(false);
      }

      const vSettings = document.getElementById('view-settings');
      if (vSettings) setShown(vSettings, false);

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
