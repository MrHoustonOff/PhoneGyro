package app

import "testing"

// TestHiddenWindowPausesUIStreams: hiding to the tray marks the UI hidden (state
// and orientation events pause), showing the window clears it again.
func TestHiddenWindowPausesUIStreams(t *testing.T) {
	a := &App{}
	a.hideWindow()
	if !a.uiHidden.Load() {
		t.Fatal("hidden window not marked")
	}
	a.emitStateChange() // no window context: must not panic
	a.ShowWindow()
	if a.uiHidden.Load() {
		t.Fatal("shown window still marked hidden")
	}
}
