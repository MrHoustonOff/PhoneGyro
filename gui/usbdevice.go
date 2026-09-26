package main

import (
	"sync"
	"time"

	"go.bug.st/serial"

	"gyrobridge/pkg/server"
)

// USB host implementation of the PhoneGyro Hardware Protocol v1.0
// (https://github.com/MrHoustonOff/PhoneGyro_hardware_protocol). This is the
// host half of the contract: any device speaking the protocol is picked up
// automatically and fed into the exact same downstream pipeline the phone
// path uses (via server.Server.InjectMotionFrame), so calibration, sensor
// alignment, AHRS and DSU output behave identically regardless of source.
//
// This file deliberately contains no calibration/AHRS/DSU logic of its own:
// its only job is transport (find the device, decode its frames, convert
// raw register values to physical units) and handing the result to the core
// pipeline the same way a phone's WebSocket frame would.

const (
	usbFrameSize = 24
	usbMagic0    = 0xAA
	usbMagic1    = 0x55
	usbTypeMeta  = 0x00
	usbTypeData  = 0x01
	usbBaudRate  = 115200

	usbProbeTimeout  = 1500 * time.Millisecond
	usbRescanEvery   = 4 * time.Second
	usbReadTimeout   = 300 * time.Millisecond
	usbMetaGraceTime = 500 * time.Millisecond

	// Protocol Level 3 safe defaults, used until (or unless) a metadata frame
	// declares the device's real sensor range.
	usbDefaultGyroRangeDps = 250.0
	usbDefaultAccelRangeG  = 2.0
)

// usbFrame is one decoded 24-byte PhoneGyro frame, still in raw register units.
type usbFrame struct {
	Type        uint8
	Seq         uint8
	TimestampUs uint32
	Accel       [3]int16
	Gyro        [3]int16
	Temp        int16
	Buttons     uint8
}

// usbCRC8 is CRC-8/SMBUS: poly 0x07, init 0x00, no reflect, no final xor —
// the exact variant the protocol and reference firmware use.
func usbCRC8(data []byte) byte {
	var crc byte
	for _, b := range data {
		crc ^= b
		for i := 0; i < 8; i++ {
			if crc&0x80 != 0 {
				crc = (crc << 1) ^ 0x07
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

// usbFrameDecoder is a streaming, resynchronizing decoder: feed it arbitrary
// chunks of bytes as they arrive off the wire, get back however many whole,
// CRC-valid frames were found. On any corruption it drops one byte at a time
// until MAGIC lines up again (protocol Level 2/Level 5), so a single glitch
// never requires tearing down the connection.
type usbFrameDecoder struct {
	buf []byte
}

func (d *usbFrameDecoder) push(data []byte) []usbFrame {
	d.buf = append(d.buf, data...)
	var out []usbFrame
	for {
		f, consumed, ok := decodeOneUSBFrame(d.buf)
		if consumed == 0 {
			break // not enough bytes yet; wait for more
		}
		d.buf = d.buf[consumed:]
		if ok {
			out = append(out, f)
		}
	}
	return out
}

func decodeOneUSBFrame(buf []byte) (usbFrame, int, bool) {
	if len(buf) < 2 {
		return usbFrame{}, 0, false
	}
	if buf[0] != usbMagic0 || buf[1] != usbMagic1 {
		return usbFrame{}, 1, false // resync: drop one byte and look again
	}
	if len(buf) < usbFrameSize {
		return usbFrame{}, 0, false // wait for the rest of the frame
	}
	frame := buf[:usbFrameSize]
	if usbCRC8(frame[:usbFrameSize-1]) != frame[usbFrameSize-1] {
		return usbFrame{}, 2, false // coincidental MAGIC match, not a real frame
	}
	var f usbFrame
	f.Type = frame[2]
	f.Seq = frame[3]
	f.TimestampUs = uint32(frame[4]) | uint32(frame[5])<<8 | uint32(frame[6])<<16 | uint32(frame[7])<<24
	for k := 0; k < 3; k++ {
		f.Accel[k] = int16(uint16(frame[8+2*k]) | uint16(frame[9+2*k])<<8)
		f.Gyro[k] = int16(uint16(frame[14+2*k]) | uint16(frame[15+2*k])<<8)
	}
	f.Temp = int16(uint16(frame[20]) | uint16(frame[21])<<8)
	f.Buttons = frame[22]
	return f, usbFrameSize, true
}

// usbConnState is the per-connection decoding state: declared sensor range
// (protocol Level 3), sequence tracking for drop telemetry, and the reset
// button's edge state.
type usbConnState struct {
	gyroRangeDps float64
	accelRangeG  float64
	haveMeta     bool
	metaDeadline time.Time

	haveSeq       bool
	lastSeq       uint8
	droppedFrames uint64

	prevResetHeld bool
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
func (st *usbConnState) handle(f usbFrame, app *App) {
	switch f.Type {
	case usbTypeMeta:
		st.accelRangeG = metaRangeOrDefault(f.Accel[0], usbDefaultAccelRangeG)
		st.gyroRangeDps = metaRangeOrDefault(f.Accel[1], usbDefaultGyroRangeDps)
		st.haveMeta = true
	case usbTypeData:
		if !st.haveMeta && time.Now().After(st.metaDeadline) {
			st.haveMeta = true // give up waiting; declared/default range stands as-is
		}
		if st.haveSeq {
			gap := int(f.Seq) - int(st.lastSeq)
			if gap < 0 {
				gap += 256
			}
			if gap > 1 {
				st.droppedFrames += uint64(gap - 1)
			}
		}
		st.lastSeq, st.haveSeq = f.Seq, true

		// BUTTONS bit 0: reset centering, identical to the phone's recenter
		// action (protocol Level 5). Edge-triggered so holding it down
		// doesn't spam resets 200 times a second.
		held := f.Buttons&0x01 != 0
		if held && !st.prevResetHeld {
			app.TriggerRecenterFromHotkey()
		}
		st.prevResetHeld = held

		mf := server.MotionFrame{
			Timestamp:   uint32(time.Now().UnixMilli()),
			TimestampUs: uint64(f.TimestampUs),
			RotX:        float32(float64(f.Gyro[0]) / 32768.0 * st.gyroRangeDps),
			RotY:        float32(float64(f.Gyro[1]) / 32768.0 * st.gyroRangeDps),
			RotZ:        float32(float64(f.Gyro[2]) / 32768.0 * st.gyroRangeDps),
			AccX:        float32(float64(f.Accel[0]) / 32768.0 * st.accelRangeG),
			AccY:        float32(float64(f.Accel[1]) / 32768.0 * st.accelRangeG),
			AccZ:        float32(float64(f.Accel[2]) / 32768.0 * st.accelRangeG),
			// Qx/Qy/Qz/Qw stay zero: this reference transport carries no
			// on-device orientation estimate. attitudeanchor.go already
			// treats a near-zero quaternion as "no reference available" and
			// no-ops (see anchorMinQuatNorm in attitudeanchor.go) — exactly
			// the behavior we want here.
		}
		if app.srv != nil {
			app.srv.InjectMotionFrame(mf)
		}
	}
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
	frames  []usbFrame
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
func probeUSBPort(name string, stop <-chan struct{}) (serial.Port, []usbFrame, []byte, bool) {
	mode := &serial.Mode{BaudRate: usbBaudRate, DataBits: 8, Parity: serial.NoParity, StopBits: serial.OneStopBit}
	port, err := serial.Open(name, mode)
	if err != nil {
		return nil, nil, nil, false
	}
	_ = port.SetReadTimeout(150 * time.Millisecond)

	var dec usbFrameDecoder
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
		if frames := dec.push(buf[:n]); len(frames) > 0 {
			return port, frames, dec.buf, true
		}
	}
	port.Close()
	return nil, nil, nil, false
}

func (m *usbDeviceManager) attach(name string, port serial.Port, initial []usbFrame, pending []byte) {
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

func (m *usbDeviceManager) readLoop(port serial.Port, name string, initial []usbFrame, pending []byte) {
	state := newUSBConnState()
	for _, f := range initial {
		state.handle(f, m.app)
	}

	dec := usbFrameDecoder{buf: pending}
	_ = port.SetReadTimeout(usbReadTimeout)
	buf := make([]byte, 256)

	for {
		if !m.isConnected() {
			break
		}
		n, err := port.Read(buf)
		if err != nil {
			break // device unplugged or port error: drop and let scanning resume
		}
		if n == 0 {
			continue // read timeout; loop again so Stop() is noticed promptly
		}
		for _, f := range dec.push(buf[:n]) {
			state.handle(f, m.app)
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
		m.app.logEvent("INFO", "USB: %s disconnected (%d frame(s) dropped this session)", name, state.droppedFrames)
		m.app.emitStateChange()
	}
}
