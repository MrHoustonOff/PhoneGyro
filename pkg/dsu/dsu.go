package dsu

import (
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"math"
	"math/rand"
	"net"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"phonegyro/pkg/server"
)

const (
	DefaultPort = 26760
	MagicServer = "DSUS"
	MagicClient = "DSUC"
	ProtocolVer = 1001

	MsgTypeVersion   = 0x100000
	MsgTypeListPorts = 0x100001
	MsgTypePadData   = 0x100002

	SlotStateDisconnected = 0
	SlotStateConnected    = 2
	ModelFullGamepad      = 2
	ConnTypeBluetooth     = 2
	BatteryFull           = 5
)

// ClientSub represents an active client (Cemu / PadTest / Dolphin) subscribed to motion stream.
type ClientSub struct {
	Addr        *net.UDPAddr
	LastSeen    time.Time
	ConnectedAt time.Time // the list is ordered by it (stable in the UI)
	// CemuGuard: this client is Cemu and gets the drift guard's correction
	// packets (cemubias.go). Set by the app, which knows the program's name.
	CemuGuard bool
	cemu      cemuBiasModel // what Cemu's filter makes of the packets we sent
}

// kickedClient is a client the user disconnected (Server.Kick).
type kickedClient struct {
	addr     *net.UDPAddr
	kickedAt time.Time // the list of kicked clients is ordered by it
	lastSeen time.Time // its last request
}

var padPacketPool = sync.Pool{
	New: func() interface{} {
		b := make([]byte, 100)
		return &b
	},
}

// Server implements Cemuhook DSU motion protocol over UDP.
type Server struct {
	port          int
	conn          atomic.Pointer[net.UDPConn] // swapped by Rebind
	serverID      uint32
	packetCounter uint32
	macAddr       [6]byte

	clientsMu sync.RWMutex
	clients   map[string]*ClientSub
	// kicked: clients the user disconnected, by address. Their requests are
	// ignored until they stay silent for kickedUntilSilent or the user brings
	// them back (Readmit) (under clientsMu).
	kicked map[string]*kickedClient

	lastFrameMu    sync.RWMutex
	lastMotionTime time.Time
	lastFrame      server.MotionFrame

	stopChan chan struct{}
	running  atomic.Bool

	// DSU timestamp chain (see stampMotion). Clients integrate RotX/Y/Z over the
	// delta between consecutive packet timestamps, so for device frames that
	// delta must be the device's own sample interval, not our send time.
	timeMu         sync.Mutex
	currentDsuTsUs uint64    // last timestamp handed out (strictly increasing)
	lastStampWall  time.Time // wall time when currentDsuTsUs was handed out
	srcPrevTsUs    uint64    // previous device frame's TimestampUs
	srcClock       uint8     // its server.MotionFrame.SampleClock
	haveSrc        bool

	// Lifecycle event hooks for clean, non-spammy logging
	OnClientConnect    func(addr *net.UDPAddr)
	OnClientDisconnect func(addr *net.UDPAddr)
}

// GenerateRandomMAC generates a randomized 6-byte Cemuhook MAC with standard prefix 00:13:37.
func GenerateRandomMAC() [6]byte {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	return [6]byte{0x00, 0x13, 0x37, byte(r.Intn(256)), byte(r.Intn(256)), byte(r.Intn(256))}
}

// NewServer creates a new Cemuhook DSU server.
// If port < 0, it defaults to 26760. If port == 0, OS allocates a dynamic port.
// Optional mac parameter specifies the fixed MAC address. If omitted or zero, a random MAC is generated.
func NewServer(port int, mac ...[6]byte) *Server {
	if port < 0 {
		port = DefaultPort
	}

	var m [6]byte
	if len(mac) > 0 && mac[0] != [6]byte{} {
		m = mac[0]
	} else {
		m = GenerateRandomMAC()
	}

	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	s := &Server{
		port:     port,
		serverID: r.Uint32(),
		macAddr:  m,
		clients:  make(map[string]*ClientSub),
		stopChan: make(chan struct{}),
	}

	return s
}

// SetMACAddress dynamically updates the server MAC address.
func (s *Server) SetMACAddress(mac [6]byte) {
	s.clientsMu.Lock()
	s.macAddr = mac
	s.clientsMu.Unlock()
}

// MACAddress returns current server MAC address.
func (s *Server) MACAddress() [6]byte {
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()
	return s.macAddr
}

// ClientInfo describes a connected DSU emulator client with detailed network metrics.
type ClientInfo struct {
	Address    string `json:"address"`
	IP         string `json:"ip"`
	Port       int    `json:"port"`
	LastSeenMs int64  `json:"lastSeenMs"`
	Active     bool   `json:"active"`
	// CemuBias is the gyro bias (deg/s) Cemu's filter would hold if this client
	// is Cemu, replayed from the packets sent since it subscribed (cemubias.go).
	ConnectedAtMs int64      `json:"connectedAtMs"` // unix ms; the list is sorted by it
	CemuBias      [3]float64 `json:"cemuBias"`
	CemuSamples   uint64     `json:"cemuSamples"`
	CemuGuard     bool       `json:"cemuGuard"`
}

// ActiveClientCount returns the number of currently active DSU subscribers.
func (s *Server) ActiveClientCount() int {
	if s == nil {
		return 0
	}
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()
	return len(s.clients)
}

// GetClientsInfo returns a snapshot list of currently subscribed emulator clients.
func (s *Server) GetClientsInfo() []ClientInfo {
	if s == nil {
		return nil
	}
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()

	now := time.Now()
	res := make([]ClientInfo, 0, len(s.clients))
	for _, c := range s.clients {
		ms := now.Sub(c.LastSeen).Milliseconds()
		res = append(res, ClientInfo{
			Address:       c.Addr.String(),
			IP:            c.Addr.IP.String(),
			Port:          c.Addr.Port,
			LastSeenMs:    ms,
			Active:        ms < 3500,
			CemuBias:      c.cemu.biasDps(),
			CemuSamples:   c.cemu.n,
			CemuGuard:     c.CemuGuard,
			ConnectedAtMs: c.ConnectedAt.UnixMilli(),
		})
	}
	// Map order is random: without this the UI list shuffled on every update.
	sort.SliceStable(res, func(i, j int) bool {
		if res[i].ConnectedAtMs != res[j].ConnectedAtMs {
			return res[i].ConnectedAtMs < res[j].ConnectedAtMs
		}
		return res[i].Address < res[j].Address
	})
	return res
}

// Start opens UDP socket and begins listening for Cemu requests.
func (s *Server) Start() error {
	conn, err := listenDSU(s.port)
	if err != nil {
		return err
	}
	s.conn.Store(conn)
	s.running.Store(true)

	go s.listenLoop()
	go s.cleanupLoop()
	go s.heartbeatLoop()

	return nil
}

func listenDSU(port int) (*net.UDPConn, error) {
	conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: port, IP: net.IPv4zero})
	if err != nil {
		return nil, fmt.Errorf("failed to bind DSU UDP port %d: %w", port, err)
	}
	_ = conn.SetReadBuffer(64 * 1024)
	_ = conn.SetWriteBuffer(64 * 1024)
	return conn, nil
}

// Rebind moves a running server to another port in place: the server, its
// callbacks and its timestamp chain stay, so nothing holding it has to swap
// pointers. On error the server keeps its old port. Before Start it only sets
// the port Start will use.
func (s *Server) Rebind(port int) error {
	if !s.running.Load() {
		s.port = port
		return nil
	}
	conn, err := listenDSU(port)
	if err != nil {
		return err
	}
	s.port = port
	if old := s.conn.Swap(conn); old != nil {
		old.Close() // listenLoop's read fails and it carries on with the new socket
	}
	return nil
}

// Stop terminates the DSU server.
func (s *Server) Stop() {
	if s.running.CompareAndSwap(true, false) {
		close(s.stopChan)
		if c := s.conn.Load(); c != nil {
			c.Close()
		}
	}
}

// SendMotion converts MotionFrame into a 100-byte Cemuhook DSU packet and sends to all active clients.
func (s *Server) SendMotion(frame server.MotionFrame) {
	if !s.running.Load() {
		return
	}

	s.lastFrameMu.Lock()
	prev := s.lastFrame
	s.lastFrame = frame
	s.lastMotionTime = time.Now()
	s.lastFrameMu.Unlock()

	s.clientsMu.Lock()
	// Corrections go out before this frame is stamped: they take the microsecond
	// right after the previous packet, and this frame still spans its interval.
	s.sendCemuCorrectionsLocked(prev)
	// Stamp even with no clients: the chain must see every device frame, or the
	// first packet after a client subscribes would span an arbitrary interval.
	ts := s.stampMotion(frame)
	if len(s.clients) == 0 {
		s.clientsMu.Unlock()
		return // Fast path: zero emulators subscribed, zero allocations, zero packet work!
	}

	packetNum := atomic.AddUint32(&s.packetCounter, 1)

	// Acquire pooled buffer (Zero heap allocations in the hot path!)
	bufPtr := padPacketPool.Get().(*[]byte)
	pkt := *bufPtr
	s.fillPadDataPacket(pkt, packetNum, frame, ts)

	for _, client := range s.clients {
		_, _ = s.conn.Load().WriteToUDP(pkt, client.Addr)
		client.cemu.add(frame.RotX, frame.RotY, frame.RotZ)
	}
	s.clientsMu.Unlock()

	padPacketPool.Put(bufPtr)
}

// SkipMotion accounts a device frame that is deliberately not sent (paused
// output): the next sent frame's rate only covers the interval since THIS one,
// so the timestamp chain must advance its device-clock reference past it.
func (s *Server) SkipMotion(frame server.MotionFrame) {
	s.timeMu.Lock()
	defer s.timeMu.Unlock()
	if frame.SampleClock == server.ClockNone {
		s.haveSrc = false
		return
	}
	s.srcPrevTsUs, s.srcClock, s.haveSrc = frame.TimestampUs, frame.SampleClock, true
}

func (s *Server) fillPadDataPacket(buf []byte, packetNum uint32, frame server.MotionFrame, tsUs uint64) {
	// Total size: 100 bytes (20 bytes header + 80 bytes payload)
	// --- 1. Header (20 bytes) ---
	copy(buf[0:4], MagicServer)
	binary.LittleEndian.PutUint16(buf[4:6], ProtocolVer)
	binary.LittleEndian.PutUint16(buf[6:8], 80+4) // length: payload (80) + msgType (4)
	binary.LittleEndian.PutUint32(buf[8:12], 0)   // CRC32 initialized to 0
	binary.LittleEndian.PutUint32(buf[12:16], s.serverID)
	binary.LittleEndian.PutUint32(buf[16:20], MsgTypePadData)

	// --- 2. Payload (80 bytes, offsets relative to 20) ---
	p := buf[20:]
	p[0] = 0                    // Slot 0
	p[1] = SlotStateConnected   // 2 = Connected
	p[2] = ModelFullGamepad     // 2 = Full Gyro Gamepad
	p[3] = ConnTypeBluetooth    // 2 = Bluetooth / Wireless
	copy(p[4:10], s.macAddr[:]) // MAC Address
	p[10] = BatteryFull         // 5 = Full Battery
	p[11] = 1                   // Active state

	binary.LittleEndian.PutUint32(p[12:16], packetNum)

	// Buttons & Joysticks (centered at 128)
	p[20] = 128 // Left Stick X
	p[21] = 128 // Left Stick Y
	p[22] = 128 // Right Stick X
	p[23] = 128 // Right Stick Y

	// Strictly monotonic timestamp in microseconds (offset 48..56), see stampMotion
	binary.LittleEndian.PutUint64(p[48:56], tsUs)

	// Accelerometer in g: AccX, AccY, AccZ (offsets 56..68)
	binary.LittleEndian.PutUint32(p[56:60], float32ToBits(frame.AccX))
	binary.LittleEndian.PutUint32(p[60:64], float32ToBits(frame.AccY))
	binary.LittleEndian.PutUint32(p[64:68], float32ToBits(frame.AccZ))

	// Gyroscope in °/s: Pitch (X), Yaw (Y), Roll (Z) (offsets 68..80)
	binary.LittleEndian.PutUint32(p[68:72], float32ToBits(frame.RotX))
	binary.LittleEndian.PutUint32(p[72:76], float32ToBits(frame.RotY))
	binary.LittleEndian.PutUint32(p[76:80], float32ToBits(frame.RotZ))

	// --- 3. Compute IEEE 802.3 CRC32 over entire 100 bytes ---
	crc := crc32.ChecksumIEEE(buf)
	binary.LittleEndian.PutUint32(buf[8:12], crc)
}

// BuildPadDataPacket builds and returns a newly allocated 100-byte packet (useful for tests).
func (s *Server) BuildPadDataPacket(packetNum uint32, frame server.MotionFrame) []byte {
	buf := make([]byte, 100)
	s.fillPadDataPacket(buf, packetNum, frame, s.stampMotion(frame))
	return buf
}

// nominalFrameUs is the interval assumed for a device frame whose own interval
// is unknown (first frame, reconnect, clock reset): one 60 Hz frame, never more
// than the wall time actually elapsed. Long enough not to drop a real frame's
// rotation, short enough that a stale rate is never integrated over a long gap.
const nominalFrameUs = 16_667

// stampMotion returns the DSU timestamp for a device frame.
//
// Clients (Cemu, yuzu-family, PadTest) integrate RotX/Y/Z * (ts - previous ts).
// With a device clock (MotionFrame.SampleClock) the delta is exactly the device
// interval the rate was averaged over, so network bursts and stalls no longer
// change how much rotation a client integrates. Without one (legacy phone page)
// the delta is the wall time since the previous packet, as before.
func (s *Server) stampMotion(frame server.MotionFrame) uint64 {
	now := time.Now()
	s.timeMu.Lock()
	defer s.timeMu.Unlock()

	if frame.SampleClock == server.ClockNone {
		s.haveSrc = false
		return s.emitTsLocked(s.wallAdvanceLocked(now), now)
	}

	d, ok := uint64(0), false
	if s.haveSrc && s.srcClock == frame.SampleClock {
		d, ok = server.SourceDeltaUs(s.srcPrevTsUs, frame.TimestampUs, frame.SampleClock)
	}
	s.srcPrevTsUs, s.srcClock, s.haveSrc = frame.TimestampUs, frame.SampleClock, true

	if s.currentDsuTsUs == 0 {
		return s.emitTsLocked(uint64(now.UnixMicro()), now)
	}
	if !ok {
		d = uint64(max(0, now.Sub(s.lastStampWall).Microseconds()))
		if d > nominalFrameUs {
			d = nominalFrameUs
		}
	}
	return s.emitTsLocked(s.currentDsuTsUs+d, now)
}

// stampIdle returns the timestamp for a heartbeat frame (zero rates): it only
// needs to move forward in step with wall time.
func (s *Server) stampIdle() uint64 {
	now := time.Now()
	s.timeMu.Lock()
	defer s.timeMu.Unlock()
	return s.emitTsLocked(s.wallAdvanceLocked(now), now)
}

// stampRepeat returns the timestamp for a packet that must span no time at all
// (the welcome packet of a new subscriber, a drift guard correction): +1 us.
// The wall-time reference stays at the last real packet, so the next frame
// without a device clock still spans its whole interval, not the time since this
// packet.
func (s *Server) stampRepeat() uint64 {
	now := time.Now()
	s.timeMu.Lock()
	defer s.timeMu.Unlock()
	if s.currentDsuTsUs == 0 {
		return s.emitTsLocked(uint64(now.UnixMicro()), now)
	}
	s.currentDsuTsUs++
	return s.currentDsuTsUs
}

func (s *Server) wallAdvanceLocked(now time.Time) uint64 {
	if s.currentDsuTsUs == 0 || s.lastStampWall.IsZero() {
		return uint64(now.UnixMicro())
	}
	return s.currentDsuTsUs + uint64(max(0, now.Sub(s.lastStampWall).Microseconds()))
}

// emitTsLocked hands out cand, forced strictly above the previous timestamp.
func (s *Server) emitTsLocked(cand uint64, now time.Time) uint64 {
	if cand <= s.currentDsuTsUs {
		cand = s.currentDsuTsUs + 1
	}
	s.currentDsuTsUs = cand
	s.lastStampWall = now
	return cand
}

// LastMotionFrame returns the latest received telemetry frame.
func (s *Server) LastMotionFrame() server.MotionFrame {
	s.lastFrameMu.RLock()
	defer s.lastFrameMu.RUnlock()
	return s.lastFrame
}

func (s *Server) listenLoop() {
	buf := make([]byte, 1024)

	for s.running.Load() {
		n, remoteAddr, err := s.conn.Load().ReadFromUDP(buf)
		if err != nil {
			if !s.running.Load() {
				return
			}
			continue
		}

		if n < 16 {
			continue
		}

		// Fast 32-bit integer magic header check ("DSUC" = 0x44535543)
		if binary.BigEndian.Uint32(buf[0:4]) != 0x44535543 {
			continue
		}

		// Verify incoming CRC32
		expectedCRC := binary.LittleEndian.Uint32(buf[8:12])
		binary.LittleEndian.PutUint32(buf[8:12], 0)
		calculatedCRC := crc32.ChecksumIEEE(buf[:n])
		if expectedCRC != calculatedCRC {
			continue
		}

		if n < 20 {
			continue
		}

		msgType := binary.LittleEndian.Uint32(buf[16:20])
		s.handleRequest(msgType, buf[20:n], remoteAddr)
	}
}

func (s *Server) handleRequest(msgType uint32, payload []byte, remoteAddr *net.UDPAddr) {
	if s.stillKicked(remoteAddr) {
		return
	}
	// Register / keepalive client subscription
	isNew := s.touchClient(remoteAddr)

	switch msgType {
	case MsgTypeVersion:
		s.sendVersionRsp(remoteAddr)
	case MsgTypeListPorts:
		s.sendPortInfoRsp(remoteAddr, payload)
	case MsgTypePadData:
		// A data request is a subscription; the stream itself comes from
		// SendMotion (device frames) and heartbeatLoop (device silent). Cemu
		// repeats the request after every packet it receives, so answering each
		// one made the two ping-pong thousands of packets a second -- a whole CPU
		// core, and every packet repeated the last rotation rate, which Cemu turned
		// into a slow in-game drift (field report 2026-09-28). Only a brand new
		// subscriber gets one packet right away, at rest, so it sees the pad at once.
		if isNew {
			s.sendRestPadDataTo(remoteAddr)
		}
	}
}

// sendRestPadDataTo sends one pad-data packet with the last orientation data but
// zero rotation rates: it announces the pad without moving anything.
func (s *Server) sendRestPadDataTo(remoteAddr *net.UDPAddr) {
	if !s.running.Load() {
		return
	}

	s.lastFrameMu.RLock()
	frame := s.lastFrame
	s.lastFrameMu.RUnlock()
	frame.RotX, frame.RotY, frame.RotZ = 0, 0, 0

	// If no motion frame has ever been received, provide neutral gravity down
	if frame.AccX == 0 && frame.AccY == 0 && frame.AccZ == 0 {
		frame.AccY = -1.0
	}
	packetNum := atomic.AddUint32(&s.packetCounter, 1)

	bufPtr := padPacketPool.Get().(*[]byte)
	pkt := *bufPtr
	s.fillPadDataPacket(pkt, packetNum, frame, s.stampRepeat())

	_, _ = s.conn.Load().WriteToUDP(pkt, remoteAddr)

	padPacketPool.Put(bufPtr)

	s.clientsMu.Lock()
	if c := s.clients[remoteAddr.String()]; c != nil {
		c.cemu.add(0, 0, 0)
	}
	s.clientsMu.Unlock()
}

// sendCemuCorrectionsLocked sends each guarded client whose Cemu bias sum is not
// zero a packet that cancels it (cemubias.go), stamped 1 us after the previous
// packet so it rotates nothing. prev is the frame the client got last: the same
// acceleration keeps Cemu's accAcceleration of the next real frame right. Called
// with clientsMu held, before the next packet is stamped.
func (s *Server) sendCemuCorrectionsLocked(prev server.MotionFrame) {
	var ts uint64
	for _, c := range s.clients {
		if !c.CemuGuard {
			continue
		}
		rx, ry, rz, ok := c.cemu.correction()
		if !ok {
			continue
		}
		if ts == 0 {
			ts = s.stampRepeat()
		}
		f := prev
		f.RotX, f.RotY, f.RotZ = rx, ry, rz
		bufPtr := padPacketPool.Get().(*[]byte)
		s.fillPadDataPacket(*bufPtr, atomic.AddUint32(&s.packetCounter, 1), f, ts)
		_, _ = s.conn.Load().WriteToUDP(*bufPtr, c.Addr)
		padPacketPool.Put(bufPtr)
		c.cemu.add(rx, ry, rz)
	}
}

// SetCemuGuard turns the drift guard on or off for a subscribed client (by the
// address in ClientInfo.Address). The app turns it on for clients it identified
// as Cemu; other emulators never get correction packets.
func (s *Server) SetCemuGuard(address string, on bool) {
	s.clientsMu.Lock()
	if c := s.clients[address]; c != nil {
		c.CemuGuard = on
	}
	s.clientsMu.Unlock()
}

// idleAfter is how long the device stream must be silent before heartbeat
// frames (zero rates) take over to keep subscribed clients alive.
const idleAfter = 250 * time.Millisecond

// heartbeatLoop maintains active DSU client subscriptions when no live motion stream is flowing.
// When an emulator is subscribed but no device is transmitting, it emits a neutral frame at 60 Hz.
func (s *Server) heartbeatLoop() {
	ticker := time.NewTicker(16 * time.Millisecond) // ~60 Hz
	defer ticker.Stop()

	for {
		select {
		case <-s.stopChan:
			return
		case now := <-ticker.C:
			s.clientsMu.RLock()
			clientCount := len(s.clients)
			s.clientsMu.RUnlock()

			if clientCount == 0 {
				continue // No emulator listening: zero packets, zero CPU
			}

			s.lastFrameMu.RLock()
			lastTime := s.lastMotionTime
			lastF := s.lastFrame
			s.lastFrameMu.RUnlock()

			// While a device is streaming, stay out of its way. A short Wi-Fi stall
			// is not "no device": zero-rate filler frames there only make clients
			// see motion stop and then jump. With device-clock timestamps nothing is
			// lost across the gap either way (see stampMotion).
			if !lastTime.IsZero() && now.Sub(lastTime) < idleAfter {
				continue
			}

			// Prepare neutral frame
			idleFrame := lastF
			// Zero out angular velocities during idle
			idleFrame.RotX = 0
			idleFrame.RotY = 0
			idleFrame.RotZ = 0
			if idleFrame.AccX == 0 && idleFrame.AccY == 0 && idleFrame.AccZ == 0 {
				idleFrame.AccY = -1.0
			}

			s.clientsMu.Lock()
			s.sendCemuCorrectionsLocked(idleFrame)

			packetNum := atomic.AddUint32(&s.packetCounter, 1)
			bufPtr := padPacketPool.Get().(*[]byte)
			pkt := *bufPtr
			s.fillPadDataPacket(pkt, packetNum, idleFrame, s.stampIdle())
			for _, client := range s.clients {
				_, _ = s.conn.Load().WriteToUDP(pkt, client.Addr)
				client.cemu.add(0, 0, 0)
			}
			s.clientsMu.Unlock()

			padPacketPool.Put(bufPtr)
		}
	}
}

func (s *Server) sendVersionRsp(remoteAddr *net.UDPAddr) {
	buf := make([]byte, 24) // 20 bytes header + 2 bytes version + 2 bytes padding (aligned to 4 bytes)
	copy(buf[0:4], MagicServer)
	binary.LittleEndian.PutUint16(buf[4:6], ProtocolVer)
	binary.LittleEndian.PutUint16(buf[6:8], 4+4) // 4 bytes payload + 4 bytes msgType
	binary.LittleEndian.PutUint32(buf[12:16], s.serverID)
	binary.LittleEndian.PutUint32(buf[16:20], MsgTypeVersion)
	binary.LittleEndian.PutUint16(buf[20:22], ProtocolVer)
	buf[22] = 0
	buf[23] = 0

	crc := crc32.ChecksumIEEE(buf)
	binary.LittleEndian.PutUint32(buf[8:12], crc)

	_, _ = s.conn.Load().WriteToUDP(buf, remoteAddr)
}

func (s *Server) sendPortInfoRsp(remoteAddr *net.UDPAddr, payload []byte) {
	slots := []byte{0}
	if len(payload) >= 4 {
		count := int(binary.LittleEndian.Uint32(payload[0:4]))
		if count > 0 && count <= 4 && len(payload) >= 4+count {
			slots = make([]byte, count)
			copy(slots, payload[4:4+count])
		}
	}

	for _, slot := range slots {
		buf := make([]byte, 32) // 20 bytes header + 12 bytes port info
		copy(buf[0:4], MagicServer)
		binary.LittleEndian.PutUint16(buf[4:6], ProtocolVer)
		binary.LittleEndian.PutUint16(buf[6:8], 12+4) // 12 bytes payload + 4 bytes msgType
		binary.LittleEndian.PutUint32(buf[12:16], s.serverID)
		binary.LittleEndian.PutUint32(buf[16:20], MsgTypeListPorts)

		p := buf[20:]
		p[0] = slot
		if slot == 0 {
			p[1] = SlotStateConnected // Connected
			p[2] = ModelFullGamepad   // Full Gyro Gamepad
			p[3] = ConnTypeBluetooth  // Wireless
			s.clientsMu.RLock()
			copy(p[4:10], s.macAddr[:])
			s.clientsMu.RUnlock()
			p[10] = BatteryFull
			p[11] = 1 // Active state
		} else {
			p[1] = SlotStateDisconnected // Disconnected
			p[2] = 0
			p[3] = 0
			p[10] = 0
			p[11] = 0
		}

		crc := crc32.ChecksumIEEE(buf)
		binary.LittleEndian.PutUint32(buf[8:12], crc)

		_, _ = s.conn.Load().WriteToUDP(buf, remoteAddr)
	}
}

// kickedUntilSilent: a disconnected client stays ignored until it has sent
// nothing for this long. Cemu asks every few milliseconds, so without it the
// client would be back at once; a client that reconnects later comes from a new
// port anyway.
const kickedUntilSilent = 5 * time.Second

// Kick disconnects a client (by the address in ClientInfo.Address): it gets no
// more packets and its requests are ignored until it stays silent for
// kickedUntilSilent or Readmit brings it back. Returns false if no such client
// is subscribed.
func (s *Server) Kick(address string) bool {
	s.clientsMu.Lock()
	client, ok := s.clients[address]
	if ok {
		delete(s.clients, address)
		if s.kicked == nil {
			s.kicked = map[string]*kickedClient{}
		}
		now := time.Now()
		s.kicked[address] = &kickedClient{addr: client.Addr, kickedAt: now, lastSeen: now}
	}
	s.clientsMu.Unlock()
	if ok && s.OnClientDisconnect != nil {
		go s.OnClientDisconnect(client.Addr)
	}
	return ok
}

// Readmit undoes Kick: the client is subscribed again and gets a packet at
// once. A client that stopped asking because nothing came any more (Cemu asks
// only after it receives a packet) starts again from that packet. Returns false
// if the address is not a kicked client.
func (s *Server) Readmit(address string) bool {
	s.clientsMu.Lock()
	k, ok := s.kicked[address]
	delete(s.kicked, address)
	s.clientsMu.Unlock()
	if !ok {
		return false
	}
	s.touchClient(k.addr)
	s.sendRestPadDataTo(k.addr)
	return true
}

// KickedClients returns the clients the user disconnected, in the order they
// were kicked (ConnectedAtMs is the time of the kick). LastSeenMs is the time
// since their last request.
func (s *Server) KickedClients() []ClientInfo {
	if s == nil {
		return nil
	}
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()
	now := time.Now()
	res := make([]ClientInfo, 0, len(s.kicked))
	for _, k := range s.kicked {
		res = append(res, ClientInfo{
			Address:       k.addr.String(),
			IP:            k.addr.IP.String(),
			Port:          k.addr.Port,
			LastSeenMs:    now.Sub(k.lastSeen).Milliseconds(),
			ConnectedAtMs: k.kickedAt.UnixMilli(),
		})
	}
	sort.SliceStable(res, func(i, j int) bool {
		if res[i].ConnectedAtMs != res[j].ConnectedAtMs {
			return res[i].ConnectedAtMs < res[j].ConnectedAtMs
		}
		return res[i].Address < res[j].Address
	})
	return res
}

// ForgetKicked drops a kicked client that is gone (its program has closed), so
// it is no longer listed.
func (s *Server) ForgetKicked(address string) {
	s.clientsMu.Lock()
	delete(s.kicked, address)
	s.clientsMu.Unlock()
}

// stillKicked reports whether a request from addr must be ignored, and keeps
// the kick alive while the client keeps asking.
func (s *Server) stillKicked(addr *net.UDPAddr) bool {
	key := addr.String()
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	k, ok := s.kicked[key]
	if !ok {
		return false
	}
	if time.Since(k.lastSeen) > kickedUntilSilent {
		delete(s.kicked, key)
		return false
	}
	k.lastSeen = time.Now()
	return true
}

// MaxClients caps simultaneous subscribers (a real setup has one or two emulators).
const MaxClients = 16

// touchClient registers or refreshes a subscription; true if it is new.
func (s *Server) touchClient(addr *net.UDPAddr) bool {
	key := addr.String()
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()

	client, exists := s.clients[key]
	if !exists {
		if len(s.clients) >= MaxClients {
			// UDP sources are trivial to forge: without a cap every fake address
			// would get a 60 Hz stream for 5 s and a map entry.
			return false
		}
		now := time.Now()
		s.clients[key] = &ClientSub{
			Addr:        addr,
			LastSeen:    now,
			ConnectedAt: now,
		}
		if s.OnClientConnect != nil {
			connectCb := s.OnClientConnect
			go connectCb(addr)
		}
		return true
	}
	client.LastSeen = time.Now()
	return false
}

func (s *Server) cleanupLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopChan:
			return
		case <-ticker.C:
			s.clientsMu.Lock()
			now := time.Now()
			for key, client := range s.clients {
				// Timeout after 5 seconds of inactivity from emulator
				if now.Sub(client.LastSeen) > 5*time.Second {
					expiredAddr := client.Addr
					delete(s.clients, key)
					if s.OnClientDisconnect != nil {
						disconnectCb := s.OnClientDisconnect
						go disconnectCb(expiredAddr)
					}
				}
			}
			s.clientsMu.Unlock()
		}
	}
}

// ActiveClients returns the number of emulators currently listening for motion.
func (s *Server) ActiveClients() int {
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()
	return len(s.clients)
}

func float32ToBits(f float32) uint32 {
	return math.Float32bits(f)
}
