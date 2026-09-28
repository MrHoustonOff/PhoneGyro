package dsu

// Cemu's motion filter (src/input/motion/Mahony.h) estimates the gyro bias as
// the lifetime mean of every sample whose three rates are all below 0.35 rad/s,
// never forgetting, and hands the game "rate - bias" without any deadzone. Slow
// real motion (placing the pad on the desk, slow aiming one way, fast back the
// other) therefore leaves a bias that the game keeps turning by even when we send
// exact zeros -- the in-game aim drift of 2026-09-28/29, which went on even with
// PhoneGyro disconnected (Cemu keeps its last sample).
//
// cemuBiasModel replays that estimate for the packets we sent to one client, so
// the UI can show what Cemu believes (a subscription starts a fresh model; Cemu's
// own lives as long as the Cemu process).
type cemuBiasModel struct {
	sum [3]float64 // rad/s
	n   uint64
}

const (
	deg2rad         = 0.0174533 // Cemu's own factor
	cemuBiasMaxRate = 0.35      // rad/s: faster samples are ignored
	cemuBiasMinN    = 200       // Cemu applies the bias only from this many samples on
)

func (m *cemuBiasModel) add(rx, ry, rz float32) {
	r := [3]float64{float64(rx) * deg2rad, float64(ry) * deg2rad, float64(rz) * deg2rad}
	for _, v := range r {
		if v >= cemuBiasMaxRate || v <= -cemuBiasMaxRate {
			return
		}
	}
	for i := range r {
		m.sum[i] += r[i]
	}
	m.n++
}

// biasDps is the bias Cemu would subtract now, in deg/s.
func (m *cemuBiasModel) biasDps() [3]float64 {
	if m.n < cemuBiasMinN {
		return [3]float64{}
	}
	var b [3]float64
	for i := range b {
		b[i] = m.sum[i] / float64(m.n) / deg2rad
	}
	return b
}

// restFillPackets: while the device is at rest (the frame's rates are exactly
// zero) a client marked with SetRestFill gets this many extra zero-rate packets
// per frame, each +1 us on the timestamp chain. Zero rates over 1 us cannot
// rotate anything, but every one counts as a sample in Cemu's bias mean: the
// bias left by slow motion fades ten times faster instead of staying for good.
const restFillPackets = 9

// SetRestFill turns the rest-time bias dilution on or off for one client (by
// ClientInfo.Address). PhoneGyro enables it for clients it identifies as Cemu.
func (s *Server) SetRestFill(address string, on bool) {
	s.clientsMu.Lock()
	if c, ok := s.clients[address]; ok {
		c.RestFill = on
	}
	s.clientsMu.Unlock()
}
