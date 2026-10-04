package dsu

import (
	"encoding/binary"
	"hash/crc32"
	"math"
	"net"
	"testing"
	"time"

	"phonegyro/pkg/server"
)

func padDataRequest(clientID uint32) []byte {
	req := make([]byte, 20)
	copy(req[0:4], "DSUC")
	binary.LittleEndian.PutUint16(req[4:6], 1001)
	binary.LittleEndian.PutUint16(req[6:8], 4)
	binary.LittleEndian.PutUint32(req[12:16], clientID)
	binary.LittleEndian.PutUint32(req[16:20], MsgTypePadData)
	binary.LittleEndian.PutUint32(req[8:12], crc32.ChecksumIEEE(req))
	return req
}

// TestDSU_RepeatedRequestsDoNotPingPong: field report 2026-09-28 -- Cemu repeats
// the data request after every packet it gets. When each request was answered
// with a packet the two ping-ponged thousands of packets a second (a whole CPU
// core), each repeating the last rotation rate, and the game drifted. Now a
// request only refreshes the subscription; a brand new subscriber gets one packet
// at rest (zero rates, even though the last device frame was moving).
func TestDSU_RepeatedRequestsDoNotPingPong(t *testing.T) {
	srv := NewServer(0)
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()
	// The device was turning when the client subscribed.
	srv.SendMotion(server.MotionFrame{RotX: 90, RotY: -45, RotZ: 30, AccY: -1})

	conn, err := net.DialUDP("udp", nil, srv.conn.Load().LocalAddr().(*net.UDPAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	if _, err := conn.Write(padDataRequest(7)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 256)
	conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	n, err := conn.Read(buf)
	if err != nil || n != 100 {
		t.Fatalf("new subscriber got no immediate packet: n=%d err=%v", n, err)
	}
	for i, off := range []int{88, 92, 96} {
		if r := math.Float32frombits(binary.LittleEndian.Uint32(buf[off : off+4])); r != 0 {
			t.Fatalf("welcome packet carries rotation rate %d = %v, want 0", i, r)
		}
	}

	// 300 more requests from the same client within ~100 ms.
	for i := 0; i < 300; i++ {
		_, _ = conn.Write(padDataRequest(7))
	}
	got := 0
	conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	for {
		if _, err := conn.Read(buf); err != nil {
			break
		}
		got++
	}
	// Only the 60 Hz heartbeat may arrive here (the device went silent).
	if got > 20 {
		t.Fatalf("%d packets answered 300 repeated requests: the server still ping-pongs", got)
	}
}

// TestDSU_KickIgnoresUntilSilent: a kicked client gets nothing more even though
// it keeps asking (Cemu asks every few ms); after staying silent it may return.
func TestDSU_KickIgnoresUntilSilent(t *testing.T) {
	srv := NewServer(0)
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()
	conn, err := net.DialUDP("udp", nil, srv.conn.Load().LocalAddr().(*net.UDPAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = conn.Write(padDataRequest(1))
	time.Sleep(50 * time.Millisecond)
	if srv.ActiveClientCount() != 1 {
		t.Fatalf("client not subscribed")
	}
	if !srv.Kick(conn.LocalAddr().String()) {
		t.Fatal("Kick did not find the client")
	}
	for i := 0; i < 20; i++ {
		_, _ = conn.Write(padDataRequest(1))
		time.Sleep(5 * time.Millisecond)
	}
	if n := srv.ActiveClientCount(); n != 0 {
		t.Fatalf("kicked client came back while still asking: %d clients", n)
	}
	srv.clientsMu.Lock()
	srv.kicked[conn.LocalAddr().String()].lastSeen = time.Now().Add(-kickedUntilSilent - time.Second)
	srv.clientsMu.Unlock()
	_, _ = conn.Write(padDataRequest(1))
	time.Sleep(50 * time.Millisecond)
	if srv.ActiveClientCount() != 1 {
		t.Fatal("client could not return after staying silent")
	}
}

// TestDSU_Readmit: a kicked client is listed until the user brings it back; then
// it is subscribed again and gets a packet at once, without asking first (Cemu
// asks only after it receives one).
func TestDSU_Readmit(t *testing.T) {
	srv := NewServer(0)
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()
	conn, err := net.DialUDP("udp", nil, srv.conn.Load().LocalAddr().(*net.UDPAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	addr := conn.LocalAddr().String()
	_, _ = conn.Write(padDataRequest(1))
	time.Sleep(50 * time.Millisecond)
	if !srv.Kick(addr) {
		t.Fatal("Kick did not find the client")
	}
	if srv.Readmit("127.0.0.1:1") {
		t.Fatal("Readmit accepted a client that was not kicked")
	}
	if k := srv.KickedClients(); len(k) != 1 || k[0].Address != addr {
		t.Fatalf("kicked clients = %+v, want %s", k, addr)
	}

	// Drain what arrived before the kick, then stay silent like a Cemu whose
	// stream stopped.
	buf := make([]byte, 256)
	for {
		conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
		if _, err := conn.Read(buf); err != nil {
			break
		}
	}
	if !srv.Readmit(addr) {
		t.Fatal("Readmit did not find the kicked client")
	}
	conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	if n, err := conn.Read(buf); err != nil || n != 100 {
		t.Fatalf("readmitted client got no packet: n=%d err=%v", n, err)
	}
	if srv.ActiveClientCount() != 1 || len(srv.KickedClients()) != 0 {
		t.Fatalf("after Readmit: %d clients, %d kicked", srv.ActiveClientCount(), len(srv.KickedClients()))
	}

	if !srv.Kick(addr) {
		t.Fatal("second Kick did not find the client")
	}
	srv.ForgetKicked(addr)
	if len(srv.KickedClients()) != 0 {
		t.Fatal("ForgetKicked left the client listed")
	}
}

// TestDSU_ClientsInConnectionOrder: the list must not shuffle between calls
// (map order is random); the first subscriber comes first.
func TestDSU_ClientsInConnectionOrder(t *testing.T) {
	srv := NewServer(0)
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()
	var addrs []string
	for i := 0; i < 3; i++ {
		c, err := net.DialUDP("udp", nil, srv.conn.Load().LocalAddr().(*net.UDPAddr))
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		_, _ = c.Write(padDataRequest(uint32(i)))
		addrs = append(addrs, c.LocalAddr().String())
		time.Sleep(20 * time.Millisecond)
	}
	for k := 0; k < 50; k++ {
		list := srv.GetClientsInfo()
		if len(list) != 3 {
			t.Fatalf("%d clients", len(list))
		}
		for i := range list {
			if list[i].Address != addrs[i] {
				t.Fatalf("call %d: position %d is %s, want %s", k, i, list[i].Address, addrs[i])
			}
		}
	}
}

func TestTouchClientCap(t *testing.T) {
	s := NewServer(0)
	for i := 0; i < MaxClients+10; i++ {
		s.touchClient(&net.UDPAddr{IP: net.IPv4(10, 0, byte(i>>8), byte(i)), Port: 5000})
	}
	if n := s.ActiveClients(); n != MaxClients {
		t.Fatalf("clients = %d, want %d", n, MaxClients)
	}
}

// Rebind moves a running server to a new port: requests to the new port are
// answered, the old port is free again.
func TestRebind(t *testing.T) {
	srv := NewServer(0)
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()
	old := srv.conn.Load().LocalAddr().(*net.UDPAddr)
	probe, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	port := probe.LocalAddr().(*net.UDPAddr).Port
	probe.Close()
	if err := srv.Rebind(port); err != nil {
		t.Fatal(err)
	}
	c, err := net.DialUDP("udp", nil, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if _, err := c.Write(padDataRequest(1)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 256)
	c.SetReadDeadline(time.Now().Add(time.Second))
	if n, err := c.Read(buf); err != nil || n != 100 {
		t.Fatalf("no answer on the new port: n=%d err=%v", n, err)
	}
	again, err := net.ListenUDP("udp", &net.UDPAddr{Port: old.Port})
	if err != nil {
		t.Fatalf("old port still taken: %v", err)
	}
	again.Close()
}
