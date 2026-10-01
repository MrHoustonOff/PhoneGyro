package app

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"phonegyro-gui/internal/motion"
	"strings"
	"time"
)

// captureSample holds raw 60 Hz gyro and accel readings
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

// CaptureResult represents the computed result of a calibration gesture
type CaptureResult struct {
	Success     bool       `json:"success"`
	AxisIdx     int        `json:"axisIdx"`    // 0=X, 1=Y, 2=Z
	Sign        float64    `json:"sign"`       // +1.0 or -1.0
	AxisName    string     `json:"axisName"`   // "+X", "-Y", etc.
	Confidence  float64    `json:"confidence"` // 0.0 to 1.0
	SampleCount int        `json:"sampleCount"`
	PeakSpeed   float64    `json:"peakSpeed"` // peak speed in °/s
	Vector      [3]float64 `json:"vector"`    // Normalized 3D direction vector
	ErrorCode   string     `json:"errorCode"`
	ErrorMsg    string     `json:"errorMsg"`
}

// ValidationResult represents the 3-tier foolproof verification of all 3 calibration gestures
type ValidationResult struct {
	Success   bool          `json:"success"`
	ErrorCode string        `json:"errorCode"`
	ErrorMsg  string        `json:"errorMsg"`
	Matrix    [3][3]float64 `json:"matrix"`
	Det       float64       `json:"det"`
	PitchAxis string        `json:"pitchAxis"`
	YawAxis   string        `json:"yawAxis"`
	RollAxis  string        `json:"rollAxis"`
}

// AxisAlignStatus reports the live state of the accelerometer↔gyro axis relation
// (gui/internal/motion/sensoralign.go) for the explicit "determine axes" wizard step: how many
// informative still-tilt-still pairs have been scored, and whether physics has
// locked a confident mapping yet.
type AxisAlignStatus struct {
	Known    bool      `json:"known"`
	Pairs    int       `json:"pairs"`
	MinPairs int       `json:"minPairs"`
	Mapping  [3]string `json:"mapping"` // e.g. ["+Y", "+Z", "+X"]
}

// StepCaptureLog stores the full recorded session of a calibration gesture step
type StepCaptureLog struct {
	Step      int             `json:"step"`
	Samples   []captureSample `json:"samples"`
	Result    CaptureResult   `json:"result"`
	Timestamp time.Time       `json:"timestamp"`
}

// RawLogFrame holds exact raw telemetry frame fields for debug logging
type RawLogFrame struct {
	Timestamp uint32  `json:"ts"`
	RotX      float32 `json:"rotX"`
	RotY      float32 `json:"rotY"`
	RotZ      float32 `json:"rotZ"`
	AccX      float32 `json:"accX"`
	AccY      float32 `json:"accY"`
	AccZ      float32 `json:"accZ"`
	Qx        float32 `json:"qx"`
	Qy        float32 `json:"qy"`
	Qz        float32 `json:"qz"`
	Qw        float32 `json:"qw"`
}

// getWizardAlign returns the active bank's calibration wizard scratch aligner, or nil
// when no axis-align step is in progress (see wizardAlign field doc).
func (a *App) getWizardAlign() *motion.SensorAligner {
	bank := a.activeBank()
	bank.wizardAlignMu.RLock()
	defer bank.wizardAlignMu.RUnlock()
	return bank.wizardAlign
}

// PreviewMatrix temporarily overrides the active bank's calibration matrix for the 3D
// viewport. Call this when the calibration wizard shows the confirm or manual screen
// so the user can see exactly how the candidate matrix behaves before saving.
func (a *App) PreviewMatrix(matrix [3][3]float64) {
	bank := a.activeBank()
	bank.previewMu.Lock()
	bank.previewMatrix = matrix
	bank.usePreview = true
	bank.previewMu.Unlock()
	a.stageWizardMount(bank, matrix)
	if bank.ahrs != nil {
		bank.resetOrientation()
	}
}

// ClearPreview removes the temporary preview matrix and reverts to the saved activeMatrix.
// Call this when the calibration wizard is closed or cancelled.
func (a *App) ClearPreview() {
	bank := a.activeBank()
	bank.previewMu.Lock()
	bank.usePreview = false
	bank.previewMu.Unlock()
	// Discard the wizard's scratch axis-align attempt too: whatever it found either
	// was already captured into the profile by SaveProfile, or the wizard was
	// cancelled and it must not linger and leak into some later, unrelated Save.
	bank.wizardAlignMu.Lock()
	bank.wizardAlign = nil
	bank.wizardGravityValid = false
	bank.wizardAlignMu.Unlock()
	bank.mountMu.Lock()
	bank.wizardMount = nil
	bank.mountMu.Unlock()
	if bank.ahrs != nil {
		bank.resetOrientation()
	}
}

func (a *App) StartCapture() {
	bank := a.activeBank()
	bank.captureMu.Lock()
	bank.captureBuffer = make([]captureSample, 0, 300)
	bank.captureMu.Unlock()
	bank.isCapturing.Store(true)
}

// writeDebugCSV appends a capture session block to gyro_debug_capture.csv in the
// active mode's own bank directory. Each session is separated by a blank line and
// starts with a header and a metadata row.
func (a *App) writeDebugCSV(bank *motionBank, step int, samples []captureSample, result CaptureResult) {
	// The in-memory step log comes first and never depends on the file: the
	// wizard reads it (mount-tilt correction, calibration report). It used to be
	// stored only after the CSV opened, and on a fresh install the USB bank's
	// folder does not exist until the first profile save -- so the very first USB
	// calibration silently lost every step and could not show the mount card.
	bank.calLogMu.Lock()
	if bank.calStepLogs == nil {
		bank.calStepLogs = make(map[int]StepCaptureLog)
	}
	samplesCopy := make([]captureSample, len(samples))
	copy(samplesCopy, samples)
	bank.calStepLogs[step] = StepCaptureLog{
		Step:      step,
		Samples:   samplesCopy,
		Result:    result,
		Timestamp: time.Now(),
	}
	bank.calLogMu.Unlock()

	dir := a.bankDir(a.GetInputMode())
	if err := os.MkdirAll(dir, 0755); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "gyro_debug_capture.csv"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	ts := time.Now().Format("2006-01-02 15:04:05")
	fmt.Fprintf(f, "\n# Session: %s  step=%d  samples=%d  success=%v  axisIdx=%d  axisName=%s  confidence=%.3f  peakSpeed=%.2f\n",
		ts, step, len(samples), result.Success, result.AxisIdx, result.AxisName, result.Confidence, result.PeakSpeed)
	fmt.Fprintln(f, "idx,rotX,rotY,rotZ,accX,accY,accZ,speed")
	for i, s := range samples {
		speed := math.Sqrt(s.rot[0]*s.rot[0] + s.rot[1]*s.rot[1] + s.rot[2]*s.rot[2])
		fmt.Fprintf(f, "%d,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f\n",
			i, s.rot[0], s.rot[1], s.rot[2],
			s.acc[0], s.acc[1], s.acc[2], speed)
	}
}

// StopCapture stops buffering and analyzes the captured gyro frames for the given gesture step.
// step 0: Stillness / "Покой" — phone motionless on desk (~1.5s) to calibrate zero-bias
// step 1: Pitch     / "Кивни" — tilt phone forward/back (nod gesture, target RotX < 0)
// step 2: Roll      / "Самолётик" — bank phone left/right (wing gesture, target RotZ > 0)
// Yaw is computed automatically in ValidateCalibration with det = -1.0.
func (a *App) StopCapture(step int) CaptureResult {
	bank := a.activeBank()
	bank.isCapturing.Store(false)
	bank.captureMu.Lock()
	samples := bank.captureBuffer
	bank.captureBuffer = nil
	bank.captureMu.Unlock()

	if len(samples) < 5 {
		res := CaptureResult{
			Success:   false,
			ErrorCode: "error_too_few_samples",
			ErrorMsg:  a.getI18nMsg("calibration.error_too_few_samples"),
		}
		a.writeDebugCSV(bank, step, samples, res)
		return res
	}

	// ── Step 0: Stillness / Bias Calibration (§2 of spec) ──
	if step == 0 {
		if len(samples) < 20 {
			res := CaptureResult{
				Success:   false,
				ErrorCode: "error_too_few_samples",
				ErrorMsg:  a.getI18nMsg("calibration.error_too_few_samples"),
			}
			a.writeDebugCSV(bank, step, samples, res)
			return res
		}

		var sumX, sumY, sumZ float64
		var peakSpeed float64
		for _, s := range samples {
			sumX += s.rot[0]
			sumY += s.rot[1]
			sumZ += s.rot[2]
			spd := math.Sqrt(s.rot[0]*s.rot[0] + s.rot[1]*s.rot[1] + s.rot[2]*s.rot[2])
			if spd > peakSpeed {
				peakSpeed = spd
			}
		}
		n := float64(len(samples))
		bX := sumX / n
		bY := sumY / n
		bZ := sumZ / n

		// Compute variance to verify phone was not shaken or moved during rest
		var varSum float64
		for _, s := range samples {
			dx := s.rot[0] - bX
			dy := s.rot[1] - bY
			dz := s.rot[2] - bZ
			varSum += dx*dx + dy*dy + dz*dz
		}
		stdDev := math.Sqrt(varSum / n)

		if stdDev > 2.5 || peakSpeed > 6.0 {
			res := CaptureResult{
				Success:     false,
				ErrorCode:   "error_moved_during_rest",
				ErrorMsg:    a.getI18nMsg("calibration.error_moved_during_rest"),
				SampleCount: len(samples),
				PeakSpeed:   peakSpeed,
			}
			a.writeDebugCSV(bank, step, samples, res)
			return res
		}

		// Store verified zero-bias
		bank.biasMu.Lock()
		bank.gyroBias = [3]float64{bX, bY, bZ}
		bank.biasMu.Unlock()

		// Capture average gravity unit vector during stillness
		var sumAccX, sumAccY, sumAccZ float64
		for _, s := range samples {
			sumAccX += s.acc[0]
			sumAccY += s.acc[1]
			sumAccZ += s.acc[2]
		}
		gX := sumAccX / n
		gY := sumAccY / n
		gZ := sumAccZ / n
		gNorm := math.Sqrt(gX*gX + gY*gY + gZ*gZ)
		if gNorm > 0.4 {
			// Stage it (do not touch the live bank.calGravity yet): this rest step may
			// belong to a profile that is not even the active one, and the wizard may
			// still be cancelled. Only SaveProfile commits it — see wizardGravity.
			bank.wizardAlignMu.Lock()
			bank.wizardGravity = [3]float64{gX / gNorm, gY / gNorm, gZ / gNorm}
			bank.wizardGravityValid = true
			bank.wizardAlignMu.Unlock()
		}

		res := CaptureResult{
			Success:     true,
			AxisIdx:     -1,
			Sign:        1.0,
			AxisName:    "",
			Confidence:  1.0,
			SampleCount: len(samples),
			PeakSpeed:   peakSpeed,
		}
		a.writeDebugCSV(bank, step, samples, res)
		return res
	}

	// ── Step 1 & 2: Dynamic gestures (Pitch / Roll) ──
	// Subtract calibrated bias first (§1 of spec)
	bank.biasMu.RLock()
	bx, by, bz := bank.gyroBias[0], bank.gyroBias[1], bank.gyroBias[2]
	bank.biasMu.RUnlock()

	for i := range samples {
		samples[i].rot[0] -= bx
		samples[i].rot[1] -= by
		samples[i].rot[2] -= bz
	}

	axisNames := []string{"X", "Y", "Z"}

	var peakSpeed float64
	var activeCount int
	var energy [3]float64
	var peakVal [3]float64

	for _, s := range samples {
		speed := math.Sqrt(s.rot[0]*s.rot[0] + s.rot[1]*s.rot[1] + s.rot[2]*s.rot[2])
		if speed > peakSpeed {
			peakSpeed = speed
		}
		if speed >= 10.0 { // movement threshold in °/s
			activeCount++
			for i := 0; i < 3; i++ {
				energy[i] += s.rot[i] * s.rot[i]
				if math.Abs(s.rot[i]) > math.Abs(peakVal[i]) {
					peakVal[i] = s.rot[i]
				}
			}
		}
	}

	if activeCount < 3 || peakSpeed < 12.0 {
		res := CaptureResult{
			Success:     false,
			SampleCount: len(samples),
			PeakSpeed:   peakSpeed,
			ErrorCode:   "error_too_weak",
			ErrorMsg:    a.getI18nMsg("calibration.error_too_weak"),
		}
		a.writeDebugCSV(bank, step, samples, res)
		return res
	}

	totalEnergy := energy[0] + energy[1] + energy[2]
	if totalEnergy < 1e-3 {
		res := CaptureResult{
			Success:     false,
			SampleCount: len(samples),
			PeakSpeed:   peakSpeed,
			ErrorCode:   "error_too_weak",
			ErrorMsg:    a.getI18nMsg("calibration.error_too_weak"),
		}
		a.writeDebugCSV(bank, step, samples, res)
		return res
	}

	// Find dominant axis by energy
	axisIdx := 0
	maxEnergy := energy[0]
	for i := 1; i < 3; i++ {
		if energy[i] > maxEnergy {
			maxEnergy = energy[i]
			axisIdx = i
		}
	}
	secondEnergy := 0.0
	for i := 0; i < 3; i++ {
		if i != axisIdx && energy[i] > secondEnergy {
			secondEnergy = energy[i]
		}
	}

	confidence := 0.0
	if maxEnergy > 1e-6 {
		confidence = (maxEnergy - secondEnergy) / maxEnergy
	}

	// Determine gesture sign from the first significant half-wave of motion
	maxPeakOnAxis := math.Abs(peakVal[axisIdx])
	threshold := math.Max(8.0, 0.25*maxPeakOnAxis)
	sign := 1.0
	firstSign := 0.0
	for _, s := range samples {
		v := s.rot[axisIdx]
		if firstSign == 0 {
			if math.Abs(v) >= threshold {
				if v >= 0 {
					firstSign = 1.0
				} else {
					firstSign = -1.0
				}
			}
		} else {
			if (firstSign > 0 && v < -5.0) || (firstSign < 0 && v > 5.0) {
				break // End of first half-wave
			}
		}
	}
	if firstSign != 0 {
		sign = firstSign
	} else if peakVal[axisIdx] < 0 {
		sign = -1.0
	}

	signStr := "+"
	if sign < 0 {
		signStr = "-"
	}
	name := signStr + axisNames[axisIdx]

	// Ambiguity check
	if maxPeakOnAxis < 10.0 || confidence < 0.15 {
		res := CaptureResult{
			Success:     false,
			AxisIdx:     axisIdx,
			Sign:        sign,
			AxisName:    name,
			Confidence:  confidence,
			SampleCount: activeCount,
			PeakSpeed:   peakSpeed,
			ErrorCode:   "error_ambiguous",
			ErrorMsg:    a.getI18nMsg("calibration.error_ambiguous"),
		}
		a.writeDebugCSV(bank, step, samples, res)
		return res
	}

	// Build canonical row vector according to formula in §3.1:
	// row_k = target_sign * detected_sign * e_{detected_axis}
	var d [3]float64
	if step == 1 {
		// Pitch step: target RotX < 0 when nodding forward -> target = -1.0
		targetPitchSign := -1.0
		d[axisIdx] = targetPitchSign * sign
		bank.calVectors[0] = d
		bank.calVectors[1] = [3]float64{0, 0, 0}
	} else if step == 2 {
		// Roll step: target RotZ > 0 when banking right -> target = +1.0
		targetRollSign := +1.0
		d[axisIdx] = targetRollSign * sign

		// Verify it's a different physical axis from Pitch
		pitchAxIdx := -1
		for i := 0; i < 3; i++ {
			if math.Abs(bank.calVectors[0][i]) > 0.5 {
				pitchAxIdx = i
				break
			}
		}
		if pitchAxIdx >= 0 && pitchAxIdx == axisIdx {
			res := CaptureResult{
				Success:     false,
				AxisIdx:     axisIdx,
				Sign:        sign,
				AxisName:    name,
				Confidence:  confidence,
				SampleCount: activeCount,
				PeakSpeed:   peakSpeed,
				Vector:      d,
				ErrorCode:   "error_grip_changed",
				ErrorMsg:    a.getI18nMsg("calibration.error_grip_changed"),
			}
			a.writeDebugCSV(bank, step, samples, res)
			return res
		}
		bank.calVectors[1] = d
	}

	res := CaptureResult{
		Success:     true,
		AxisIdx:     axisIdx,
		Sign:        sign,
		AxisName:    name,
		Confidence:  confidence,
		SampleCount: activeCount,
		PeakSpeed:   peakSpeed,
		Vector:      d,
	}
	a.writeDebugCSV(bank, step, samples, res)
	return res
}

// ValidateCalibration builds the calibration matrix from the 2 captured gesture vectors: Pitch and Roll.
// Yaw is computed as Pitch x Roll with det = -1.0 (Cemuhook DSU left-handed parity convention, §3.3).
func (a *App) ValidateCalibration(pitch, roll [3]float64) ValidationResult {
	bank := a.activeBank()
	norm := func(v [3]float64) [3]float64 {
		m := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
		if m < 1e-6 {
			return v
		}
		return [3]float64{v[0] / m, v[1] / m, v[2] / m}
	}

	// Snap each vector to nearest cardinal axis (±X, ±Y, or ±Z)
	snap := func(v [3]float64) [3]float64 {
		ax := 0
		maxVal := math.Abs(v[0])
		if math.Abs(v[1]) > maxVal {
			ax = 1
			maxVal = math.Abs(v[1])
		}
		if math.Abs(v[2]) > maxVal {
			ax = 2
		}
		var res [3]float64
		if v[ax] >= 0 {
			res[ax] = 1.0
		} else {
			res[ax] = -1.0
		}
		return res
	}

	getAxisIdx := func(v [3]float64) int {
		for i := 0; i < 3; i++ {
			if math.Abs(v[i]) > 0.5 {
				return i
			}
		}
		return -1
	}

	pitchRow := snap(norm(pitch))
	rollRow := snap(norm(roll))

	idxP := getAxisIdx(pitchRow)
	idxR := getAxisIdx(rollRow)

	// Tier 2: Pitch and Roll must activate different physical axes
	if idxP < 0 || idxR < 0 || idxP == idxR {
		res := ValidationResult{
			Success:   false,
			ErrorCode: "error_grip_changed",
			ErrorMsg:  a.getI18nMsg("calibration.error_grip_changed"),
		}
		bank.calLogMu.Lock()
		bank.calValResult = res
		bank.calLogMu.Unlock()
		return res
	}

	// Tier 3: Compute canonical Cemuhook DSU calibration matrix.
	// Cross product for Yaw:
	yawRow := [3]float64{
		pitchRow[1]*rollRow[2] - pitchRow[2]*rollRow[1],
		pitchRow[2]*rollRow[0] - pitchRow[0]*rollRow[2],
		pitchRow[0]*rollRow[1] - pitchRow[1]*rollRow[0],
	}

	var mat [3][3]float64
	mat[0] = pitchRow
	mat[1] = yawRow
	mat[2] = rollRow

	// Cemuhook DSU is left-handed parity convention -> det(M) must be -1.0 (§3.3)
	if motion.Det3x3(mat) > 0 {
		yawRow = [3]float64{-yawRow[0], -yawRow[1], -yawRow[2]}
		mat[1] = yawRow
	}

	det := motion.Det3x3(mat)
	if math.Abs(det+1.0) > 0.05 {
		res := ValidationResult{
			Success:   false,
			ErrorCode: "error_invalid_determinant",
			ErrorMsg:  a.getI18nMsg("calibration.error_invalid_determinant"),
		}
		bank.calLogMu.Lock()
		bank.calValResult = res
		bank.calLogMu.Unlock()
		return res
	}

	formatAxis := func(v [3]float64) string {
		axes := []string{"X", "Y", "Z"}
		for i := 0; i < 3; i++ {
			if v[i] > 0.5 {
				return "+" + axes[i]
			} else if v[i] < -0.5 {
				return "-" + axes[i]
			}
		}
		return "?"
	}

	res := ValidationResult{
		Success:   true,
		Matrix:    mat,
		Det:       det,
		PitchAxis: formatAxis(mat[0]),
		YawAxis:   formatAxis(mat[1]),
		RollAxis:  formatAxis(mat[2]),
	}
	bank.calLogMu.Lock()
	bank.calValResult = res
	bank.calLogMu.Unlock()
	return res
}

// StartAxisAlign begins (or restarts) the explicit "determine axes" wizard step:
// it clears any partially-collected physics evidence so the live progress readout
// (GetAxisAlignStatus) starts from zero. The already-learned/seeded mapping keeps
// driving DSU output the whole time — the wizard uses its own scratch aligner
// (wizardAlign), so this always starts that scratch completely fresh regardless of
// what the live aligner currently believes. forgetKnown is kept for binding
// compatibility (the wizard always passes true: a "determine axes" run is always a
// full re-learn from scratch, never a partial confidence check).
func (a *App) StartAxisAlign(forgetKnown bool) {
	_ = forgetKnown
	bank := a.activeBank()
	bank.wizardAlignMu.Lock()
	bank.wizardAlign = motion.NewSensorAligner("")
	bank.wizardAlignMu.Unlock()
}

// GetAxisAlignStatus reports live progress of the wizard's scratch axis-align attempt
// so it can show "N of M tilts" and detect the moment physics locks a mapping. Empty
// until StartAxisAlign has been called (no wizard session in progress).
func (a *App) GetAxisAlignStatus() AxisAlignStatus {
	wz := a.getWizardAlign()
	if wz == nil {
		return AxisAlignStatus{}
	}
	pairs, minPairs, known := wz.Progress()
	return AxisAlignStatus{
		Known:    known,
		Pairs:    pairs,
		MinPairs: minPairs,
		Mapping:  wz.AxisMapping(),
	}
}

// CopyLast20Frames returns the last 20 raw frames formatted as CSV text for clipboard
func (a *App) CopyLast20Frames() string {
	bank := a.activeBank()
	bank.recentFramesMu.Lock()
	defer bank.recentFramesMu.Unlock()

	if len(bank.recentFrames) == 0 {
		return "No frames received from phone yet"
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("# Recent %d raw frames from phone:\n", len(bank.recentFrames)))
	sb.WriteString("idx,ts,rotX,rotY,rotZ,accX,accY,accZ,qx,qy,qz,qw\n")
	for i, f := range bank.recentFrames {
		sb.WriteString(fmt.Sprintf("%d,%d,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f\n",
			i+1, f.Timestamp, f.RotX, f.RotY, f.RotZ, f.AccX, f.AccY, f.AccZ, f.Qx, f.Qy, f.Qz, f.Qw))
	}
	return sb.String()
}

// CopyCalibrationReport returns a detailed text report of the last calibration session:
// raw samples from each 2.5s step, algorithm decisions, and final matrix verdict.
func (a *App) CopyCalibrationReport() string {
	bank := a.activeBank()
	bank.calLogMu.Lock()
	defer bank.calLogMu.Unlock()

	var sb strings.Builder
	sb.WriteString("=== PHONEGYRO CALIBRATION FULL REPORT ===\n")
	sb.WriteString(fmt.Sprintf("Generated: %s\n\n", time.Now().Format("2006-01-02 15:04:05")))

	// Final Verdict
	val := bank.calValResult
	sb.WriteString("--- FINAL VERDICT & MATRIX ---\n")
	sb.WriteString(fmt.Sprintf("Validation Success: %v\n", val.Success))
	if !val.Success && val.ErrorCode != "" {
		sb.WriteString(fmt.Sprintf("Error: [%s] %s\n", val.ErrorCode, val.ErrorMsg))
	}
	sb.WriteString(fmt.Sprintf("Determinant: %.4f\n", val.Det))
	sb.WriteString(fmt.Sprintf("Pitch Axis (Row 0): %s\n", val.PitchAxis))
	sb.WriteString(fmt.Sprintf("Yaw Axis   (Row 1): %s\n", val.YawAxis))
	sb.WriteString(fmt.Sprintf("Roll Axis  (Row 2): %s\n", val.RollAxis))
	sb.WriteString("Matrix:\n")
	for row := 0; row < 3; row++ {
		sb.WriteString(fmt.Sprintf("  [%8.4f, %8.4f, %8.4f]\n",
			val.Matrix[row][0], val.Matrix[row][1], val.Matrix[row][2]))
	}
	sb.WriteString("\n")

	// Static Gyro Bias
	bank.biasMu.RLock()
	bias := bank.gyroBias
	bank.biasMu.RUnlock()
	sb.WriteString(fmt.Sprintf("Static Gyro Bias: [%.4f, %.4f, %.4f] deg/s\n\n", bias[0], bias[1], bias[2]))

	// Steps (0 = Rest/Stillness, 1 = Pitch, 2 = Roll)
	stepNames := map[int]string{
		0: "STEP 0: REST / STILLNESS BIAS",
		1: "STEP 1: PITCH (Nod forward)",
		2: "STEP 2: ROLL (Bank right)",
	}

	for step := 0; step < 3; step++ {
		log, exists := bank.calStepLogs[step]
		name := stepNames[step]
		sb.WriteString(fmt.Sprintf("--- %s ---\n", name))
		if !exists || len(log.Samples) == 0 {
			sb.WriteString("No samples recorded for this step.\n\n")
			continue
		}
		sb.WriteString(fmt.Sprintf("Algorithm Result: Success=%v, DetectedAxis=%s (index %d), Sign=%+.1f, Confidence=%.1f%%, PeakSpeed=%.2f deg/s, SamplesCount=%d\n",
			log.Result.Success, log.Result.AxisName, log.Result.AxisIdx, log.Result.Sign, log.Result.Confidence*100, log.Result.PeakSpeed, len(log.Samples)))
		sb.WriteString(fmt.Sprintf("Detected Vector: [%.1f, %.1f, %.1f]\n",
			log.Result.Vector[0], log.Result.Vector[1], log.Result.Vector[2]))
		if log.Result.ErrorCode != "" {
			sb.WriteString(fmt.Sprintf("Error: [%s] %s\n", log.Result.ErrorCode, log.Result.ErrorMsg))
		}
		sb.WriteString("RAW SAMPLES (2.5 sec at 60 Hz):\n")
		sb.WriteString("idx,rotX,rotY,rotZ,accX,accY,accZ,speed\n")
		for i, s := range log.Samples {
			speed := math.Sqrt(s.rot[0]*s.rot[0] + s.rot[1]*s.rot[1] + s.rot[2]*s.rot[2])
			sb.WriteString(fmt.Sprintf("%d,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f\n",
				i+1, s.rot[0], s.rot[1], s.rot[2], s.acc[0], s.acc[1], s.acc[2], speed))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("=== END OF REPORT ===\n")
	return sb.String()
}
