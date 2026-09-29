'use strict';

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

    // The level bubble and yaw needle ease towards the latest angles (targetPitch/
    // Roll/Yaw, set by render at 15 Hz). The loop runs only while they are still
    // moving: once they reach the target it stops, and render wakes it again.
    startInclinometerLoop() {
      if (this._inclinometerLoopRunning) return;
      this._inclinometerLoopRunning = true;

      const bubble = document.getElementById('gyro-bubble');
      const yawGroup = document.getElementById('gyro-yaw-group');
      const hudStatus = document.getElementById('hud-level-status');
      const maxR = 40.0;
      const settled = 0.005; // degrees: closer than this to the target counts as there
      let lastCx = '', lastCy = '', lastTransform = '', lastLevel = null;

      const step = () => {
        this._inclinometerRaf = null;
        // Inclinometer hidden: Settings open, or the device is offline. render wakes it.
        if ((typeof SettingsManager !== 'undefined' && SettingsManager.isOpen) || (this.lastState && this.lastState.status === 'offline')) {
          return;
        }

        // Exponential lerp smoothing for 60/120/144Hz buttery smooth fluid movement
        const factor = 0.22;
        const dP = this.targetPitch - this.currentPitch;
        const dR = this.targetRoll - this.currentRoll;
        // Wrap-around shortest angle distance for yaw needle
        let diffYaw = (this.targetYaw - this.currentYaw) % 360;
        if (diffYaw > 180) diffYaw -= 360;
        if (diffYaw < -180) diffYaw += 360;

        const done = Math.abs(dP) < settled && Math.abs(dR) < settled && Math.abs(diffYaw) < settled;
        if (done) {
          this.currentPitch = this.targetPitch;
          this.currentRoll = this.targetRoll;
          this.currentYaw += diffYaw;
        } else {
          this.currentPitch += dP * factor;
          this.currentRoll += dR * factor;
          this.currentYaw += diffYaw * factor;
        }

        if (bubble && yawGroup) {
          // Pitch: tilt forward (p > 0) -> bubble forward (up, -Y in SVG); tilt backward (p < 0) -> bubble backward (down, +Y)
          const offsetY = Math.max(-maxR, Math.min(maxR, -this.currentPitch * 0.9));
          // Roll: tilt right (r > 0) -> bubble right (+X in SVG); tilt left (r < 0) -> bubble left (-X)
          const offsetX = Math.max(-maxR, Math.min(maxR, this.currentRoll * 0.9));

          const cx = (60 + offsetX).toFixed(2);
          const cy = (60 + offsetY).toFixed(2);
          if (cx !== lastCx) { bubble.setAttribute('cx', cx); lastCx = cx; }
          if (cy !== lastCy) { bubble.setAttribute('cy', cy); lastCy = cy; }

          // Snap to glowing green level state if within 3.0 degrees
          const isLevel = Math.abs(this.currentPitch) <= 3.0 && Math.abs(this.currentRoll) <= 3.0;
          if (isLevel !== lastLevel) {
            bubble.classList.toggle('level', isLevel);
            if (hudStatus) hudStatus.classList.toggle('level', isLevel);
            lastLevel = isLevel;
          }

          // Rotate compass pointer around center (60, 60) with Yaw
          const transform = `rotate(${this.currentYaw.toFixed(2)} 60 60)`;
          if (transform !== lastTransform) { yawGroup.setAttribute('transform', transform); lastTransform = transform; }
        }

        if (!done) this._inclinometerRaf = requestAnimationFrame(step);
      };

      this._wakeInclinometer = () => {
        if (!this._inclinometerRaf) this._inclinometerRaf = requestAnimationFrame(step);
      };
      this._wakeInclinometer();
    },

    // render runs 15 times a second: writing an unchanged text or display still
    // invalidates style and layout, so these write only on change.
    _setText(el, v) {
      if (el && el.textContent !== v) el.textContent = v;
    },
    _setDisplay(el, v) {
      if (el && el.style.display !== v) el.style.display = v;
    },
    _lastHideAuthor: null,
    _applyAuthorSignature(hide) {
      hide = !!hide;
      if (this._lastHideAuthor === hide) return;
      this._lastHideAuthor = hide;
      ['author-signature', 'help-author-sig', 'setup-author-sig'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = hide ? 'none' : '';
      });
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

    // kicked: clients the user disconnected, listed greyed out so they can be
    // brought back (gui/internal/app/dsu_clients.go dsuKickedViews).
    updateDSU(count, clients, kicked) {
      count = typeof count === 'number' ? count : (Array.isArray(clients) ? clients.length : 0);
      clients = Array.isArray(clients) ? clients : [];
      kicked = Array.isArray(kicked) ? kicked : [];
      const clientsJson = DsuClientList.uiKey(count, clients, kicked);

      if (this._lastDsuCount === count && this._lastDsuClientsJson === clientsJson) {
        DsuClientList.refreshInfo(clients);
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

        if (idleRow) idleRow.style.display = isOnline ? 'none' : 'flex';
        if (clientsList) {
          const shown = isOnline ? clients : [];
          clientsList.style.display = (shown.length || kicked.length) ? 'flex' : 'none';
          DsuClientList.render(clientsList, shown, kicked);
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

      if (!fromBackend && window.go?.app?.App?.SetInputMode) {
        window.go.app.App.SetInputMode(mode).catch(console.error);
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
        this.updateDSU(state.dsuClients, state.dsuClientList, state.dsuKickedList || []);
      }

      if (typeof state.usbConnected !== 'undefined') {
        this.updateUsbStatus(state.usbConnected, state.usbPort);
      }

      const viewOffline = document.getElementById('view-offline');
      const viewOnline = document.getElementById('view-online');
      const viewUsb = document.getElementById('view-usb-mode');
      const cardModeHeader = document.getElementById('card-mode-header');
      const badgeStatus = document.getElementById('badge-status');
      const statusText = document.getElementById('status-text');
      const btnPause = document.getElementById('btn-pause-resume');

      // Populate QR codes and URLs for Android and iOS Setup screens
      const imgQrAndroid = document.getElementById('img-qr-android');
      if (state.qrCode && imgQrAndroid && imgQrAndroid.src !== state.qrCode) {
        imgQrAndroid.src = state.qrCode;
      }
      const linkUrlAndroidText = document.getElementById('link-url-android-text');
      if (state.gamepadUrl) this._setText(linkUrlAndroidText, state.gamepadUrl);

      const imgQrSetup = document.getElementById('img-qr-setup');
      if (state.setupQrCode && imgQrSetup && imgQrSetup.src !== state.setupQrCode) {
        imgQrSetup.src = state.setupQrCode;
      }
      const linkUrlSetupText = document.getElementById('link-url-setup-text');
      if (state.setupUrl) this._setText(linkUrlSetupText, state.setupUrl);

      const isWizardOpen = !!(SetupWizard?.isOpen || HelpManager?.isOpen || SettingsManager?.isOpen || WelcomeManager?.isOpen || CalibrationWizard?.isOpen);
      this._setDisplay(cardModeHeader, isWizardOpen ? 'none' : 'flex');

      // Mode Branch: Stationary USB Controller Mode, before a device is found.
      // Once state.usbConnected flips true we deliberately fall through to the
      // exact same "connected" rendering phone mode uses below (view-online,
      // the LEVEL HUD, profiles module, DSU banner) instead of a bespoke USB
      // view -- GetState()/GetProfiles()/etc. already resolve to the USB bank
      // on their own, so reusing that view is both correct and free.
      if (this.inputMode === 'usb' && !state.usbConnected) {
        const enteringWaiting = this._lastStatus !== 'waiting_usb';
        this._setDisplay(viewOffline, 'none');
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
            this._setDisplay(viewOnline, 'none');
            this._setDisplay(viewUsb, 'flex');
          }
        }
        this.hideRecalHint(true);

        if (enteringWaiting) {
          this._lastStatus = 'waiting_usb';
          if (badgeStatus) badgeStatus.className = 'status-capsule waiting-usb';
          if (statusText) {
            statusText.setAttribute('data-i18n', 'status.waiting_usb');
            statusText.innerHTML = renderMarkdown(I18n.t('status.waiting_usb'));
          }
        }

        this._applyAuthorSignature(state.hideAuthor);
        return;
      }

      // There's a brief gap between the USB transport connecting
      // (state.usbConnected) and the pipeline processing its first frame
      // (state.status flips to "online"). Keep showing the USB waiting view
      // through that gap instead of ever flashing the phone QR screen below.
      if (this.inputMode === 'usb' && state.status === 'offline') {
        this._setDisplay(viewOnline, 'none');
        this._setDisplay(viewOffline, 'none');
        if (!isWizardOpen) this._setDisplay(viewUsb, 'flex');
        return;
      }
      this._setDisplay(viewUsb, 'none');

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
          this._setText(document.getElementById('link-url-text'), this.currentUrl || '...');
        }
      } else {
        // State 2 & 3: Online or Paused
        if (!SetupWizard?.isOpen && !HelpManager?.isOpen && !SettingsManager?.isOpen && !WelcomeManager?.isOpen) {
          this._setDisplay(viewOffline, 'none');
          this._setDisplay(viewOnline, 'flex');
        }

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
          this._setText(deviceNameEl, knownName + portLabel);
        } else {
          this._setText(deviceNameEl, state.deviceName || 'Controller');
        }
        this._setText(document.getElementById('device-hz'), `${Math.round(state.hz || 60)} Hz`);

        // Ping/network-quality pills are meaningless over a wired USB link --
        // repurpose them to show the port and a plain "direct connection"
        // label instead of a fabricated latency number.
        const pingTxt = document.getElementById('device-ping-txt');
        const netSpark = document.getElementById('main-net-spark-canvas');
        const networkHealthEl = document.getElementById('network-health');
        if (isUsbSource) {
          this._setText(pingTxt || document.getElementById('device-ping'), state.usbPort || 'USB');
          this._setDisplay(netSpark, 'none');
          if (networkHealthEl) {
            if (networkHealthEl.hasAttribute('data-i18n')) networkHealthEl.removeAttribute('data-i18n');
            this._setText(networkHealthEl, I18n.t('usb_mode.direct_connection') || 'Прямое USB-подключение');
          }
        } else {
          // Real round-trip time of the phone link (server PING/PONG, 1/s);
          // -1 until the first answer arrives.
          const pingVal = (typeof state.pingMs === 'number') ? state.pingMs : -1;
          const pingLabel = pingVal >= 0 ? `${pingVal} ms` : '—';
          this._setText(pingTxt || document.getElementById('device-ping'), pingLabel);
          this._setDisplay(netSpark, '');
          const qualityKey = pingVal < 0 ? 'calibration.network_quality_measuring'
            : pingVal < 40 ? 'calibration.network_quality_optimal'
            : pingVal < 100 ? 'calibration.network_quality_fair'
            : 'calibration.network_quality_poor';
          if (networkHealthEl && networkHealthEl.getAttribute('data-i18n') !== qualityKey) {
            networkHealthEl.setAttribute('data-i18n', qualityKey);
            networkHealthEl.innerHTML = renderMarkdown(I18n.t(qualityKey));
          }
          this._setText(document.getElementById('bench-net-ping'), pingLabel);
          if (typeof NetSparkline !== 'undefined') {
            NetSparkline.push(pingVal);
          }
        }
        this._setText(document.getElementById('device-time'), state.connectedTime || '00:00:00');

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
        if (this._wakeInclinometer) this._wakeInclinometer();

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

      this._applyAuthorSignature(state.hideAuthor);
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
          if (window.go && window.go.app && window.go.app.App) {
            const newState = await window.go.app.App.TogglePause();
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
        if (window.go?.app?.App?.OpenLiveDebugWindow) {
          window.go.app.App.OpenLiveDebugWindow();
        } else {
          window.open('http://127.0.0.1:8080/livedebug', '_blank');
        }
      };
      document.getElementById('btn-header-stats')?.addEventListener('click', onOpenStats);

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
              AppState.updateDSU(data.count, data.clients, data.kicked || []);
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
      if (window.go && window.go.app && window.go.app.App) {
        const state = await window.go.app.App.GetState();
        this.render(state);
        if (window.go.app.App.GetInputMode) {
          window.go.app.App.GetInputMode().then((m) => {
            if (m && m !== AppState.inputMode) {
              AppState.setInputMode(m, true);
            }
          }).catch(() => {});
        }
        if (window.go.app.App.GetDSUStatus) {
          window.go.app.App.GetDSUStatus().then((dsu) => {
            if (dsu) {
              AppState.updateDSU(dsu.count, dsu.clients, dsu.kicked || []);
            }
          }).catch(() => {});
        }
      }
    }
  };
