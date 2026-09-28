package main

import (
	"testing"

	"phonegyro/pkg/dsu"
)

func cemuView(addr, process string) DSUClientView {
	return DSUClientView{ClientInfo: dsu.ClientInfo{Address: addr}, Process: process}
}

// TestCemuNotice: shown once per Cemu instance (again when it comes back),
// never for other emulators, never after "don't show again".
func TestCemuNotice(t *testing.T) {
	app := NewApp()
	app.profilesDir = t.TempDir()
	app.cemuNotice.hidden.Store(false)

	app.announceCemuClients([]DSUClientView{cemuView("127.0.0.1:1", "PadTest")})
	if app.PendingCemuNotice() != nil {
		t.Fatal("notice for a client that is not Cemu")
	}

	cemu := cemuView("127.0.0.1:2", "Cemu")
	app.announceCemuClients([]DSUClientView{cemu})
	if app.PendingCemuNotice() == nil {
		t.Fatal("no notice when Cemu subscribed")
	}
	app.CloseCemuNotice(false)
	app.announceCemuClients([]DSUClientView{cemu}) // the same instance, next update
	if app.PendingCemuNotice() != nil {
		t.Fatal("the same Cemu instance was announced twice")
	}

	app.announceCemuClients(nil) // Cemu closed
	app.announceCemuClients([]DSUClientView{cemuView("127.0.0.1:3", "Cemu")})
	if app.PendingCemuNotice() == nil {
		t.Fatal("no notice when Cemu came back")
	}

	app.CloseCemuNotice(true)
	if !app.cemuNotice.hidden.Load() {
		t.Fatal("\"don't show again\" was not kept")
	}
	app.announceCemuClients([]DSUClientView{cemuView("127.0.0.1:4", "Cemu")})
	if app.PendingCemuNotice() != nil {
		t.Fatal("notice shown after \"don't show again\"")
	}

	// The choice survives a restart.
	again := NewApp()
	again.profilesDir = app.profilesDir
	again.loadSettings()
	if !again.cemuNotice.hidden.Load() {
		t.Fatal("\"don't show again\" was not saved")
	}
}
