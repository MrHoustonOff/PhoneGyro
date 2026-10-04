package winstate

import "testing"

func TestSaveLoad(t *testing.T) {
	dir := t.TempDir()
	if _, ok := Load(dir); ok {
		t.Fatal("empty dir must not load")
	}
	want := State{Left: 10, Top: 20, Right: 1290, Bottom: 740, Maximised: true}
	if err := Save(dir, want); err != nil {
		t.Fatal(err)
	}
	got, ok := Load(dir)
	if !ok || got != want {
		t.Fatalf("got %+v ok=%v, want %+v", got, ok, want)
	}
}

func TestLoadRejectsEmptyRect(t *testing.T) {
	dir := t.TempDir()
	_ = Save(dir, State{})
	if _, ok := Load(dir); ok {
		t.Fatal("zero-size rectangle must not load")
	}
}

func TestSnapRoundsDown(t *testing.T) {
	for in, want := range map[float64]float64{1: 1, 0.95: 0.9, 0.74: 0.7, 0.3: 0.5, 2: 1} {
		if got := Snap(in); got != want {
			t.Errorf("Snap(%v) = %v, want %v", in, got, want)
		}
	}
}
