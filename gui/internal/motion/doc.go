// Package motion is the math between a raw sensor sample and what PhoneGyro
// sends: the 3x3 calibration matrices, the gyroscope/accelerometer axis relation
// learned from motion (sensoralign.go), the DSU output conventions, live gyro
// bias tracking at rest (gyrobias.go), the iOS attitude anchor that keeps the
// integrated angle on the phone's own orientation (attitudeanchor.go), the
// device frame clock (frameclock.go), the in-app AHRS (ahrs.go), the tremor
// deadband formula (deadband.go) and the USB sensor mount-tilt correction
// (mount.go). It holds no app state; gui/ wires it into the frame pipeline.
// See docs/motion-pipeline.md for the whole path.
package motion
