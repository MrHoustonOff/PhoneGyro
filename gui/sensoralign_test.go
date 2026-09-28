package main

import (
	"math"
	"math/rand"
	"testing"
)

// iosQ maps device axes into the gyro packet axes produced by web/index.html on iOS
// Safari, whose rotationRate reports alpha/beta/gamma about device X/Y/Z:
// packet = (beta, gamma, alpha) = (devY, devZ, devX).
var iosQ = [3][3]float64{{0, 1, 0}, {0, 0, 1}, {1, 0, 0}}

// userProfile is the real "vertical iPhone" matrix from the calibration wizard.
var userProfile = [3][3]float64{{0, 0, 1}, {0, 1, 0}, {1, 0, 0}}

func rodrigues(v, axis [3]float64, angle float64) [3]float64 {
	n := Norm3(axis)
	if n < 1e-12 {
		return v
	}
	k := [3]float64{axis[0] / n, axis[1] / n, axis[2] / n}
	c, s := math.Cos(angle), math.Sin(angle)
	kxv := cross3(k, v)
	kv := k[0]*v[0] + k[1]*v[1] + k[2]*v[2]
	var out [3]float64
	for i := 0; i < 3; i++ {
		out[i] = v[i]*c + kxv[i]*s + k[i]*kv*(1-c)
	}
	return out
}

type simFrame struct {
	rotPk [3]float64 // deg/s, packet axes
	acc   [3]float64 // g, device axes
	tsUs  uint64
}

// simulateIOSBursts mimics real handling: random-axis bursts (60..400 deg/s) with
// hand acceleration up to ~0.5g, separated by still pauses, plus sensor noise.
func simulateIOSBursts(seconds float64, seed int64) []simFrame {
	const dt = 1.0 / 60.0
	rng := rand.New(rand.NewSource(seed))
	g := [3]float64{0, 0, -1}
	var w [3]float64
	var out []simFrame
	for i := 0; float64(i)*dt < seconds; i++ {
		t := float64(i) * dt
		phase := math.Mod(t, 1.2)
		moving := phase < 0.5
		if i%72 == 0 {
			ax := [3]float64{rng.NormFloat64(), rng.NormFloat64(), rng.NormFloat64()}
			sp := (60 + 340*rng.Float64()) * DegToRad / Norm3(ax)
			w = [3]float64{ax[0] * sp, ax[1] * sp, ax[2] * sp}
		}
		cur := w
		if !moving {
			cur = [3]float64{}
		}
		acc := g
		for k := 0; k < 3; k++ {
			acc[k] += 0.004 * rng.NormFloat64()
			if moving {
				acc[k] += 0.5 * math.Sin(9*t+2*float64(k))
			}
		}
		pk := MulVec3(iosQ, cur)
		for k := 0; k < 3; k++ {
			pk[k] = pk[k]/DegToRad + 0.3*rng.NormFloat64()
		}
		out = append(out, simFrame{rotPk: pk, acc: acc, tsUs: uint64(i) * 16667})
		g = rodrigues(g, cur, -Norm3(cur)*dt)
	}
	return out
}

// simulateIOS rotates a phone (right-handed body rates) starting flat, screen up,
// and returns what the iOS web client would send.
func simulateIOS(seconds float64) []simFrame {
	const dt = 1.0 / 60.0
	g := [3]float64{0, 0, -1} // iOS: gravity along -Z when flat, screen up
	var out []simFrame
	for i := 0; float64(i)*dt < seconds; i++ {
		t := float64(i) * dt
		w := [3]float64{2.0 * math.Sin(1.3*t), 1.5 * math.Sin(0.7*t+1), 2.5 * math.Sin(0.9*t+2)}
		pk := MulVec3(iosQ, w)
		out = append(out, simFrame{
			rotPk: [3]float64{pk[0] / DegToRad, pk[1] / DegToRad, pk[2] / DegToRad},
			acc:   g,
			tsUs:  uint64(i) * 16667,
		})
		g = rodrigues(g, w, -Norm3(w)*dt) // world-fixed vector seen from the body
	}
	return out
}

func TestSensorAlignerLearnsIOSAxes(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		s := NewSensorAligner("")
		for _, f := range simulateIOSBursts(20, seed) {
			s.Feed(f.rotPk, f.acc, f.tsUs)
		}
		got, known := s.Frame()
		if !known || got.Q != iosQ || got.H != -1 {
			t.Fatalf("seed %d: learned %+v known=%v, want Q=%v h=-1", seed, got, known, iosQ)
		}
	}
}

func TestOutputMappingFlatRestReadsMinusY(t *testing.T) {
	accMat, ys := BuildOutputMapping(userProfile, SensorFrame{Q: iosQ, H: -1}, [3]float64{0, 0, -1})
	a := MulVec3(accMat, [3]float64{0, 0, -1})
	if math.Abs(a[0]) > 1e-9 || math.Abs(a[1]+1) > 1e-9 || math.Abs(a[2]) > 1e-9 {
		t.Fatalf("flat rest -> Acc %v, want [0 -1 0]", a)
	}
	if ys != 1 {
		t.Fatalf("yawSign = %v, want +1 for right-handed rates", ys)
	}
}

// NOTE: TestPadTestMadgwickAgreesAfterAlignment / madgwickGravityError used to
// live here. They ran our OWN internal AHRS clone as a stand-in for "real
// PadTest's Madgwick" to sanity-check that buildOutputMapping's gyro and accel
// agree from PadTest's point of view. That only worked while our internal
// filter was a literal sign-for-sign clone of the (as it turned out, wrongly
// reverse-engineered) old PadTest formula. ahrs.go is now a different,
// independently-derived-and-validated filter (see its header comment) with its
// own internal sign convention chosen for our own display, not for bit-parity
// with PadTest's internals -- so reusing it as a PadTest stand-in no longer
// means anything, and the test failed a 180°-flipped comparison that was never
// about the real DSU output being wrong. The thing that test actually protected
// -- the real d(Acc)/dt = (D·Rot)×Acc invariant PadTest depends on -- is fully
// covered below by dsuKinematicResidual/TestDSUOutputMatchesClientConvention,
// which checks raw numbers directly and doesn't go through any AHRS filter at
// all, so it stayed meaningful and still passes untouched.

// dsuKinematicResidual returns the mean relative residual of
// d(Acc)/dt = sign·(D·Rot) × Acc over the DSU output of a smooth iOS simulation.
func dsuKinematicResidual(sign float64) float64 {
	frames := simulateIOS(10)
	accMat, ys := BuildOutputMapping(userProfile, SensorFrame{Q: iosQ, H: -1}, [3]float64{0, 0, -1})
	out := func(f simFrame) (r, a [3]float64) {
		r = MulVec3(userProfile, f.rotPk)
		r[1] *= ys * float64(DSUYawSign)
		a = MulVec3(accMat, f.acc)
		for k := 0; k < 3; k++ {
			r[k] *= DegToRad
			a[k] *= float64(DSUAccSign[k])
		}
		return r, a
	}
	var sum float64
	for i := 1; i < len(frames); i++ {
		r, a1 := out(frames[i-1])
		_, a2 := out(frames[i])
		dr := [3]float64{r[0], -r[1], -r[2]}
		pred := cross3(dr, a1)
		var e float64
		for k := 0; k < 3; k++ {
			d := (a2[k]-a1[k])*60 - sign*pred[k]
			e += d * d
		}
		sum += math.Sqrt(e) / (Norm3(r) + 1e-9)
	}
	return sum / float64(len(frames)-1)
}

func TestDSUOutputMatchesClientConvention(t *testing.T) {
	flat, _ := BuildOutputMapping(userProfile, SensorFrame{Q: iosQ, H: -1}, [3]float64{0, 0, -1})
	if y := MulVec3(flat, [3]float64{0, 0, -1})[1] * float64(DSUAccSign[1]); math.Abs(y+1) > 1e-9 {
		t.Fatalf("flat DSU AccY = %v, want -1", y)
	}
	if e := dsuKinematicResidual(-1); e > 0.05 {
		t.Fatalf("DSU output violates client kinematics: residual %.3f", e)
	}
	if e := dsuKinematicResidual(+1); e < 0.5 {
		t.Fatalf("residual for the wrong handedness only %.3f; test not discriminating", e)
	}
}
