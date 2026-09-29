'use strict';

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
        const cal = formatCalibrationDate(activeProf);
        triggerDevice.textContent = (I18n.t('calibration.device_label') || 'Устройство: {device}').replace('{device}', devName)
          + (cal ? ` • ${cal.short}` : '');
        triggerDevice.title = cal ? cal.full : '';
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
        setShown(outdatedWarning, activeProf.outdated);
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
      if (mountRow) setShown(mountRow, hasMount);
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
            const res = await window.go?.app?.App?.SetProfileMountEnabled(this.activeSlot, want);
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
          const cal = formatCalibrationDate(p);
          if (cal) item.title = cal.full;
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
                <span class="profile-item-sub">${formatSlotName(i)} • ${devText}${cal ? ` • ${cal.short}` : ''}</span>
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
        if (window.go?.app?.App?.SetActiveProfile) {
          result = await window.go.app.App.SetActiveProfile(slot);
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
