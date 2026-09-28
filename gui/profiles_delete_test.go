package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestDeleteProfile: deleting frees the slot on disk, and deleting the active
// profile hands over to the next saved one, then to none.
func TestDeleteProfile(t *testing.T) {
	root := t.TempDir()
	app := &App{profilesDir: root, inputMode: "usb"}
	app.bank("phone") // saveProfiles also writes settings, which reads the phone bank
	bank := app.bank("usb")
	up, pitch := simulateMount(rotAxis([3]float64{0, 0, 1}, 8), 0)
	m := ComputeMountCorrection(up, pitch)
	bank.profilesMu.Lock()
	bank.profiles[1] = Profile{Slot: 1, Name: "A", Device: "Nano", Icon: "gamepad", Matrix: DefaultMatrix3x3(), Mount: &m, Active: true}
	bank.profiles[4] = Profile{Slot: 4, Name: "B", Device: "Nano", Icon: "gamepad", Matrix: DefaultMatrix3x3()}
	bank.activeSlot = 1
	bank.profilesMu.Unlock()
	app.applyProfileMount(bank, 1)

	if res := app.DeleteProfile(2); res == "ok" {
		t.Fatal("deleting an empty slot must fail")
	}
	if res := app.DeleteProfile(1); res != "ok" {
		t.Fatalf("delete active: %q", res)
	}
	if bank.activeSlot != 4 {
		t.Fatalf("active slot after deleting the active profile = %d, want 4", bank.activeSlot)
	}
	if bank.activeMount(false).Active() {
		t.Fatal("deleted profile's mount correction still live")
	}
	var saved struct{ Profiles []Profile }
	data, err := os.ReadFile(filepath.Join(root, "usb", "profiles.json"))
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(data, &saved)
	if p := saved.Profiles[1]; p.Name != "" || p.Mount != nil || p.Slot != 1 {
		t.Fatalf("slot 1 not freed on disk: %+v", p)
	}

	if res := app.DeleteProfile(4); res != "ok" {
		t.Fatalf("delete last: %q", res)
	}
	if bank.activeSlot != -1 {
		t.Fatalf("active slot after deleting every profile = %d, want -1", bank.activeSlot)
	}
}
