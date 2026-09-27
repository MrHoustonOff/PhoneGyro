package main

import (
	"math"
	"testing"
)

// TestEulerSigns: физический поворот пада -> знак угла, который ждёт LEVEL-HUD.
// Кадр: X вправо, Y вверх, Z к пользователю; поворот задаётся по правилу правой руки.
func TestEulerSigns(t *testing.T) {
	const deg = 10.0
	h := deg * math.Pi / 180 / 2
	c, s := float32(math.Cos(h)), float32(math.Sin(h))

	cases := []struct {
		name                string
		q                   [4]float32
		wantP, wantR, wantY float64
	}{
		// -θ вокруг X: дальний край (-Z) уходит вниз = наклон вперёд.
		{"наклон вперёд", [4]float32{c, -s, 0, 0}, deg, 0, 0},
		// -θ вокруг Z: правый край (+X) уходит вниз = наклон вправо.
		{"наклон вправо", [4]float32{c, 0, 0, -s}, 0, deg, 0},
		// -θ вокруг Y (вверх): по часовой при взгляде сверху.
		{"поворот по часовой", [4]float32{c, 0, -s, 0}, 0, 0, deg},
	}
	for _, tc := range cases {
		m := NewAHRS()
		m.Q0, m.Q1, m.Q2, m.Q3 = tc.q[0], tc.q[1], tc.q[2], tc.q[3]
		p, r, y := m.GetEulerAngles()
		if math.Abs(p-tc.wantP) > 0.01 || math.Abs(r-tc.wantR) > 0.01 || math.Abs(y-tc.wantY) > 0.01 {
			t.Errorf("%s: pitch %.2f roll %.2f yaw %.2f, want %.0f %.0f %.0f", tc.name, p, r, y, tc.wantP, tc.wantR, tc.wantY)
		}
	}
}
