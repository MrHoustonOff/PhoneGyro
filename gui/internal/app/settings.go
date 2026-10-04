package app

import (
	"encoding/base64"
	"fmt"
	"math"
	"os"
	"os/exec"

	"phonegyro/pkg/dsu"
	"phonegyro/pkg/pairing"

	"phonegyro-gui/internal/settings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// AppSettings is what the settings window shows and edits (internal/settings).
type AppSettings = settings.Settings

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

func (a *App) getSoundVolumes() map[string]int {
	a.soundVolumesMu.RLock()
	defer a.soundVolumesMu.RUnlock()
	if a.soundVolumes == nil {
		return settings.DefaultSoundVolumes()
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
	a.soundVolumes = settings.SoundVolumes(m)
}

// loadSettings reads settings.json from profilesDir and makes it live.
func (a *App) loadSettings() {
	if a.profilesDir == "" {
		return
	}
	s, _ := settings.Load(a.profilesDir)
	a.applySettings(s)
}

// applySettings makes s the live settings (s is valid: settings.Load/Defaults).
func (a *App) applySettings(s AppSettings) {
	a.themeMu.Lock()
	a.currentTheme = s.Theme
	a.accent = s.Accent
	a.currentLang = s.Lang
	a.firstLaunchDone = s.FirstLaunchDone
	a.hideAuthor = s.HideAuthor
	a.splash.Store(s.Splash)
	a.debugPanel.Store(s.DebugPanel)
	if !a.debugLogOn.Swap(s.DebugLog) && s.DebugLog {
		a.logEvent("INFO", "debug log on: logs/debug.log")
	} else if !s.DebugLog {
		a.closeDebugLog()
	}
	a.themeMu.Unlock()

	if a.phoneBank != nil && s.ActiveSlot >= 0 && s.ActiveSlot < 6 {
		a.phoneBank.profilesMu.Lock()
		a.phoneBank.activeSlot = s.ActiveSlot
		a.phoneBank.profilesMu.Unlock()
	}

	a.setDSUMAC(s.DSUMAC)
	a.dsuPort = s.DSUPort
	a.httpPort = s.HTTPPort
	a.httpsPort = s.HTTPSPort
	a.gyroDeadzoneBits.Store(math.Float64bits(s.GyroDeadzone))
	a.stillnessHint.Store(s.StillnessHint)
	a.disconnectAlert.Store(s.DisconnectAlert)
	a.silenceDisconnect.Store(s.SilenceDisconnect)
	a.cemuDriftGuard.Store(s.CemuDriftGuard)
	a.cemuNotice.hidden.Store(s.CemuNoticeHidden)
	a.update.enabled.Store(s.CheckUpdates)
	a.update.setSkipped(s.SkippedUpdate)
	a.soundMode = s.SoundMode
	a.soundVolume.Store(int32(s.SoundVolume))
	a.setSoundVolumes(s.SoundVolumes)
	a.gyroDeadbandBits.Store(math.Float64bits(s.GyroDeadband))
	a.gyroDeadbandUsbBits.Store(math.Float64bits(s.GyroDeadbandUsb))
	a.gyroSensitivityBits.Store(math.Float64bits(s.GyroSensitivity))
	a.fontScaleBits.Store(math.Float64bits(s.FontScale))
	a.closeActionMu.Lock()
	a.closeAction = s.CloseAction
	a.closeActionMu.Unlock()
	a.inputModeMu.Lock()
	a.inputMode = s.InputMode
	a.inputModeMu.Unlock()
}

// settingsSnapshot is the live settings; unset values (an App not built by
// NewApp) read as their defaults.
func (a *App) settingsSnapshot() AppSettings {
	def := settings.Defaults()

	a.themeMu.RLock()
	theme := a.currentTheme
	accent := a.accent
	lang := a.currentLang
	firstLaunch := a.firstLaunchDone
	hideAuthor := a.hideAuthor
	a.themeMu.RUnlock()

	slot := def.ActiveSlot
	if a.phoneBank != nil {
		a.phoneBank.profilesMu.RLock()
		slot = a.phoneBank.activeSlot
		a.phoneBank.profilesMu.RUnlock()
	}

	orDefault := func(v, d int) int {
		if v == 0 {
			return d
		}
		return v
	}

	deadzone := math.Float64frombits(a.gyroDeadzoneBits.Load())
	if a.gyroDeadzoneBits.Load() == 0 {
		deadzone = def.GyroDeadzone
	}
	soundMode := a.soundMode
	if soundMode == "" {
		soundMode = def.SoundMode
	}
	sensitivity := math.Float64frombits(a.gyroSensitivityBits.Load())
	if sensitivity <= 0 {
		sensitivity = def.GyroSensitivity
	}
	vol := int(a.soundVolume.Load())
	if vol < 0 || vol > settings.MaxVolume {
		vol = def.SoundVolume
	}
	closeAction := a.GetCloseAction()

	return AppSettings{
		Theme: theme,
		Accent: func() string {
			if settings.ValidAccent(accent) {
				return accent
			}
			return def.Accent
		}(),
		Lang:                  lang,
		FontScale:             a.GetFontScale(),
		ActiveSlot:            slot,
		FirstLaunchDone:       firstLaunch,
		HideAuthor:            hideAuthor,
		Splash:                a.splash.Load(),
		DebugPanel:            a.debugPanel.Load(),
		DebugLog:              a.debugLogOn.Load(),
		DSUPort:               orDefault(a.dsuPort, def.DSUPort),
		DSUMAC:                a.getDSUMAC(),
		HTTPPort:              orDefault(a.httpPort, def.HTTPPort),
		HTTPSPort:             orDefault(a.httpsPort, def.HTTPSPort),
		GyroDeadzone:          deadzone,
		StillnessHint:         a.stillnessHint.Load(),
		DisconnectAlert:       a.disconnectAlert.Load(),
		SilenceDisconnect:     a.silenceDisconnect.Load(),
		CemuDriftGuard:        a.cemuDriftGuard.Load(),
		CemuNoticeHidden:      a.cemuNotice.hidden.Load(),
		CheckUpdates:          a.update.enabled.Load(),
		SkippedUpdate:         a.update.getSkipped(),
		SoundMode:             soundMode,
		SoundVolume:           vol,
		SoundVolumes:          a.getSoundVolumes(),
		GyroDeadband:          math.Float64frombits(a.gyroDeadbandBits.Load()),
		GyroDeadbandUsb:       math.Float64frombits(a.gyroDeadbandUsbBits.Load()),
		GyroSensitivity:       sensitivity,
		MinimizeToTray:        closeAction == "minimize",
		CloseAction:           closeAction,
		InputMode:             a.GetInputMode(),
	}
}

// saveSettings writes the live settings to settings.json.
func (a *App) saveSettings() {
	if a.profilesDir == "" {
		return
	}
	a.saveMu.Lock()
	defer a.saveMu.Unlock()

	if a.getDSUMAC() == "" {
		a.setDSUMAC(settings.RandomMAC())
	}
	if err := settings.Save(a.profilesDir, a.settingsSnapshot()); err != nil {
		a.logEvent("ERROR", "failed to save settings.json: %v", err)
	}
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
	if !settings.ValidCloseAction(action) {
		action = "ask"
	}
	a.closeActionMu.Lock()
	a.closeAction = action
	a.closeActionMu.Unlock()
}

// ConfirmCloseChoice handles user's decision from the Apple confirmation modal.
func (a *App) ConfirmCloseChoice(action string, remember bool) {
	if remember {
		a.SetCloseAction(action)
		a.saveSettings()
	}
	if action == "minimize" {
		a.hideWindow()
	} else {
		a.QuitApp()
	}
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
	if scale < settings.MinFontScale || scale > settings.MaxFontScale {
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
	if scale < settings.MinFontScale || scale > settings.MaxFontScale {
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

// GetDefaultAppSettings is a first launch's settings: the settings screen marks
// what differs from them and resets to them.
func (a *App) GetDefaultAppSettings() AppSettings { return settings.Defaults() }

// GetSplash reports whether the launch animation plays (settings.json splash).
func (a *App) GetSplash() bool { return a.splash.Load() }

// SetSplash turns the launch animation on or off and saves it.
func (a *App) SetSplash(on bool) {
	if a.splash.Swap(on) != on {
		a.saveSettings()
	}
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
		hPort = settings.DefaultHTTPPort
	}
	hsPort := a.httpsPort
	if hsPort == 0 {
		hsPort = settings.DefaultHTTPSPort
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
	return a.settingsSnapshot()
}

// SaveAppSettings validates, applies and persists settings
func (a *App) SaveAppSettings(s AppSettings) (map[string]any, error) {
	if err := settings.CheckPorts(s.DSUPort, s.HTTPPort, s.HTTPSPort); err != nil {
		return nil, err
	}

	if s.DSUMAC != "" {
		if parsed, err := settings.ParseMAC(s.DSUMAC); err == nil {
			formatted := settings.FormatMAC(parsed)
			a.setDSUMAC(formatted)
			if a.dsuSrv != nil {
				a.dsuSrv.SetMACAddress(parsed)
			}
		}
	}

	// Ports move in place (Rebind): the servers are the same objects, so the
	// frame handler and the UI keep their pointers. Before the network is up
	// (startNetwork) the new ports are simply used when it starts.
	dsuRestarted := false
	if s.DSUPort != a.dsuPort && a.dsuSrv != nil {
		if err := a.dsuSrv.Rebind(s.DSUPort); err != nil {
			return nil, err
		}
		a.dsuPort = s.DSUPort
		dsuRestarted = true
	} else if a.dsuPort == 0 {
		a.dsuPort = s.DSUPort
	}

	if s.HTTPPort != a.httpPort || s.HTTPSPort != a.httpsPort {
		if a.srv != nil {
			if err := a.srv.Rebind(s.HTTPPort, s.HTTPSPort); err != nil {
				return nil, err
			}
		}
		a.httpPort = s.HTTPPort
		a.httpsPort = s.HTTPSPort
		a.rebuildURLsAndQRCodes()
	}

	if s.GyroDeadzone >= 0 {
		a.gyroDeadzoneBits.Store(math.Float64bits(s.GyroDeadzone))
	}
	if settings.ValidAccent(s.Accent) {
		a.themeMu.Lock()
		a.accent = s.Accent
		a.themeMu.Unlock()
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

	a.splash.Store(s.Splash)
	a.debugPanel.Store(s.DebugPanel)
	if !a.debugLogOn.Swap(s.DebugLog) && s.DebugLog {
		a.logEvent("INFO", "debug log on: logs/debug.log")
	} else if !s.DebugLog {
		a.closeDebugLog()
	}
	a.syncDebug()
	a.stillnessHint.Store(s.StillnessHint)
	a.disconnectAlert.Store(s.DisconnectAlert)
	a.silenceDisconnect.Store(s.SilenceDisconnect)
	a.cemuDriftGuard.Store(s.CemuDriftGuard)
	// CemuNoticeHidden is not a settings-window field: only the notice's own
	// "don't show again" changes it (CloseCemuNotice). Same for SkippedUpdate.
	if a.update.enabled.Swap(s.CheckUpdates) != s.CheckUpdates {
		a.update.wake() // switched on: check now; switched off: show "off"
	}
	a.dsuClientViews() // turns the guard on or off for the Cemu clients now
	if s.CloseAction != "" {
		a.SetCloseAction(s.CloseAction)
	}
	if s.SoundVolume >= 0 && s.SoundVolume <= settings.MaxVolume {
		a.soundVolume.Store(int32(s.SoundVolume))
	}
	if s.SoundVolumes != nil {
		a.setSoundVolumes(s.SoundVolumes)
	}
	if s.SoundMode != "" {
		a.soundMode = s.SoundMode
	}
	if s.FontScale >= settings.MinFontScale && s.FontScale <= settings.MaxFontScale {
		a.fontScaleBits.Store(math.Float64bits(s.FontScale))
	} else if s.FontScale == 0 {
		a.fontScaleBits.Store(math.Float64bits(1.00))
	}

	// Note: Theme and Lang are controlled authoritatively via SetTheme and SetLang (header).
	// We do not overwrite them here with potentially stale frontend snapshots.

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
	macStr := settings.FormatMAC(newMAC)
	a.setDSUMAC(macStr)
	if a.dsuSrv != nil {
		a.dsuSrv.SetMACAddress(newMAC)
	}
	a.saveSettings()
	return macStr
}

// GetDataDir is the folder that holds everything PhoneGyro keeps: settings,
// profiles (phone and usb\), the certificate authority (ca\), logs and the
// WebView2 data. Shown in Settings; deleting it resets the app completely.
func (a *App) GetDataDir() string {
	return a.profilesDir
}

// OpenDataDir opens the data folder in Explorer.
func (a *App) OpenDataDir() string {
	if a.profilesDir == "" {
		return "no folder"
	}
	if err := os.MkdirAll(a.profilesDir, 0755); err != nil {
		return err.Error()
	}
	if err := exec.Command("explorer.exe", a.profilesDir).Start(); err != nil {
		return err.Error()
	}
	return "ok"
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
