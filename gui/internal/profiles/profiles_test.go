package profiles

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"phonegyro-gui/internal/motion"
)

func write(t *testing.T, json string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, FileName), []byte(json), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestLoadNothingUsable(t *testing.T) {
	if _, ok := Load(t.TempDir()); ok {
		t.Fatal("no file: ok")
	}
	if _, ok := Load(write(t, "{oops")); ok {
		t.Fatal("not JSON: ok")
	}
}

// TestLoadOldSchema: a file older than SchemaVersion gives empty slots, no active
// profile, and nothing else from it.
func TestLoadOldSchema(t *testing.T) {
	f, ok := Load(write(t, `{"schemaVersion":1,"activeSlot":2,"gyroBias":[1,2,3],
		"profiles":[{"name":"old"}]}`))
	if !ok || !f.SchemaReset {
		t.Fatalf("ok=%v reset=%v", ok, f.SchemaReset)
	}
	if f.ActiveSlot != -1 || f.Profiles != EmptySlots() || f.GyroBias != [3]float64{} {
		t.Fatalf("got %+v", f)
	}
}

// TestLoadNormalizes: missing slots are empty, slot numbers and blank fields are
// fixed, a matrix that is not a signed permutation becomes the default, and the
// active slot is marked.
func TestLoadNormalizes(t *testing.T) {
	f, ok := Load(write(t, `{"schemaVersion":2,"activeSlot":1,"calGravity":[0,0,-1],
		"profiles":[
			{"slot":5,"name":"A","matrix":[[2,0,0],[0,2,0],[0,0,2]]},
			{"slot":1,"name":"B","device":"Nano","icon":"gamepad","matrix":[[1,0,0],[0,0,1],[0,1,0]],"version":3}
		]}`))
	if !ok || f.SchemaReset {
		t.Fatalf("ok=%v reset=%v", ok, f.SchemaReset)
	}
	a, b := f.Profiles[0], f.Profiles[1]
	if a.Slot != 0 || a.Device != "Unknown" || a.Icon != "default" || a.Matrix != motion.DefaultMatrix3x3() || a.Active {
		t.Fatalf("slot 0: %+v", a)
	}
	if b.Device != "Nano" || b.Matrix != [3][3]float64{{1, 0, 0}, {0, 0, 1}, {0, 1, 0}} || !b.Active || b.Outdated() {
		t.Fatalf("slot 1: %+v", b)
	}
	if !a.Outdated() {
		t.Fatal("a named profile without a version is not outdated")
	}
	for i := 2; i < Slots; i++ {
		if f.Profiles[i] != Empty(i) {
			t.Fatalf("slot %d: %+v", i, f.Profiles[i])
		}
	}
	if f.CalGravity != [3]float64{0, 0, -1} {
		t.Fatalf("calGravity %v", f.CalGravity)
	}
}

// TestSaveLoadRoundTrip: what is saved comes back, pointers and all.
func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	f := File{Profiles: EmptySlots(), ActiveSlot: 3, GyroBias: [3]float64{0.1, -0.2, 0.3}}
	frame := motion.IOSSensorFrame()
	mount := motion.MountCorrection{Enabled: true}
	f.Profiles[3] = Profile{Slot: 3, Name: "USB", Device: "Nano", Icon: "gamepad",
		Matrix: [3][3]float64{{1, 0, 0}, {0, 0, 1}, {0, 1, 0}}, CalGravity: [3]float64{0, 0, 1},
		SensorFrame: &frame, Mount: &mount, Active: true, Version: CurrentVersion}
	if err := Save(dir, f); err != nil {
		t.Fatal(err)
	}
	got, ok := Load(dir)
	f.SchemaVersion = SchemaVersion
	if !ok || !reflect.DeepEqual(got, f) {
		t.Fatalf("round trip:\n got %+v\nwant %+v", got, f)
	}
}

func TestCheckMatrix(t *testing.T) {
	if err := CheckMatrix([3][3]float64{{1, 0, 0}, {0, 0, 1}, {0, 1, 0}}); err != nil {
		t.Fatal(err)
	}
	if CheckMatrix(motion.Identity3()) == nil {
		t.Fatal("det +1 accepted")
	}
}
