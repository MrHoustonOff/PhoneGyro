package motion

import (
	"log"
	"math"
)

// Attitude anchoring.
//
// The browser gives the gyro only at 60 Hz. Integrating 60 Hz samples of fast,
// wobbly hand motion (what DSU clients do) accumulates several degrees of error per
// minute; gravity later fixes tilt but nothing fixes yaw. The phone's own attitude
// (DeviceOrientation, fused by the OS at a much higher internal rate) does not have
// that error. We keep the live gyro for responsiveness and add a small, clamped
// correction rate so the angle a client integrates from our stream is slowly pulled
// onto the phone's attitude on all three axes.
//
// Which quaternion convention/handedness the browser really uses is not trusted: the
// frame-to-frame rotation of each candidate is compared against the gyro, and the
// anchor only engages once one candidate clearly matches.

type Quat [4]float64 // w, x, y, z

const (
	anchorGain         = 2.0 // 1/s: fraction of the error removed per second
	anchorMaxCorrRad   = 20.0 * DegToRad
	anchorMinStepRad   = 0.5 * DegToRad // mean per-frame rotation a scoring window needs
	anchorWindowFrames = 15             // ~250 ms scoring windows (see scoreWindow)
	anchorScoreWindows = 8              // decide after this many informative windows (~2 s of motion)
	anchorMaxRelErr    = 0.25           // mean relative window mismatch of the winner
	anchorMaxWindowRad = 2.0            // ~115°: beyond this a window's rotation is too close to 180° to compare
	anchorMarginRatio  = 4.0
	anchorCandidates   = 4 // {q, q*} × {+, -} rotation sense
	AnchorMinQuatNorm  = 0.5
	AnchorDefaultDtSec = 1.0 / 60.0
)

type AttitudeAnchor struct {
	// Engage test window (scoreWindow): gyro rotation composed since the window
	// opened, and the reference when it opened.
	winG      Quat
	winRef0   Quat
	winFrames int
	winOpen   bool

	score [anchorCandidates]float64
	n     int
	mode  int // -1 until a candidate is proven
	evals int // decisions made while not engaged (throttles the diagnostic log)

	// Attitude a client reaches by integrating our output, per candidate convention,
	// tracked from the first frame so drift from before engagement is corrected too.
	est     [anchorCandidates]Quat
	haveEst bool
}

func NewAttitudeAnchor() *AttitudeAnchor {
	return &AttitudeAnchor{mode: -1}
}

// Reset forgets the client model (keeps the learned convention). Call it when the
// phone reconnects: its attitude reference restarts from an arbitrary heading.
func (a *AttitudeAnchor) Reset() {
	a.winOpen, a.haveEst = false, false
}

// Correction returns the correction rate (device axes, rad/s) to add to the gyro for
// this frame. gyroDev is the bias-corrected gyro in device axes (rad/s), ref the
// phone's attitude quaternion, dt the frame period.
func (a *AttitudeAnchor) Correction(gyroDev [3]float64, ref Quat, dt float64) [3]float64 {
	var zero [3]float64
	if qnorm(ref) < AnchorMinQuatNorm {
		a.winOpen, a.haveEst = false, false
		return zero
	}
	ref = qnormalize(ref)

	a.scoreWindow([3]float64{gyroDev[0] * dt, gyroDev[1] * dt, gyroDev[2] * dt}, ref)

	if !a.haveEst {
		for c := range a.est {
			a.est[c], _ = view(c, ref)
		}
		a.haveEst = true
	}

	var corr [3]float64
	if a.mode >= 0 {
		att, sense := view(a.mode, ref)
		e := qlog(qmul(qconj(a.est[a.mode]), att))
		// Never resync on a large error: a network stall that lost rotation shows up
		// exactly like that, and accepting it would leave the game offset for good.
		// Chase it at the clamped rate instead; only Reset (reconnect) resyncs.
		for k := 0; k < 3; k++ {
			corr[k] = sense * anchorGain * e[k]
		}
		if n := Norm3(corr); n > anchorMaxCorrRad {
			for k := 0; k < 3; k++ {
				corr[k] *= anchorMaxCorrRad / n
			}
		}
	}

	// Advance every client model with what we actually output this frame.
	for c := range a.est {
		_, sense := view(c, ref)
		var out [3]float64
		for k := 0; k < 3; k++ {
			out[k] = sense * (gyroDev[k] + corr[k]) * dt
		}
		a.est[c] = qnormalize(qmul(a.est[c], qexp(out)))
	}
	return corr
}

// view maps the reference quaternion into candidate convention c.
func view(c int, q Quat) (Quat, float64) {
	if c/2 == 1 {
		q = qconj(q)
	}
	sense := 1.0
	if c%2 == 1 {
		sense = -1
	}
	return q, sense
}

// scoreWindow decides which reference convention (if any) matches the gyro.
//
// Measured on real iPhone recordings (2026-09-27): the deviceorientation
// quaternion arrives about one frame behind the gyro (the step error is smallest
// with the reference shifted by +1..2 frames), and single-frame steps on fast
// hand motion are too noisy to judge: with the right convention the mean error
// was 0.33-0.42 per frame -- above anchorMaxRelErr, so the anchor never engaged --
// but 0.12 over 250 ms windows. So candidates are scored on windows: the gyro
// rotation composed over anchorWindowFrames steps against the reference's
// rotation over the same span taken one frame later, which is the same
// one-frame alignment Correction uses (client model before this frame's output
// vs this frame's reference).
func (a *AttitudeAnchor) scoreWindow(g [3]float64, ref Quat) {
	if a.winOpen && a.winFrames >= anchorWindowFrames {
		a.closeWindow(ref) // this call's reference ends the window the previous steps filled
	}
	if !a.winOpen {
		a.winG, a.winRef0, a.winFrames, a.winOpen = Quat{1, 0, 0, 0}, ref, 0, true
	}
	a.winG = qnormalize(qmul(a.winG, qexp(g)))
	a.winFrames++
}

func (a *AttitudeAnchor) closeWindow(end Quat) {
	a.winOpen = false
	gw := qlog(a.winG)
	gn := Norm3(gw)
	if gn < anchorMinStepRad*anchorWindowFrames {
		return // too little motion to tell conventions apart
	}
	if gn > anchorMaxWindowRad {
		// Near 180° the shortest-path rotation flips direction, so gyro and reference
		// can disagree for no real reason (window of a >700°/s spin): such a window
		// would count as a mismatch and could disengage a working anchor.
		return
	}
	for c := 0; c < anchorCandidates; c++ {
		p, q := a.winRef0, end
		if c/2 == 1 {
			p, q = qconj(p), qconj(q)
		}
		d := qlog(qmul(qconj(p), q))
		if c%2 == 1 {
			d = [3]float64{-d[0], -d[1], -d[2]}
		}
		r := [3]float64{d[0] - gw[0], d[1] - gw[1], d[2] - gw[2]}
		a.score[c] += math.Min(Norm3(r)/gn, 2)
	}
	a.n++
	if a.n < anchorScoreWindows {
		return
	}
	best, second := 0, -1
	for c := 1; c < anchorCandidates; c++ {
		if a.score[c] < a.score[best] {
			second, best = best, c
		} else if second < 0 || a.score[c] < a.score[second] {
			second = c
		}
	}
	mean := a.score[best] / float64(a.n)
	if mean < anchorMaxRelErr && a.score[second] > anchorMarginRatio*a.score[best] {
		if a.mode != best {
			log.Printf("[anchor] attitude reference engaged: mode %d (window err %.2f)", best, mean)
			a.mode = best
		}
	} else if a.mode >= 0 && mean >= anchorMaxRelErr {
		log.Printf("[anchor] attitude reference disagrees with gyro (window err %.2f): disengaged", mean)
		a.mode = -1
	}
	if a.mode < 0 {
		// Why it does not engage: relative window error of each candidate convention
		// ({q, q*} x rotation sense). Engaging needs best < anchorMaxRelErr and the
		// runner-up anchorMarginRatio times worse. Logged every ~10 s of motion.
		if a.evals%5 == 0 {
			n := float64(a.n)
			log.Printf("[anchor] not engaged: window err per convention %.2f %.2f %.2f %.2f (best %d, need < %.2f and runner-up x%.0f)",
				a.score[0]/n, a.score[1]/n, a.score[2]/n, a.score[3]/n, best, anchorMaxRelErr, anchorMarginRatio)
		}
		a.evals++
	}
	a.score = [anchorCandidates]float64{}
	a.n = 0
}

func qmul(a, b Quat) Quat {
	return Quat{
		a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3],
		a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
		a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1],
		a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0],
	}
}

func qconj(q Quat) Quat { return Quat{q[0], -q[1], -q[2], -q[3]} }

func qnorm(q Quat) float64 { return math.Sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]) }

func qnormalize(q Quat) Quat {
	n := qnorm(q)
	return Quat{q[0] / n, q[1] / n, q[2] / n, q[3] / n}
}

// qlog returns the rotation vector (axis·angle, shortest path) of a unit quaternion.
func qlog(q Quat) [3]float64 {
	if q[0] < 0 {
		q = Quat{-q[0], -q[1], -q[2], -q[3]}
	}
	v := [3]float64{q[1], q[2], q[3]}
	s := Norm3(v)
	if s < 1e-12 {
		return [3]float64{2 * v[0], 2 * v[1], 2 * v[2]}
	}
	k := 2 * math.Atan2(s, q[0]) / s
	return [3]float64{v[0] * k, v[1] * k, v[2] * k}
}

// qexp returns the unit quaternion of a rotation vector.
func qexp(r [3]float64) Quat {
	th := Norm3(r)
	if th < 1e-12 {
		return Quat{1, r[0] / 2, r[1] / 2, r[2] / 2}
	}
	s := math.Sin(th/2) / th
	return Quat{math.Cos(th / 2), r[0] * s, r[1] * s, r[2] * s}
}
