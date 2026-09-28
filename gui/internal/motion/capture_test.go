package motion

// captureSample is one calibration sample as the app records it in
// gyro_debug_capture.csv; tests that replay real recordings parse into it.
type captureSample struct {
	rot [3]float64 // RotX, RotY, RotZ in °/s
	acc [3]float64 // AccX, AccY, AccZ in g
}

// sampleRots returns just the rotation rates of the samples, in order.
func sampleRots(samples []captureSample) [][3]float64 {
	out := make([][3]float64, len(samples))
	for i, s := range samples {
		out[i] = s.rot
	}
	return out
}
