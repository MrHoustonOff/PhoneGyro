package app

import (
	"os"
	"path/filepath"
	"testing"
)

// TestDeadbandPerSource: the phone and the USB controller have their own tremor
// thresholds; settings saved before the split (one threshold, tuned for phones)
// keep it for the phone and start USB from its own default.
func TestDeadbandPerSource(t *testing.T) {
	root := t.TempDir()
	legacy := `{"gyroDeadband": 0.2, "gyroDeadzone": 0.2}`
	if err := os.WriteFile(filepath.Join(root, "settings.json"), []byte(legacy), 0644); err != nil {
		t.Fatal(err)
	}
	app := NewApp()
	app.profilesDir = root
	app.loadSettings()
	if got := app.deadbandFor(app.phoneBank); got != 0.2 {
		t.Fatalf("phone threshold %g, want the saved 0.2", got)
	}
	if got := app.deadbandFor(app.usbBank); got != defaultDeadbandUSB {
		t.Fatalf("USB threshold %g, want its default %g", got, defaultDeadbandUSB)
	}
	app.SetTuningFilterParams(0, 0.75, 1)
	if app.deadbandFor(app.phoneBank) != 0 || app.deadbandFor(app.usbBank) != 0.75 {
		t.Fatalf("live update: phone %g, usb %g", app.deadbandFor(app.phoneBank), app.deadbandFor(app.usbBank))
	}
}
