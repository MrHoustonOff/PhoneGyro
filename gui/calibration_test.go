package main

import (
	"math"
	"phonegyro-gui/internal/motion"
	"testing"
)

func TestCalibration_StillnessStep0(t *testing.T) {
	app := &App{}

	// 1. Normal motionless resting on desk (bias test)
	app.StartCapture()
	for i := 0; i < 30; i++ {
		app.phoneBank.captureMu.Lock()
		app.phoneBank.captureBuffer = append(app.phoneBank.captureBuffer, captureSample{
			rot: [3]float64{0.45, -0.25, 0.15},
			acc: [3]float64{0, 0, 1.0},
		})
		app.phoneBank.captureMu.Unlock()
	}
	res := app.StopCapture(0)
	if !res.Success {
		t.Fatalf("expected Step 0 stillness to succeed, got error: %s (%s)", res.ErrorCode, res.ErrorMsg)
	}

	app.phoneBank.biasMu.RLock()
	bx, by, bz := app.phoneBank.gyroBias[0], app.phoneBank.gyroBias[1], app.phoneBank.gyroBias[2]
	app.phoneBank.biasMu.RUnlock()

	if math.Abs(bx-0.45) > 0.01 || math.Abs(by+0.25) > 0.01 || math.Abs(bz-0.15) > 0.01 {
		t.Fatalf("unexpected bias values: %f, %f, %f", bx, by, bz)
	}

	// 2. Moving / shaking during Step 0 -> must fail with error_moved_during_rest
	app.StartCapture()
	for i := 0; i < 30; i++ {
		app.phoneBank.captureMu.Lock()
		app.phoneBank.captureBuffer = append(app.phoneBank.captureBuffer, captureSample{
			rot: [3]float64{float64(i%5) * 3.0, 0.0, 0.0},
			acc: [3]float64{0, 0, 1.0},
		})
		app.phoneBank.captureMu.Unlock()
	}
	resMoved := app.StopCapture(0)
	if resMoved.Success {
		t.Fatalf("expected shaking during Step 0 to fail")
	}
	if resMoved.ErrorCode != "error_moved_during_rest" {
		t.Fatalf("expected error_moved_during_rest, got %s", resMoved.ErrorCode)
	}
}

func TestCalibration_SignsAndDeterminant(t *testing.T) {
	app := &App{}

	// Portrait mode gestures:
	// Pitch forward: channel 0 (X) moves in negative direction (beta < 0) -> row_pitch = target(-1) * sign(-1) * e_0 = [+1, 0, 0]
	// Roll right: channel 2 (Z) moves in negative direction (alpha < 0) -> row_roll = target(+1) * sign(-1) * e_2 = [0, 0, -1]
	pitchRow := [3]float64{1, 0, 0}
	rollRow := [3]float64{0, 0, -1}

	res := app.ValidateCalibration(pitchRow, rollRow)
	if !res.Success {
		t.Fatalf("expected valid calibration to pass, got error: %s (%s)", res.ErrorCode, res.ErrorMsg)
	}

	// Cemuhook DSU is a left-handed parity convention (§3.3 of spec) -> det = -1.0
	if math.Abs(res.Det+1.0) > 1e-4 {
		t.Fatalf("expected det = -1.0, got %f", res.Det)
	}

	if res.PitchAxis != "+X" || res.YawAxis != "+Y" || res.RollAxis != "-Z" {
		t.Fatalf("unexpected axis names: P=%s Y=%s R=%s", res.PitchAxis, res.YawAxis, res.RollAxis)
	}

	expectedMatrix := [3][3]float64{
		{1, 0, 0},
		{0, 1, 0},
		{0, 0, -1},
	}
	if res.Matrix != expectedMatrix {
		t.Fatalf("expected canonical matrix %v, got %v", expectedMatrix, res.Matrix)
	}
}

func TestYawSignNotFlipped(t *testing.T) {
	app := &App{}

	// Regression test for §3.3 & §7:
	// In portrait orientation, Pitch=+X, Roll=-Z.
	// When user turns phone clockwise (looking from top down), physical sensor rotates around +Y in negative direction (gamma < 0).
	// Protcol requires RotY < 0.
	pitchRow := [3]float64{1, 0, 0}
	rollRow := [3]float64{0, 0, -1}
	res := app.ValidateCalibration(pitchRow, rollRow)
	if !res.Success {
		t.Fatalf("calibration failed: %s", res.ErrorMsg)
	}

	// Matrix multiplication of pure clockwise turn: raw = [0, -40, 0]
	rawClockwise := [3]float64{0, -40.0, 0}
	rx, ry, rz := motion.ApplyMatrix(res.Matrix, rawClockwise[0], rawClockwise[1], rawClockwise[2])

	if ry >= 0 {
		t.Fatalf("RotY must be NEGATIVE for clockwise turn, got %f", ry)
	}
	if math.Abs(rx) > 1e-4 || math.Abs(rz) > 1e-4 {
		t.Fatalf("Cross-axis leakage: rx=%f, rz=%f", rx, rz)
	}
}

func TestPitchRollAxisCollision(t *testing.T) {
	app := &App{}

	// Pitch and Roll mapped to same physical axis (X) -> must fail with error_grip_changed
	resGrip := app.ValidateCalibration([3]float64{1, 0, 0}, [3]float64{1, 0, 0})
	if resGrip.Success {
		t.Fatalf("expected duplicate Pitch+Roll axes to fail")
	}
	if resGrip.ErrorCode != "error_grip_changed" {
		t.Fatalf("expected error_grip_changed, got %s", resGrip.ErrorCode)
	}
}

func TestCalibration_EndToEnd_StandardPortraitFlow(t *testing.T) {
	app := &App{}

	// Step 0: Stillness (Bias)
	app.StartCapture()
	for i := 0; i < 25; i++ {
		app.phoneBank.captureMu.Lock()
		app.phoneBank.captureBuffer = append(app.phoneBank.captureBuffer, captureSample{
			rot: [3]float64{0.1, -0.05, 0.08},
			acc: [3]float64{0, 1.0, 0},
		})
		app.phoneBank.captureMu.Unlock()
	}
	res0 := app.StopCapture(0)
	if !res0.Success {
		t.Fatalf("Step 0 failed: %s", res0.ErrorMsg)
	}

	// Step 1 (Pitch / "Кивни"): Nod phone forward -> raw sensor detects -X
	app.StartCapture()
	for i := 0; i < 20; i++ {
		app.phoneBank.captureMu.Lock()
		app.phoneBank.captureBuffer = append(app.phoneBank.captureBuffer, captureSample{
			rot: [3]float64{-65.0, 0.2, -0.1},
			acc: [3]float64{0, 1.0, 0},
		})
		app.phoneBank.captureMu.Unlock()
	}
	res1 := app.StopCapture(1)
	if !res1.Success {
		t.Fatalf("Step 1 failed: %s (%s)", res1.ErrorCode, res1.ErrorMsg)
	}
	if res1.Vector != [3]float64{1, 0, 0} {
		t.Fatalf("Step 1 expected [+1, 0, 0], got %v", res1.Vector)
	}

	// Step 2 (Roll / "Самолётик"): Bank right -> raw sensor detects -Z in portrait
	app.StartCapture()
	for i := 0; i < 20; i++ {
		app.phoneBank.captureMu.Lock()
		app.phoneBank.captureBuffer = append(app.phoneBank.captureBuffer, captureSample{
			rot: [3]float64{0.1, 0.2, -58.0},
			acc: [3]float64{0, 1.0, 0},
		})
		app.phoneBank.captureMu.Unlock()
	}
	res2 := app.StopCapture(2)
	if !res2.Success {
		t.Fatalf("Step 2 failed: %s (%s)", res2.ErrorCode, res2.ErrorMsg)
	}
	if res2.Vector != [3]float64{0, 0, -1} {
		t.Fatalf("Step 2 expected [0, 0, -1], got %v", res2.Vector)
	}

	// Validation
	val := app.ValidateCalibration(res1.Vector, res2.Vector)
	if !val.Success {
		t.Fatalf("Validation failed: %s (%s)", val.ErrorCode, val.ErrorMsg)
	}
	if val.PitchAxis != "+X" || val.YawAxis != "+Y" || val.RollAxis != "-Z" {
		t.Fatalf("Expected P=+X, Y=+Y, R=-Z; got P=%s, Y=%s, R=%s", val.PitchAxis, val.YawAxis, val.RollAxis)
	}
	if math.Abs(val.Det+1.0) > 1e-4 {
		t.Fatalf("Expected det = -1.0, got %f", val.Det)
	}

	expectedMatrix := [3][3]float64{
		{1, 0, 0},  // Pitch = +X
		{0, 1, 0},  // Yaw   = +Y
		{0, 0, -1}, // Roll  = -Z
	}
	if val.Matrix != expectedMatrix {
		t.Fatalf("Matrix mismatch. Got %v, expected %v", val.Matrix, expectedMatrix)
	}
}

func TestCalibration_UnconstrainedGestureRecognition(t *testing.T) {
	app := &App{}

	// Step 0: Rest on desk
	app.StartCapture()
	for i := 0; i < 25; i++ {
		app.phoneBank.captureMu.Lock()
		app.phoneBank.captureBuffer = append(app.phoneBank.captureBuffer, captureSample{
			rot: [3]float64{0.0, 0.0, 0.0},
			acc: [3]float64{0, 0, 1.0},
		})
		app.phoneBank.captureMu.Unlock()
	}
	res0 := app.StopCapture(0)
	if !res0.Success {
		t.Fatalf("Step 0 failed: %s", res0.ErrorMsg)
	}

	// Step 1: Gesture on any axis succeeds without artificial blocking
	app.StartCapture()
	for i := 0; i < 20; i++ {
		app.phoneBank.captureMu.Lock()
		app.phoneBank.captureBuffer = append(app.phoneBank.captureBuffer, captureSample{
			rot: [3]float64{0.1, 0.2, -65.0},
			acc: [3]float64{0, 0, 1.0},
		})
		app.phoneBank.captureMu.Unlock()
	}
	res1 := app.StopCapture(1)
	if !res1.Success {
		t.Fatalf("Step 1 expected to succeed, got error: %s", res1.ErrorCode)
	}
}

func TestPadTest_Convergence(t *testing.T) {
	testCases := []struct {
		name       string
		ax, ay, az float32
	}{
		{"AccX=-1.0 (Current bug)", -1.0, 0.0, 0.0},
		{"AccZ=-1.0", 0.0, 0.0, -1.0},
		{"AccZ=+1.0", 0.0, 0.0, 1.0},
		{"AccY=-1.0", 0.0, -1.0, 0.0},
		{"AccY=+1.0", 0.0, 1.0, 0.0},
	}

	for _, tc := range testCases {
		ahrs := motion.NewAHRS()
		// Run 300 steps (5 seconds at 60 Hz) of stationary holding
		for i := 0; i < 300; i++ {
			ahrs.Update(0, 0, 0, tc.ax, tc.ay, tc.az, 1.0/60.0)
		}
		p, r, y := ahrs.GetEulerAngles()
		t.Logf("[%s] Q: (%+.3f, %+.3f, %+.3f, %+.3f) -> Pitch: %+.1f°, Roll: %+.1f°, Yaw: %+.1f°",
			tc.name, ahrs.Q0, ahrs.Q1, ahrs.Q2, ahrs.Q3, p, r, y)
	}
}

func TestLandscapeCalibration_YawAndPadTest(t *testing.T) {
	app := &App{}

	// Landscape user gestures: Pitch = +Z, Roll = +X
	pitchRow := [3]float64{0, 0, 1}
	rollRow := [3]float64{1, 0, 0}

	val := app.ValidateCalibration(pitchRow, rollRow)
	if !val.Success {
		t.Fatalf("Validation failed: %s (%s)", val.ErrorCode, val.ErrorMsg)
	}

	expectedMatrix := [3][3]float64{
		{0, 0, 1}, // Pitch = +Z
		{0, 1, 0}, // Yaw   = +Y (natural right-handed yaw, matches Three.js and PadTest)
		{1, 0, 0}, // Roll  = +X
	}
	if val.Matrix != expectedMatrix {
		t.Fatalf("Matrix mismatch. Got %v, expected %v", val.Matrix, expectedMatrix)
	}

	// Verify Yaw sign: Clockwise turn produces positive RotY
	rawClockwise := [3]float64{0, 35.0, 0}
	_, ry, _ := motion.ApplyMatrix(val.Matrix, rawClockwise[0], rawClockwise[1], rawClockwise[2])
	if ry <= 0 {
		t.Fatalf("RotY must be POSITIVE for clockwise turn in landscape, got %f", ry)
	}

}
