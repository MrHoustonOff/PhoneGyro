package main

import (
	"encoding/binary"
	"hash/crc32"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"phonegyro/pkg/dsu"
)

// TestNameDSUClients: a loopback client is named after the process that owns its
// UDP port (here: this test binary); a client on another PC keeps just its address.
func TestNameDSUClients(t *testing.T) {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	a := conn.LocalAddr().(*net.UDPAddr)

	views := nameDSUClients([]dsu.ClientInfo{
		{Address: a.String(), IP: "127.0.0.1", Port: a.Port},
		{Address: "192.168.1.50:50000", IP: "192.168.1.50", Port: 50000},
	})
	if views[0].PID != uint32(os.Getpid()) {
		t.Fatalf("PID %d, want this process %d", views[0].PID, os.Getpid())
	}
	if views[0].Process == "" || strings.HasSuffix(strings.ToLower(views[0].Process), ".exe") {
		t.Fatalf("process name %q", views[0].Process)
	}
	if views[1].Process != "" || views[1].PID != 0 {
		t.Fatalf("remote client got a local name: %+v", views[1])
	}
	t.Logf("loopback client -> %q (pid %d)", views[0].Process, views[0].PID)
}

// TestDSUKickedClients: a disconnected local client stays listed (named) while
// its program keeps the port open, comes back with ReconnectDSUClient, and is
// dropped from the list once its port is closed (seen at the next read of the
// port table).
func TestDSUKickedClients(t *testing.T) {
	free, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	port := free.LocalAddr().(*net.UDPAddr).Port
	free.Close()

	app := NewApp()
	app.profilesDir = t.TempDir()
	app.dsuSrv = dsu.NewServer(port)
	if err := app.dsuSrv.Start(); err != nil {
		t.Fatal(err)
	}
	defer app.dsuSrv.Stop()

	conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port})
	if err != nil {
		t.Fatal(err)
	}
	addr := conn.LocalAddr().String()
	_, _ = conn.Write(dsuPadDataRequest())
	time.Sleep(50 * time.Millisecond)

	if res := app.DisconnectDSUClient(addr); res != "ok" {
		t.Fatalf("DisconnectDSUClient = %q", res)
	}
	kicked := app.dsuKickedViews()
	if len(kicked) != 1 || kicked[0].Address != addr || kicked[0].PID != uint32(os.Getpid()) {
		t.Fatalf("kicked views = %+v, want %s owned by this process", kicked, addr)
	}

	if res := app.ReconnectDSUClient(addr); res != "ok" {
		t.Fatalf("ReconnectDSUClient = %q", res)
	}
	if len(app.dsuKickedViews()) != 0 || app.dsuSrv.ActiveClientCount() != 1 {
		t.Fatal("the client is not back after ReconnectDSUClient")
	}

	if res := app.DisconnectDSUClient(addr); res != "ok" {
		t.Fatalf("second DisconnectDSUClient = %q", res)
	}
	conn.Close() // the program is gone; the port table is re-read within dsuClientNamesTTL
	dsuPortsMu.Lock()
	dsuPortsAt = time.Now().Add(-2 * dsuClientNamesTTL)
	dsuPortsMu.Unlock()
	if k := app.dsuKickedViews(); len(k) != 0 {
		t.Fatalf("a client whose port is closed is still listed: %+v", k)
	}
	if res := app.ReconnectDSUClient(addr); res != "not found" {
		t.Fatalf("ReconnectDSUClient of a forgotten client = %q", res)
	}
}

// dsuPadDataRequest is a client's DSU pad data request (subscribes it).
func dsuPadDataRequest() []byte {
	req := make([]byte, 20)
	copy(req[0:4], "DSUC")
	binary.LittleEndian.PutUint16(req[4:6], 1001)
	binary.LittleEndian.PutUint16(req[6:8], 4)
	binary.LittleEndian.PutUint32(req[16:20], dsu.MsgTypePadData)
	binary.LittleEndian.PutUint32(req[8:12], crc32.ChecksumIEEE(req))
	return req
}
