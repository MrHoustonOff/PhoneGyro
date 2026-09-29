package app

import (
	"io/fs"
	"os"
	"strings"
	"testing"
)

// Знаки Эйлеровых углов (вперёд / вправо / по часовой = +) проверяет
// TestEulerSigns в ahrs_euler_test.go -- в кадре кватерниона AHRS из "темы".

func TestLiveDebug_AssetsAndBroadcast(t *testing.T) {
	// Verify the UI contains livedebug.html and required static assets (package
	// main embeds this same directory and hands it to Run).
	assets = os.DirFS("../..")
	subFS, err := fs.Sub(assets, "frontend/src")
	if err != nil {
		t.Fatalf("fs.Sub failed: %v", err)
	}

	htmlData, err := fs.ReadFile(subFS, "livedebug.html")
	if err != nil {
		t.Fatalf("failed to read livedebug.html from embedded FS: %v", err)
	}
	if len(htmlData) == 0 {
		t.Fatal("livedebug.html is empty")
	}

	// Verify crucial elements in livedebug.html
	content := string(htmlData)
	if !strings.Contains(content, "livedebug-canvas") {
		t.Fatal("livedebug.html missing livedebug-canvas")
	}
	if !strings.Contains(content, "eco-toggle") {
		t.Fatal("livedebug.html missing eco-toggle")
	}
	if !strings.Contains(content, "/livedebug/ws") {
		t.Fatal("livedebug.html missing /livedebug/ws endpoint connection")
	}
	if !strings.Contains(content, "model-segmented") {
		t.Fatal("livedebug.html missing model-segmented control")
	}
	if !strings.Contains(content, "btn-recenter") {
		t.Fatal("livedebug.html missing btn-recenter button")
	}

	// Verify broadcast with zero clients does not panic
	app := &App{
		currentTheme: "dark",
		currentLang:  "ru",
	}
	app.broadcastLiveDebug(1, 0, 0, 0)
	app.broadcastLiveDebugJSON(map[string]string{"type": "theme", "theme": "light"})
}

func TestLiveDebug_ThemeAndLangSync(t *testing.T) {
	app := &App{
		currentTheme: "dark",
		currentLang:  "ru",
	}

	if app.GetTheme() != "dark" {
		t.Fatalf("expected initial theme dark, got %s", app.GetTheme())
	}
	if app.GetLang() != "ru" {
		t.Fatalf("expected initial lang ru, got %s", app.GetLang())
	}

	app.SetTheme("light")
	if app.GetTheme() != "light" {
		t.Fatalf("expected theme light after SetTheme, got %s", app.GetTheme())
	}

	app.SetLang("en")
	if app.GetLang() != "en" {
		t.Fatalf("expected lang en after SetLang, got %s", app.GetLang())
	}
}

func TestLiveDebug_AppMethods(t *testing.T) {
	debugApp := NewLiveDebugApp()
	if debugApp == nil {
		t.Fatal("NewLiveDebugApp returned nil")
	}
	// Verify GetDeviceStatus returns without panicking regardless of background server state
	_ = debugApp.GetDeviceStatus()
}
