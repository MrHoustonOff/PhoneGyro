package main

// DeleteProfile clears a slot of the active bank completely — name, calibration
// matrix, gravity, sensor frame and mount correction — so it is free again. When the
// deleted profile was the active one, the first other saved profile takes over, or
// none (-1) when nothing else is saved.
func (a *App) DeleteProfile(slot int) string {
	if slot < 0 || slot > 5 {
		return "invalid slot"
	}
	bank := a.activeBank()

	bank.profilesMu.Lock()
	if bank.profiles[slot].Name == "" {
		bank.profilesMu.Unlock()
		return "empty slot"
	}
	bank.profiles[slot] = Profile{Slot: slot, Name: "", Device: "Unknown", Icon: "default", Matrix: defaultMatrix3x3()}
	wasActive := bank.activeSlot == slot
	next := -1
	for i := range bank.profiles {
		if bank.profiles[i].Name != "" {
			next = i
			break
		}
	}
	bank.profilesMu.Unlock()

	if wasActive {
		return a.SetActiveProfile(next) // re-applies the live state, saves and emits
	}
	a.saveProfiles()
	a.emitStateChange()
	return "ok"
}
