// Package settings is settings.json: what the settings window shows and edits,
// the defaults, and reading files written by older builds.
package settings

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"

	"phonegyro/pkg/dsu"
)

// FileName is the settings file inside the app's data directory.
const FileName = "settings.json"

const (
	DefaultDSUPort   = 26760
	DefaultHTTPPort  = 8080
	DefaultHTTPSPort = 8443
	DefaultHotkey    = "Ctrl+Shift+R"

	// Порог микро-тремора свой у каждого источника: шум датчиков разный. Телефон —
	// ~0.05–0.1 °/с, MPU-6050 в USB-контроллере на ±2000 °/с — ~0.2 °/с в среднем и до
	// 0.3–0.5 на пиках (записи 2026-09-27), поэтому по умолчанию 0.10 и 0.50.
	DefaultDeadbandPhone = 0.10
	DefaultDeadbandUSB   = 0.50

	MinFontScale = 0.50
	MaxFontScale = 3.00
	MaxVolume    = 3 // sound volume levels are 0..3
)

// Settings holds configurable parameters exposed in the settings window.
type Settings struct {
	Theme                 string         `json:"theme"`
	Accent                string         `json:"accent"`
	Lang                  string         `json:"lang"`
	FontScale             float64        `json:"fontScale"`
	ActiveSlot            int            `json:"activeSlot"`
	FirstLaunchDone       bool           `json:"firstLaunchDone"`
	HideAuthor            bool           `json:"hideAuthor"`
	Splash                bool           `json:"splash"`     // play the launch animation
	DebugPanel            bool           `json:"debugPanel"` // the debug panel opens at start
	DebugLog              bool           `json:"debugLog"`   // write logs/debug.log
	DSUPort               int            `json:"dsuPort"`
	DSUMAC                string         `json:"dsuMac"`
	HTTPPort              int            `json:"httpPort"`
	HTTPSPort             int            `json:"httpsPort"`
	GyroDeadzone          float64        `json:"gyroDeadzone"`
	StillnessHint         bool           `json:"stillnessHint"`
	DisconnectAlert       bool           `json:"disconnectAlert"`
	SilenceDisconnect     bool           `json:"silenceDisconnect"`
	CemuDriftGuard        bool           `json:"cemuDriftGuard"`
	CemuNoticeHidden      bool           `json:"cemuNoticeHidden,omitempty"`
	CheckUpdates          bool           `json:"checkUpdates"`            // off by default: the only request PhoneGyro makes to the internet
	SkippedUpdate         string         `json:"skippedUpdate,omitempty"` // "don't remind me about this version"
	SoundMode             string         `json:"soundMode"`
	SoundVolume           int            `json:"soundVolume"`
	SoundVolumes          map[string]int `json:"soundVolumes,omitempty"`
	GyroDeadband          float64        `json:"gyroDeadband"`
	GyroDeadbandUsb       float64        `json:"gyroDeadbandUsb"`
	GyroSensitivity       float64        `json:"gyroSensitivity"`
	MinimizeToTray        bool           `json:"minimizeToTray"` // kept for old readers: CloseAction == "minimize"
	CloseAction           string         `json:"closeAction"`
	HotkeyRecenterEnabled bool           `json:"hotkeyRecenterEnabled"`
	HotkeyRecenterKey     string         `json:"hotkeyRecenterKey"`
	InputMode             string         `json:"inputMode,omitempty"`
	NoAutoZoom            bool           `json:"noAutoZoom"` // true = always use saved fontScale, false (default) = auto-pick on launch
}

// ValidAccent reports whether a is one of the UI accent colours.
func ValidAccent(a string) bool {
	switch a {
	case "green", "teal", "blue", "violet", "pink", "coral", "amber", "graphite":
		return true
	}
	return false
}

// Defaults is a first launch's settings (DSUMAC is left empty: Load makes one).
func Defaults() Settings {
	return Settings{
		Theme:                 "dark",
		Accent:                "amber",
		Lang:                  "ru",
		FontScale:             1.00,
		ActiveSlot:            -1,
		DSUPort:               DefaultDSUPort,
		HTTPPort:              DefaultHTTPPort,
		HTTPSPort:             DefaultHTTPSPort,
		GyroDeadzone:          0.20,
		Splash:                true,
		StillnessHint:         true,
		DisconnectAlert:       true,
		SilenceDisconnect:     true,
		CemuDriftGuard:        true,
		SoundMode:             "cute",
		SoundVolume:           1,
		SoundVolumes:          DefaultSoundVolumes(),
		GyroDeadband:          DefaultDeadbandPhone,
		GyroDeadbandUsb:       DefaultDeadbandUSB,
		GyroSensitivity:       1.00,
		CloseAction:           "ask",
		HotkeyRecenterEnabled: false,
		HotkeyRecenterKey:     DefaultHotkey,
		InputMode:             "phone",
	}
}

// DefaultSoundVolumes is the volume of each sound (0..MaxVolume).
func DefaultSoundVolumes() map[string]int {
	return map[string]int{
		"connect":    1,
		"disconnect": 1,
		"dsu":        1,
		"recenter":   1,
		"goal":       1,
		"defeat":     1,
		"loss":       1, // тихий сигнал сильной потери данных (link/alarm.go)
	}
}

// SoundVolumes is m over the defaults: known sounds only, clamped to 0..MaxVolume.
func SoundVolumes(m map[string]int) map[string]int {
	out := DefaultSoundVolumes()
	for k := range out {
		if v, ok := m[k]; ok {
			out[k] = min(max(v, 0), MaxVolume)
		}
	}
	return out
}

// ValidCloseAction tells whether a is a window-close choice.
func ValidCloseAction(a string) bool {
	return a == "ask" || a == "minimize" || a == "quit"
}

func validPort(p int) bool { return p >= 1024 && p <= 65535 }

func validFontScale(s float64) bool { return s >= MinFontScale && s <= MaxFontScale }

// CheckPorts rejects ports the app cannot use: out of the non-privileged range,
// or two services on the same port.
func CheckPorts(dsuPort, httpPort, httpsPort int) error {
	if !validPort(dsuPort) {
		return fmt.Errorf("DSU port must be between 1024 and 65535")
	}
	if !validPort(httpPort) {
		return fmt.Errorf("HTTP port must be between 1024 and 65535")
	}
	if !validPort(httpsPort) {
		return fmt.Errorf("HTTPS port must be between 1024 and 65535")
	}
	if httpPort == httpsPort || httpPort == dsuPort || httpsPort == dsuPort {
		return fmt.Errorf("DSU, HTTP and HTTPS ports must be different")
	}
	return nil
}

// FormatMAC is the DSU server MAC as settings.json and the UI keep it.
func FormatMAC(b [6]byte) string {
	return fmt.Sprintf("%02X:%02X:%02X:%02X:%02X:%02X", b[0], b[1], b[2], b[3], b[4], b[5])
}

// ParseMAC reads a 6-byte MAC address in any form net.ParseMAC accepts.
func ParseMAC(s string) ([6]byte, error) {
	var b [6]byte
	hw, err := net.ParseMAC(strings.TrimSpace(s))
	if err != nil {
		return b, err
	}
	if len(hw) != 6 {
		return b, fmt.Errorf("MAC address must be 6 bytes")
	}
	copy(b[:], hw[:6])
	return b, nil
}

// RandomMAC is a new DSU server MAC.
func RandomMAC() string {
	return FormatMAC(dsu.GenerateRandomMAC())
}

// stored is settings.json as read: a missing field (nil) takes its default,
// which for some fields depends on other fields (see Load).
type stored struct {
	Theme                 string         `json:"theme"`
	Accent                string         `json:"accent"`
	Lang                  string         `json:"lang"`
	ActiveSlot            int            `json:"activeSlot"`
	FirstLaunchDone       bool           `json:"firstLaunchDone"`
	HideAuthor            bool           `json:"hideAuthor"`
	Splash                *bool          `json:"splash"`
	DebugPanel            bool           `json:"debugPanel"`
	DebugLog              bool           `json:"debugLog"`
	DSUPort               int            `json:"dsuPort"`
	DSUMAC                string         `json:"dsuMac"`
	HTTPPort              int            `json:"httpPort"`
	HTTPSPort             int            `json:"httpsPort"`
	GyroDeadzone          float64        `json:"gyroDeadzone"`
	StillnessHint         *bool          `json:"stillnessHint"`
	DisconnectAlert       *bool          `json:"disconnectAlert"`
	SilenceDisconnect     *bool          `json:"silenceDisconnect"`
	CemuDriftGuard        *bool          `json:"cemuDriftGuard"`
	CemuNoticeHidden      bool           `json:"cemuNoticeHidden,omitempty"`
	CheckUpdates          bool           `json:"checkUpdates"`
	SkippedUpdate         string         `json:"skippedUpdate,omitempty"`
	SoundMode             string         `json:"soundMode"`
	SoundVolume           *int           `json:"soundVolume"`
	SoundVolumes          map[string]int `json:"soundVolumes,omitempty"`
	GyroDeadband          *float64       `json:"gyroDeadband,omitempty"`
	GyroDeadbandUsb       *float64       `json:"gyroDeadbandUsb,omitempty"`
	GyroSensitivity       *float64       `json:"gyroSensitivity,omitempty"`
	FontScale             *float64       `json:"fontScale,omitempty"`
	CloseAction           string         `json:"closeAction,omitempty"`
	HotkeyRecenterEnabled *bool          `json:"hotkeyRecenterEnabled,omitempty"`
	HotkeyRecenterKey     string         `json:"hotkeyRecenterKey,omitempty"`
	InputMode             string         `json:"inputMode,omitempty"`
	NoAutoZoom            bool           `json:"noAutoZoom,omitempty"`
}

// Load reads dir/settings.json over the defaults; invalid values keep their
// default. found is false on a first launch (no file, or one that is not
// JSON). The result always has a valid DSU MAC.
func Load(dir string) (s Settings, found bool) {
	s = Defaults()
	s.DSUMAC = RandomMAC()
	data, err := os.ReadFile(filepath.Join(dir, FileName))
	if err != nil {
		return s, false
	}
	var r stored
	if err := json.Unmarshal(data, &r); err != nil {
		return s, false
	}

	if r.Theme == "dark" || r.Theme == "light" {
		s.Theme = r.Theme
	}
	if r.Accent == "gold" { // the first palette's gold is the design's amber
		r.Accent = "amber"
	}
	if ValidAccent(r.Accent) {
		s.Accent = r.Accent
	}
	if r.Lang == "ru" || r.Lang == "en" {
		s.Lang = r.Lang
	}
	s.FirstLaunchDone = r.FirstLaunchDone
	s.HideAuthor = r.HideAuthor
	if r.Splash != nil {
		s.Splash = *r.Splash
	}
	s.DebugPanel = r.DebugPanel
	s.DebugLog = r.DebugLog
	if r.ActiveSlot >= 0 && r.ActiveSlot < 6 {
		s.ActiveSlot = r.ActiveSlot
	}
	if mac, err := ParseMAC(r.DSUMAC); err == nil {
		s.DSUMAC = FormatMAC(mac)
	}
	if validPort(r.DSUPort) {
		s.DSUPort = r.DSUPort
	}
	if validPort(r.HTTPPort) {
		s.HTTPPort = r.HTTPPort
	}
	if validPort(r.HTTPSPort) {
		s.HTTPSPort = r.HTTPSPort
	}
	if r.GyroDeadzone > 0 {
		s.GyroDeadzone = r.GyroDeadzone
	}
	if r.StillnessHint != nil {
		s.StillnessHint = *r.StillnessHint
	}
	if r.DisconnectAlert != nil {
		s.DisconnectAlert = *r.DisconnectAlert
	}
	if r.SilenceDisconnect != nil {
		s.SilenceDisconnect = *r.SilenceDisconnect
	}
	if r.CemuDriftGuard != nil {
		s.CemuDriftGuard = *r.CemuDriftGuard
	}
	s.CemuNoticeHidden = r.CemuNoticeHidden
	s.CheckUpdates = r.CheckUpdates
	s.SkippedUpdate = strings.TrimSpace(r.SkippedUpdate)
	if r.SoundMode != "" {
		s.SoundMode = r.SoundMode
	}
	if r.SoundVolume != nil && *r.SoundVolume >= 0 && *r.SoundVolume <= MaxVolume {
		s.SoundVolume = *r.SoundVolume
	}
	if r.SoundVolumes != nil {
		s.SoundVolumes = SoundVolumes(r.SoundVolumes)
	}
	// Before the tremor threshold had its own field it was gyroDeadzone.
	if r.GyroDeadband != nil {
		s.GyroDeadband = *r.GyroDeadband
	} else if r.GyroDeadzone > 0 {
		s.GyroDeadband = r.GyroDeadzone
	}
	// Settings from before the split had one threshold, tuned for phones: USB then
	// starts from its own default rather than inheriting it.
	if r.GyroDeadbandUsb != nil {
		s.GyroDeadbandUsb = *r.GyroDeadbandUsb
	}
	if r.GyroSensitivity != nil && *r.GyroSensitivity > 0 {
		s.GyroSensitivity = *r.GyroSensitivity
	}
	if r.FontScale != nil && validFontScale(*r.FontScale) {
		s.FontScale = *r.FontScale
	}
	if ValidCloseAction(r.CloseAction) {
		s.CloseAction = r.CloseAction
	}
	s.MinimizeToTray = s.CloseAction == "minimize"
	if r.HotkeyRecenterEnabled != nil {
		s.HotkeyRecenterEnabled = *r.HotkeyRecenterEnabled
	}
	if r.HotkeyRecenterKey != "" {
		s.HotkeyRecenterKey = r.HotkeyRecenterKey
	}
	if r.InputMode == "usb" {
		s.InputMode = "usb"
	}
	s.NoAutoZoom = r.NoAutoZoom
	return s, true
}

// Save writes s to dir/settings.json.
func Save(dir string, s Settings) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, FileName), data, 0644)
}
