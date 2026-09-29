package app

import (
	"sync"
	"time"

	"go.bug.st/serial"

	"phonegyro-gui/internal/hwproto"
	"phonegyro/pkg/server"
)

// USB host implementation of the PhoneGyro Hardware Protocol
// (https://github.com/MrHoustonOff/PhoneGyro_hardware_protocol). This is the
// host half of the contract: any device speaking the protocol is picked up
// automatically and fed into the exact same downstream pipeline the phone
// path uses (via server.Server.InjectMotionFrame), so calibration, sensor
// alignment, AHRS and DSU output behave identically regardless of source.
//
// This file deliberately contains no calibration/AHRS/DSU logic of its own:
// its only job is transport (find the device, decode its frames with
// internal/hwproto, convert raw register values to physical units) and handing
// the result to the core pipeline the same way a phone's WebSocket frame would.

// Host-side timing and safe defaults.
const (
	usbProbeTimeout  = 1500 * time.Millisecond
	usbRescanEvery   = 4 * time.Second
	usbReadTimeout   = 300 * time.Millisecond
	usbMetaGraceTime = 500 * time.Millisecond

	// A streaming device sends data frames at 100-200 Hz; this long without a
	// single NEW one means the link is dead even if the port still "reads". Seen in
	// the field (2026-09-28): after a flaky port dropped and came back, the handle
	// replayed the same stale frame ~12 000 times a second without an error, or
	// returned 0 bytes at once. Longer than the ~1.8 s an Arduino is silent while
	// it reboots on port open.
	usbSilenceTimeout = 3 * time.Second
	// A read that returns nothing sooner than this ignored the read timeout
	// (dead handle): pause instead of spinning a CPU core.
	usbInstantRead = 5 * time.Millisecond
	usbSpinPause   = 50 * time.Millisecond

	// Protocol Level 3 safe defaults, used until (or unless) a metadata frame
	// declares the device's real sensor range.
	usbDefaultGyroRangeDps = 250.0
	usbDefaultAccelRangeG  = 2.0
)

// usbConnState is the per-connection decoding state: declared sensor range
// (protocol Level 3), sequence tracking for drop telemetry, and the reset
// button's edge state.
type usbConnState struct {
	gyroRangeDps float64
	accelRangeG  float64
	haveMeta     bool
	metaDeadline time.Time

	haveSeq       bool
	afterMeta     bool // the previous frame was metadata: a data SEQ of 0 now means a reboot
	lastSeq       uint8
	droppedFrames uint64
	dataFrames    uint64

	// The previous data frame, to reject replays: a real device never sends two
	// data frames with the same SEQ and device timestamp in a row.
	haveData bool
	lastData struct {
		seq uint8
		ts  uint32
	}
	duplicates uint64

	// What the metadata declared beyond the ranges, and how often it comes
	// (usb_status.go shows it in Live Debug).
	protoVersion uint32
	declaredHz   int16
	caps         uint8
	metaCount    uint64
	lastMetaAt   time.Time
	metaInterval time.Duration
	resetPresses uint64

	prevResetHeld    bool
	lastReportedName string
}

func newUSBConnState() *usbConnState {
	return &usbConnState{
		gyroRangeDps: usbDefaultGyroRangeDps,
		accelRangeG:  usbDefaultAccelRangeG,
		metaDeadline: time.Now().Add(usbMetaGraceTime),
	}
}

func metaRangeOrDefault(v int16, def float64) float64 {
	if v <= 0 {
		return def
	}
	return float64(v)
}

// handle processes one decoded frame: applies metadata (Level 3), tracks
// dropped frames via SEQ, handles the reset button (Level 5), and — for a
// data frame — injects the converted result into the app's core pipeline.
// handle reports whether f was fresh data from the device: a data frame that is
// not a replay of the previous one. Metadata and name frames repeat by design
// and never count as proof that the device is alive.
func (st *usbConnState) handle(f hwproto.Frame, app *App) (fresh bool) {
	switch f.Type {
	case hwproto.TypeMeta:
		// Applied whenever it arrives, not only at the start: since protocol v1.1
		// the device repeats it about once a second, so a host that joins a stream
		// already running (the board did not reboot when the port opened) still
		// learns the real range instead of keeping the +-250 dps default.
		gyro := metaRangeOrDefault(f.Accel[1], usbDefaultGyroRangeDps)
		accel := metaRangeOrDefault(f.Accel[0], usbDefaultAccelRangeG)
		if !st.haveMeta || gyro != st.gyroRangeDps || accel != st.accelRangeG {
			app.logEvent("INFO", "USB: sensor range ±%g dps, ±%g g", gyro, accel)
		}
		st.gyroRangeDps, st.accelRangeG = gyro, accel
		st.haveMeta = true
		st.afterMeta = true
		now := time.Now()
		if st.metaCount > 0 {
			st.metaInterval = now.Sub(st.lastMetaAt)
		}
		st.lastMetaAt = now
		st.metaCount++
		st.protoVersion = f.TimestampUs
		st.declaredHz = f.Accel[2]
		st.caps = f.Buttons
	case hwproto.TypeName:
		// Optional (protocol Level 3): a device may self-identify. Mirrors
		// the phone's OnClientDevice -- same bank field, same "show it in
		// the UI and the profile's Device column" treatment.
		if f.Name != "" && f.Name != st.lastReportedName {
			st.lastReportedName = f.Name
			app.usbBank.deviceName.Store(f.Name)
			app.logEvent("INFO", "USB: device identified as %q", f.Name)
			app.emitStateChange()
		}
	case hwproto.TypeData:
		if st.haveData && f.Seq == st.lastData.seq && f.TimestampUs == st.lastData.ts {
			// A replayed frame (stale handle): feeding it on would integrate the
			// same rotation thousands of times a second.
			st.duplicates++
			return false
		}
		st.haveData = true
		st.lastData.seq, st.lastData.ts = f.Seq, f.TimestampUs
		fresh = true
		if !st.haveMeta && time.Now().After(st.metaDeadline) {
			st.haveMeta = true // give up waiting; declared/default range stands as-is
		}
		gap := 1
		// A boot sends metadata and then restarts SEQ at 0 (the port opening often
		// reboots the board right after the probe read stale frames of the previous
		// run): that jump is not lost frames. Repeated metadata mid-stream does not
		// consume SEQ, so there the next frame just continues the count.
		rebooted := st.afterMeta && f.Seq == 0
		st.afterMeta = false
		st.dataFrames++
		if st.haveSeq && !rebooted {
			gap = int(f.Seq) - int(st.lastSeq)
			if gap < 0 {
				gap += 256
			}
			if gap > 1 {
				st.droppedFrames += uint64(gap - 1)
			}
		}
		st.lastSeq, st.haveSeq = f.Seq, true
		if app.usbBank != nil {
			app.usbBank.loss.ObserveUSB(gap) // карточка «Потери» в Live Debug (link/loss.go)
		}

		// BUTTONS bit 0: reset centering, identical to the phone's recenter
		// action (protocol Level 5). Edge-triggered so holding it down
		// doesn't spam resets 200 times a second.
		held := f.Buttons&0x01 != 0
		if held && !st.prevResetHeld {
			st.resetPresses++
			app.TriggerRecenterFromHotkey()
		}
		st.prevResetHeld = held

		mf := server.MotionFrame{
			Timestamp:   uint32(time.Now().UnixMilli()),
			TimestampUs: uint64(f.TimestampUs),
			SampleClock: server.ClockMicros32, // firmware micros() at sample time
			RotX:        float32(float64(f.Gyro[0]) / 32768.0 * st.gyroRangeDps),
			RotY:        float32(float64(f.Gyro[1]) / 32768.0 * st.gyroRangeDps),
			RotZ:        float32(float64(f.Gyro[2]) / 32768.0 * st.gyroRangeDps),
			AccX:        float32(float64(f.Accel[0]) / 32768.0 * st.accelRangeG),
			AccY:        float32(float64(f.Accel[1]) / 32768.0 * st.accelRangeG),
			AccZ:        float32(float64(f.Accel[2]) / 32768.0 * st.accelRangeG),
			// Qx/Qy/Qz/Qw stay zero: this reference transport carries no
			// on-device orientation estimate. motion/attitudeanchor.go already
			// treats a near-zero quaternion as "no reference available" and
			// no-ops (see AnchorMinQuatNorm in motion/attitudeanchor.go) — exactly
			// the behavior we want here.
		}
		if app.srv != nil {
			app.srv.InjectMotionFrame(mf)
		}
	}
	return fresh
}

// usbDeviceManager implements protocol Level 4 auto-discovery: while active,
// it periodically probes every serial port on the machine for a valid
// PhoneGyro frame, connects to the first match, and streams its data into
// the app's pipeline until it disconnects (at which point scanning resumes).
type usbDeviceManager struct {
	app *App

	mu        sync.Mutex
	running   bool
	stopCh    chan struct{}
	port      serial.Port
	portName  string
	connected bool
}

func newUSBDeviceManager(app *App) *usbDeviceManager {
	return &usbDeviceManager{app: app}
}

func (m *usbDeviceManager) Start() {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return
	}
	m.running = true
	stop := make(chan struct{})
	m.stopCh = stop
	m.mu.Unlock()

	go m.run(stop)
}

func (m *usbDeviceManager) Stop() {
	m.mu.Lock()
	if !m.running {
		m.mu.Unlock()
		return
	}
	m.running = false
	stop := m.stopCh
	m.stopCh = nil
	port := m.port
	m.port = nil
	m.connected = false
	m.mu.Unlock()

	if port != nil {
		// Same as a disconnect (readLoop only does it while still connected): a
		// stale connectedAt would skip the loss-alarm grace on the next attach.
		m.app.usbBank.hasClient.Store(false)
		m.app.usbBank.connectedAt = time.Time{}
	}
	if stop != nil {
		close(stop)
	}
	if port != nil {
		port.Close()
	}
}

func (m *usbDeviceManager) isConnected() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.connected
}

// Status reports whether a PhoneGyro device is currently connected and, if
// so, which port it's on -- for surfacing in the UI (AppState.UsbConnected).
func (m *usbDeviceManager) Status() (connected bool, port string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.connected, m.portName
}

func (m *usbDeviceManager) run(stop chan struct{}) {
	m.scanOnce(stop)
	ticker := time.NewTicker(usbRescanEvery)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if !m.isConnected() {
				m.scanOnce(stop)
			}
		}
	}
}

type usbProbeResult struct {
	name    string
	port    serial.Port
	frames  []hwproto.Frame
	pending []byte
}

// scanOnce implements protocol Level 4: enumerate every serial port, probe
// them concurrently (not filtered by USB VID/PID — a third-party device may
// sit on any USB-UART bridge or native USB CDC), and attach to the first one
// that proves itself with a valid frame.
func (m *usbDeviceManager) scanOnce(stop chan struct{}) {
	ports, err := serial.GetPortsList()
	if err != nil || len(ports) == 0 {
		return
	}

	probeStop := make(chan struct{})
	resultCh := make(chan usbProbeResult, 1)
	var wg sync.WaitGroup
	for _, name := range ports {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			port, frames, pending, ok := probeUSBPort(name, probeStop)
			if !ok {
				return
			}
			select {
			case resultCh <- usbProbeResult{name, port, frames, pending}:
			default:
				port.Close() // another port already won the race
			}
		}(name)
	}
	go func() {
		wg.Wait()
		close(resultCh)
	}()

	select {
	case r, ok := <-resultCh:
		close(probeStop)
		if !ok {
			return
		}
		m.attach(r.name, r.port, r.frames, r.pending)
	case <-stop:
		close(probeStop)
	}
}

// probeUSBPort opens one port and listens for a valid PhoneGyro frame within
// usbProbeTimeout. On success it returns the still-open port plus whatever
// frames/leftover bytes were already read, so the handoff to the streaming
// reader loses nothing (in particular, a one-time metadata frame that
// happened to arrive during the probe window must not be discarded).
func probeUSBPort(name string, stop <-chan struct{}) (serial.Port, []hwproto.Frame, []byte, bool) {
	mode := &serial.Mode{BaudRate: hwproto.BaudRate, DataBits: 8, Parity: serial.NoParity, StopBits: serial.OneStopBit}
	port, err := serial.Open(name, mode)
	if err != nil {
		return nil, nil, nil, false
	}
	_ = port.SetReadTimeout(150 * time.Millisecond)

	var dec hwproto.Decoder
	deadline := time.Now().Add(usbProbeTimeout)
	buf := make([]byte, 128)
	for time.Now().Before(deadline) {
		select {
		case <-stop:
			port.Close()
			return nil, nil, nil, false
		default:
		}
		n, err := port.Read(buf)
		if err != nil {
			port.Close()
			return nil, nil, nil, false
		}
		if n == 0 {
			continue // read timeout, try again until deadline
		}
		if frames := dec.Push(buf[:n]); len(frames) > 0 {
			return port, frames, dec.Pending(), true
		}
	}
	port.Close()
	return nil, nil, nil, false
}

func (m *usbDeviceManager) attach(name string, port serial.Port, initial []hwproto.Frame, pending []byte) {
	m.mu.Lock()
	if !m.running {
		m.mu.Unlock()
		port.Close()
		return
	}
	m.port = port
	m.portName = name
	m.connected = true
	m.mu.Unlock()

	m.app.logEvent("INFO", "USB: PhoneGyro device found on %s", name)
	m.app.emitStateChange()

	go m.readLoop(port, name, initial, pending)
}

func (m *usbDeviceManager) readLoop(port serial.Port, name string, initial []hwproto.Frame, pending []byte) {
	state := newUSBConnState()
	for _, f := range initial {
		state.handle(f, m.app)
	}

	dec := hwproto.ResumeDecoder(pending)
	_ = port.SetReadTimeout(usbReadTimeout)
	buf := make([]byte, 256)

	// Protocol status for Live Debug, once a second (usb_status.go).
	lastReport, lastFrames := time.Now(), state.dataFrames
	report := func() {
		now := time.Now()
		if now.Sub(lastReport) < usbProtoEvery {
			return
		}
		rate := float64(state.dataFrames-lastFrames) / now.Sub(lastReport).Seconds()
		lastReport, lastFrames = now, state.dataFrames
		m.app.broadcastLiveDebugJSON(state.snapshot(now, name, &dec, rate))
	}
	defer m.app.broadcastLiveDebugJSON(usbProtoStatus{Type: "usb_proto"})

	lastFrameAt := time.Now()
	for {
		report()
		if !m.isConnected() {
			break
		}
		if time.Since(lastFrameAt) > usbSilenceTimeout {
			m.app.logEvent("WARN", "USB: no fresh data from %s for %s (%d replayed frames dropped), reconnecting",
				name, usbSilenceTimeout, state.duplicates)
			break
		}
		readStart := time.Now()
		n, err := port.Read(buf)
		if err != nil {
			break // device unplugged or port error: drop and let scanning resume
		}
		if n == 0 {
			if time.Since(readStart) < usbInstantRead {
				time.Sleep(usbSpinPause) // dead handle: the timeout was ignored
			}
			continue // read timeout; loop again so Stop() is noticed promptly
		}
		for _, f := range dec.Push(buf[:n]) {
			if state.handle(f, m.app) {
				lastFrameAt = time.Now()
			}
		}
	}

	m.mu.Lock()
	wasConnected := m.connected
	if m.port == port {
		m.port = nil
		m.connected = false
	}
	m.mu.Unlock()

	port.Close()
	if wasConnected {
		// Mirror the phone transport's OnClientDisconnect: clear this bank's
		// connection status so the UI actually falls back to the "waiting for
		// device" screen instead of showing stale connected/frozen telemetry.
		m.app.usbBank.hasClient.Store(false)
		m.app.usbBank.connectedAt = time.Time{}
		m.app.usbBank.deviceName.Store("Controller")
		m.app.logEvent("INFO", "USB: %s disconnected (%d frame(s) dropped this session)", name, state.droppedFrames)
		m.app.emitStateChange()
	}
}
