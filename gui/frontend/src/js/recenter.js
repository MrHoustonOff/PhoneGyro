'use strict';

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
        window.go.app.App.ResetAHRS().catch(() => {});
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
        // 60 Hz orientation for the live calibration previews (gui/internal/app/loops.go "ahrs:quat").
        window.runtime.EventsOn('ahrs:quat', (q) => {
          if (!q || typeof Scene3D === 'undefined') return;
          for (const id of ['cal-3d-canvas-confirm', 'cal-3d-canvas-manual']) {
            const sc = Scene3D.get(id);
            if (sc && sc.updateQuat) sc.updateQuat(q.q0, q.q1, q.q2, q.q3);
          }
        });

        // Heavy data loss on the active link (gui/internal/link/alarm.go decides when).
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
