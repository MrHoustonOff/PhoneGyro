package app

import (
	"math"
	"testing"
)

// Centering takes the next frame's pose as zero; a new profile or calibration drops it.
func TestCentreHere(t *testing.T) {
	b := newMotionBank()
	if p, r := b.fromCentre(-38, 12); p != -38 || r != 12 {
		t.Fatalf("no centering yet: %v %v", p, r)
	}
	b.centreHere()
	if p, r := b.fromCentre(-38, 12); p != 0 || r != 0 {
		t.Fatalf("first frame after centering: %v %v", p, r)
	}
	if p, r := b.fromCentre(-28, 10); math.Abs(p-10) > 1e-9 || math.Abs(r+2) > 1e-9 {
		t.Fatalf("relative angles: %v %v", p, r)
	}
	if p, _ := b.fromCentre(170, 0); math.Abs(p+152) > 1e-9 {
		t.Fatalf("wrap: %v", p)
	}
	b.resetOrientation()
	if p, r := b.fromCentre(-38, 12); p != -38 || r != 12 {
		t.Fatalf("after resetOrientation: %v %v", p, r)
	}
}
