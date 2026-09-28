package dsu

// Cemu's motion filter (src/input/motion/Mahony.h) estimates the gyro bias as
// the lifetime mean of every sample whose three rates are all below 0.35 rad/s,
// never forgetting, and hands the game "rate - bias". Slow real motion (aiming
// slowly one way, turning back fast) therefore becomes "bias", and the game keeps
// turning by it while the pad is held still -- the BotW aim drift of 2026-09-28/29
// (up to 7 deg/s after 10 minutes of play in a replay of Mahony.h).
//
// cemuBiasModel replays that estimate, bit for bit, for the packets sent to one
// client. The drift guard (cemuCorrection) uses it to keep Cemu's sum at zero:
// before a real packet it sends one extra packet stamped 1 us after the previous
// one, whose rates cancel the sum. Cemu integrates rotation over the timestamp
// delta, so that packet turns nothing (rate * 1 us), but its estimator counts it
// like any other sample. The bias Cemu holds stays at zero, during play too.
type cemuBiasModel struct {
	sum [3]float64 // rad/s, as Cemu sums them: float32 values added into a double
	n   uint64
}

const (
	cemuDeg2Rad     float32 = 0.0174533 // DSUControllerProvider.cpp: gyro.x * 0.0174533f
	cemuBiasMaxRate float32 = 0.35      // rad/s: a sample with any rate at or above it is ignored
	cemuBiasMinN            = 200       // Cemu applies the bias only from this many samples on

	// cemuCorrectionMax is the largest correction rate per packet (rad/s), under
	// cemuBiasMaxRate with a margin so the packet is surely counted. A bigger sum
	// is cancelled over the next packets.
	cemuCorrectionMax = 0.3
	// cemuCorrectionMinSum: a smaller sum is left alone. Spread over at least
	// cemuBiasMinN samples it is a bias under 0.002 deg/s; this keeps the extra
	// packets away while the device sends exact zeros.
	cemuCorrectionMinSum = 0.005
)

// cemuRad is a DSU rate (deg/s) as Cemu converts it.
func cemuRad(dps float32) float32 { return dps * cemuDeg2Rad }

func (m *cemuBiasModel) add(rx, ry, rz float32) {
	r := [3]float32{cemuRad(rx), cemuRad(ry), cemuRad(rz)}
	for _, v := range r {
		if v >= cemuBiasMaxRate || v <= -cemuBiasMaxRate {
			return
		}
	}
	for i := range r {
		m.sum[i] += float64(r[i])
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
		b[i] = float64(float32(m.sum[i]/float64(m.n))) / float64(cemuDeg2Rad)
	}
	return b
}

// correction returns the rates (deg/s) of a packet that brings the sum back to
// zero, or ok=false when the sum is already negligible.
func (m *cemuBiasModel) correction() (rx, ry, rz float32, ok bool) {
	var c [3]float32
	for i, s := range m.sum {
		if s > -cemuCorrectionMinSum && s < cemuCorrectionMinSum {
			continue
		}
		v := -s
		if v > cemuCorrectionMax {
			v = cemuCorrectionMax
		} else if v < -cemuCorrectionMax {
			v = -cemuCorrectionMax
		}
		c[i] = float32(v) / cemuDeg2Rad
		ok = true
	}
	return c[0], c[1], c[2], ok
}
