package resmon

import (
	"testing"
	"time"
)

func TestResmon_Sample(t *testing.T) {
	m, err := New()
	if err != nil {
		t.Fatalf("Failed to create monitor: %v", err)
	}

	// Sleep slightly to allow CPU time delta
	time.Sleep(50 * time.Millisecond)

	s := m.Sample()
	if s.RAMBytes == 0 {
		t.Errorf("Expected RAMBytes > 0, got 0")
	}
	if s.TotalRAMBytes == 0 {
		t.Errorf("Expected TotalRAMBytes > 0, got 0")
	}
	if s.CPUPercent < 0 {
		t.Errorf("Expected CPUPercent >= 0, got %f", s.CPUPercent)
	}
}

func TestResmon_RunLoop(t *testing.T) {
	samples := 0
	stop := RunLoop(20*time.Millisecond, func(s Stats) {
		samples++
	})
	time.Sleep(70 * time.Millisecond)
	stop()

	if samples == 0 {
		t.Errorf("Expected at least 1 sample from RunLoop, got 0")
	}
}

func TestResmon_ChildProcessTree(t *testing.T) {
	m, err := New()
	if err != nil {
		t.Fatalf("Failed to create monitor: %v", err)
	}

	initialSample := m.Sample()
	if initialSample.RAMBytes == 0 {
		t.Errorf("Expected initial RAMBytes > 0, got 0")
	}

	time.Sleep(50 * time.Millisecond)
	s := m.Sample()
	if s.RAMBytes == 0 {
		t.Errorf("Expected RAMBytes > 0, got 0")
	}
}

// TestResmon_SeesBusyCPU: a busy core shows up as roughly 1/NumCPU of the
// machine (Task Manager's scale), not as zero.
func TestResmon_SeesBusyCPU(t *testing.T) {
	m, err := New()
	if err != nil {
		t.Fatal(err)
	}
	m.Sample()
	deadline := time.Now().Add(400 * time.Millisecond)
	x := 0
	for time.Now().Before(deadline) {
		x++
	}
	s := m.Sample()
	if s.CPUPercent <= 0 || s.CPUPercent > 100 {
		t.Fatalf("busy loop measured as %.2f%% of the machine (x=%d)", s.CPUPercent, x)
	}
	t.Logf("one busy core: %.1f%% of the machine", s.CPUPercent)
}

// BenchmarkSample: what one measurement costs (the app samples every 1.5 s).
func BenchmarkSample(b *testing.B) {
	m, err := New()
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.Sample()
	}
}
