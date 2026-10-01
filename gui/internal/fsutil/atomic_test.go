package fsutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteFileAtomic(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.json")
	for _, s := range []string{"first", "second, longer"} {
		if err := WriteFileAtomic(p, []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
		if b, _ := os.ReadFile(p); string(b) != s {
			t.Fatalf("got %q, want %q", b, s)
		}
	}
	if es, _ := os.ReadDir(dir); len(es) != 1 {
		t.Fatalf("temporary files left: %v", es)
	}
}
