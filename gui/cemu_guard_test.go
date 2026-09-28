package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestCemuDriftGuardSetting: the guard is on by default, also for a
// settings.json written before the setting existed, and an explicit off stays off.
func TestCemuDriftGuardSetting(t *testing.T) {
	for _, tc := range []struct {
		json string
		want bool
	}{
		{`{}`, true},
		{`{"cemuDriftGuard": true}`, true},
		{`{"cemuDriftGuard": false}`, false},
	} {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(tc.json), 0o644); err != nil {
			t.Fatal(err)
		}
		app := NewApp()
		app.profilesDir = dir
		app.cemuDriftGuard.Store(!tc.want)
		app.loadSettings()
		if got := app.cemuDriftGuard.Load(); got != tc.want {
			t.Fatalf("%s: guard %v, want %v", tc.json, got, tc.want)
		}
		if got := app.GetAppSettings().CemuDriftGuard; got != tc.want {
			t.Fatalf("%s: GetAppSettings says %v, want %v", tc.json, got, tc.want)
		}
	}
}
