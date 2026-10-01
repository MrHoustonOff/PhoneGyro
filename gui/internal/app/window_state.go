package app

import (
	"math"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"phonegyro-gui/internal/winstate"
)

// prepareWindow decides, before the window exists, how it opens. The saved
// placement (position, size, maximised) is restored only if it still fits the
// monitors; the UI scale belongs to it and is kept then. Otherwise the window
// opens at the default size, centred, with the default scale (100 %, or smaller
// when the screen cannot hold 1280×720), and the saved scale is dropped.
func (a *App) prepareWindow() {
	if st, ok := winstate.Load(a.profilesDir); ok && st.Usable() {
		a.winRestore = &st
		return
	}
	a.fontScaleBits.Store(math.Float64bits(winstate.FitZoom()))
	a.saveSettings()
}

// windowReady runs when the page is up: puts the window where it belongs.
func (a *App) windowReady() {
	a.winHwnd = winstate.FindMain()
	if a.winRestore != nil && a.winHwnd != 0 {
		winstate.Apply(a.winHwnd, *a.winRestore)
		return
	}
	if a.ctx != nil {
		wailsRuntime.WindowCenter(a.ctx)
	}
}

// saveWindow remembers the window's placement for the next launch. Called when
// the window closes, hides or the app quits (the handle is still valid then).
func (a *App) saveWindow() {
	if a.profilesDir == "" || a.winHwnd == 0 {
		return
	}
	if st, ok := winstate.Capture(a.winHwnd); ok {
		_ = winstate.Save(a.profilesDir, st)
	}
}
