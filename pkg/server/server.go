package server

import (
	"bytes"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"phonegyro/pkg/ca"
)

// MotionFrame represents telemetry received from mobile device sensors (50-byte or 46-byte binary payload).
type MotionFrame struct {
	Timestamp   uint32  `json:"ts"`
	TimestampUs uint64  `json:"ts_us,omitempty"`
	// Angular velocity in °/s for Cemuhook DSU
	RotX float32 `json:"rx"`
	RotY float32 `json:"ry"`
	RotZ float32 `json:"rz"`
	// Unit Quaternion (X, Y, Z, W) for SLERP interpolation and 3D visualization without Gimbal Lock
	Qx float32 `json:"qx"`
	Qy float32 `json:"qy"`
	Qz float32 `json:"qz"`
	Qw float32 `json:"qw"`
	// Acceleration in g (1g = 9.80665 m/s²) for Cemuhook DSU
	AccX float32 `json:"ax"`
	AccY float32 `json:"ay"`
	AccZ float32 `json:"az"`
	// Buttons and control flags bitmask
	Buttons uint16 `json:"buttons"`
	// SampleClock says what TimestampUs means (see SourceDeltaUs):
	// ClockNone — no usable device clock (legacy phone page: Date.now() at send);
	// ClockMicros32 / ClockMicros64 — device µs clock, and RotX/Y/Z is the mean
	// angular rate over exactly the interval since the previous frame's timestamp.
	SampleClock uint8 `json:"-"`
	// Phone page counters (58-byte frame), cumulative since page load:
	// SensorEvents — DeviceMotion events seen; SensorDropped — events whose
	// rotation was discarded (very long stall). Lets the app tell how many samples
	// had to share one packet and how many were really lost (gui/internal/link/loss.go).
	SensorEvents     uint32 `json:"-"`
	SensorDropped    uint32 `json:"-"`
	HasEventCounters bool   `json:"-"`
}

// Device clock kinds for MotionFrame.SampleClock.
const (
	ClockNone     uint8 = 0
	ClockMicros32 uint8 = 32 // wraps every ~71.6 min (USB firmware micros())
	ClockMicros64 uint8 = 64 // monotonic, never wraps (phone page integration clock)
)

// MaxSourceDeltaUs bounds a trusted device-clock interval. Anything longer (or
// non-positive) is a reconnect, page reload or clock reset, not a sample period.
const MaxSourceDeltaUs = 1_000_000

// SourceDeltaUs returns the device-clock interval between two frames' TimestampUs
// and whether it can be trusted as the period the frame's rate covers. 32-bit
// clocks are subtracted modulo 2^32, so the USB micros() wrap is not a reset.
func SourceDeltaUs(prev, cur uint64, clock uint8) (uint64, bool) {
	var d uint64
	switch clock {
	case ClockMicros32:
		d = uint64(uint32(cur) - uint32(prev))
	case ClockMicros64:
		if cur <= prev {
			return 0, false
		}
		d = cur - prev
	default:
		return 0, false
	}
	return d, d > 0 && d <= MaxSourceDeltaUs
}

// Server encapsulates both HTTP (for certificate distribution) and HTTPS+WSS for gamepad traffic.
type Server struct {
	caManager   *ca.CertificateManager
	httpPort    int
	httpsPort   int
	webContent  []byte
	listenMu    sync.Mutex
	httpServer  *http.Server
	httpsServer *http.Server
	upgrader    websocket.Upgrader
	onFrame     func(frame MotionFrame)
	packetCount   atomic.Uint64
	currentHzBits atomic.Uint64
	activeClient  atomic.Int32
	stopChan      chan struct{}

	// HTTPMux and HTTPSMux are created at construction time so that external
	// modules (e.g. the 3D visualizer) can register additional routes before Start().
	HTTPMux  *http.ServeMux
	HTTPSMux *http.ServeMux

	// Lifecycle event hooks for clean, non-spammy logging
	OnClientConnect    func(remoteAddr string)
	OnClientDisconnect func(remoteAddr string)
	OnClientDevice     func(device string)
	OnClientVisibility func(visible bool)

	inputModeMu sync.RWMutex
	inputMode   string // "phone" (default) or "usb"

	clientMu    sync.Mutex
	clientConns map[*websocket.Conn]*sync.Mutex

	// rtt is the latest phone connection's PING/PONG round-trip meter (linkrtt.go).
	rtt atomic.Pointer[linkRTT]
}

// NewServer initializes HTTP and HTTPS server instances.
func NewServer(caMgr *ca.CertificateManager, httpPort, httpsPort int, webHTML []byte, onFrame func(MotionFrame)) *Server {
	httpMux  := http.NewServeMux()
	httpsMux := http.NewServeMux()

	s := &Server{
		caManager:   caMgr,
		httpPort:    httpPort,
		httpsPort:   httpsPort,
		webContent:  webHTML,
		onFrame:     onFrame,
		stopChan:    make(chan struct{}),
		HTTPMux:     httpMux,
		HTTPSMux:    httpsMux,
		clientConns: make(map[*websocket.Conn]*sync.Mutex),
		inputMode:   "phone",
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: sameOrigin,
		},
	}

	// Register core routes
	httpMux.HandleFunc("/ca.mobileconfig", s.handleMobileConfig)
	httpMux.HandleFunc("/ca.crt", s.handleRawCACert)
	httpMux.HandleFunc("/api/mode", s.handleAPIMode)

	httpsMux.HandleFunc("/ca.mobileconfig", s.handleMobileConfig)
	httpsMux.HandleFunc("/ca.crt", s.handleRawCACert)
	httpsMux.HandleFunc("/api/mode", s.handleAPIMode)
	httpsMux.HandleFunc("/ws", s.handleWebSocket)
	httpsMux.HandleFunc("/", s.handleWebClient)

	// HTTP root catch-all: redirect to HTTPS (registered last so specific routes win)
	httpMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			host = h
		}
		s.listenMu.Lock()
		httpsPort := s.httpsPort
		s.listenMu.Unlock()
		target := fmt.Sprintf("https://%s%s", net.JoinHostPort(host, strconv.Itoa(httpsPort)), r.URL.RequestURI())
		http.Redirect(w, r, target, http.StatusTemporaryRedirect)
	})

	return s
}

// Start launches both servers. All routes must be registered before calling Start.
func (s *Server) Start() error {
	if err := s.listen(); err != nil {
		return err
	}
	go s.rateMonitorLoop()
	return nil
}

// listen opens both listeners on s.httpPort / s.httpsPort and serves them.
func (s *Server) listen() error {
	s.listenMu.Lock()
	httpPort, httpsPort := s.httpPort, s.httpsPort
	s.listenMu.Unlock()
	// Only GetCertificate, no static Certificates: with both set, crypto/tls
	// serves the static one to every client without SNI -- the phone connects
	// by IP, so a leaf re-signed for a new IP (ca.AddHostIPs) would never reach it.
	tlsConfig := &tls.Config{
		GetCertificate: s.caManager.GetCertificate,
		MinVersion:     tls.VersionTLS12,
	}

	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", httpPort),
		Handler:           s.HTTPMux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	httpsServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", httpsPort),
		Handler:           s.HTTPSMux,
		TLSConfig:         tlsConfig,
		ReadHeaderTimeout: 10 * time.Second,
	}

	httpListener, err := net.Listen("tcp", httpServer.Addr)
	if err != nil {
		return fmt.Errorf("failed to bind HTTP port %d: %w", httpPort, err)
	}

	httpsListener, err := tls.Listen("tcp", httpsServer.Addr, tlsConfig)
	if err != nil {
		httpListener.Close()
		return fmt.Errorf("failed to bind HTTPS port %d: %w", httpsPort, err)
	}

	s.listenMu.Lock()
	s.httpServer, s.httpsServer = httpServer, httpsServer
	s.listenMu.Unlock()
	go httpServer.Serve(httpListener)
	go httpsServer.Serve(httpsListener)
	return nil
}

// closeListeners stops both HTTP servers (open phone sockets are hijacked
// connections and stay up).
func (s *Server) closeListeners() {
	s.listenMu.Lock()
	h, hs := s.httpServer, s.httpsServer
	s.listenMu.Unlock()
	if h != nil {
		h.Close()
	}
	if hs != nil {
		hs.Close()
	}
}

// Rebind moves a running server to new ports. On error it goes back to the old
// ones and returns the error. Before Start it only sets the ports Start will use.
func (s *Server) Rebind(httpPort, httpsPort int) error {
	s.listenMu.Lock()
	oldHTTP, oldHTTPS := s.httpPort, s.httpsPort
	started := s.httpServer != nil
	s.listenMu.Unlock()
	if !started {
		s.setPorts(httpPort, httpsPort)
		return nil
	}
	s.closeListeners()
	s.setPorts(httpPort, httpsPort)
	err := s.listen()
	if err != nil {
		s.setPorts(oldHTTP, oldHTTPS)
		_ = s.listen()
	}
	return err
}

func (s *Server) setPorts(httpPort, httpsPort int) {
	s.listenMu.Lock()
	s.httpPort, s.httpsPort = httpPort, httpsPort
	s.listenMu.Unlock()
}

// Stop gracefully shuts down both servers.
func (s *Server) Stop() {
	select {
	case <-s.stopChan:
	default:
		close(s.stopChan)
	}
	s.closeListeners()
}

func (s *Server) rateMonitorLoop() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	var lastPackets uint64
	lastTime := time.Now()

	for {
		select {
		case <-s.stopChan:
			return
		case now := <-ticker.C:
			curr := s.packetCount.Load()
			diff := curr - lastPackets
			elapsed := now.Sub(lastTime).Seconds()
			if elapsed > 0 {
				hz := float64(diff) / elapsed
				s.currentHzBits.Store(math.Float64bits(hz))
			}
			lastPackets = curr
			lastTime = now
		}
	}
}

func (s *Server) handleMobileConfig(w http.ResponseWriter, r *http.Request) {
	configBytes, err := s.caManager.GenerateMobileConfig()
	if err != nil {
		http.Error(w, "Failed to generate profile: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Mandatory Apple MIME-type to trigger "Profile Downloaded" sheet in Safari
	w.Header().Set("Content-Type", "application/x-apple-as-config")
	w.Header().Set("Content-Disposition", "attachment; filename=\"phonegyro.mobileconfig\"")
	w.WriteHeader(http.StatusOK)
	w.Write(configBytes)
}

func (s *Server) handleRawCACert(w http.ResponseWriter, r *http.Request) {
	pemBytes := s.caManager.RootCertPEM()
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", "attachment; filename=\"phonegyro-ca.crt\"")
	w.WriteHeader(http.StatusOK)
	w.Write(pemBytes)
}

func (s *Server) handleWebClient(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.WriteHeader(http.StatusOK)
	w.Write(s.webContent)
}

const (
	wsReadDeadline = 30 * time.Second // connection dies if no client frame in this window
	wsPingInterval = 1 * time.Second  // server→client keepalive ping interval (also the RTT sample rate, linkrtt.go)
	wsPingText     = "PING"           // client listens for this and resets its own watchdog
	wsMaxMessage   = 4096             // a frame is 58 bytes, a control message well under 1 KB
)

// sameOrigin lets the phone page open the socket (its Origin is this server)
// and clients that send no Origin at all; a web page from anywhere else cannot.
func sameOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	u, err := url.Parse(o)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

// DisconnectAllClients forcefully closes all active client WebSocket connections.
func (s *Server) DisconnectAllClients() {
	s.clientMu.Lock()
	defer s.clientMu.Unlock()
	for conn := range s.clientConns {
		_ = conn.Close()
	}
}

// SetAppVersion substitutes every "__APP_VERSION__" placeholder in the served web
// client with display (e.g. "1.1.3.017-dev"), so the phone shows the same build
// identity as the desktop app footer. A no-op if the placeholder isn't present (the
// page was changed, or this is never called) — the client just keeps the literal
// placeholder text rather than failing to load.
func (s *Server) SetAppVersion(display string) {
	s.webContent = bytes.ReplaceAll(s.webContent, []byte("__APP_VERSION__"), []byte(display))
}

// SetInputMode changes the active input mode ("phone" or "usb").
// When switching to "usb", it broadcasts a mode change to any connected phone clients and closes them.
func (s *Server) SetInputMode(mode string) {
	if mode != "usb" {
		mode = "phone"
	}
	s.inputModeMu.Lock()
	prev := s.inputMode
	s.inputMode = mode
	s.inputModeMu.Unlock()

	if mode == "usb" && prev != "usb" {
		s.BroadcastModeBlocked("usb")
		s.DisconnectAllClients()
	}
}

// GetInputMode returns the current input mode ("phone" or "usb").
func (s *Server) GetInputMode() string {
	s.inputModeMu.RLock()
	defer s.inputModeMu.RUnlock()
	if s.inputMode == "" {
		return "phone"
	}
	return s.inputMode
}

// BroadcastModeBlocked notifies all connected WebSocket clients that the mode has changed to a blocked state.
func (s *Server) BroadcastModeBlocked(mode string) {
	s.clientMu.Lock()
	defer s.clientMu.Unlock()
	payload, _ := json.Marshal(map[string]interface{}{
		"type":    "mode",
		"mode":    mode,
		"blocked": true,
	})
	for conn, writeMu := range s.clientConns {
		writeMu.Lock()
		_ = conn.SetWriteDeadline(time.Now().Add(500 * time.Millisecond))
		_ = conn.WriteMessage(websocket.TextMessage, payload)
		writeMu.Unlock()
	}
}

func (s *Server) handleAPIMode(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"mode": s.GetInputMode(),
	})
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// If server is in USB/hardware mode, phone connections are disallowed
	if s.GetInputMode() == "usb" {
		conn, err := s.upgrader.Upgrade(w, r, nil)
		if err == nil {
			payload, _ := json.Marshal(map[string]interface{}{
				"type":    "mode",
				"mode":    "usb",
				"blocked": true,
			})
			_ = conn.SetWriteDeadline(time.Now().Add(1 * time.Second))
			_ = conn.WriteMessage(websocket.TextMessage, payload)
			_ = conn.Close()
		}
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.EnableWriteCompression(false)
	conn.SetReadLimit(wsMaxMessage)

	// Optimize underlying TCP connection for ultra-low latency & keepalive.
	// For WSS connections, conn.UnderlyingConn() is *tls.Conn, which wraps the raw *net.TCPConn.
	rawConn := conn.UnderlyingConn()
	if tlsConn, ok := rawConn.(*tls.Conn); ok {
		rawConn = tlsConn.NetConn()
	}
	if tcpConn, ok := rawConn.(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
		_ = tcpConn.SetKeepAlive(true)
		_ = tcpConn.SetKeepAlivePeriod(10 * time.Second)
		_ = tcpConn.SetReadBuffer(64 * 1024)
		_ = tcpConn.SetWriteBuffer(64 * 1024)
	}

	remoteAddr := r.RemoteAddr
	s.activeClient.Add(1)
	if s.OnClientConnect != nil {
		s.OnClientConnect(remoteAddr)
	}
	if dev := r.URL.Query().Get("device"); dev != "" && s.OnClientDevice != nil {
		s.OnClientDevice(dev)
	}

	writeMu := &sync.Mutex{}
	s.clientMu.Lock()
	s.clientConns[conn] = writeMu
	s.clientMu.Unlock()

	defer func() {
		s.clientMu.Lock()
		delete(s.clientConns, conn)
		s.clientMu.Unlock()

		s.activeClient.Add(-1)
		if s.OnClientDisconnect != nil {
			s.OnClientDisconnect(remoteAddr)
		}
	}()

	// Arm initial read deadline
	conn.SetReadDeadline(time.Now().Add(wsReadDeadline))

	// Server→client keepalive goroutine.
	// Sends "PING" text frames so the client can detect server-side silence
	// independent of the OS TCP keepalive timer (~2 min default).
	done := make(chan struct{})
	defer close(done)

	// Round-trip meter for this connection; the newest connection is the one reported.
	rtt := &linkRTT{}
	s.rtt.Store(rtt)
	defer s.rtt.CompareAndSwap(rtt, nil)

	go func() {
		t := time.NewTicker(wsPingInterval)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				writeMu.Lock()
				conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				rtt.pingSent(time.Now())
				err := conn.WriteMessage(websocket.TextMessage, []byte(wsPingText))
				writeMu.Unlock()
				if err != nil {
					return // connection dead, exit silently; defer conn.Close() handles cleanup
				}
			}
		}
	}()

	// Read telemetry frames (binary or JSON)
	lastDeadlineRenew := time.Now()
	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		// Refresh read deadline periodically (every 2s) instead of every frame
		// Eliminates ~100 redundant timer/syscalls per second while streaming!
		now := time.Now()
		if now.Sub(lastDeadlineRenew) >= 2*time.Second {
			_ = conn.SetReadDeadline(now.Add(wsReadDeadline))
			lastDeadlineRenew = now
		}

		// Check for client keepalive PONG
		if msgType == websocket.TextMessage && string(message) == "PONG" {
			rtt.pongReceived(now)
			_ = conn.SetReadDeadline(time.Now().Add(wsReadDeadline))
			continue
		}

		// Check for text control messages (the phone reports its device model / visibility)
		if msgType == websocket.TextMessage {
			var ctrl struct {
				Type    string `json:"type"`
				Model   string `json:"model"`
				Visible *bool  `json:"visible"`
			}
			if err := json.Unmarshal(message, &ctrl); err == nil && ctrl.Type != "" {
				// A control message is never a motion frame, even one this
				// server does not act on (it would decode as all zeros).
				if ctrl.Type == "device" && ctrl.Model != "" && s.OnClientDevice != nil {
					s.OnClientDevice(ctrl.Model)
				}
				if ctrl.Type == "visibility" && ctrl.Visible != nil && s.OnClientVisibility != nil {
					s.OnClientVisibility(*ctrl.Visible)
				}
				continue
			}
		}

		frame, ok := s.parseFrame(msgType, message)
		if !ok {
			continue
		}

		s.packetCount.Add(1)

		if s.onFrame != nil {
			s.onFrame(frame)
		}
	}
}

func (s *Server) parseFrame(msgType int, data []byte) (MotionFrame, bool) {
	// Fast binary decoding for 50-byte layout (uint64 ts_us, 3x float32 rotRate, 4x float32 quat, 3x float32 accel, uint16 buttons),
	// optionally followed by uint32 sensor events + uint32 dropped events (58 bytes, current phone page)
	if msgType == websocket.BinaryMessage && len(data) >= 50 {
		tsUs := binary.LittleEndian.Uint64(data[0:8])
		rx := math.Float32frombits(binary.LittleEndian.Uint32(data[8:12]))
		ry := math.Float32frombits(binary.LittleEndian.Uint32(data[12:16]))
		rz := math.Float32frombits(binary.LittleEndian.Uint32(data[16:20]))

		qx := math.Float32frombits(binary.LittleEndian.Uint32(data[20:24]))
		qy := math.Float32frombits(binary.LittleEndian.Uint32(data[24:28]))
		qz := math.Float32frombits(binary.LittleEndian.Uint32(data[28:32]))
		qw := math.Float32frombits(binary.LittleEndian.Uint32(data[32:36]))

		ax := math.Float32frombits(binary.LittleEndian.Uint32(data[36:40]))
		ay := math.Float32frombits(binary.LittleEndian.Uint32(data[40:44]))
		az := math.Float32frombits(binary.LittleEndian.Uint32(data[44:48]))

		buttons := binary.LittleEndian.Uint16(data[48:50])

		var events, dropped uint32
		hasCounters := len(data) >= 58
		if hasCounters {
			events = binary.LittleEndian.Uint32(data[50:54])
			dropped = binary.LittleEndian.Uint32(data[54:58])
		}

		return MotionFrame{
			Timestamp:        uint32(tsUs / 1000),
			TimestampUs:      tsUs,
			SampleClock:      ClockMicros64,
			SensorEvents:     events,
			SensorDropped:    dropped,
			HasEventCounters: hasCounters,
			RotX:             rx,
			RotY:             ry,
			RotZ:             rz,
			Qx:               qx,
			Qy:               qy,
			Qz:               qz,
			Qw:               qw,
			AccX:             ax,
			AccY:             ay,
			AccZ:             az,
			Buttons:          buttons,
		}, true
	}

	// Legacy binary decoding (46 bytes: uint32 ts_ms, 3x float32 rotRate, 4x float32 quat, 3x float32 accel, uint16 buttons)
	if msgType == websocket.BinaryMessage && len(data) >= 46 {
		ts := binary.LittleEndian.Uint32(data[0:4])
		rx := math.Float32frombits(binary.LittleEndian.Uint32(data[4:8]))
		ry := math.Float32frombits(binary.LittleEndian.Uint32(data[8:12]))
		rz := math.Float32frombits(binary.LittleEndian.Uint32(data[12:16]))

		qx := math.Float32frombits(binary.LittleEndian.Uint32(data[16:20]))
		qy := math.Float32frombits(binary.LittleEndian.Uint32(data[20:24]))
		qz := math.Float32frombits(binary.LittleEndian.Uint32(data[24:28]))
		qw := math.Float32frombits(binary.LittleEndian.Uint32(data[28:32]))

		ax := math.Float32frombits(binary.LittleEndian.Uint32(data[32:36]))
		ay := math.Float32frombits(binary.LittleEndian.Uint32(data[36:40]))
		az := math.Float32frombits(binary.LittleEndian.Uint32(data[40:44]))

		buttons := binary.LittleEndian.Uint16(data[44:46])

		return MotionFrame{
			Timestamp:   ts,
			TimestampUs: uint64(ts) * 1000,
			RotX:        rx,
			RotY:        ry,
			RotZ:        rz,
			Qx:          qx,
			Qy:          qy,
			Qz:          qz,
			Qw:          qw,
			AccX:        ax,
			AccY:        ay,
			AccZ:        az,
			Buttons:     buttons,
		}, true
	}

	// JSON fallback
	var frame MotionFrame
	if err := json.Unmarshal(data, &frame); err == nil {
		if frame.TimestampUs == 0 && frame.Timestamp > 0 {
			frame.TimestampUs = uint64(frame.Timestamp) * 1000
		}
		return frame, true
	}

	return frame, false
}

// InjectMotionFrame feeds a MotionFrame into the exact same pipeline used for
// frames received over the phone's WebSocket connection (same onFrame
// callback, same packet-rate accounting for PacketStats). Non-network motion
// sources — e.g. a USB serial device implementing the PhoneGyro Hardware
// Protocol — call this instead of duplicating any downstream logic, so
// calibration, sensor alignment, AHRS and DSU output behave identically
// regardless of where the frame came from.
func (s *Server) InjectMotionFrame(frame MotionFrame) {
	s.packetCount.Add(1)
	if s.onFrame != nil {
		s.onFrame(frame)
	}
}

// PacketStats returns total received packets, current active connections, and current polling rate in Hz.
func (s *Server) PacketStats() (uint64, int32, float64) {
	total := s.packetCount.Load()
	clients := s.activeClient.Load()
	hz := math.Float64frombits(s.currentHzBits.Load())
	return total, clients, hz
}

// QuaternionToEuler converts Cemuhook SO(3) unit quaternion (Qx=Pitch, Qy=Yaw, Qz=-Roll, Qw=W)
// to intuitive Euler angles (Pitch, Roll, Yaw) in degrees:
// - Pitch > 0: phone tilted forward (nose down); Pitch < 0: phone tilted backward (nose up)
// - Roll  > 0: phone tilted right; Roll < 0: phone tilted left
// - Yaw: rotation around vertical Y axis (compass heading / spin on table)
func QuaternionToEuler(qx, qy, qz, qw float32) (pitch, roll, yaw float64) {
	// Pitch (rotation around X axis: forward/backward tilt)
	sinp := 2 * (float64(qw)*float64(qx) - float64(qy)*float64(qz))
	if math.Abs(sinp) >= 1 {
		pitch = math.Copysign(90.0, sinp)
	} else {
		pitch = math.Asin(sinp) * 180 / math.Pi
	}

	// Roll (rotation around Z axis: left/right tilt; positive = tilt right)
	sinr := 2 * (float64(qw)*float64(qz) + float64(qx)*float64(qy))
	cosr := 1 - 2*(float64(qz)*float64(qz) + float64(qx)*float64(qx))
	roll = -math.Atan2(sinr, cosr) * 180 / math.Pi

	// Yaw (rotation around Y axis: spin on table; positive = turning right)
	siny := 2 * (float64(qw)*float64(qy) + float64(qx)*float64(qz))
	cosy := 1 - 2*(float64(qx)*float64(qx) + float64(qy)*float64(qy))
	yaw = -math.Atan2(siny, cosy) * 180 / math.Pi

	return pitch, roll, yaw
}

