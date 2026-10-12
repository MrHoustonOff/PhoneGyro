package app

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"phonegyro/pkg/server"

	"phonegyro-gui/internal/motion"

	"github.com/gorilla/websocket"
)

// Slow steady rotation must reach the DSU output whole, for as long as it lasts.
//
// Up to v2.1.0 a live "auto-zero" took a slow, smooth rotation (it has almost no
// spread, the same as a device lying still) for gyro bias and subtracted it: after
// about 3 s the rotation vanished from the output, axis by axis, and the aim felt
// pulled onto the other axis. The bias now comes only from the calibration "rest"
// step (and the saved profile); motion frames never change it.

// pipelineRig runs real frames through onMotionFrame and reads what the pipeline
// sends to the DSU from the Stats screen's telemetry socket (out_gx/gy/gz are the
// rates written into the DSU packet).
type pipelineRig struct {
	a    *App
	bank *motionBank
	msgs chan liveDebugMsg
	srv  *server.Server
	ts   uint64
	n    uint32
}

func newPipelineRig(t *testing.T, mode string, bias [3]float64) *pipelineRig {
	t.Helper()
	a := NewApp()
	// what startup() sets up before the first frame can arrive
	a.phoneBank.align = motion.NewSensorAligner(a.bankDir("phone"))
	a.usbBank.align = motion.NewSensorAligner(a.bankDir("usb"))
	a.initProfileSensorFrame(a.phoneBank, a.bankDir("phone"))
	a.initProfileSensorFrame(a.usbBank, a.bankDir("usb"))
	a.inputModeMu.Lock()
	a.inputMode = mode
	a.inputModeMu.Unlock()
	bank := a.activeBank()
	bank.biasMu.Lock()
	bank.gyroBias = bias
	bank.biasMu.Unlock()

	srv := &server.Server{HTTPMux: http.NewServeMux(), HTTPSMux: http.NewServeMux()}
	a.serveLiveDebug(srv)
	hs := httptest.NewServer(srv.HTTPMux)
	t.Cleanup(hs.Close)
	conn, _, err := websocket.DefaultDialer.Dial("ws://"+hs.Listener.Addr().String()+"/livedebug/ws", nil)
	if err != nil {
		t.Fatalf("telemetry socket: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	r := &pipelineRig{a: a, bank: bank, msgs: make(chan liveDebugMsg, 1<<16), srv: srv, ts: 1_000_000}
	go func() {
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if strings.Contains(string(data[:min(len(data), 40)]), `"type"`) {
				continue // sync and status messages, not frames
			}
			var m liveDebugMsg
			if json.Unmarshal(data, &m) == nil && m.Seq > 0 { // Seq: a pipeline frame
				r.msgs <- m
			}
		}
	}()
	// the server registers the client right after the upgrade; wait for it
	deadline := time.Now().Add(2 * time.Second)
	for {
		a.liveDebugMu.RLock()
		ready := len(a.liveDebugClients) > 0
		a.liveDebugMu.RUnlock()
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("telemetry client never registered")
		}
		time.Sleep(5 * time.Millisecond)
	}
	return r
}

// feed sends one USB-style frame: device clock in µs, rates in °/s, accel in g.
func (r *pipelineRig) feed(rot, acc [3]float64, stepUs uint64) {
	r.ts += stepUs
	r.n++
	r.a.onMotionFrame(r.srv, server.MotionFrame{
		Timestamp:   uint32(r.ts / 1000),
		TimestampUs: r.ts,
		SampleClock: server.ClockMicros32,
		RotX:        float32(rot[0]), RotY: float32(rot[1]), RotZ: float32(rot[2]),
		AccX: float32(acc[0]), AccY: float32(acc[1]), AccZ: float32(acc[2]),
		Qw: 1,
	})
}

func (r *pipelineRig) bias() [3]float64 {
	r.bank.biasMu.RLock()
	defer r.bank.biasMu.RUnlock()
	return r.bank.gyroBias
}

// drain returns the telemetry messages received so far.
func (r *pipelineRig) drain(wait time.Duration) []liveDebugMsg {
	time.Sleep(wait)
	var out []liveDebugMsg
	for {
		select {
		case m := <-r.msgs:
			out = append(out, m)
		default:
			return out
		}
	}
}

func norm(v [3]float32) float64 {
	return math.Sqrt(float64(v[0])*float64(v[0]) + float64(v[1])*float64(v[1]) + float64(v[2])*float64(v[2]))
}

// The exact scenario of the bug, in real time: a USB controller turned slowly and
// steadily about the gravity axis (the accelerometer cannot see that turn at all),
// 1.5 °/s for 8 s, with a little sensor noise. The old auto-zero took it for rest
// after ~3 s and cancelled it; the output must stay at 1.5 °/s to the end.
func TestSlowSteadyRotationIsNeverEatenAsBias(t *testing.T) {
	if testing.Short() {
		t.Skip("real-time test (8 s)")
	}
	bias := [3]float64{-1.8, 0.48, 0.30} // the calibrated zero of the controller in the bug report
	r := newPipelineRig(t, "usb", bias)

	const hz, seconds, rate = 200, 8, 1.5
	start := time.Now()
	for i := 0; i < hz*seconds; i++ {
		// deterministic "noise", well inside a still sensor's spread
		nz := 0.05 * math.Sin(float64(i)*1.7)
		rot := [3]float64{bias[0] + nz, bias[1] - nz, bias[2] + rate + nz}
		r.feed(rot, [3]float64{0, 0, 1}, 1_000_000/hz)
		// pace like the device: the old auto-zero measured rest in wall-clock time
		if wait := time.Until(start.Add(time.Duration(i+1) * time.Second / hz)); wait > 0 {
			time.Sleep(wait)
		}
	}
	msgs := r.drain(200 * time.Millisecond)

	if got := r.bias(); got != bias {
		t.Fatalf("motion frames changed the gyro bias: %v -> %v", bias, got)
	}
	if len(msgs) < 100 {
		t.Fatalf("only %d telemetry frames received", len(msgs))
	}
	// every frame after the first half second, and in particular the last seconds,
	// must still carry the whole rotation
	late, checked := 0, 0
	for i, m := range msgs {
		if i < len(msgs)/16 {
			continue
		}
		checked++
		got := norm([3]float32{m.OutGx, m.OutGy, m.OutGz})
		if math.Abs(got-rate) > 0.15 {
			t.Errorf("frame %d/%d: output %.3f °/s, want %.1f (out %.2f %.2f %.2f)",
				i, len(msgs), got, rate, m.OutGx, m.OutGy, m.OutGz)
			if late++; late > 5 {
				t.FailNow()
			}
		}
	}
	if checked == 0 {
		t.Fatal("no frames checked")
	}
}

// Rest with the calibrated zero: the output is silent and the bias stays put.
func TestStillDeviceKeepsCalibratedBias(t *testing.T) {
	bias := [3]float64{-1.8, 0.48, 0.30}
	r := newPipelineRig(t, "usb", bias)
	for i := 0; i < 2000; i++ {
		nz := 0.2 * math.Sin(float64(i)*2.3)
		r.feed([3]float64{bias[0] + nz, bias[1] - nz, bias[2] + nz}, [3]float64{0, 0, 1}, 5000)
	}
	msgs := r.drain(200 * time.Millisecond)
	if got := r.bias(); got != bias {
		t.Fatalf("bias changed at rest: %v -> %v", bias, got)
	}
	for _, m := range msgs {
		if n := norm([3]float32{m.OutGx, m.OutGy, m.OutGz}); n != 0 {
			t.Fatalf("still device: output %.3f °/s, want 0 (noise is under the tremor threshold)", n)
		}
	}
}

// Every frame of the real recording from the bug report (USB controller moved
// slowly by hand for a minute) goes through the pipeline: the bias never moves,
// and the output is the calibrated rate scaled only by the tremor threshold, the
// same factor for all three axes -- nothing is cut per axis.
// Replayed at the recording's own pace (~1 min): the old auto-zero measured rest
// in wall-clock time, so a faster replay would hide the bug.
func TestRealSlowAimRecordingIsPassedThroughLinearly(t *testing.T) {
	if testing.Short() {
		t.Skip("real-time replay (~1 min)")
	}
	frames := loadSlowAimRecording(t)
	bias := [3]float64{-1.8, 0.48, 0.30}
	r := newPipelineRig(t, "usb", bias)
	r.bank.matrixMu.RLock()
	mat := r.bank.activeMatrix
	r.bank.matrixMu.RUnlock()
	thr := r.a.deadbandFor(r.bank)

	checked := 0
	start := time.Now()
	for i, f := range frames {
		r.feed(f.rot, f.acc, 5050)
		if wait := time.Until(start.Add(time.Duration(i+1) * 5050 * time.Microsecond)); wait > 0 {
			time.Sleep(wait)
		}
		if i%8 == 7 {
			for _, m := range r.drain(0) {
				cx, cy, cz := motion.ApplyMatrix(mat, float64(m.RawGx)-bias[0], float64(m.RawGy)-bias[1], float64(m.RawGz)-bias[2])
				want := [3]float64{cx, cy, cz}
				speed := math.Sqrt(cx*cx + cy*cy + cz*cz)
				k := motion.DeadbandScale(speed, thr)
				out := [3]float64{float64(m.OutGx), float64(m.OutGy), float64(m.OutGz)}
				for ax := 0; ax < 3; ax++ {
					// sign conventions of the DSU output aside, each axis is the
					// calibrated rate times one common factor
					if d := math.Abs(math.Abs(out[ax]) - k*math.Abs(want[ax])); d > 1e-3+1e-4*math.Abs(want[ax]) {
						t.Fatalf("frame %d axis %d: |out| %.4f, want %.4f (k %.3f, raw %.3f %.3f %.3f)",
							i, ax, math.Abs(out[ax]), k*math.Abs(want[ax]), k, m.RawGx, m.RawGy, m.RawGz)
					}
				}
				checked++
			}
		}
	}
	if got := r.bias(); got != bias {
		t.Fatalf("bias changed during the recording: %v -> %v", bias, got)
	}
	if checked < 500 {
		t.Fatalf("only %d frames checked", checked)
	}
}

// The state sent to the UI no longer carries the removed auto-zero fields, and
// still carries everything else the device card reads.
func TestStateHasNoAutoZeroFields(t *testing.T) {
	b, err := json.Marshal(AppState{})
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, gone := range []string{`"biasAtRest"`, `"biasRestProgress"`, `"biasX"`, `"biasY"`, `"biasZ"`} {
		if strings.Contains(s, gone) {
			t.Errorf("AppState still has %s", gone)
		}
	}
	for _, kept := range []string{`"dsuAccX"`, `"pitch"`, `"roll"`, `"yaw"`, `"hz"`, `"status"`} {
		if !strings.Contains(s, kept) {
			t.Errorf("AppState lost %s", kept)
		}
	}
}

type recordedFrame struct{ rot, acc [3]float64 }

// loadSlowAimRecording reads testdata/usb_slow_aim_2026-10-12.csv (raw gyro °/s
// and accel g of the bug report's recording).
func loadSlowAimRecording(t *testing.T) []recordedFrame {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "usb_slow_aim_2026-10-12.csv"))
	if err != nil {
		t.Fatal(err)
	}
	var out []recordedFrame
	for _, line := range strings.Split(strings.ReplaceAll(string(data), "\r", ""), "\n") {
		if line == "" || line[0] == '#' || strings.HasPrefix(line, "raw_") {
			continue
		}
		f := strings.Split(line, ",")
		if len(f) != 6 {
			t.Fatalf("bad line %q", line)
		}
		var v [6]float64
		for i, s := range f {
			if v[i], err = strconv.ParseFloat(s, 64); err != nil {
				t.Fatalf("bad number %q: %v", s, err)
			}
		}
		out = append(out, recordedFrame{rot: [3]float64{v[0], v[1], v[2]}, acc: [3]float64{v[3], v[4], v[5]}})
	}
	if len(out) < 10000 {
		t.Fatalf("recording has %d frames, want the whole minute", len(out))
	}
	return out
}
