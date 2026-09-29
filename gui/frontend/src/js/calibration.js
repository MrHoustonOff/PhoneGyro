'use strict';

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
        if (window.go?.app?.App) {
          window.go.app.App.StopCapture(this.captureStep).catch(() => {});
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
      if (window.go?.app?.App) {
        window.go.app.App.ClearPreview().catch(() => {});
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
        if (window.go?.app?.App) {
          if (this.builtMatrix) {
            window.go.app.App.PreviewMatrix(this.builtMatrix)
              .then(() => this._renderMountCard())
              .catch(() => {});
          } else {
            this._renderMountCard();
          }
          window.go.app.App.ResetAHRS().catch(() => {});
        }
      } else if (screen === 'manual') {
        const s = Scene3D.mount('cal-3d-canvas-manual', { mode: 'live' });
        if (s) s.resetQuat();
        if (window.go?.app?.App) {
          window.go.app.App.ResetAHRS().catch(() => {});
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
      if (window.go?.app?.App) {
        window.go.app.App.StartAxisAlign(true).catch(() => {});
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

      if (window.go?.app?.App) {
        await window.go.app.App.StartCapture();
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
      if (window.go?.app?.App) {
        result = await window.go.app.App.StopCapture(this.captureStep);
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
          if (window.go?.app?.App) {
            valRes = await window.go.app.App.ValidateCalibration(
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
    // physics-based aligner (gui/internal/motion/sensoralign.go) while the user keeps tilting the
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
        if (window.go?.app?.App) {
          try { status = await window.go.app.App.GetAxisAlignStatus(); } catch (e) {}
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
      if (window.go?.app?.App) {
        await window.go.app.App.StartAxisAlign(true);
      }

      const startTime = Date.now();
      const timeoutMs = 20000;

      this.axisAlignInterval = setInterval(async () => {
        if (!window.go?.app?.App) return;
        let status;
        try { status = await window.go.app.App.GetAxisAlignStatus(); } catch (e) { return; }
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
        if (window.go?.app?.App) {
          window.go.app.App.PreviewMatrix(mat).catch(() => {});
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
        if (window.go?.app?.App) {
          window.go.app.App.StartAxisAlign(true).catch(() => {});
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
      try { m = await window.go?.app?.App?.GetWizardMount(); } catch (e) {}
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

      if (window.go?.app?.App) {
        const result = await window.go.app.App.SaveProfile(slot, name, device, icon, mat);
        if (result === 'ok') {
          await window.go.app.App.SetActiveProfile(slot);
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
        window.go?.app?.App?.SetWizardMountEnabled(e.target.checked).catch(() => {});
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
          if (window.go?.app?.App) {
            window.go.app.App.ValidateCalibration(this.capturedVectors[1], this.capturedVectors[2]).then(valRes => {
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
        if (window.go?.app?.App?.ResetAHRS) {
          window.go.app.App.ResetAHRS().catch(() => {});
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
          if (window.go?.app?.App?.CopyCalibrationReport) {
            report = await window.go.app.App.CopyCalibrationReport();
          } else if (window['go']?.['app']?.['App']?.['CopyCalibrationReport']) {
            report = await window['go']['app']['App']['CopyCalibrationReport']();
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
