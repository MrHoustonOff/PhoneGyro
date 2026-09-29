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

func TestCloseWindow(t *testing.T) {
	a := &App{}
	a.SetCloseAction("minimize")
	a.CloseWindow()
	if !a.uiHidden.Load() {
		t.Fatal("CloseWindow with minimize did not mark uiHidden")
	}

	a2 := &App{}
	a2.SetCloseAction("quit")
	a2.CloseWindow()
	if !a2.quitting.Load() {
		t.Fatal("CloseWindow with quit did not mark quitting")
	}

	a3 := &App{}
	a3.SetCloseAction("ask")
	a3.CloseWindow()
	if !a3.quitting.Load() {
		t.Fatal("CloseWindow with ask did not fall back to quit")
	}
}
