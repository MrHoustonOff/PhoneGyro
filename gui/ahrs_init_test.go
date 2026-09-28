package main

import (
	"math"
	"testing"
)

// TestInitKeepsHeading: пад лежит наклонённым сразу по двум осям, но «смотрит
// вперёд». Фильтр стартует по гравитации (так же работает «Центрировать»), затем
// пад плавно возвращается в ровное положение. Модель обязана оказаться ровной и
// без разворота по курсу — раньше минимальный поворот оставлял 8-27° курса.
func TestInitKeepsHeading(t *testing.T) {
	for _, c := range []struct{ pitch, roll float64 }{{30, 0}, {0, 30}, {30, 30}, {45, 30}, {60, 45}, {20, 60}} {
		r0 := MatMul(rotAxis([3]float64{1, 0, 0}, -c.pitch), rotAxis([3]float64{0, 0, 1}, -c.roll)) // тело→мир
		m := NewAHRS()
		// Путь возврата: постоянная угловая скорость тела ω = log(R0ᵀ)/T.
		const T, steps = 2.0, 400
		dt := T / steps
		wb := rotVecOf(Transpose3(r0))
		cur := r0
		for i := 0; i <= steps; i++ {
			up := MulVec3(Transpose3(cur), [3]float64{0, 1, 0})
			var rot [3]float64
			if i > 0 {
				rot = [3]float64{wb[0] / T * 180 / math.Pi, -wb[1] / T * 180 / math.Pi, -wb[2] / T * 180 / math.Pi}
			}
			m.Update(float32(rot[0]), float32(rot[1]), float32(rot[2]), float32(-up[0]), float32(-up[1]), float32(-up[2]), float32(dt))
			cur = MatMul(cur, rotAxis(wb, math.Sqrt(wb[0]*wb[0]+wb[1]*wb[1]+wb[2]*wb[2])/steps*180/math.Pi))
		}
		p, r, y := m.GetEulerAngles()
		t.Logf("старт наклонён вперёд %2.0f°, вправо %2.0f° -> в ровном: pitch %.2f roll %.2f yaw %.2f", c.pitch, c.roll, p, r, y)
		if math.Abs(p) > 0.5 || math.Abs(r) > 0.5 || math.Abs(y) > 0.5 {
			t.Errorf("pitch %.2f roll %.2f yaw %.2f after returning flat, want ~0", p, r, y)
		}
	}
}

// rotVecOf — вектор поворота (ось·угол, рад) матрицы поворота.
func rotVecOf(m [3][3]float64) [3]float64 {
	c := (m[0][0] + m[1][1] + m[2][2] - 1) / 2
	a := math.Acos(math.Max(-1, math.Min(1, c)))
	if a < 1e-9 {
		return [3]float64{}
	}
	k := a / (2 * math.Sin(a))
	return [3]float64{(m[2][1] - m[1][2]) * k, (m[0][2] - m[2][0]) * k, (m[1][0] - m[0][1]) * k}
}
