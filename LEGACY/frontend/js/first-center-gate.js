'use strict';

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
