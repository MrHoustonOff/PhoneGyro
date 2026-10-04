package app

import (
	"fmt"
	"os"
	"testing"
)

// TestMain points %APPDATA% at a throwaway folder for the whole package: NewApp()
// reads settings and profiles from it and writes its start-up line to
// logs/phonegyro.log, so without this every `go test` appended a dozen
// "PhoneGyro initialized" lines to the real log of the developer's machine
// (and read its real settings).
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "phonegyro-appdata-*")
	if err != nil {
		fmt.Fprintln(os.Stderr, "tests: no temp folder:", err)
		os.Exit(1)
	}
	os.Setenv("APPDATA", dir)
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}
