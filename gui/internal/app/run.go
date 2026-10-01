package app

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// assets is the UI (frontend/src under its own path), set by Run.
var assets fs.FS

// Run starts PhoneGyro: the main window, or the Live Debug window when started
// with --livedebug. frontend holds frontend/src (embedded by package main).
func Run(frontend fs.FS) {
	assets = frontend

	startProfilerIfAsked()
	for _, arg := range os.Args[1:] {
		if arg == "--livedebug" {
			runLiveDebug()
			return
		}
		if arg == "--debugwin" {
			runDebugWindow()
			return
		}
	}

	app := NewApp()
	// Debug window / log on: up before the window, servers and DSU, so the
	// start itself is recorded (debughub.go).
	if app.debugPanel.Load() || app.debugLogOn.Load() {
		app.startDebugHub()
	}
	debugApp := NewLiveDebugApp()
	app.prepareWindow()

	bgR, bgG, bgB := uint8(0xf1), uint8(0xf1), uint8(0xf1)
	if app.GetTheme() == "dark" {
		bgR, bgG, bgB = 0x0b, 0x0b, 0x0b
	}

	err := wails.Run(&options.App{
		Title:     "PhoneGyro",
		Width:     1280,
		Height:    720,
		MinWidth:  960,
		MinHeight: 540,
		// The UI draws its own title bar (frontend: .titlebar); Windows keeps the
		// shadow, rounded corners, snapping and edge resizing.
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: app.startup,
		OnDomReady: func(ctx context.Context) {
			app.windowReady()
			app.hubPhase("window DOM ready")
		},
		OnShutdown: app.shutdown,
		OnBeforeClose: func(ctx context.Context) (prevent bool) {
			return app.requestClose()
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "phonegyro-desktop-lock-uuid",
			OnSecondInstanceLaunch: func(secondInstanceData options.SecondInstanceData) {
				app.ShowWindow()
			},
		},
		Bind: []interface{}{
			app,
			debugApp,
		},
		EnableDefaultContextMenu: true,
		Debug: options.Debug{
			OpenInspectorOnStartup: false,
		},
		// The page's own --bg: no white or black flash before the first frame.
		BackgroundColour: &options.RGBA{R: bgR, G: bgG, B: bgB, A: 0xff},
		Windows: &windows.Options{
			WebviewUserDataPath:  filepath.Join(os.Getenv("APPDATA"), "PhoneGyro", "WebView2_Main"),
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			// The UI scales itself (design system: 50-300 %, Ctrl +/-/0);
			// WebView2's own Ctrl+wheel zoom would fight it.
			IsZoomControlEnabled: false,
			ZoomFactor:           1.0,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
