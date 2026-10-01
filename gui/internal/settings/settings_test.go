package settings

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func write(t *testing.T, json string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, FileName), []byte(json), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestLoadFirstLaunch: no file (or not JSON) is the defaults with a fresh MAC.
func TestLoadFirstLaunch(t *testing.T) {
	for name, dir := range map[string]string{
		"no file":  t.TempDir(),
		"not JSON": write(t, "{oops"),
	} {
		s, found := Load(dir)
		if found {
			t.Fatalf("%s: found", name)
		}
		if _, err := ParseMAC(s.DSUMAC); err != nil {
			t.Fatalf("%s: MAC %q: %v", name, s.DSUMAC, err)
		}
		want := Defaults()
		want.DSUMAC = s.DSUMAC
		if !reflect.DeepEqual(s, want) {
			t.Fatalf("%s: got %+v, want defaults", name, s)
		}
	}
}

// TestLoadMissingFieldsKeepDefaults: a file from before a setting existed gets
// that setting's default, not a zero value.
func TestLoadMissingFieldsKeepDefaults(t *testing.T) {
	s, found := Load(write(t, `{}`))
	if !found {
		t.Fatal("not found")
	}
	d := Defaults()
	if !s.CemuDriftGuard || !s.SilenceDisconnect || !s.StillnessHint || !s.DisconnectAlert {
		t.Fatalf("on-by-default switches came back off: %+v", s)
	}
	if s.GyroDeadband != d.GyroDeadband || s.GyroDeadbandUsb != d.GyroDeadbandUsb || s.GyroSensitivity != 1 {
		t.Fatalf("filter defaults: %+v", s)
	}
	if s.CloseAction != "ask" || s.MinimizeToTray || s.InputMode != "phone" {
		t.Fatalf("window/input defaults: %+v", s)
	}
	// As always: a missing activeSlot reads as slot 0 (profiles.json has the
	// real active slot and is loaded after the settings).
	if s.ActiveSlot != 0 {
		t.Fatalf("activeSlot of a file without the field: got %d, want 0", s.ActiveSlot)
	}
	if s.SoundVolumes["intro"] != 1 {
		t.Fatalf("intro default: got %d, want 1", s.SoundVolumes["intro"])
	}
}

// TestLoadLegacyDeadband: before the per-source split there was one threshold
// (tuned for phones, once named gyroDeadzone): the phone keeps it, USB starts
// from its own default.
func TestLoadLegacyDeadband(t *testing.T) {
	s, _ := Load(write(t, `{"gyroDeadzone": 0.3}`))
	if s.GyroDeadband != 0.3 || s.GyroDeadzone != 0.3 {
		t.Fatalf("phone threshold %g (deadzone %g), want 0.3", s.GyroDeadband, s.GyroDeadzone)
	}
	if s.GyroDeadbandUsb != DefaultDeadbandUSB {
		t.Fatalf("USB threshold %g, want its default", s.GyroDeadbandUsb)
	}
	s, _ = Load(write(t, `{"gyroDeadband": 0, "gyroDeadzone": 0.3}`))
	if s.GyroDeadband != 0 {
		t.Fatalf("an explicit 0 threshold became %g", s.GyroDeadband)
	}
}

// TestLoadInvalidValues: values the app cannot use fall back to their defaults.
func TestLoadInvalidValues(t *testing.T) {
	s, _ := Load(write(t, `{"theme":"pink","lang":"de","dsuPort":80,"httpPort":70000,
		"dsuMac":"nope","fontScale":5,"soundVolume":9,"gyroSensitivity":-1,
		"closeAction":"explode","activeSlot":7,"inputMode":"bluetooth",
		"soundVolumes":{"connect":9,"dsu":-2,"intro":7,"unknown":1}}`))
	d := Defaults()
	if s.Theme != d.Theme || s.Lang != d.Lang || s.DSUPort != d.DSUPort || s.HTTPPort != d.HTTPPort {
		t.Fatalf("theme/lang/ports: %+v", s)
	}
	if _, err := ParseMAC(s.DSUMAC); err != nil {
		t.Fatalf("invalid MAC kept: %q", s.DSUMAC)
	}
	if s.FontScale != 1 || s.SoundVolume != 1 || s.GyroSensitivity != 1 || s.CloseAction != "ask" || s.ActiveSlot != -1 || s.InputMode != "phone" {
		t.Fatalf("clamped values: %+v", s)
	}
	if s.SoundVolumes["connect"] != MaxVolume || s.SoundVolumes["dsu"] != 0 || s.SoundVolumes["goal"] != 1 || s.SoundVolumes["intro"] != MaxVolume {
		t.Fatalf("volumes: %+v", s.SoundVolumes)
	}
	sLow, _ := Load(write(t, `{"soundVolumes":{"intro":-5}}`))
	if sLow.SoundVolumes["intro"] != 0 {
		t.Fatalf("intro lower bound: got %d, want 0", sLow.SoundVolumes["intro"])
	}
	if _, ok := s.SoundVolumes["unknown"]; ok {
		t.Fatal("unknown sound kept")
	}
}

// TestSaveLoadRoundTrip: what is saved comes back unchanged.
func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := Defaults()
	s.DSUMAC = "AA:BB:CC:DD:EE:01"
	s.Theme, s.Lang, s.FontScale, s.ActiveSlot = "light", "en", 1.2, 3
	s.DSUPort, s.HTTPPort, s.HTTPSPort = 26761, 8081, 8444
	s.CemuDriftGuard, s.CemuNoticeHidden, s.SilenceDisconnect = false, true, false
	s.GyroDeadband, s.GyroDeadbandUsb, s.GyroSensitivity = 0, 0.75, 1.5
	s.CloseAction, s.MinimizeToTray = "minimize", true
	s.InputMode = "usb"
	s.SoundVolumes["dsu"] = 3
	if err := Save(dir, s); err != nil {
		t.Fatal(err)
	}
	got, found := Load(dir)
	if !found || !reflect.DeepEqual(got, s) {
		t.Fatalf("round trip:\n got %+v\nwant %+v", got, s)
	}
}

func TestCheckPorts(t *testing.T) {
	if err := CheckPorts(26760, 8080, 8443); err != nil {
		t.Fatal(err)
	}
	for _, p := range [][3]int{{80, 8080, 8443}, {26760, 8080, 8080}, {26760, 26760, 8443}, {26760, 8080, 70000}} {
		if CheckPorts(p[0], p[1], p[2]) == nil {
			t.Fatalf("%v accepted", p)
		}
	}
}
