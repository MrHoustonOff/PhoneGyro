package app

import (
	"math"
	"net/http/httptest"
	"testing"

	"phonegyro/pkg/server"
)

// Знаки Эйлеровых углов (вперёд / вправо / по часовой = +) проверяет
// TestEulerSigns в ahrs_euler_test.go -- в кадре кватерниона AHRS из "темы".

func TestLiveDebug_BroadcastNoClients(t *testing.T) {
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

// The telemetry socket sits on the LAN-facing servers: only this PC and the
// app's own window may open it.
func TestLiveDebug_SocketGuards(t *testing.T) {
	for addr, want := range map[string]bool{
		"127.0.0.1:5000": true, "[::1]:5000": true,
		"192.168.1.20:5000": false, "10.0.0.5:1": false, "garbage": false,
	} {
		if got := loopback(addr); got != want {
			t.Errorf("loopback(%q) = %v, want %v", addr, got, want)
		}
	}
	for origin, want := range map[string]bool{
		"": true, "http://wails.localhost": true, "wails://wails": true,
		"http://localhost:34115": true, "http://127.0.0.1:8080": true,
		"https://evil.example": false, "http://192.168.1.20": false,
	} {
		r := httptest.NewRequest("GET", "/livedebug/ws", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if got := appOrigin(r); got != want {
			t.Errorf("appOrigin(%q) = %v, want %v", origin, got, want)
		}
	}
}

func TestFiniteFrame(t *testing.T) {
	ok := server.MotionFrame{RotX: 1, AccY: -1, Qw: 1}
	if !finiteFrame(ok) {
		t.Fatal("a normal frame was rejected")
	}
	for i, f := range []server.MotionFrame{
		{RotX: float32(math.NaN())}, {AccZ: float32(math.Inf(1))}, {Qw: float32(math.Inf(-1))},
	} {
		if finiteFrame(f) {
			t.Errorf("frame %d with NaN/Inf passed", i)
		}
	}
}
