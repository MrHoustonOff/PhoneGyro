package dsu

import (
	"math"
	"testing"
)

// TestCemuBiasModel follows Mahony.h: only samples with all rates under
// 0.35 rad/s count, and the bias exists from 200 samples on.
func TestCemuBiasModel(t *testing.T) {
	var m cemuBiasModel
	for i := 0; i < 199; i++ {
		m.add(0, 10, 0)
	}
	if b := m.biasDps(); b != [3]float64{} {
		t.Fatalf("bias before 200 samples: %v", b)
	}
	m.add(0, 10, 0)
	if b := m.biasDps(); math.Abs(b[1]-10) > 1e-6 {
		t.Fatalf("bias %v, want 10 deg/s on Y", b)
	}
	m.add(0, 30, 0) // 30 deg/s = 0.52 rad/s: too fast, ignored
	for i := 0; i < 200; i++ {
		m.add(0, 0, 0)
	}
	if b := m.biasDps(); math.Abs(b[1]-5) > 1e-6 || m.n != 400 {
		t.Fatalf("bias %v n %d, want 5 deg/s over 400 samples", b, m.n)
	}
}
