// Package profiles is profiles.json: the six calibration profile slots of one
// input source, the active slot, and reading files written by older builds.
// Making a profile live (matrix, gravity, axis relation, mount correction) is
// the app's job.
package profiles

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"

	"phonegyro-gui/internal/fsutil"
	"phonegyro-gui/internal/motion"
)

const (
	// FileName is the profiles file inside a source's data directory.
	FileName = "profiles.json"
	// Slots is how many profiles a source has, always.
	Slots = 6
	// SchemaVersion is the file layout. Files older than it are reset to empty
	// slots on load (§5 of spec).
	SchemaVersion = 2
	// Calibration data generations, a supported range:
	//   CurrentVersion is what SaveProfile stamps on every save. Bump it whenever the
	//   calibration stores something new.
	//   MinVersion is the oldest generation the current pipeline still handles
	//   correctly. Profiles below it are Outdated() and must be recalibrated. Raise it
	//   only when old calibration data really stops working (it became 3 when
	//   SensorFrame, the learned accelerometer axis mapping, became required); an
	//   addition older profiles can live without bumps CurrentVersion alone, so an
	//   update does not ask anyone to recalibrate for nothing.
	CurrentVersion = 3
	MinVersion     = 3
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
	// Поправка на наклон установки датчика (только USB, см. app/mount.go).
	Mount  *motion.MountCorrection `json:"mount,omitempty"`
	Active bool                    `json:"active"` // is this the currently applied profile?
	// Version is the calibration data generation this profile was captured with,
	// stamped by SaveProfile. Explicit, not inferred: a named profile whose Version
	// is below MinVersion is definitely missing data the current pipeline needs
	// (e.g. SensorFrame) and must be recalibrated — see Outdated().
	// A never-configured (empty Name) slot is not "outdated", just unused.
	Version int `json:"version,omitempty"`
	// When the calibration wizard saved this profile (Unix seconds) and with which
	// app version; shown to tell profiles apart. Absent for profiles saved by
	// older builds. Informational only: a calibration does not age.
	CalibratedAt   int64  `json:"calibratedAt,omitempty"`
	CalibratedWith string `json:"calibratedWith,omitempty"`
}

// Empty is an unused slot.
func Empty(slot int) Profile {
	return Profile{
		Slot:   slot,
		Name:   "",
		Device: "Unknown",
		Icon:   "default",
		Matrix: motion.DefaultMatrix3x3(),
		Active: false,
	}
}

// EmptySlots is a source with no profiles.
func EmptySlots() [Slots]Profile {
	var ps [Slots]Profile
	for i := range ps {
		ps[i] = Empty(i)
	}
	return ps
}

// Outdated reports whether this is a real (named) profile captured by an older build
// that is missing data the current pipeline depends on. Never true for an empty slot.
func (p Profile) Outdated() bool {
	return p.Name != "" && p.Version < MinVersion
}

// View is what the UI actually receives (GetProfiles, AppState.Profiles): the
// stored profile plus display-only fields that are never written to profiles.json.
type View struct {
	Profile
	Outdated bool `json:"outdated"`
}

// NewView is p as the UI shows it.
func NewView(p Profile) View {
	return View{Profile: p, Outdated: p.Outdated()}
}

// CheckMatrix accepts a calibration matrix with determinant -1 (Cemuhook DSU
// left-handed parity convention).
func CheckMatrix(m [3][3]float64) error {
	det := m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) -
		m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) +
		m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
	if math.Abs(det+1.0) > 0.05 {
		return fmt.Errorf("invalid matrix: determinant is %.4f, must be -1.0", det)
	}
	return nil
}

// File is profiles.json.
type File struct {
	SchemaVersion int            `json:"schemaVersion"`
	Profiles      [Slots]Profile `json:"profiles"`
	ActiveSlot    int            `json:"activeSlot"` // -1 = none (identity)
	GyroBias      [3]float64     `json:"gyroBias"`
	CalGravity    [3]float64     `json:"calGravity,omitempty"`

	// SchemaReset: the file was older than SchemaVersion, so Load returned empty
	// slots and nothing else from it.
	SchemaReset bool `json:"-"`
}

// Load reads dir/profiles.json. ok is false when there is nothing usable
// (first run, or not JSON): the caller keeps what it has.
func Load(dir string) (f File, ok bool) {
	data, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		return f, false // first run — default profiles are fine
	}
	var stored struct {
		SchemaVersion int        `json:"schemaVersion"`
		Profiles      []Profile  `json:"profiles"`
		ActiveSlot    int        `json:"activeSlot"`
		GyroBias      [3]float64 `json:"gyroBias"`
		CalGravity    [3]float64 `json:"calGravity,omitempty"`
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		return f, false
	}

	f.SchemaVersion = stored.SchemaVersion
	if stored.SchemaVersion < SchemaVersion {
		f.Profiles = EmptySlots()
		f.ActiveSlot = -1
		f.SchemaReset = true
		return f, true
	}

	for i := 0; i < Slots; i++ {
		p := Empty(i)
		if i < len(stored.Profiles) {
			p = stored.Profiles[i]
		}
		p.Slot = i // ensure slot index is canonical
		if p.Device == "" {
			p.Device = "Unknown"
		}
		if p.Icon == "" {
			p.Icon = "default"
		}
		// Validate matrix: |det| ≈ 1.0 (valid signed-permutation matrix)
		if math.Abs(math.Abs(motion.Det3x3(p.Matrix))-1.0) > 0.05 {
			p.Matrix = motion.DefaultMatrix3x3()
		}
		// Deliberately no "it already has a SensorFrame, so back-fill Version"
		// shortcut here: a populated SensorFrame isn't proof it was actually earned
		// under the current wizard for THIS profile (it may be a carry-over — see
		// the app's initProfileSensorFrame legacy migration). The only thing that
		// stamps Version is SaveProfile itself, so a pre-versioning profile simply
		// stays Outdated() until it goes through the wizard once — explicit, not assumed.
		f.Profiles[i] = p
	}
	f.ActiveSlot = stored.ActiveSlot
	if f.ActiveSlot >= 0 && f.ActiveSlot < Slots {
		f.Profiles[f.ActiveSlot].Active = true
	}
	f.GyroBias = stored.GyroBias
	f.CalGravity = stored.CalGravity
	return f, true
}

// Save writes f to dir/profiles.json with the current SchemaVersion.
func Save(dir string, f File) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	f.SchemaVersion = SchemaVersion
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return fsutil.WriteFileAtomic(filepath.Join(dir, FileName), data, 0644)
}
