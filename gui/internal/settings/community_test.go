package settings

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"phonegyro-gui/internal/community"
)

func writeSettings(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, FileName), []byte(body), 0644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestCommunityRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := Defaults()
	s.DSUMAC = RandomMAC()
	s.Community = community.State{GoodSessions: 4, ShownCount: 1, LastShown: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC), Done: true}
	if err := Save(dir, s); err != nil {
		t.Fatal(err)
	}
	got, found := Load(dir)
	if !found || got.Community != s.Community {
		t.Fatalf("community after save+load: %+v (found %v), want %+v", got.Community, found, s.Community)
	}
}

func TestCommunityMissingInOldFile(t *testing.T) {
	dir := writeSettings(t, `{"theme":"light","dsuPort":26761}`)
	s, found := Load(dir)
	if !found || s.Theme != "light" || s.DSUPort != 26761 {
		t.Fatalf("old file not read: found %v, %+v", found, s)
	}
	if s.Community != (community.State{}) {
		t.Fatalf("old file: community %+v, want zero", s.Community)
	}
}

// A damaged "community" block must never cost the rest of settings.json, and a
// damaged field must not cost the others: above all "done".
func TestCommunityDamagedBlock(t *testing.T) {
	for name, block := range map[string]string{
		"not an object": `"oops"`,
		"null":          `null`,
		"array":         `[1,2]`,
	} {
		dir := writeSettings(t, `{"theme":"light","dsuPort":26761,"community":`+block+`}`)
		s, found := Load(dir)
		if !found || s.Theme != "light" || s.DSUPort != 26761 {
			t.Errorf("%s: the rest of the file was lost: found %v, %+v", name, found, s)
		}
		if s.Community != (community.State{}) {
			t.Errorf("%s: community %+v, want zero", name, s.Community)
		}
	}

	dir := writeSettings(t, `{"theme":"light","community":{"goodSessions":"many","shownCount":-3,"lastShown":"yesterday","done":true}}`)
	s, _ := Load(dir)
	want := community.State{Done: true}
	if s.Theme != "light" || s.Community != want {
		t.Fatalf("damaged fields: theme %q community %+v, want %+v", s.Theme, s.Community, want)
	}

	dir = writeSettings(t, `{"community":{"goodSessions":7,"shownCount":1,"lastShown":"2026-10-01T12:00:00Z","done":false}}`)
	s, _ = Load(dir)
	if s.Community.GoodSessions != 7 || s.Community.ShownCount != 1 || s.Community.Done || s.Community.LastShown.IsZero() {
		t.Fatalf("valid block: %+v", s.Community)
	}
}

func TestCommunityDefaultIsZero(t *testing.T) {
	if Defaults().Community != (community.State{}) {
		t.Fatalf("Defaults().Community = %+v", Defaults().Community)
	}
}
