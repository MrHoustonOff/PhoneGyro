package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"phonegyro-gui/internal/motion"
)

// Profile represents a saved calibration profile with a 3x3 signed-permutation matrix.
type Profile struct {
	Slot   int           `json:"slot"`   // 0-5
	Name   string        `json:"name"`   // user-visible name
	Device string        `json:"device"` // device name e.g. "Unknown"
	Icon   string        `json:"icon"`   // "default", "vertical", "horizontal"
	Matrix [3][3]float64 `json:"matrix"` // signed permutation matrix
	// Gravity at the calibration rest pose, in raw phone axes. Per profile because the
	// gravity sign differs between platforms (iOS reads -1g flat, Android +1g).
	CalGravity [3]float64 `json:"calGravity,omitempty"`
	// Learned gyro↔accel axis relation of the device used with this profile.
	SensorFrame *motion.SensorFrame `json:"sensorFrame,omitempty"`
	// Поправка на наклон установки датчика (только USB, см. mount.go).
	Mount  *motion.MountCorrection `json:"mount,omitempty"`
	Active bool                    `json:"active"` // is this the currently applied profile?
	// Version is the calibration data generation this profile was captured with,
	// stamped by SaveProfile. Explicit, not inferred: a named profile whose Version
	// is behind CurrentProfileVersion is definitely missing data the current
	// pipeline needs (e.g. SensorFrame) and must be recalibrated — see Outdated().
	// A never-configured (empty Name) slot is not "outdated", just unused.
	Version int `json:"version,omitempty"`
}

// Outdated reports whether this is a real (named) profile captured by an older build
// that is missing data the current pipeline depends on. Never true for an empty slot.
func (p Profile) Outdated() bool {
	return p.Name != "" && p.Version < CurrentProfileVersion
}

// ProfileView is what the UI actually receives (GetProfiles, AppState.Profiles): the
// stored profile plus display-only fields that are never written to profiles.json.
type ProfileView struct {
	Profile
	Outdated bool `json:"outdated"`
}

func toProfileView(p Profile) ProfileView {
	return ProfileView{Profile: p, Outdated: p.Outdated()}
}

// loadProfiles reads profiles.json from disk
// loadProfiles (re)loads the currently active mode's profiles.json from its
// bank-specific directory. Kept as a no-arg method for backward
// compatibility with existing call sites (it simply targets a.activeBank()).
func (a *App) loadProfiles() {
	a.loadProfilesInto(a.activeBank(), a.bankDir(a.GetInputMode()))
}

// loadProfilesInto loads dir/profiles.json into the given bank. Both phone
// and usb banks are loaded explicitly at startup (see NewApp) so switching
// modes later never needs a lazy first-load.
func (a *App) loadProfilesInto(bank *motionBank, dir string) {
	path := filepath.Join(dir, "profiles.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return // first run — default profiles are fine
	}

	var stored struct {
		SchemaVersion int        `json:"schemaVersion"`
		Profiles      []Profile  `json:"profiles"`
		ActiveSlot    int        `json:"activeSlot"`
		GyroBias      [3]float64 `json:"gyroBias"`
		CalGravity    [3]float64 `json:"calGravity,omitempty"`
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		return
	}

	bank.profilesMu.Lock()
	defer bank.profilesMu.Unlock()

	// If schema version is outdated (< 2), reset all profiles to canonical defaults (§5 of spec)
	if stored.SchemaVersion < CurrentProfileSchemaVersion {
		for i := 0; i < 6; i++ {
			bank.profiles[i] = Profile{
				Slot:   i,
				Name:   "",
				Device: "Unknown",
				Icon:   "default",
				Matrix: motion.DefaultMatrix3x3(),
				Active: false,
			}
		}
		bank.activeSlot = -1
		return
	}

	for i := 0; i < 6; i++ {
		if i < len(stored.Profiles) {
			bank.profiles[i] = stored.Profiles[i]
		} else {
			bank.profiles[i] = Profile{
				Slot:   i,
				Name:   "",
				Device: "Unknown",
				Icon:   "default",
				Matrix: motion.DefaultMatrix3x3(),
				Active: false,
			}
		}
		bank.profiles[i].Slot = i // ensure slot index is canonical
		if bank.profiles[i].Device == "" {
			bank.profiles[i].Device = "Unknown"
		}
		if bank.profiles[i].Icon == "" {
			bank.profiles[i].Icon = "default"
		}
		// Validate matrix: determinant must be |det| ≈ 1.0 (valid signed-permutation matrix)
		if math.Abs(math.Abs(motion.Det3x3(bank.profiles[i].Matrix))-1.0) > 0.05 {
			bank.profiles[i].Matrix = motion.DefaultMatrix3x3()
		}
		// Deliberately no "it already has a SensorFrame, so back-fill Version"
		// shortcut here: a populated SensorFrame isn't proof it was actually earned
		// under the current wizard for THIS profile (it may be a carry-over — see
		// initProfileSensorFrame's legacy migration). The only thing that stamps
		// Version is SaveProfile itself, so a pre-versioning profile simply stays
		// Outdated() until it goes through the wizard once — explicit, not assumed.
	}
	bank.activeSlot = stored.ActiveSlot

	// Restore active matrix
	if bank.activeSlot >= 0 && bank.activeSlot < 6 {
		p := bank.profiles[bank.activeSlot]
		bank.matrixMu.Lock()
		bank.activeMatrix = p.Matrix
		bank.matrixMu.Unlock()
		bank.profiles[bank.activeSlot].Active = true
	}

	bank.biasMu.Lock()
	bank.gyroBias = stored.GyroBias
	bank.biasMu.Unlock()

	if math.Sqrt(stored.CalGravity[0]*stored.CalGravity[0]+stored.CalGravity[1]*stored.CalGravity[1]+stored.CalGravity[2]*stored.CalGravity[2]) > 0.3 {
		bank.calGravity = stored.CalGravity
	}
	// profilesMu is held here: read the active profile's gravity directly.
	if bank.activeSlot >= 0 && bank.activeSlot < len(bank.profiles) && motion.Norm3(bank.profiles[bank.activeSlot].CalGravity) > 0.3 {
		bank.calGravity = bank.profiles[bank.activeSlot].CalGravity
	}
	if bank.activeSlot >= 0 && bank.activeSlot < len(bank.profiles) {
		bank.setLiveMount(bank.profiles[bank.activeSlot].Mount)
	}
}

// saveProfiles writes the currently active mode's profiles.json with
// schemaVersion 2. Kept as a no-arg method for backward compatibility; it
// targets a.activeBank().
func (a *App) saveProfiles() {
	a.saveProfilesFrom(a.activeBank(), a.bankDir(a.GetInputMode()))
	a.saveSettings()
}

// saveProfilesFrom writes the given bank's profiles to dir/profiles.json.
func (a *App) saveProfilesFrom(bank *motionBank, dir string) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}
	path := filepath.Join(dir, "profiles.json")

	bank.profilesMu.RLock()
	bank.biasMu.RLock()
	stored := struct {
		SchemaVersion int        `json:"schemaVersion"`
		Profiles      [6]Profile `json:"profiles"`
		ActiveSlot    int        `json:"activeSlot"`
		GyroBias      [3]float64 `json:"gyroBias"`
		CalGravity    [3]float64 `json:"calGravity,omitempty"`
	}{
		SchemaVersion: CurrentProfileSchemaVersion,
		Profiles:      bank.profiles,
		ActiveSlot:    bank.activeSlot,
		GyroBias:      bank.gyroBias,
		CalGravity:    bank.calGravity,
	}
	bank.biasMu.RUnlock()
	bank.profilesMu.RUnlock()

	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, data, 0644)
}

// getActiveProfileName returns a human-readable label for the currently active profile.
func (a *App) getActiveProfileName() string {
	bank := a.activeBank()
	bank.profilesMu.RLock()
	defer bank.profilesMu.RUnlock()
	if bank.activeSlot >= 0 && bank.activeSlot < len(bank.profiles) {
		name := bank.profiles[bank.activeSlot].Name
		if name != "" {
			return name
		}
		if a.GetLang() == "ru" {
			return fmt.Sprintf("Слот %d", bank.activeSlot+1)
		}
		return fmt.Sprintf("Slot %d", bank.activeSlot+1)
	}
	return ""
}

// GetProfiles returns current 6 profile slots for the active input mode
func (a *App) GetProfiles() []ProfileView {
	bank := a.activeBank()
	bank.profilesMu.RLock()
	defer bank.profilesMu.RUnlock()

	result := make([]ProfileView, 6)
	for i := 0; i < 6; i++ {
		p := bank.profiles[i]
		p.Active = (i == bank.activeSlot)
		result[i] = toProfileView(p)
	}
	return result
}

// SaveProfile overwrites a profile slot (slot 0-5) with the given name, device, icon, and matrix,
// on the active input mode's own isolated profile bank.
// The matrix must be a valid signed-permutation matrix with determinant -1.
func (a *App) SaveProfile(slot int, name string, device string, icon string, matrix [3][3]float64) string {
	if slot < 0 || slot > 5 {
		return "invalid slot"
	}
	if device == "" {
		device = "Unknown"
	}
	if icon == "" {
		icon = "default"
	}

	// Validate matrix: determinant must be -1 (Cemuhook DSU left-handed parity convention)
	det := matrix[0][0]*(matrix[1][1]*matrix[2][2]-matrix[1][2]*matrix[2][1]) -
		matrix[0][1]*(matrix[1][0]*matrix[2][2]-matrix[1][2]*matrix[2][0]) +
		matrix[0][2]*(matrix[1][0]*matrix[2][1]-matrix[1][1]*matrix[2][0])

	if math.Abs(det+1.0) > 0.05 {
		return fmt.Sprintf("invalid matrix: determinant is %.4f, must be -1.0", det)
	}

	bank := a.activeBank()

	bank.profilesMu.Lock()
	gravity := bank.profiles[slot].CalGravity
	sensorFrame := bank.profiles[slot].SensorFrame
	mount := bank.profiles[slot].Mount
	bank.profilesMu.Unlock()

	// Commit whatever the wizard staged during this session (rest step / axis-align),
	// if any — never invent or assume either value here (§3: no magic, only what the
	// wizard actually measured this run, otherwise keep the profile's existing data).
	bank.wizardAlignMu.Lock()
	if bank.wizardGravityValid {
		gravity = bank.wizardGravity
		bank.wizardGravityValid = false
		// Мастер прошёл заново: старая поправка к новой калибровке не относится.
		bank.mountMu.Lock()
		mount = bank.wizardMount
		bank.wizardMount = nil
		bank.mountMu.Unlock()
	}
	if bank.wizardAlign != nil {
		if f, known := bank.wizardAlign.Frame(); known {
			cp := f
			sensorFrame = &cp
		}
	}
	bank.wizardAlignMu.Unlock()

	bank.profilesMu.Lock()
	bank.profiles[slot] = Profile{
		Slot:        slot,
		Name:        name,
		Device:      device,
		Icon:        icon,
		Matrix:      matrix,
		Active:      (slot == bank.activeSlot),
		CalGravity:  gravity,
		SensorFrame: sensorFrame,
		Mount:       mount,
		// Reaching Save means the wizard's axis-align step already confirmed a
		// mapping (its "next" button is disabled otherwise), so this profile
		// definitely meets the current pipeline's requirements.
		Version: CurrentProfileVersion,
	}
	bank.profilesMu.Unlock()

	// If this slot is currently active, push the new matrix into the live path immediately.
	if slot == bank.activeSlot {
		bank.matrixMu.Lock()
		bank.activeMatrix = matrix
		bank.matrixMu.Unlock()
		a.applyProfileGravity(bank, slot)
		a.applyProfileMount(bank, slot)
		if bank.ahrs != nil {
			bank.ahrs.Reset()
		}
	}

	a.saveProfiles()
	a.emitStateChange()
	return "ok"
}

// applyProfileGravity makes the profile's own rest gravity the live reference. Profiles
// calibrated before gravity was stored per profile keep the bank's existing value.
func (a *App) applyProfileGravity(bank *motionBank, slot int) {
	if slot < 0 || slot >= len(bank.profiles) {
		return
	}
	bank.profilesMu.RLock()
	g := bank.profiles[slot].CalGravity
	bank.profilesMu.RUnlock()
	if motion.Norm3(g) > 0.3 {
		bank.biasMu.Lock()
		bank.calGravity = g
		bank.biasMu.Unlock()
	}
}

// applyProfileSensorFrame loads the profile's learned axis relation into the bank's
// aligner. Without one the aligner relearns from a few tilts and stores the result there.
//
// Switching profile mid-session (device stays connected, no new OnClientDevice event)
// must not silently fall back to the identity guess for a device we already know is
// an iPhone/iPad: that guess is wrong for iOS, and until physics re-confirms it
// PadTest's Madgwick fights the mismatched axes (reported as a wildly skewed pad
// after switching to a profile that had never been through the axis wizard).
func (a *App) applyProfileSensorFrame(bank *motionBank, slot int) {
	if bank.align == nil {
		return
	}
	var f *motion.SensorFrame
	bank.profilesMu.RLock()
	if slot >= 0 && slot < len(bank.profiles) {
		f = bank.profiles[slot].SensorFrame
	}
	bank.profilesMu.RUnlock()
	if f != nil {
		bank.align.SetFrame(*f, true)
		return
	}
	guess := motion.SensorFrame{Q: motion.Identity3(), H: -1}
	if dn, _ := bank.deviceName.Load().(string); dn == "iPhone" || dn == "iPad" {
		guess = motion.IOSSensorFrame()
	}
	bank.align.SetFrame(guess, false)
}

// initProfileSensorFrame hooks bank's live aligner to its active profile. A frame
// learned by older builds (global sensor_frame.json) is migrated into the active
// profile once; this is a one-time explicit upgrade, not the ongoing background
// writes that used to happen here (removed: see wizardAlign). Called once per bank
// at startup, since each bank's aligner and profiles are fully independent.
func (a *App) initProfileSensorFrame(bank *motionBank, dir string) {
	legacy, legacyKnown := bank.align.Frame()
	bank.profilesMu.Lock()
	migrate := legacyKnown && bank.activeSlot >= 0 && bank.activeSlot < len(bank.profiles) && bank.profiles[bank.activeSlot].SensorFrame == nil
	if migrate {
		// Seed only — an unattended carry-over from the old global file is not the
		// same thing as this profile having gone through the current wizard's own
		// axis-align step, so it must NOT bump Version: leave it Outdated() until
		// the user actually confirms it there (§3/§5: no silent "trust me" upgrades).
		bank.profiles[bank.activeSlot].SensorFrame = &legacy
	}
	slot := bank.activeSlot
	bank.profilesMu.Unlock()
	if migrate {
		a.saveProfilesFrom(bank, dir)
	}
	a.applyProfileSensorFrame(bank, slot)
}

// SetActiveProfile selects the profile at the given slot (-1 = identity/none) on the
// active input mode's own bank. Outdated profiles are still switchable — the wizard
// shouldn't be forced on someone who's just picking a slot to play with. The outdated
// warning (banner, highlighted Calibrate button) stays visible once it's active
// instead of gating the switch.
func (a *App) SetActiveProfile(slot int) string {
	if slot < -1 || slot > 5 {
		return "invalid slot"
	}

	bank := a.activeBank()

	bank.profilesMu.Lock()
	// Clear previous active flag
	for i := range bank.profiles {
		bank.profiles[i].Active = false
	}
	bank.activeSlot = slot
	if slot >= 0 {
		bank.profiles[slot].Active = true
	}
	bank.profilesMu.Unlock()

	// Update active matrix
	bank.matrixMu.Lock()
	if slot >= 0 {
		bank.profilesMu.RLock()
		bank.activeMatrix = bank.profiles[slot].Matrix
		bank.profilesMu.RUnlock()
	} else {
		bank.activeMatrix = motion.DefaultMatrix3x3()
	}
	bank.matrixMu.Unlock()
	a.applyProfileGravity(bank, slot)
	a.applyProfileSensorFrame(bank, slot)
	a.applyProfileMount(bank, slot)

	if bank.ahrs != nil {
		bank.ahrs.Reset()
	}

	a.saveProfiles()
	a.emitStateChange()
	return "ok"
}

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
	bank.profiles[slot] = Profile{Slot: slot, Name: "", Device: "Unknown", Icon: "default", Matrix: motion.DefaultMatrix3x3()}
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
