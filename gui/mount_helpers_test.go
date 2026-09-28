package main

import (
	"math"

	"phonegyro-gui/internal/motion"
)

// rotAxis and simulateMount give the app-level tests a real, verified mount
// correction to work with (the same helpers internal/motion's own tests use).

func rotAxis(axis [3]float64, deg float64) [3][3]float64 {
	n := motion.Norm3(axis)
	x, y, z := axis[0]/n, axis[1]/n, axis[2]/n
	a := deg * math.Pi / 180
	c, s, t := math.Cos(a), math.Sin(a), 1-math.Cos(a)
	return [3][3]float64{
		{t*x*x + c, t*x*y - s*z, t*x*z + s*y},
		{t*x*y + s*z, t*y*y + c, t*y*z - s*x},
		{t*x*z - s*y, t*y*z + s*x, t*z*z + c},
	}
}

func simulateMount(m [3][3]float64, pitchWobbleDeg float64) (up [3]float64, pitch [][3]float64) {
	mt := motion.Transpose3(m)
	up = motion.MulVec3(mt, [3]float64{0, 1, 0})
	wob := rotAxis([3]float64{0, 1, 0}, pitchWobbleDeg)
	for i := 0; i < 200; i++ {
		w := 150 * math.Sin(float64(i)/10)
		pitch = append(pitch, motion.MulVec3(mt, motion.MulVec3(wob, [3]float64{w, 0, 0})))
	}
	return
}
