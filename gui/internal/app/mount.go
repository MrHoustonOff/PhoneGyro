package app

import "phonegyro-gui/internal/motion"

// ── Связка с App / motionBank ────────────────────────────────────────────────

// activeMount — поправка для живого потока: на превью мастера — кандидат мастера,
// иначе — активного профиля. nil-безопасно через (*MountCorrection).Active().
func (b *motionBank) activeMount(preview bool) *motion.MountCorrection {
	b.mountMu.RLock()
	defer b.mountMu.RUnlock()
	if preview {
		return b.wizardMount
	}
	return b.mountLive
}

func (b *motionBank) setLiveMount(m *motion.MountCorrection) {
	var cp *motion.MountCorrection
	if m != nil {
		c := *m
		cp = &c
	}
	b.mountMu.Lock()
	b.mountLive = cp
	b.mountMu.Unlock()
}

func (a *App) applyProfileMount(bank *motionBank, slot int) {
	var m *motion.MountCorrection
	if slot >= 0 && slot < len(bank.profiles) {
		bank.profilesMu.RLock()
		m = bank.profiles[slot].Mount
		bank.profilesMu.RUnlock()
	}
	bank.setLiveMount(m)
}

// stageWizardMount считает поправку для кандидата калибровки (вызывается из
// PreviewMatrix). Только USB, только если в этом прогоне мастера есть покой и
// успешный жест «вперёд» после него, и кадр датчика уже известен.
func (a *App) stageWizardMount(bank *motionBank, matrix [3][3]float64) {
	var staged *motion.MountCorrection
	if a.GetInputMode() == "usb" {
		bank.wizardAlignMu.Lock()
		gravity, gravityOK := bank.wizardGravity, bank.wizardGravityValid
		var sf motion.SensorFrame
		sfOK := false
		if bank.wizardAlign != nil {
			sf, sfOK = bank.wizardAlign.Frame()
		}
		bank.wizardAlignMu.Unlock()

		bank.calLogMu.Lock()
		rest, restOK := bank.calStepLogs[0]
		pitch, pitchOK := bank.calStepLogs[1]
		bank.calLogMu.Unlock()

		if gravityOK && sfOK && restOK && pitchOK && pitch.Result.Success && pitch.Timestamp.After(rest.Timestamp) {
			c := motion.MountFromCalibration(matrix, sf, gravity, sampleRots(pitch.Samples))
			// Сохраняем выбор пользователя при повторных превью той же калибровки.
			bank.mountMu.RLock()
			if prev := bank.wizardMount; prev != nil && prev.Status == motion.MountOK && c.Status == motion.MountOK {
				c.Enabled = prev.Enabled
			}
			bank.mountMu.RUnlock()
			staged = &c
		}
	}
	bank.mountMu.Lock()
	bank.wizardMount = staged
	bank.mountMu.Unlock()
}

// GetWizardMount — результат для экрана подтверждения калибровки (nil — нечего показывать).
func (a *App) GetWizardMount() *motion.MountCorrection {
	bank := a.activeBank()
	bank.mountMu.RLock()
	defer bank.mountMu.RUnlock()
	if bank.wizardMount == nil {
		return nil
	}
	c := *bank.wizardMount
	return &c
}

// SetWizardMountEnabled — выключатель поправки на экране подтверждения; сразу
// действует на превью, в профиль попадает при сохранении.
func (a *App) SetWizardMountEnabled(enabled bool) {
	bank := a.activeBank()
	bank.mountMu.Lock()
	if bank.wizardMount != nil {
		bank.wizardMount.Enabled = enabled && bank.wizardMount.Status == motion.MountOK
	}
	bank.mountMu.Unlock()
	if bank.ahrs != nil {
		bank.ahrs.Reset()
	}
}

// SetProfileMountEnabled — тот же выключатель для уже сохранённого профиля.
func (a *App) SetProfileMountEnabled(slot int, enabled bool) string {
	bank := a.activeBank()
	if slot < 0 || slot >= len(bank.profiles) {
		return "invalid slot"
	}
	bank.profilesMu.Lock()
	m := bank.profiles[slot].Mount
	if m == nil || m.Status != motion.MountOK {
		bank.profilesMu.Unlock()
		return "no mount correction"
	}
	c := *m
	c.Enabled = enabled
	bank.profiles[slot].Mount = &c
	active := slot == bank.activeSlot
	bank.profilesMu.Unlock()
	if active {
		a.applyProfileMount(bank, slot)
		if bank.ahrs != nil {
			bank.ahrs.Reset()
		}
	}
	a.saveProfiles()
	a.emitStateChange()
	return "ok"
}

// outputFrameInputs picks the sensor frame and rest gravity the output mapping is
// built from. Normally that is the live aligner and the active profile. On the
// calibration preview (usePrev) it must be what the wizard has just measured:
// the profile's gravity may be absent (fresh install) or belong to another device,
// and it decides the accelerometer's sign — with the wrong one the preview showed
// gravity upside down and the model heavily tilted until the profile was saved.
func (b *motionBank) outputFrameInputs(usePrev bool, sf motion.SensorFrame, sfKnown bool, calGravity [3]float64) (motion.SensorFrame, bool, [3]float64) {
	if !usePrev {
		return sf, sfKnown, calGravity
	}
	b.wizardAlignMu.Lock()
	defer b.wizardAlignMu.Unlock()
	if b.wizardGravityValid {
		calGravity = b.wizardGravity
	}
	if b.wizardAlign != nil {
		if f, ok := b.wizardAlign.Frame(); ok {
			sf, sfKnown = f, true
		}
	}
	return sf, sfKnown, calGravity
}
