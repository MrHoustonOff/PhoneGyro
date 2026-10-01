package app

import (
	"encoding/json"
	"math"
	"time"

	"github.com/gorilla/websocket"
)

type liveDebugMsg struct {
	DeviceConnected bool            `json:"device_connected"`
	Q0              float32         `json:"q0"`
	Q1              float32         `json:"q1"`
	Q2              float32         `json:"q2"`
	Q3              float32         `json:"q3"`
	Seq             uint64          `json:"seq,omitempty"`
	Timestamp       uint32          `json:"ts,omitempty"`
	RecvTs          int64           `json:"recv_ts,omitempty"`
	SendTs          int64           `json:"send_ts,omitempty"`
	RawGx           float32         `json:"raw_gx"`
	RawGy           float32         `json:"raw_gy"`
	RawGz           float32         `json:"raw_gz"`
	RawAx           float32         `json:"raw_ax"`
	RawAy           float32         `json:"raw_ay"`
	RawAz           float32         `json:"raw_az"`
	OutGx           float32         `json:"out_gx"`
	OutGy           float32         `json:"out_gy"`
	OutGz           float32         `json:"out_gz"`
	OutAx           float32         `json:"out_ax"`
	OutAy           float32         `json:"out_ay"`
	OutAz           float32         `json:"out_az"`
	StickLx         float32         `json:"stick_lx,omitempty"`
	StickLy         float32         `json:"stick_ly,omitempty"`
	InHz            float64         `json:"in_hz,omitempty"`
	OutHz           float64         `json:"out_hz,omitempty"`
	PipeMs          float64         `json:"pipe_ms,omitempty"`
	DsuClients      int             `json:"dsu_clients"`
	DsuClientList   []DSUClientView `json:"dsu_client_list,omitempty"`
	// Кадр источника для офлайн-разбора записей Live Debug: часы устройства (µs)
	// и ориентация, которую прислал телефон (кватернион iOS/Android).
	DevTsUs uint64  `json:"dev_ts_us,omitempty"`
	RefQw   float32 `json:"ref_qw"`
	RefQx   float32 `json:"ref_qx"`
	RefQy   float32 `json:"ref_qy"`
	RefQz   float32 `json:"ref_qz"`
	// LinkRttMs — измеренное время отклика канала телефона (PING/PONG), мс;
	// -1 — не измерено (нет телефона, USB). Всегда в сообщении: 0 и -1 значимы.
	LinkRttMs float64 `json:"link_rtt_ms"`
	// Накопительные счётчики потерь активного источника (link/loss.go):
	// LossKind "usb" | "phone" | "" (нет данных).
	LossKind   string `json:"loss_kind"`
	LossTotal  uint64 `json:"loss_total"`
	LossMerged uint64 `json:"loss_merged"`
	LossLost   uint64 `json:"loss_lost"`
}

// linkPingMs — RTT канала телефона в целых мс, -1 если не измерен или источник USB.
func (a *App) linkPingMs() int {
	if ms := a.linkRttMs(); ms >= 0 {
		return int(math.Round(ms))
	}
	return -1
}

// linkRttMs — RTT канала телефона в мс по настоящему PING/PONG (pkg/server
// linkrtt.go), -1 если измерения нет. Для USB не бывает: там нет сети.
func (a *App) linkRttMs() float64 {
	if a.srv == nil || a.GetInputMode() == "usb" {
		return -1
	}
	if rtt, ok := a.srv.LinkRTT(); ok {
		return float64(rtt.Microseconds()) / 1000
	}
	return -1
}

// liveDebugMinInterval caps telemetry to Live Debug. Real sources top out at 200 Hz
// (USB); a fault must not drown the window -- a stale USB handle once replayed
// one frame ~12 000 times a second and the window never managed to paint.
const liveDebugMinInterval = time.Second / 250

func (a *App) broadcastLiveDebug(q0, q1, q2, q3 float32, extras ...liveDebugMsg) {
	a.liveDebugMu.RLock()
	clientCount := len(a.liveDebugClients)
	a.liveDebugMu.RUnlock()
	if clientCount == 0 {
		return
	}
	now := time.Now().UnixNano()
	if now-a.lastLiveDebugNs.Load() < int64(liveDebugMinInterval) {
		return
	}
	a.lastLiveDebugNs.Store(now)

	msg := liveDebugMsg{
		DeviceConnected: a.activeBank().hasClient.Load(),
		Q0:              q0,
		Q1:              q1,
		Q2:              q2,
		Q3:              q3,
	}

	if a.dsuSrv != nil {
		msg.DsuClients = a.dsuSrv.ActiveClientCount()
		msg.DsuClientList = a.dsuClientViews()
	}
	msg.LinkRttMs = a.linkRttMs()
	msg.LossKind, msg.LossTotal, msg.LossMerged, msg.LossLost = a.activeBank().loss.Snapshot()

	if len(extras) > 0 {
		e := extras[0]
		msg.Seq = e.Seq
		msg.Timestamp = e.Timestamp
		msg.RecvTs = e.RecvTs
		msg.SendTs = e.SendTs
		msg.RawGx = e.RawGx
		msg.RawGy = e.RawGy
		msg.RawGz = e.RawGz
		msg.RawAx = e.RawAx
		msg.RawAy = e.RawAy
		msg.RawAz = e.RawAz
		msg.DevTsUs = e.DevTsUs
		msg.RefQw, msg.RefQx, msg.RefQy, msg.RefQz = e.RefQw, e.RefQx, e.RefQy, e.RefQz
		msg.OutGx = e.OutGx
		msg.OutGy = e.OutGy
		msg.OutGz = e.OutGz
		msg.OutAx = e.OutAx
		msg.OutAy = e.OutAy
		msg.OutAz = e.OutAz
		msg.StickLx = e.StickLx
		msg.StickLy = e.StickLy
		msg.InHz = e.InHz
		msg.OutHz = e.OutHz
		msg.PipeMs = e.PipeMs
		if e.DsuClients > 0 || len(e.DsuClientList) > 0 {
			msg.DsuClients = e.DsuClients
			msg.DsuClientList = e.DsuClientList
		}
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	a.liveDebugMu.Lock()
	defer a.liveDebugMu.Unlock()
	for conn := range a.liveDebugClients {
		_ = conn.SetWriteDeadline(time.Now().Add(50 * time.Millisecond))
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			conn.Close()
			delete(a.liveDebugClients, conn)
		}
	}
}

func (a *App) broadcastLiveDebugJSON(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	a.liveDebugMu.Lock()
	defer a.liveDebugMu.Unlock()
	for conn := range a.liveDebugClients {
		_ = conn.SetWriteDeadline(time.Now().Add(50 * time.Millisecond))
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			conn.Close()
			delete(a.liveDebugClients, conn)
		}
	}
}
