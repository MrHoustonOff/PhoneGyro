package app

import (
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.bug.st/serial"

	"phonegyro-gui/internal/hwproto"
)

// deadPort is a serial handle from a port that re-enumerated under it: every
// Read returns at once, without an error, ignoring the read timeout -- either
// 0 bytes or the same stale bytes again (replay).
type deadPort struct {
	reads  atomic.Int64
	closed atomic.Bool
	replay []byte
}

func (p *deadPort) SetMode(*serial.Mode) error { return nil }
func (p *deadPort) Read(b []byte) (int, error) {
	p.reads.Add(1)
	return copy(b, p.replay), nil
}
func (p *deadPort) Write(b []byte) (int, error) { return len(b), nil }
func (p *deadPort) Drain() error                { return nil }
func (p *deadPort) ResetInputBuffer() error     { return nil }
func (p *deadPort) ResetOutputBuffer() error    { return nil }
func (p *deadPort) SetDTR(bool) error           { return nil }
func (p *deadPort) SetRTS(bool) error           { return nil }
func (p *deadPort) GetModemStatusBits() (*serial.ModemStatusBits, error) {
	return &serial.ModemStatusBits{}, nil
}
func (p *deadPort) SetReadTimeout(time.Duration) error { return nil }
func (p *deadPort) Close() error                       { p.closed.Store(true); return nil }
func (p *deadPort) Break(time.Duration) error          { return nil }

// runReadLoop runs readLoop on port as the manager's attached device and waits
// for it to give up.
func runReadLoop(t *testing.T, port *deadPort) (*App, *usbDeviceManager, string) {
	t.Helper()
	root := t.TempDir()
	app := &App{profilesDir: root}
	app.bank("usb")
	app.usbBank.hasClient.Store(true)
	m := newUSBDeviceManager(app)
	m.port, m.portName, m.connected = port, "COM9", true

	done := make(chan struct{})
	start := time.Now()
	go func() { m.readLoop(port, "COM9", nil, nil); close(done) }()
	select {
	case <-done:
	case <-time.After(usbSilenceTimeout + 3*time.Second):
		t.Fatal("read loop never gave up on a handle that delivers no fresh data")
	}
	if took := time.Since(start); took < usbSilenceTimeout {
		t.Fatalf("gave up after %v, before the %v silence timeout", took, usbSilenceTimeout)
	}
	log, _ := os.ReadFile(filepath.Join(root, "logs", "phonegyro.log"))
	return app, m, string(log)
}

// TestUSBReadLoopGivesUpOnDeadHandle: a handle that reads nothing forever. The
// loop drops it after usbSilenceTimeout, logs why, clears the connection so
// scanning resumes, and does not spin a CPU core meanwhile.
func TestUSBReadLoopGivesUpOnDeadHandle(t *testing.T) {
	port := &deadPort{}
	app, m, log := runReadLoop(t, port)
	if !port.closed.Load() || m.isConnected() || app.usbBank.hasClient.Load() {
		t.Fatalf("after giving up: closed=%v connected=%v hasClient=%v", port.closed.Load(), m.isConnected(), app.usbBank.hasClient.Load())
	}
	if n := port.reads.Load(); n > 200 {
		t.Fatalf("%d reads: the loop spun instead of pausing", n)
	}
	if !strings.Contains(log, "no fresh data from COM9") {
		t.Fatalf("the reason is not in the log:\n%s", log)
	}
}

// TestUSBReadLoopDropsReplayedFrames: the actual field failure (2026-09-28 23:07)
// -- after a flaky port came back, the handle returned the same frame ~12 000
// times a second. The replays must not count as a live device: the loop gives the
// handle up, and says how many replays it dropped.
func TestUSBReadLoopDropsReplayedFrames(t *testing.T) {
	frame := make([]byte, hwproto.FrameSize)
	frame[0], frame[1], frame[2], frame[3] = hwproto.Magic0, hwproto.Magic1, hwproto.TypeData, 42
	frame[4] = 0x10 // device timestamp
	frame[hwproto.FrameSize-1] = hwproto.CRC8(frame[:hwproto.FrameSize-1])
	port := &deadPort{replay: frame}
	_, m, log := runReadLoop(t, port)
	if !port.closed.Load() || m.isConnected() {
		t.Fatal("the stale handle was not released")
	}
	if !strings.Contains(log, "no fresh data from COM9") || strings.Contains(log, "(0 replayed frames") {
		t.Fatalf("expected a reconnect with the replays counted:\n%s", log)
	}
}

// TestUSBConnStateDropsReplay: a replay of the previous data frame is not fresh
// and never reaches the counters or the pipeline; the next real frame is fresh.
func TestUSBConnStateDropsReplay(t *testing.T) {
	app := &App{}
	st := newUSBConnState()
	f := hwproto.Frame{Type: hwproto.TypeData, Seq: 7, TimestampUs: 1000}
	if !st.handle(f, app) {
		t.Fatal("first frame not fresh")
	}
	for i := 0; i < 5; i++ {
		if st.handle(f, app) {
			t.Fatal("replayed frame counted as fresh")
		}
	}
	if !st.handle(hwproto.Frame{Type: hwproto.TypeData, Seq: 8, TimestampUs: 6000}, app) {
		t.Fatal("next real frame not fresh")
	}
	if st.dataFrames != 2 || st.duplicates != 5 {
		t.Fatalf("dataFrames %d duplicates %d, want 2 and 5", st.dataFrames, st.duplicates)
	}
}
