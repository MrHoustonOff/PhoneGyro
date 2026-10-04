package app

import (
	"os"
	"path/filepath"
	"phonegyro-gui/internal/motion"
	"phonegyro-gui/internal/settings"
	"testing"
	"time"
)

func TestProfileSlots6_And_SettingsPersistence(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "phonegyro-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	app := NewApp()
	app.profilesDir = tempDir
	// NewApp() already read the real machine's %APPDATA%\phonegyro\settings.json
	// (this test's tempDir override happens after construction), so input
	// mode/firstLaunchDone/hideAuthor could all be left over from a real
	// session on this dev machine. Reset them explicitly so this test is
	// hermetic regardless of ambient machine state.
	app.firstLaunchDone = false
	app.hideAuthor = false
	app.SetInputMode("phone") // may persist settings.json into tempDir; reset fields above first
	app.loadSettings()
	app.loadProfiles()

	// Verify initial 6 slots
	profs := app.GetProfiles()
	if len(profs) != 6 {
		t.Fatalf("expected 6 profile slots, got %d", len(profs))
	}

	// Test saving to slot 5 (6th slot)
	mat := motion.DefaultMatrix3x3()
	res := app.SaveProfile(5, "Slot Six Custom", "iPhone 15 Pro", "vertical", mat)
	if res != "ok" {
		t.Fatalf("failed to save slot 5: %s", res)
	}

	// Verify out-of-bounds rejected
	resInvalid := app.SaveProfile(6, "Invalid", "iPhone", "vertical", mat)
	if resInvalid != "invalid slot" {
		t.Fatalf("expected invalid slot for slot 6, got %s", resInvalid)
	}

	// Verify slot 5 in GetProfiles
	profs = app.GetProfiles()
	if profs[5].Name != "Slot Six Custom" {
		t.Fatalf("expected slot 5 name 'Slot Six Custom', got '%s'", profs[5].Name)
	}
	if age := time.Now().Unix() - profs[5].CalibratedAt; age < 0 || age > 60 || profs[5].CalibratedWith == "" {
		t.Fatalf("saved profile's calibration stamp: at %d (%ds ago), with %q", profs[5].CalibratedAt, age, profs[5].CalibratedWith)
	}

	// Test SetActiveProfile to 5
	resActive := app.SetActiveProfile(5)
	if resActive != "ok" {
		t.Fatalf("failed to set active profile to 5: %s", resActive)
	}
	if app.phoneBank.activeSlot != 5 {
		t.Fatalf("expected activeSlot 5, got %d", app.phoneBank.activeSlot)
	}

	// Test settings persistence
	app.SetTheme("light")
	app.SetLang("en")

	// Test first-launch behavior
	if !app.IsFirstLaunch() {
		t.Fatalf("expected IsFirstLaunch to be true initially")
	}
	app.MarkFirstLaunchDone()
	if app.IsFirstLaunch() {
		t.Fatalf("expected IsFirstLaunch to be false after MarkFirstLaunchDone")
	}

	// Test hideAuthor behavior
	if app.GetHideAuthor() {
		t.Fatalf("expected hideAuthor to default to false")
	}
	app.SetHideAuthor(true)
	if !app.GetHideAuthor() {
		t.Fatalf("expected hideAuthor to be true after SetHideAuthor(true)")
	}

	settingsPath := filepath.Join(tempDir, "settings.json")
	if _, err := os.Stat(settingsPath); os.IsNotExist(err) {
		t.Fatalf("settings.json was not created at %s", settingsPath)
	}

	// Test reload settings
	appReload := NewApp()
	appReload.profilesDir = tempDir
	appReload.loadSettings()
	if appReload.IsFirstLaunch() {
		t.Fatalf("expected reloaded app to have firstLaunchDone = true")
	}
	if !appReload.GetHideAuthor() {
		t.Fatalf("expected reloaded app to have hideAuthor = true")
	}
	if appReload.GetLang() != "en" {
		t.Fatalf("expected reloaded app to have lang = en, got %s", appReload.GetLang())
	}

	// Test sound volumes persistence
	defs := settings.DefaultSoundVolumes()
	if defs["connect"] != 1 || defs["dsu"] != 1 || defs["recenter"] != 1 {
		t.Fatalf("expected default sound volumes of 1, got %+v", defs)
	}
	customVols := map[string]int{
		"connect":    2,
		"disconnect": 1,
		"dsu":        3,
		"recenter":   0,
		"goal":       1,
		"defeat":     2,
	}
	app.setSoundVolumes(customVols)
	app.saveSettings()

	// Test logs persistence
	app.logEvent("TEST", "Test log message")
	logPath := filepath.Join(tempDir, "logs", "phonegyro.log")
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		t.Fatalf("phonegyro.log was not created at %s", logPath)
	}

	// Verify sound volumes reloaded
	appReload.loadSettings()
	reloadedVols := appReload.getSoundVolumes()
	if reloadedVols["dsu"] != 3 || reloadedVols["recenter"] != 0 || reloadedVols["connect"] != 2 {
		t.Fatalf("expected reloaded sound volumes to match, got %+v", reloadedVols)
	}
}

func TestSaveAppSettings_DoesNotOverwriteThemeAndLang(t *testing.T) {
	tempDir := t.TempDir()
	app := NewApp()
	app.profilesDir = tempDir
	app.loadSettings()

	// User configures Light theme and English language in the header
	app.SetTheme("light")
	app.SetLang("en")

	if app.GetTheme() != "light" || app.GetLang() != "en" {
		t.Fatalf("expected theme=light, lang=en; got theme=%s, lang=%s", app.GetTheme(), app.GetLang())
	}

	// Frontend settings screen submits a snapshot with stale dark/ru defaults while tuning sensitivity
	snapshot := app.settingsSnapshot()
	snapshot.Theme = "dark" // stale
	snapshot.Lang = "ru"   // stale
	snapshot.GyroSensitivity = 1.85

	if _, err := app.SaveAppSettings(snapshot); err != nil {
		t.Fatalf("SaveAppSettings failed: %v", err)
	}

	// In-memory theme and lang must remain what user explicitly set
	if app.GetTheme() != "light" || app.GetLang() != "en" {
		t.Fatalf("SaveAppSettings overwrote theme/lang: theme=%s, lang=%s", app.GetTheme(), app.GetLang())
	}

	// Persisted file on restart must also retain light/en
	appReload := NewApp()
	appReload.profilesDir = tempDir
	appReload.loadSettings()

	if appReload.GetTheme() != "light" || appReload.GetLang() != "en" {
		t.Fatalf("reloaded settings lost theme/lang: theme=%s, lang=%s", appReload.GetTheme(), appReload.GetLang())
	}
	if appReload.settingsSnapshot().GyroSensitivity != 1.85 {
		t.Fatalf("reloaded settings missed sensitivity: got %v", appReload.settingsSnapshot().GyroSensitivity)
	}
}

