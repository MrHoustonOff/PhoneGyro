package motion

// DefaultMatrix3x3 returns the canonical portrait orientation matrix for Cemuhook DSU:
// Pitch = +X, Yaw = +Y, Roll = -Z (det = -1.0)
func DefaultMatrix3x3() [3][3]float64 {
	return [3][3]float64{
		{1, 0, 0},
		{0, 1, 0},
		{0, 0, -1},
	}
}

// ApplyMatrix multiplies a 3x3 matrix by a column vector [x, y, z]
func ApplyMatrix(m [3][3]float64, x, y, z float64) (float64, float64, float64) {
	rx := m[0][0]*x + m[0][1]*y + m[0][2]*z
	ry := m[1][0]*x + m[1][1]*y + m[1][2]*z
	rz := m[2][0]*x + m[2][1]*y + m[2][2]*z
	return rx, ry, rz
}

// MatMul multiplies two 3x3 matrices: c = a * b
func MatMul(a, b [3][3]float64) [3][3]float64 {
	var c [3][3]float64
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			c[i][j] = a[i][0]*b[0][j] + a[i][1]*b[1][j] + a[i][2]*b[2][j]
		}
	}
	return c
}

// Det3x3 is the determinant of m.
func Det3x3(m [3][3]float64) float64 {
	return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) -
		m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) +
		m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
}
