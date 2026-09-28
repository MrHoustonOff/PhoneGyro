package dsu

import (
	"math"
	"net"
	"testing"
	"time"

	"phonegyro/pkg/server"
)

// TestCemuBiasModel follows Mahony.h: only samples with all rates under
// 0.35 rad/s count, and the bias exists from 200 samples on.
func TestCemuBiasModel(t *testing.T) {
	var m cemuBiasModel
	for i := 0; i < 199; i++ {
		m.add(0, 10, 0)
	}
	if b := m.biasDps(); b != [3]float64{} {
		t.Fatalf("bias before 200 samples: %v", b)
	}
	m.add(0, 10, 0)
	if b := m.biasDps(); math.Abs(b[1]-10) > 1e-6 {
		t.Fatalf("bias %v, want 10 deg/s on Y", b)
	}
	m.add(0, 30, 0) // 30 deg/s = 0.52 rad/s: too fast, ignored
	for i := 0; i < 200; i++ {
		m.add(0, 0, 0)
	}
	if b := m.biasDps(); math.Abs(b[1]-5) > 1e-6 || m.n != 400 {
		t.Fatalf("bias %v n %d, want 5 deg/s over 400 samples", b, m.n)
	}
}

// TestRestFillOnlyAtRestAndOnlyForMarkedClients: a marked client gets the extra
// zero packets only for frames with zero rates; they thin its bias ten times
// faster; unmarked clients get exactly one packet per frame.
func TestRestFillOnlyAtRestAndOnlyForMarkedClients(t *testing.T) {
	srv := NewServer(0)
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()
	dial := func(id uint32) *net.UDPConn {
		c, err := net.DialUDP("udp", nil, srv.conn.LocalAddr().(*net.UDPAddr))
		if err != nil {
			t.Fatal(err)
		}
		_, _ = c.Write(padDataRequest(id))
		return c
	}
	cemu, other := dial(1), dial(2)
	defer cemu.Close()
	defer other.Close()
	time.Sleep(50 * time.Millisecond)
	srv.SetRestFill(cemu.LocalAddr().String(), true)
	// Count what arrives within a fixed window (the heartbeat stays quiet for
	// 250 ms after a device frame, so only our frames arrive).
	drain := func(c *net.UDPConn) int {
		n := 0
		buf := make([]byte, 256)
		deadline := time.Now().Add(120 * time.Millisecond)
		for {
			c.SetReadDeadline(deadline)
			if _, err := c.Read(buf); err != nil {
				return n
			}
			n++
		}
	}
	srv.SendMotion(server.MotionFrame{RotY: 50, AccY: -1}) // silences the heartbeat
	drain(cemu)
	drain(other)

	moving := server.MotionFrame{RotY: 10, AccY: -1}
	for i := 0; i < 300; i++ {
		srv.SendMotion(moving)
	}
	if a, b := drain(cemu), drain(other); a != 300 || b != 300 {
		t.Fatalf("moving: %d and %d packets for 300 frames, want 300 each", a, b)
	}
	rest := server.MotionFrame{AccY: -1}
	for i := 0; i < 30; i++ {
		srv.SendMotion(rest)
	}
	if a, b := drain(cemu), drain(other); a != 30*(1+restFillPackets) || b != 30 {
		t.Fatalf("at rest: Cemu got %d (want %d), other got %d (want 30)", a, 30*(1+restFillPackets), b)
	}
	var cemuBias, otherBias float64
	for _, c := range srv.GetClientsInfo() {
		if c.Address == cemu.LocalAddr().String() {
			cemuBias = c.CemuBias[1]
		} else {
			otherBias = c.CemuBias[1]
		}
	}
	// Heartbeat zeros may add a few samples to both; the fill must dominate.
	if cemuBias > 0.6*otherBias {
		t.Fatalf("rest fill did not thin the bias: Cemu %.3f vs other %.3f deg/s", cemuBias, otherBias)
	}
	t.Logf("after 300 frames at 10 deg/s and 30 at rest: bias with fill %.2f, without %.2f deg/s", cemuBias, otherBias)
}
