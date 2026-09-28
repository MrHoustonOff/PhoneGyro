package motion

import (
	"math"
	"testing"
)

func quatAxis(axis [3]float64, deg float64) Quat {
	return qexp([3]float64{axis[0] * deg * math.Pi / 180, axis[1] * deg * math.Pi / 180, axis[2] * deg * math.Pi / 180})
}

func levelOf(q Quat) (fwd, right, heading float64) {
	m := NewAHRS()
	m.Q0, m.Q1, m.Q2, m.Q3 = float32(q[0]), float32(q[1]), float32(q[2]), float32(q[3])
	return m.GetLevel()
}

// TestLevelSigns: what the user asked for on LEVEL — tilt forward -> bubble up
// (+fwd), tilt right -> bubble right (+right), turn clockwise -> needle clockwise
// (+heading). Same conventions as TestEulerSigns.
func TestLevelSigns(t *testing.T) {
	cases := []struct {
		name          string
		q             Quat
		fwd, right, h float64
	}{
		{"наклон вперёд", quatAxis([3]float64{1, 0, 0}, -10), 10, 0, 0},
		{"наклон назад", quatAxis([3]float64{1, 0, 0}, 10), -10, 0, 0},
		{"наклон вправо", quatAxis([3]float64{0, 0, 1}, -10), 0, 10, 0},
		{"поворот по часовой", quatAxis([3]float64{0, 1, 0}, -10), 0, 0, 10},
	}
	for _, c := range cases {
		f, r, h := levelOf(c.q)
		if math.Abs(f-c.fwd) > 0.01 || math.Abs(r-c.right) > 0.01 || math.Abs(h-c.h) > 0.01 {
			t.Errorf("%s: fwd %.2f right %.2f heading %.2f, want %.0f %.0f %.0f", c.name, f, r, h, c.fwd, c.right, c.h)
		}
	}
}

// TestLevelSmoothBeyond90: tilting forward from flat to nearly upside down must
// move the bubble steadily and leave the needle alone. Euler angles flip roll and
// yaw by 180° at 90° of pitch — the "jitter past 90°" the user saw.
func TestLevelSmoothBeyond90(t *testing.T) {
	prevF := 0.0
	var eulerJump float64
	prevEY, prevER := 0.0, 0.0
	for deg := 1.0; deg <= 175; deg++ {
		q := quatAxis([3]float64{1, 0, 0}, -deg)
		f, r, h := levelOf(q)
		if math.Abs(f-prevF-1) > 0.05 || math.Abs(r) > 0.05 || math.Abs(h) > 0.05 {
			t.Fatalf("at %.0f° forward: fwd %.2f (prev %.2f) right %.2f heading %.2f — not smooth", deg, f, prevF, r, h)
		}
		prevF = f
		m := NewAHRS()
		m.Q0, m.Q1, m.Q2, m.Q3 = float32(q[0]), float32(q[1]), float32(q[2]), float32(q[3])
		_, er, ey := m.GetEulerAngles()
		eulerJump = math.Max(eulerJump, math.Max(math.Abs(ey-prevEY), math.Abs(er-prevER)))
		prevEY, prevER = ey, er
	}
	t.Logf("forward sweep 0..175°: LEVEL smooth; old Euler roll/yaw jumped by up to %.0f° in one degree of motion", eulerJump)
}

// TestLevelHeadingIgnoresTilt: tilted 60° forward and turned about the vertical,
// the needle shows exactly the turn and the bubble stays where the tilt is.
func TestLevelHeadingIgnoresTilt(t *testing.T) {
	for _, turn := range []float64{-170, -90, -30, 0, 45, 120, 170} {
		q := qmul(quatAxis([3]float64{0, 1, 0}, -turn), quatAxis([3]float64{1, 0, 0}, -60))
		f, r, h := levelOf(q)
		if math.Abs(h-turn) > 0.05 || math.Abs(f-60) > 0.05 || math.Abs(r) > 0.05 {
			t.Errorf("turn %.0f° at 60° tilt: heading %.2f fwd %.2f right %.2f", turn, h, f, r)
		}
	}
}
