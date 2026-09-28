package dsu

import (
	"encoding/binary"
	"math"
	"net"
	"sync"
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
	if b := m.biasDps(); math.Abs(b[1]-10) > 1e-4 {
		t.Fatalf("bias %v, want 10 deg/s on Y", b)
	}
	m.add(0, 30, 0) // 30 deg/s = 0.52 rad/s: too fast, ignored
	for i := 0; i < 200; i++ {
		m.add(0, 0, 0)
	}
	if b := m.biasDps(); math.Abs(b[1]-5) > 1e-4 || m.n != 400 {
		t.Fatalf("bias %v n %d, want 5 deg/s over 400 samples", b, m.n)
	}
}

// TestCemuCorrection: the correction cancels the sum, in steps Cemu still
// counts, and nothing is sent for a negligible sum.
func TestCemuCorrection(t *testing.T) {
	var m cemuBiasModel
	for i := 0; i < 300; i++ {
		m.add(0, 15, -5) // slow aiming: 0.26 and -0.087 rad/s
	}
	for step := 0; ; step++ {
		rx, ry, rz, ok := m.correction()
		if !ok {
			break
		}
		for _, v := range []float32{rx, ry, rz} {
			if r := cemuRad(v); r >= cemuBiasMaxRate || r <= -cemuBiasMaxRate {
				t.Fatalf("correction %v deg/s is too fast for Cemu to count", v)
			}
		}
		n := m.n
		m.add(rx, ry, rz)
		if m.n != n+1 {
			t.Fatal("Cemu would not count the correction")
		}
		if step > 1000 {
			t.Fatal("the correction does not converge")
		}
	}
	for i, s := range m.sum {
		if math.Abs(s) >= cemuCorrectionMinSum {
			t.Fatalf("axis %d: sum %v left", i, s)
		}
	}
	if b := m.biasDps(); math.Abs(b[1]) > 0.01 || math.Abs(b[2]) > 0.01 {
		t.Fatalf("bias after the corrections %v deg/s", b)
	}
}

// fakeCemu receives pad data the way DSUControllerProvider::integrate_motion
// does: a packet whose timestamp is not newer is dropped, every other one is
// integrated over the timestamp delta and fed to the bias estimate.
type fakeCemu struct {
	mu      sync.Mutex
	lastTs  uint64
	yawDeg  float64 // integrated Y rotation
	bias    cemuBiasModel
	packets int
	rates   map[float32]bool // the Y rates it saw
}

func (f *fakeCemu) run(conn *net.UDPConn) {
	buf := make([]byte, 256)
	for {
		n, err := conn.Read(buf)
		if err != nil {
			return
		}
		if n != 100 {
			continue
		}
		p := buf[20:]
		ts := binary.LittleEndian.Uint64(p[48:56])
		var rot [3]float32
		for i := range rot {
			rot[i] = math.Float32frombits(binary.LittleEndian.Uint32(p[68+4*i:]))
		}
		f.mu.Lock()
		f.packets++
		f.rates[rot[1]] = true
		if ts > f.lastTs {
			if f.lastTs != 0 {
				dt := float64(ts-f.lastTs) / 1e6
				if dt > 0.2 {
					dt = 0.2 // Mahony.h
				}
				f.yawDeg += float64(rot[1]) * dt
			}
			f.lastTs = ts
			f.bias.add(rot[0], rot[1], rot[2])
		}
		f.mu.Unlock()
	}
}

// TestCemuGuard_KeepsCemuBiasAtZero plays slow aiming one way and fast turns
// back (BotW's bow) to two Cemu-like clients. Without the guard the client's
// bias estimate takes the slow aiming in; with it the estimate stays at zero,
// and both clients integrate the same rotation -- the corrections turn nothing.
func TestCemuGuard_KeepsCemuBiasAtZero(t *testing.T) {
	srv := NewServer(0)
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()

	plain := &fakeCemu{rates: map[float32]bool{}}
	guarded := &fakeCemu{rates: map[float32]bool{}}
	var guardedAddr string
	for _, f := range []*fakeCemu{plain, guarded} {
		c, err := net.DialUDP("udp", nil, srv.conn.LocalAddr().(*net.UDPAddr))
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		_ = c.SetReadBuffer(4 << 20)
		go f.run(c)
		_, _ = c.Write(padDataRequest(1))
		guardedAddr = c.LocalAddr().String()
	}
	time.Sleep(50 * time.Millisecond)
	srv.SetCemuGuard(guardedAddr, true)

	const frameUs = 5000 // 200 Hz device clock
	var devTs uint64 = 1_000_000
	send := func(rate float32, frames int) {
		for i := 0; i < frames; i++ {
			devTs += frameUs
			srv.SendMotion(server.MotionFrame{TimestampUs: devTs, SampleClock: server.ClockMicros64, RotY: rate, AccY: -1})
			if i%20 == 19 {
				time.Sleep(time.Millisecond) // let the readers keep up
			}
		}
	}
	send(0, 10)
	for k := 0; k < 3; k++ {
		send(10, 800)  // 4 s aiming right at 10 deg/s
		send(-80, 100) // 0.5 s turning back fast
	}
	send(0, 40)
	time.Sleep(100 * time.Millisecond)

	plain.mu.Lock()
	guarded.mu.Lock()
	defer plain.mu.Unlock()
	defer guarded.mu.Unlock()

	if b := plain.bias.biasDps(); b[1] < 5 {
		t.Fatalf("without the guard Cemu's bias is %v deg/s; the scenario no longer shows the bug", b)
	}
	if b := guarded.bias.biasDps(); math.Abs(b[0]) > 0.01 || math.Abs(b[1]) > 0.01 || math.Abs(b[2]) > 0.01 {
		t.Fatalf("with the guard Cemu's bias is %v deg/s, want 0", b)
	}
	if guarded.packets <= plain.packets {
		t.Fatalf("guarded client got %d packets, plain %d: no corrections were sent", guarded.packets, plain.packets)
	}
	for r := range plain.rates {
		if r != 0 && r != 10 && r != -80 {
			t.Fatalf("an unguarded client got a correction packet (rate %v)", r)
		}
	}
	// Both saw the same real frames; the corrections spanned 1 us each.
	if d := guarded.yawDeg - plain.yawDeg; math.Abs(d) > 0.05 {
		t.Fatalf("the corrections turned the guarded client by %.4f deg", d)
	}
	t.Logf("plain: bias %.3f deg/s, %d packets; guarded: bias %.5f deg/s, %d packets; yaw %.3f vs %.3f deg",
		plain.bias.biasDps()[1], plain.packets, guarded.bias.biasDps()[1], guarded.packets, plain.yawDeg, guarded.yawDeg)
}

// TestCemuGuard_RepeatKeepsWallInterval: a correction before a frame without a
// device clock (legacy phone page) must not shorten that frame's interval to
// the time since the correction.
func TestCemuGuard_RepeatKeepsWallInterval(t *testing.T) {
	srv := NewServer(0)
	a := srv.stampMotion(server.MotionFrame{})
	time.Sleep(20 * time.Millisecond)
	c := srv.stampRepeat()
	b := srv.stampMotion(server.MotionFrame{})
	if c != a+1 {
		t.Fatalf("correction at +%d us, want +1", c-a)
	}
	if b-a < 15_000 {
		t.Fatalf("frame after a correction spans %d us, want the ~20 ms since the previous frame", b-a)
	}
}
