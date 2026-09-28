package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestSetProfileMountEnabled: the profile switch turns the live mount correction
// off and back on and persists the choice in profiles.json.
func TestSetProfileMountEnabled(t *testing.T) {
	root := t.TempDir()
	app := &App{profilesDir: root, inputMode: "usb"}
	app.bank("phone") // saveProfiles also writes settings, which reads the phone bank
	bank := app.bank("usb")
	up, pitch := simulateMount(rotAxis([3]float64{0, 0, 1}, 8), 0)
	m := ComputeMountCorrection(up, pitch)
	if !m.Active() {
		t.Fatalf("precondition: mount correction should be ok, got %s", m.Status)
	}
	bank.profilesMu.Lock()
	bank.profiles[0] = Profile{Slot: 0, Name: "USB", Mount: &m, Active: true}
	bank.activeSlot = 0
	bank.profilesMu.Unlock()
	app.applyProfileMount(bank, 0)

	if res := app.SetProfileMountEnabled(0, false); res != "ok" {
		t.Fatalf("disable: %q", res)
	}
	if bank.activeMount(false).Active() {
		t.Fatal("live correction still active after switching it off")
	}
	var saved struct{ Profiles []Profile }
	data, err := os.ReadFile(filepath.Join(root, "usb", "profiles.json"))
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(data, &saved)
	if saved.Profiles[0].Mount == nil || saved.Profiles[0].Mount.Enabled {
		t.Fatalf("switch not persisted: %+v", saved.Profiles[0].Mount)
	}
	if res := app.SetProfileMountEnabled(0, true); res != "ok" || !bank.activeMount(false).Active() {
		t.Fatalf("re-enable: %q, active=%v", res, bank.activeMount(false).Active())
	}
	// A profile without a verified correction cannot be switched.
	if res := app.SetProfileMountEnabled(1, true); res == "ok" {
		t.Fatal("switching a profile without mount correction must fail")
	}
}
