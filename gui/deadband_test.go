package main

import (
	"math"
	"testing"
)

func oldDeadbandScale(speed, threshold float64) float64 {
	if threshold <= 0 {
		return 1
	}
	if speed < threshold {
		return 0
	}
	return (speed - threshold) / speed
}

func TestDeadband_Edges(t *testing.T) {
	const db = 0.10
	cases := []struct{ speed, want float64 }{
		{0, 0}, {0.05, 0}, {db, 0}, // покой и тремор — полностью глушатся, как раньше
		{2 * db, 1}, {0.3, 1}, {1, 1}, {500, 1}, // выше 2·порога — без изменений
	}
	for _, c := range cases {
		if got := deadbandScale(c.speed, db); math.Abs(got-c.want) > 1e-12 {
			t.Errorf("speed %.3f: scale %.6f, want %.6f", c.speed, got, c.want)
		}
	}
	if deadbandScale(0.01, 0) != 1 {
		t.Error("threshold 0 must disable the deadband")
	}
}

func TestDeadband_SmoothAndMonotonic(t *testing.T) {
	const db = 0.10
	prevOut, prevSlope := 0.0, 0.0
	const h = 1e-5
	for s := h; s <= 3*db; s += h {
		out := s * deadbandScale(s, db)
		if out < prevOut-1e-12 {
			t.Fatalf("output not monotonic at %.5f: %.6f < %.6f", s, out, prevOut)
		}
		if out > s+1e-12 {
			t.Fatalf("output %.6f exceeds input %.6f", out, s)
		}
		slope := (out - prevOut) / h
		if s > h*2 && math.Abs(slope-prevSlope) > 0.01 {
			t.Fatalf("slope jumps at %.5f: %.4f -> %.4f (a kink = a felt jolt)", s, prevSlope, slope)
		}
		prevOut, prevSlope = out, slope
	}
}

// TestDeadband_SlowAimingKeepsSpeed: главное, ради чего правка — медленная
// доводка прицела больше не теряет скорость.
func TestDeadband_SlowAimingKeepsSpeed(t *testing.T) {
	const db = 0.10
	for _, speed := range []float64{0.2, 0.3, 0.5, 1, 2, 5} {
		oldLoss := 1 - oldDeadbandScale(speed, db)
		newLoss := 1 - deadbandScale(speed, db)
		t.Logf("%.1f °/с: потеря скорости было %.1f%%, стало %.1f%%", speed, oldLoss*100, newLoss*100)
		if newLoss > 1e-12 {
			t.Errorf("%.1f °/с still loses %.2f%%", speed, newLoss*100)
		}
	}
}
