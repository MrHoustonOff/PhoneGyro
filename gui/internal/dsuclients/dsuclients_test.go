package dsuclients

import (
	"net"
	"os"
	"strings"
	"testing"

	"phonegyro/pkg/dsu"
)

// TestName: a loopback client is named after the process that owns its UDP
// port (here: this test binary); a client on another PC keeps just its address.
func TestName(t *testing.T) {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	a := conn.LocalAddr().(*net.UDPAddr)

	var n Namer
	views := n.Name([]dsu.ClientInfo{
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

// TestPortOpen: a held port is seen as open, a closed one as closed even
// right after the table was cached with it open.
func TestPortOpen(t *testing.T) {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	port := conn.LocalAddr().(*net.UDPAddr).Port

	var n Namer
	if open, known := n.PortOpen(port); !known || !open {
		t.Fatalf("held port: open=%v known=%v", open, known)
	}
	conn.Close()
	n.TTL = -1 // re-read the table cached above
	if open, known := n.PortOpen(port); !known || open {
		t.Fatalf("closed port: open=%v known=%v", open, known)
	}
}
