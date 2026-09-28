package motion

import "math"

// Identity3x3 returns the 3x3 identity matrix
func Identity3x3() [3][3]float64 {
	return [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
}

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

// MatTranspose returns the transpose of a 3x3 matrix
func MatTranspose(a [3][3]float64) [3][3]float64 {
	return [3][3]float64{
		{a[0][0], a[1][0], a[2][0]},
		{a[0][1], a[1][1], a[2][1]},
		{a[0][2], a[1][2], a[2][2]},
	}
}

// QuatToMatrix converts a unit quaternion (qx, qy, qz, qw) to a 3x3 SO(3) rotation matrix
func QuatToMatrix(qx, qy, qz, qw float64) [3][3]float64 {
	norm := math.Sqrt(qx*qx + qy*qy + qz*qz + qw*qw)
	if norm > 1e-9 {
		qx /= norm
		qy /= norm
		qz /= norm
		qw /= norm
	} else {
		return [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	}

	xx := qx * qx
	yy := qy * qy
	zz := qz * qz
	xy := qx * qy
	xz := qx * qz
	yz := qy * qz
	wx := qw * qx
	wy := qw * qy
	wz := qw * qz

	return [3][3]float64{
		{1 - 2*(yy+zz), 2 * (xy - wz), 2 * (xz + wy)},
		{2 * (xy + wz), 1 - 2*(xx+zz), 2 * (yz - wx)},
		{2 * (xz - wy), 2 * (yz + wx), 1 - 2*(xx+yy)},
	}
}

// MatrixToQuat converts a 3x3 SO(3) rotation matrix to a unit quaternion (qx, qy, qz, qw)
func MatrixToQuat(m [3][3]float64) (qx, qy, qz, qw float64) {
	tr := m[0][0] + m[1][1] + m[2][2]
	if tr > 0 {
		s := 0.5 / math.Sqrt(tr+1.0)
		qw = 0.25 / s
		qx = (m[2][1] - m[1][2]) * s
		qy = (m[0][2] - m[2][0]) * s
		qz = (m[1][0] - m[0][1]) * s
	} else if m[0][0] > m[1][1] && m[0][0] > m[2][2] {
		s := 2.0 * math.Sqrt(math.Max(0, 1.0+m[0][0]-m[1][1]-m[2][2]))
		if s > 1e-9 {
			qw = (m[2][1] - m[1][2]) / s
			qx = 0.25 * s
			qy = (m[0][1] + m[1][0]) / s
			qz = (m[0][2] + m[2][0]) / s
		} else {
			qw = 1
		}
	} else if m[1][1] > m[2][2] {
		s := 2.0 * math.Sqrt(math.Max(0, 1.0+m[1][1]-m[0][0]-m[2][2]))
		if s > 1e-9 {
			qw = (m[0][2] - m[2][0]) / s
			qx = (m[0][1] + m[1][0]) / s
			qy = 0.25 * s
			qz = (m[1][2] + m[2][1]) / s
		} else {
			qw = 1
		}
	} else {
		s := 2.0 * math.Sqrt(math.Max(0, 1.0+m[2][2]-m[0][0]-m[1][1]))
		if s > 1e-9 {
			qw = (m[1][0] - m[0][1]) / s
			qx = (m[0][2] + m[2][0]) / s
			qy = (m[1][2] + m[2][1]) / s
			qz = 0.25 * s
		} else {
			qw = 1
		}
	}

	norm := math.Sqrt(qx*qx + qy*qy + qz*qz + qw*qw)
	if norm > 1e-9 {
		qx /= norm
		qy /= norm
		qz /= norm
		qw /= norm
	}
	if qw < 0 {
		qx, qy, qz, qw = -qx, -qy, -qz, -qw
	}
	return qx, qy, qz, qw
}

// MatrixToEuler extracts intuitive (Pitch, Roll, Yaw) in degrees from an SO(3) controller rotation matrix
func MatrixToEuler(m [3][3]float64) (pitch, roll, yaw float64) {
	// Pitch: forward/backward tilt
	sinp := -m[1][2]
	if sinp >= 1.0 {
		pitch = 90.0
	} else if sinp <= -1.0 {
		pitch = -90.0
	} else {
		pitch = math.Asin(sinp) * 180.0 / math.Pi
	}

	// Roll: left/right tilt (positive = tilt right)
	roll = math.Atan2(m[1][0], m[1][1]) * 180.0 / math.Pi

	// Yaw: spin around vertical axis (positive = turn right)
	yaw = math.Atan2(m[0][2], m[2][2]) * 180.0 / math.Pi

	return pitch, roll, yaw
}

func Det3x3(m [3][3]float64) float64 {
	return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) -
		m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) +
		m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
}
