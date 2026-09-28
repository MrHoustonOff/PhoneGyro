package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"os"
	"path/filepath"
	"phonegyro/pkg/dsu"
	"phonegyro/pkg/pairing"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// AppSettings holds configurable parameters exposed in the settings window
type AppSettings struct {
	Theme                 string         `json:"theme"`
	Lang                  string         `json:"lang"`
	FontScale             float64        `json:"fontScale"`
	ActiveSlot            int            `json:"activeSlot"`
	FirstLaunchDone       bool           `json:"firstLaunchDone"`
	HideAuthor            bool           `json:"hideAuthor"`
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
	SoundMode             string         `json:"soundMode"`
	SoundVolume           int            `json:"soundVolume"`
	SoundVolumes          map[string]int `json:"soundVolumes,omitempty"`
	GyroDeadband          float64        `json:"gyroDeadband"`
	GyroDeadbandUsb       float64        `json:"gyroDeadbandUsb"`
	GyroSensitivity       float64        `json:"gyroSensitivity"`
	MinimizeToTray        bool           `json:"minimizeToTray"`
	CloseAction           string         `json:"closeAction"`
	HotkeyRecenterEnabled bool           `json:"hotkeyRecenterEnabled"`
	HotkeyRecenterKey     string         `json:"hotkeyRecenterKey"`
	InputMode             string         `json:"inputMode,omitempty"`
}

func formatMAC(b [6]byte) string {
	return fmt.Sprintf("%02X:%02X:%02X:%02X:%02X:%02X", b[0], b[1], b[2], b[3], b[4], b[5])
}

func parseMAC(s string) ([6]byte, error) {
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

func (a *App) getDSUMAC() string {
	a.dsuMACMu.RLock()
	defer a.dsuMACMu.RUnlock()
	return a.dsuMAC
}

func (a *App) setDSUMAC(mac string) {
	a.dsuMACMu.Lock()
	a.dsuMAC = mac
	a.dsuMACMu.Unlock()
}

func defaultSoundVolumes() map[string]int {
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

func (a *App) getSoundVolumes() map[string]int {
	a.soundVolumesMu.RLock()
	defer a.soundVolumesMu.RUnlock()
	if a.soundVolumes == nil {
		return defaultSoundVolumes()
	}
	cp := make(map[string]int, len(a.soundVolumes))
	for k, v := range a.soundVolumes {
		cp[k] = v
	}
	return cp
}

func (a *App) setSoundVolumes(m map[string]int) {
	a.soundVolumesMu.Lock()
	defer a.soundVolumesMu.Unlock()
	defs := defaultSoundVolumes()
	for k := range defs {
		if v, ok := m[k]; ok {
			if v < 0 {
				defs[k] = 0
			} else if v > 3 {
				defs[k] = 3
			} else {
				defs[k] = v
			}
		}
	}
	a.soundVolumes = defs
}

// loadSettings loads theme, language, and slot preferences from settings.json
func (a *App) loadSettings() {
	if a.profilesDir == "" {
		return
	}
	path := filepath.Join(a.profilesDir, "settings.json")
	data, err := os.ReadFile(path)
	if err != nil {
		// First launch!
		a.themeMu.Lock()
		a.firstLaunchDone = false
		if a.currentLang == "" {
			a.currentLang = "ru"
		}
		a.themeMu.Unlock()
		if a.getDSUMAC() == "" {
			mac := dsu.GenerateRandomMAC()
			a.setDSUMAC(formatMAC(mac))
		}
		return
	}
	var s struct {
		Theme                 string         `json:"theme"`
		Lang                  string         `json:"lang"`
		ActiveSlot            int            `json:"activeSlot"`
		FirstLaunchDone       bool           `json:"firstLaunchDone"`
		HideAuthor            bool           `json:"hideAuthor"`
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
		SoundMode             string         `json:"soundMode"`
		SoundVolume           *int           `json:"soundVolume"`
		SoundVolumes          map[string]int `json:"soundVolumes,omitempty"`
		GyroDeadband          *float64       `json:"gyroDeadband,omitempty"`
		GyroDeadbandUsb       *float64       `json:"gyroDeadbandUsb,omitempty"`
		GyroSensitivity       *float64       `json:"gyroSensitivity,omitempty"`
		FontScale             *float64       `json:"fontScale,omitempty"`
		MinimizeToTray        *bool          `json:"minimizeToTray,omitempty"`
		CloseAction           string         `json:"closeAction,omitempty"`
		HotkeyRecenterEnabled *bool          `json:"hotkeyRecenterEnabled,omitempty"`
		HotkeyRecenterKey     string         `json:"hotkeyRecenterKey,omitempty"`
		InputMode             string         `json:"inputMode,omitempty"`
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return
	}
	a.themeMu.Lock()
	if s.Theme == "dark" || s.Theme == "light" {
		a.currentTheme = s.Theme
	}
	if s.Lang == "ru" || s.Lang == "en" {
		a.currentLang = s.Lang
	} else if a.currentLang == "" {
		a.currentLang = "ru"
	}
	a.firstLaunchDone = s.FirstLaunchDone
	a.hideAuthor = s.HideAuthor
	a.themeMu.Unlock()

	a.phoneBank.profilesMu.Lock()
	if s.ActiveSlot >= 0 && s.ActiveSlot < 6 {
		a.phoneBank.activeSlot = s.ActiveSlot
	}
	a.phoneBank.profilesMu.Unlock()

	if parsed, err := parseMAC(s.DSUMAC); err == nil {
		a.setDSUMAC(formatMAC(parsed))
	} else {
		mac := dsu.GenerateRandomMAC()
		a.setDSUMAC(formatMAC(mac))
	}

	if s.DSUPort >= 1024 && s.DSUPort <= 65535 {
		a.dsuPort = s.DSUPort
	}
	if s.HTTPPort >= 1024 && s.HTTPPort <= 65535 {
		a.httpPort = s.HTTPPort
	}
	if s.HTTPSPort >= 1024 && s.HTTPSPort <= 65535 {
		a.httpsPort = s.HTTPSPort
	}
	if s.GyroDeadzone > 0 {
		a.gyroDeadzoneBits.Store(math.Float64bits(s.GyroDeadzone))
	}
	if s.StillnessHint != nil {
		a.stillnessHint.Store(*s.StillnessHint)
	}
	if s.DisconnectAlert != nil {
		a.disconnectAlert.Store(*s.DisconnectAlert)
	}
	if s.SilenceDisconnect != nil {
		a.silenceDisconnect.Store(*s.SilenceDisconnect)
	} else {
		a.silenceDisconnect.Store(true)
	}
	if s.CemuDriftGuard != nil {
		a.cemuDriftGuard.Store(*s.CemuDriftGuard)
	} else {
		a.cemuDriftGuard.Store(true)
	}
	a.cemuNotice.hidden.Store(s.CemuNoticeHidden)
	if s.SoundMode != "" {
		a.soundMode = s.SoundMode
	} else {
		a.soundMode = "cute"
	}
	if s.SoundVolume != nil && *s.SoundVolume >= 0 && *s.SoundVolume <= 3 {
		a.soundVolume.Store(int32(*s.SoundVolume))
	} else {
		a.soundVolume.Store(1)
	}
	if s.SoundVolumes != nil {
		a.setSoundVolumes(s.SoundVolumes)
	} else {
		a.setSoundVolumes(defaultSoundVolumes())
	}
	if s.GyroDeadband != nil {
		a.gyroDeadbandBits.Store(math.Float64bits(*s.GyroDeadband))
	} else if s.GyroDeadzone > 0 {
		a.gyroDeadbandBits.Store(math.Float64bits(s.GyroDeadzone))
	} else {
		a.gyroDeadbandBits.Store(math.Float64bits(defaultDeadbandPhone))
	}
	// Settings from before the split had one threshold, tuned for phones: USB then
	// starts from its own default rather than inheriting it.
	if s.GyroDeadbandUsb != nil {
		a.gyroDeadbandUsbBits.Store(math.Float64bits(*s.GyroDeadbandUsb))
	} else {
		a.gyroDeadbandUsbBits.Store(math.Float64bits(defaultDeadbandUSB))
	}
	if s.GyroSensitivity != nil && *s.GyroSensitivity > 0 {
		a.gyroSensitivityBits.Store(math.Float64bits(*s.GyroSensitivity))
	} else {
		a.gyroSensitivityBits.Store(math.Float64bits(1.00))
	}
	if s.FontScale != nil && *s.FontScale >= 0.70 && *s.FontScale <= 1.60 {
		a.fontScaleBits.Store(math.Float64bits(*s.FontScale))
	} else {
		a.fontScaleBits.Store(math.Float64bits(1.00))
	}
	if s.CloseAction == "minimize" || s.CloseAction == "quit" || s.CloseAction == "ask" {
		a.closeActionMu.Lock()
		a.closeAction = s.CloseAction
		a.closeActionMu.Unlock()
		a.minimizeToTray.Store(s.CloseAction == "minimize")
	} else {
		a.closeActionMu.Lock()
		a.closeAction = "ask"
		a.closeActionMu.Unlock()
		a.minimizeToTray.Store(true)
	}
	if s.HotkeyRecenterEnabled != nil {
		a.hotkeyRecenterEnabled.Store(*s.HotkeyRecenterEnabled)
	} else {
		a.hotkeyRecenterEnabled.Store(true)
	}
	if s.HotkeyRecenterKey != "" {
		a.setHotkeyRecenterKey(s.HotkeyRecenterKey)
	} else {
		a.setHotkeyRecenterKey("Ctrl+Shift+R")
	}
	a.inputModeMu.Lock()
	if s.InputMode == "usb" {
		a.inputMode = "usb"
	} else {
		a.inputMode = "phone"
	}
	a.inputModeMu.Unlock()
}

// saveSettings persists theme, language, activeSlot, and preferences to settings.json
func (a *App) saveSettings() {
	if a.profilesDir == "" {
		return
	}
	if err := os.MkdirAll(a.profilesDir, 0755); err != nil {
		return
	}
	path := filepath.Join(a.profilesDir, "settings.json")

	a.themeMu.RLock()
	theme := a.currentTheme
	lang := a.currentLang
	firstLaunchDone := a.firstLaunchDone
	hideAuthor := a.hideAuthor
	a.themeMu.RUnlock()

	a.phoneBank.profilesMu.RLock()
	slot := a.phoneBank.activeSlot
	a.phoneBank.profilesMu.RUnlock()

	dsuP := a.dsuPort
	if dsuP == 0 {
		dsuP = 26760
	}
	httpP := a.httpPort
	if httpP == 0 {
		httpP = HTTPPort
	}
	httpsP := a.httpsPort
	if httpsP == 0 {
		httpsP = HTTPSPort
	}

	deadzone := math.Float64frombits(a.gyroDeadzoneBits.Load())
	if deadzone == 0 && a.gyroDeadzoneBits.Load() == 0 {
		deadzone = 0.20
	}

	soundM := a.soundMode
	if soundM == "" {
		soundM = "cute"
	}

	deadband := math.Float64frombits(a.gyroDeadbandBits.Load())
	sensitivity := math.Float64frombits(a.gyroSensitivityBits.Load())
	if sensitivity <= 0 {
		sensitivity = 1.00
	}

	vol := int(a.soundVolume.Load())
	if vol < 0 || vol > 3 {
		vol = 1
	}

	fontScale := math.Float64frombits(a.fontScaleBits.Load())
	if fontScale < 0.70 || fontScale > 1.60 {
		fontScale = 1.00
	}

	dsuMacStr := a.getDSUMAC()
	if dsuMacStr == "" {
		mac := dsu.GenerateRandomMAC()
		dsuMacStr = formatMAC(mac)
		a.setDSUMAC(dsuMacStr)
	}

	s := AppSettings{
		Theme:                 theme,
		Lang:                  lang,
		FontScale:             fontScale,
		ActiveSlot:            slot,
		FirstLaunchDone:       firstLaunchDone,
		HideAuthor:            hideAuthor,
		DSUPort:               dsuP,
		DSUMAC:                dsuMacStr,
		HTTPPort:              httpP,
		HTTPSPort:             httpsP,
		GyroDeadzone:          deadzone,
		StillnessHint:         a.stillnessHint.Load(),
		DisconnectAlert:       a.disconnectAlert.Load(),
		SilenceDisconnect:     a.silenceDisconnect.Load(),
		CemuDriftGuard:        a.cemuDriftGuard.Load(),
		CemuNoticeHidden:      a.cemuNotice.hidden.Load(),
		SoundMode:             soundM,
		SoundVolume:           vol,
		SoundVolumes:          a.getSoundVolumes(),
		GyroDeadband:          deadband,
		GyroDeadbandUsb:       math.Float64frombits(a.gyroDeadbandUsbBits.Load()),
		GyroSensitivity:       sensitivity,
		MinimizeToTray:        a.GetCloseAction() == "minimize",
		CloseAction:           a.GetCloseAction(),
		HotkeyRecenterEnabled: a.hotkeyRecenterEnabled.Load(),
		HotkeyRecenterKey:     a.getHotkeyRecenterKey(),
		InputMode:             a.GetInputMode(),
	}

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, data, 0644)
}

// GetCloseAction returns the current action on window close ("ask", "minimize", "quit").
func (a *App) GetCloseAction() string {
	a.closeActionMu.RLock()
	defer a.closeActionMu.RUnlock()
	if a.closeAction == "" {
		return "ask"
	}
	return a.closeAction
}

// SetCloseAction configures the action on window close.
func (a *App) SetCloseAction(action string) {
	if action != "ask" && action != "minimize" && action != "quit" {
		action = "ask"
	}
	a.closeActionMu.Lock()
	a.closeAction = action
	a.closeActionMu.Unlock()
	a.minimizeToTray.Store(action == "minimize")
}

// ConfirmCloseChoice handles user's decision from the Apple confirmation modal.
func (a *App) ConfirmCloseChoice(action string, remember bool) {
	if remember {
		a.SetCloseAction(action)
		a.saveSettings()
	}
	if action == "minimize" {
		if a.ctx != nil {
			wailsRuntime.WindowHide(a.ctx)
		}
	} else {
		a.QuitApp()
	}
}

// shouldMinimizeToTray reports whether closing the window should hide it to the system tray.
func (a *App) shouldMinimizeToTray() bool {
	return a.GetCloseAction() == "minimize"
}

func (a *App) getHotkeyRecenterKey() string {
	a.hotkeyRecenterKeyMu.RLock()
	defer a.hotkeyRecenterKeyMu.RUnlock()
	if a.hotkeyRecenterKey == "" {
		return "Ctrl+Shift+R"
	}
	return a.hotkeyRecenterKey
}

func (a *App) setHotkeyRecenterKey(key string) {
	a.hotkeyRecenterKeyMu.Lock()
	defer a.hotkeyRecenterKeyMu.Unlock()
	a.hotkeyRecenterKey = key
}

// SetTheme updates theme on backend, broadcasts to Live Debug window, and emits event to main window.
func (a *App) SetTheme(theme string) {
	if theme == "" {
		return
	}
	a.themeMu.Lock()
	a.currentTheme = theme
	a.themeMu.Unlock()

	a.broadcastLiveDebugJSON(map[string]string{
		"type":  "theme",
		"theme": theme,
	})

	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "theme-sync", theme)
		if theme == "dark" {
			wailsRuntime.WindowSetDarkTheme(a.ctx)
		} else if theme == "light" {
			wailsRuntime.WindowSetLightTheme(a.ctx)
		}
	}
	a.saveSettings()
}

// SetLang updates language on backend, broadcasts to Live Debug window, and emits event to main window.
func (a *App) SetLang(lang string) {
	if lang == "" {
		return
	}
	a.themeMu.Lock()
	a.currentLang = lang
	a.themeMu.Unlock()

	a.broadcastLiveDebugJSON(map[string]string{
		"type": "lang",
		"lang": lang,
	})

	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "lang-sync", lang)
	}
	a.saveSettings()
}

// GetTheme returns the current synchronized theme.
func (a *App) GetTheme() string {
	a.themeMu.RLock()
	defer a.themeMu.RUnlock()
	if a.currentTheme == "" {
		return "dark"
	}
	return a.currentTheme
}

// GetLang returns the current synchronized language.
func (a *App) GetLang() string {
	a.themeMu.RLock()
	defer a.themeMu.RUnlock()
	if a.currentLang == "" {
		return "ru"
	}
	return a.currentLang
}

// SetFontScale updates UI font scale on backend, broadcasts to Live Debug window, and emits event to main window.
func (a *App) SetFontScale(scale float64) {
	if scale < 0.70 || scale > 1.60 {
		scale = 1.00
	}
	a.fontScaleBits.Store(math.Float64bits(scale))

	a.broadcastLiveDebugJSON(map[string]any{
		"type":      "font-scale",
		"fontScale": scale,
	})

	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "font-scale-sync", scale)
	}
	a.saveSettings()
}

// GetFontScale returns the current synchronized UI font scale.
func (a *App) GetFontScale() float64 {
	scale := math.Float64frombits(a.fontScaleBits.Load())
	if scale < 0.70 || scale > 1.60 {
		return 1.00
	}
	return scale
}

// IsFirstLaunch returns true if the application has not finished its first-launch onboarding.
func (a *App) IsFirstLaunch() bool {
	a.themeMu.RLock()
	defer a.themeMu.RUnlock()
	return !a.firstLaunchDone
}

// MarkFirstLaunchDone marks that the welcome onboarding has been viewed and persists to settings.
func (a *App) MarkFirstLaunchDone() {
	a.themeMu.Lock()
	a.firstLaunchDone = true
	a.themeMu.Unlock()
	a.saveSettings()
}

// GetHideAuthor returns whether the discreet author attribution should be hidden.
func (a *App) GetHideAuthor() bool {
	a.themeMu.RLock()
	defer a.themeMu.RUnlock()
	return a.hideAuthor
}

// SetHideAuthor configures author attribution visibility and persists to settings.
func (a *App) SetHideAuthor(hide bool) {
	a.themeMu.Lock()
	a.hideAuthor = hide
	a.themeMu.Unlock()
	a.saveSettings()
}

// SetWindowTheme sets the native window title bar theme.
func (a *App) SetWindowTheme(theme string) {
	if a.ctx == nil {
		return
	}
	if theme == "dark" {
		wailsRuntime.WindowSetDarkTheme(a.ctx)
	} else if theme == "light" {
		wailsRuntime.WindowSetLightTheme(a.ctx)
	}
}

func (a *App) rebuildURLsAndQRCodes() {
	if a.primaryIP == "" {
		return
	}
	hPort := a.httpPort
	if hPort == 0 {
		hPort = HTTPPort
	}
	hsPort := a.httpsPort
	if hsPort == 0 {
		hsPort = HTTPSPort
	}

	setupURL := fmt.Sprintf("http://%s:%d/ca.mobileconfig", a.primaryIP, hPort)
	appURL := fmt.Sprintf("https://%s:%d/", a.primaryIP, hsPort)

	qrBytes, err := pairing.GenerateQRPNG(appURL, 240)
	if err == nil {
		a.qrCodePNG = "data:image/png;base64," + base64.StdEncoding.EncodeToString(qrBytes)
	}

	setupQRBytes, err := pairing.GenerateQRPNG(setupURL, 240)
	if err == nil {
		a.setupQRPNG = "data:image/png;base64," + base64.StdEncoding.EncodeToString(setupQRBytes)
	}

	a.setupURL = setupURL
	a.gamepadURL = appURL
}

// GetAppSettings returns all current application settings
func (a *App) GetAppSettings() AppSettings {
	a.themeMu.RLock()
	theme := a.currentTheme
	lang := a.currentLang
	firstLaunch := a.firstLaunchDone
	hideAuthor := a.hideAuthor
	a.themeMu.RUnlock()

	a.phoneBank.profilesMu.RLock()
	slot := a.phoneBank.activeSlot
	a.phoneBank.profilesMu.RUnlock()

	dsuP := a.dsuPort
	if dsuP == 0 {
		dsuP = 26760
	}
	httpP := a.httpPort
	if httpP == 0 {
		httpP = HTTPPort
	}
	httpsP := a.httpsPort
	if httpsP == 0 {
		httpsP = HTTPSPort
	}

	deadzone := math.Float64frombits(a.gyroDeadzoneBits.Load())

	soundM := a.soundMode
	if soundM == "" {
		soundM = "cute"
	}

	deadband := math.Float64frombits(a.gyroDeadbandBits.Load())
	sensitivity := math.Float64frombits(a.gyroSensitivityBits.Load())
	if sensitivity <= 0 {
		sensitivity = 1.00
	}

	vol := int(a.soundVolume.Load())
	if vol < 0 || vol > 3 {
		vol = 1
	}

	fontScale := math.Float64frombits(a.fontScaleBits.Load())
	if fontScale < 0.70 || fontScale > 1.60 {
		fontScale = 1.00
	}

	return AppSettings{
		Theme:                 theme,
		Lang:                  lang,
		FontScale:             fontScale,
		ActiveSlot:            slot,
		FirstLaunchDone:       firstLaunch,
		HideAuthor:            hideAuthor,
		DSUPort:               dsuP,
		DSUMAC:                a.getDSUMAC(),
		HTTPPort:              httpP,
		HTTPSPort:             httpsP,
		GyroDeadzone:          deadzone,
		StillnessHint:         a.stillnessHint.Load(),
		DisconnectAlert:       a.disconnectAlert.Load(),
		SilenceDisconnect:     a.silenceDisconnect.Load(),
		CemuDriftGuard:        a.cemuDriftGuard.Load(),
		CemuNoticeHidden:      a.cemuNotice.hidden.Load(),
		SoundMode:             soundM,
		SoundVolume:           vol,
		SoundVolumes:          a.getSoundVolumes(),
		GyroDeadband:          deadband,
		GyroDeadbandUsb:       math.Float64frombits(a.gyroDeadbandUsbBits.Load()),
		GyroSensitivity:       sensitivity,
		MinimizeToTray:        a.GetCloseAction() == "minimize",
		CloseAction:           a.GetCloseAction(),
		HotkeyRecenterEnabled: a.hotkeyRecenterEnabled.Load(),
		HotkeyRecenterKey:     a.getHotkeyRecenterKey(),
		InputMode:             a.GetInputMode(),
	}
}

// SaveAppSettings validates, applies and persists settings
func (a *App) SaveAppSettings(s AppSettings) (map[string]any, error) {
	if s.DSUPort < 1024 || s.DSUPort > 65535 {
		return nil, fmt.Errorf("DSU port must be between 1024 and 65535")
	}
	if s.HTTPPort < 1024 || s.HTTPPort > 65535 {
		return nil, fmt.Errorf("HTTP port must be between 1024 and 65535")
	}
	if s.HTTPSPort < 1024 || s.HTTPSPort > 65535 {
		return nil, fmt.Errorf("HTTPS port must be between 1024 and 65535")
	}
	if s.HTTPPort == s.HTTPSPort || s.HTTPPort == s.DSUPort || s.HTTPSPort == s.DSUPort {
		return nil, fmt.Errorf("DSU, HTTP and HTTPS ports must be different")
	}

	if s.DSUMAC != "" {
		if parsed, err := parseMAC(s.DSUMAC); err == nil {
			formatted := formatMAC(parsed)
			a.setDSUMAC(formatted)
			if a.dsuSrv != nil {
				a.dsuSrv.SetMACAddress(parsed)
			}
		}
	}

	dsuRestarted := false
	if s.DSUPort != a.dsuPort && a.dsuSrv != nil {
		a.dsuSrv.Stop()
		macBytes, _ := parseMAC(a.getDSUMAC())
		newDsu := dsu.NewServer(s.DSUPort, macBytes)
		a.bindDSUCallbacks(newDsu)
		if err := newDsu.Start(); err != nil {
			oldDsu := dsu.NewServer(a.dsuPort, macBytes)
			a.bindDSUCallbacks(oldDsu)
			_ = oldDsu.Start()
			a.dsuSrv = oldDsu
			return nil, fmt.Errorf("failed to bind DSU port %d: %w", s.DSUPort, err)
		}
		a.dsuSrv = newDsu
		a.dsuPort = s.DSUPort
		dsuRestarted = true
	} else if a.dsuPort == 0 {
		a.dsuPort = s.DSUPort
	}

	if s.HTTPPort != a.httpPort || s.HTTPSPort != a.httpsPort {
		a.httpPort = s.HTTPPort
		a.httpsPort = s.HTTPSPort
		a.rebuildURLsAndQRCodes()
	}

	if s.GyroDeadzone >= 0 {
		a.gyroDeadzoneBits.Store(math.Float64bits(s.GyroDeadzone))
	}
	if s.GyroDeadband >= 0 && s.GyroDeadband <= 1.0 {
		a.gyroDeadbandBits.Store(math.Float64bits(s.GyroDeadband))
	}
	if s.GyroDeadbandUsb >= 0 && s.GyroDeadbandUsb <= 1.0 {
		a.gyroDeadbandUsbBits.Store(math.Float64bits(s.GyroDeadbandUsb))
	}
	if s.GyroSensitivity >= 0.25 && s.GyroSensitivity <= 3.0 {
		a.gyroSensitivityBits.Store(math.Float64bits(s.GyroSensitivity))
	}

	a.stillnessHint.Store(s.StillnessHint)
	a.disconnectAlert.Store(s.DisconnectAlert)
	a.silenceDisconnect.Store(s.SilenceDisconnect)
	a.cemuDriftGuard.Store(s.CemuDriftGuard)
	// CemuNoticeHidden is not a settings-window field: only the notice's own
	// "don't show again" changes it (CloseCemuNotice).
	a.dsuClientViews() // turns the guard on or off for the Cemu clients now
	if s.CloseAction != "" {
		a.SetCloseAction(s.CloseAction)
	} else {
		a.minimizeToTray.Store(s.MinimizeToTray)
	}
	if s.SoundVolume >= 0 && s.SoundVolume <= 3 {
		a.soundVolume.Store(int32(s.SoundVolume))
	}
	if s.SoundVolumes != nil {
		a.setSoundVolumes(s.SoundVolumes)
	}
	if s.SoundMode != "" {
		a.soundMode = s.SoundMode
	}
	if s.FontScale >= 0.70 && s.FontScale <= 1.60 {
		a.fontScaleBits.Store(math.Float64bits(s.FontScale))
	} else if s.FontScale == 0 {
		a.fontScaleBits.Store(math.Float64bits(1.00))
	}

	a.themeMu.Lock()
	if s.Theme == "dark" || s.Theme == "light" {
		a.currentTheme = s.Theme
	}
	if s.Lang == "ru" || s.Lang == "en" {
		a.currentLang = s.Lang
	}
	a.themeMu.Unlock()

	a.hotkeyRecenterEnabled.Store(s.HotkeyRecenterEnabled)
	if s.HotkeyRecenterKey != "" {
		a.setHotkeyRecenterKey(s.HotkeyRecenterKey)
	}
	if a.trayMgr != nil {
		a.trayMgr.UpdateHotkey(s.HotkeyRecenterEnabled, a.getHotkeyRecenterKey())
	}

	curScale := math.Float64frombits(a.fontScaleBits.Load())
	a.broadcastLiveDebugJSON(map[string]any{
		"type":      "font-scale",
		"fontScale": curScale,
	})

	a.saveSettings()
	a.emitStateChange()

	return map[string]any{
		"success":      true,
		"dsuRestarted": dsuRestarted,
	}, nil
}

// RegenerateDSUMAC generates a fresh MAC address, updates the server, and persists to settings
func (a *App) RegenerateDSUMAC() string {
	newMAC := dsu.GenerateRandomMAC()
	macStr := formatMAC(newMAC)
	a.setDSUMAC(macStr)
	if a.dsuSrv != nil {
		a.dsuSrv.SetMACAddress(newMAC)
	}
	a.saveSettings()
	return macStr
}

// SetTuningActive toggles 60 Hz real-time telemetry streaming for the settings test bench
func (a *App) SetTuningActive(active bool) {
	a.tuningActive.Store(active)
}

// SetTuningFilterParams dynamically updates filter parameters for live bench
// previewing: the tremor thresholds of the phone and the USB controller, and the
// sensitivity.
func (a *App) SetTuningFilterParams(deadband, deadbandUsb, sensitivity float64) {
	if deadband >= 0 && deadband <= 1.0 {
		a.gyroDeadbandBits.Store(math.Float64bits(deadband))
	}
	if deadbandUsb >= 0 && deadbandUsb <= 1.0 {
		a.gyroDeadbandUsbBits.Store(math.Float64bits(deadbandUsb))
	}
	if sensitivity >= 0.25 && sensitivity <= 3.0 {
		a.gyroSensitivityBits.Store(math.Float64bits(sensitivity))
	}
	a.saveSettings()
}

// GetInputMode returns the active input mode ("phone" or "usb").
func (a *App) GetInputMode() string {
	a.inputModeMu.RLock()
	defer a.inputModeMu.RUnlock()
	if a.inputMode == "" {
		return "phone"
	}
	return a.inputMode
}

// SetInputMode changes the active input mode ("phone" or "usb"), synchronizes with server and emits state.
func (a *App) SetInputMode(mode string) string {
	if mode != "usb" {
		mode = "phone"
	}
	a.inputModeMu.Lock()
	prev := a.inputMode
	a.inputMode = mode
	a.inputModeMu.Unlock()

	if a.srv != nil {
		a.srv.SetInputMode(mode)
	}

	// No manual hasClient reset needed here: it now lives per-bank, so
	// switching modes naturally shows whatever that bank's own state is
	// (and the phone's own OnClientDisconnect path clears it for real once
	// the transport layer actually drops the connection).

	if a.usbMgr != nil {
		if mode == "usb" {
			a.usbMgr.Start()
		} else {
			a.usbMgr.Stop()
		}
	}

	if prev != mode {
		a.saveSettings()
		a.emitStateChange()
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "input-mode-changed", mode)
		}
	}
	return mode
}

// getI18nMsg returns localized message or fallback
func (a *App) getI18nMsg(key string) string {
	if a.i18nMgr != nil {
		a.themeMu.RLock()
		lang := a.currentLang
		a.themeMu.RUnlock()
		if lang == "" {
			lang = a.i18nMgr.BaseLanguage()
		}
		return a.i18nMgr.Get(lang, key)
	}
	return key
}

// GetLanguages returns available languages
func (a *App) GetLanguages() []string {
	if a.i18nMgr != nil {
		return a.i18nMgr.Languages()
	}
	return []string{"ru", "en"}
}

// GetTranslations returns raw JSON for the specified language
func (a *App) GetTranslations(lang string) string {
	if a.i18nMgr != nil {
		if raw, ok := a.i18nMgr.RawLocaleJSON(lang); ok {
			return string(raw)
		}
	}
	return "{}"
}

// ValidateSync runs translation mutual synchronization check
func (a *App) ValidateSync() []string {
	if a.i18nMgr != nil {
		return a.i18nMgr.ValidateSync()
	}
	return nil
}
