package app

import (
	"net"
	"testing"
	"time"

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

// TestCemuNoticeNotAgainAfterReconnect: a Cemu the user disconnected and brought
// back (DisconnectDSUClient / ReconnectDSUClient) is the same instance -- no new
// notice.
func TestCemuNoticeNotAgainAfterReconnect(t *testing.T) {
	app := NewApp()
	app.profilesDir = t.TempDir()
	app.cemuNotice.hidden.Store(false)
	free, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	port := free.LocalAddr().(*net.UDPAddr).Port
	free.Close()
	app.dsuSrv = dsu.NewServer(port)
	if err := app.dsuSrv.Start(); err != nil {
		t.Fatal(err)
	}
	defer app.dsuSrv.Stop()

	// A real client, so the server can kick it; it is named "Cemu" by hand.
	conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = conn.Write(dsuPadDataRequest())
	time.Sleep(50 * time.Millisecond)
	cemu := cemuView(conn.LocalAddr().String(), "Cemu")

	app.announceCemuClients([]DSUClientView{cemu})
	app.CloseCemuNotice(false)

	if !app.dsuSrv.Kick(cemu.Address) {
		t.Fatal("Kick did not find the client")
	}
	app.announceCemuClients(nil) // disconnected: gone from the live list
	if !app.dsuSrv.Readmit(cemu.Address) {
		t.Fatal("Readmit did not find the client")
	}
	app.announceCemuClients([]DSUClientView{cemu})
	if app.PendingCemuNotice() != nil {
		t.Fatal("the notice came again for a Cemu that was only disconnected and brought back")
	}
}
