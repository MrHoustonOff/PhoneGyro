package app

import (
	"math"
	"time"

	"phonegyro/pkg/server"

	"phonegyro-gui/internal/motion"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// onMotionFrame runs one motion frame -- from the phone's WebSocket or injected
// by the USB transport -- through the pipeline: bias, calibration matrix, axis
// alignment, attitude anchor, deadband, sensitivity, mount correction, AHRS for
// the UI, and out to the DSU clients. srv is the server that received it.
// See docs/motion-pipeline.md.
func (a *App) onMotionFrame(srv *server.Server, frame server.MotionFrame) {
	startPipe := time.Now()
	recvTs := startPipe.UnixMilli()
	// The transport layer guarantees only one source is ever actually
	// live at a time (phone WS connections are refused/closed while USB
	// mode is active, and vice versa via usbMgr.Start/Stop), so picking
	// the bank by current input mode is race-free in practice.
	bank := a.activeBank()
	if !finiteFrame(frame) {
		// One NaN would stay in the gyro bias, the anchor and the AHRS for good.
		return
	}
	bank.frameMu.Lock()
	defer bank.frameMu.Unlock()
	bank.lastMotionRecvTs.Store(recvTs)
	if frame.HasEventCounters {
		bank.loss.ObservePhone(frame.SensorEvents, frame.SensorDropped)
	} else if frame.SampleClock == server.ClockNone {
		bank.loss.MarkNoData() // старая страница телефона: счётчиков нет
	}

	if !bank.hasClient.Load() {
		bank.hasClient.Store(true)
		bank.markConnected()
		a.emitStateChange()
		a.broadcastLiveDebugJSON(map[string]any{
			"type":      "device_status",
			"connected": true,
		})
	}

	// Sensor freeze detection: check if readings actually changed
	prevRotX := float32(math.Float64frombits(bank.curRotX.Load()))
	prevRotY := float32(math.Float64frombits(bank.curRotY.Load()))
	prevRotZ := float32(math.Float64frombits(bank.curRotZ.Load()))
	prevAccX := float32(math.Float64frombits(bank.curAccX.Load()))
	prevAccY := float32(math.Float64frombits(bank.curAccY.Load()))
	prevAccZ := float32(math.Float64frombits(bank.curAccZ.Load()))

	if frame.RotX != prevRotX || frame.RotY != prevRotY || frame.RotZ != prevRotZ ||
		frame.AccX != prevAccX || frame.AccY != prevAccY || frame.AccZ != prevAccZ ||
		bank.lastSensorChangeTs.Load() == 0 {
		bank.lastSensorChangeTs.Store(recvTs)
	}

	// Store latest raw gyro/accel/quaternion for calibration wizard
	bank.curRotX.Store(math.Float64bits(float64(frame.RotX)))
	bank.curRotY.Store(math.Float64bits(float64(frame.RotY)))
	bank.curRotZ.Store(math.Float64bits(float64(frame.RotZ)))
	bank.curAccX.Store(math.Float64bits(float64(frame.AccX)))
	bank.curAccY.Store(math.Float64bits(float64(frame.AccY)))
	bank.curAccZ.Store(math.Float64bits(float64(frame.AccZ)))
	bank.curQx.Store(math.Float64bits(float64(frame.Qx)))
	bank.curQy.Store(math.Float64bits(float64(frame.Qy)))
	bank.curQz.Store(math.Float64bits(float64(frame.Qz)))
	bank.curQw.Store(math.Float64bits(float64(frame.Qw)))

	// Record raw frame in rolling 20-frame debug buffer
	bank.recentFramesMu.Lock()
	bank.recentFrames = append(bank.recentFrames, RawLogFrame{
		Timestamp: frame.Timestamp,
		RotX:      frame.RotX,
		RotY:      frame.RotY,
		RotZ:      frame.RotZ,
		AccX:      frame.AccX,
		AccY:      frame.AccY,
		AccZ:      frame.AccZ,
		Qx:        frame.Qx,
		Qy:        frame.Qy,
		Qz:        frame.Qz,
		Qw:        frame.Qw,
	})
	if len(bank.recentFrames) > 20 {
		bank.recentFrames = bank.recentFrames[len(bank.recentFrames)-20:]
	}
	bank.recentFramesMu.Unlock()

	// If calibration gesture recording is active, capture every 60 Hz frame
	if bank.isCapturing.Load() {
		bank.captureMu.Lock()
		bank.captureBuffer = append(bank.captureBuffer, captureSample{
			rot: [3]float64{float64(frame.RotX), float64(frame.RotY), float64(frame.RotZ)},
			acc: [3]float64{float64(frame.AccX), float64(frame.AccY), float64(frame.AccZ)},
		})
		bank.captureMu.Unlock()
	}

	// Apply active or preview calibration matrix to the frame
	bank.previewMu.RLock()
	usePrev := bank.usePreview
	prevMat := bank.previewMatrix
	bank.previewMu.RUnlock()

	var mat [3][3]float64
	if usePrev {
		mat = prevMat
	} else {
		bank.matrixMu.RLock()
		mat = bank.activeMatrix
		bank.matrixMu.RUnlock()
	}

	// Живая подстройка нуля гироскопа в покое (см. motion/gyrobias.go). Не во время
	// записи шага калибровки: там bias задаётся явно.
	if !bank.isCapturing.Load() {
		rawGyro := [3]float64{float64(frame.RotX), float64(frame.RotY), float64(frame.RotZ)}
		rawAccel := [3]float64{float64(frame.AccX), float64(frame.AccY), float64(frame.AccZ)}
		bank.biasMu.Lock()
		if nb, ok := bank.biasTracker.Feed(startPipe, rawGyro, rawAccel, bank.gyroBias); ok {
			bank.gyroBias = nb
		}
		bank.biasMu.Unlock()
	} else {
		bank.biasMu.Lock()
		bank.biasTracker.Reset()
		bank.biasMu.Unlock()
	}

	// Subtract gyro zero-bias before applying calibration matrix M (§1, §2 of spec)
	bank.biasMu.RLock()
	bx, by, bz := bank.gyroBias[0], bank.gyroBias[1], bank.gyroBias[2]
	calGravity := bank.calGravity
	bank.biasMu.RUnlock()

	rawRx := float64(frame.RotX) - bx
	rawRy := float64(frame.RotY) - by
	rawRz := float64(frame.RotZ) - bz
	rawAcc := [3]float64{float64(frame.AccX), float64(frame.AccY), float64(frame.AccZ)}

	// Gyro goes through the gesture calibration matrix; the accelerometer goes through
	// a matrix derived from it plus the learned gyro↔accel axis relation, so PadTest's
	// Madgwick sees a gravity vector that agrees with the gyro (see motion/sensoralign.go).
	bank.align.Feed([3]float64{rawRx, rawRy, rawRz}, rawAcc, frame.TimestampUs)
	if wz := a.getWizardAlign(); wz != nil {
		wz.Feed([3]float64{rawRx, rawRy, rawRz}, rawAcc, frame.TimestampUs)
	}
	sf, sfKnown := bank.align.Frame()
	sf, sfKnown, calGravity = bank.outputFrameInputs(usePrev, sf, sfKnown, calGravity)
	accMat, yawSign := motion.BuildOutputMapping(mat, sf, calGravity)

	// Pull the integrated angle onto the source's own attitude (see motion/attitudeanchor.go).
	anchorDt := motion.AnchorDefaultDtSec
	if bank.resetAnchor.Swap(false) {
		bank.anchor.Reset()
		bank.anchorClock = motion.FrameClock{}
		bank.anchorWhyLogged = 0
		a.logEvent("INFO", "anchor: reset (new phone connection)")
	}
	if frame.SampleClock != server.ClockNone {
		// Device clock: the anchor's client model must integrate exactly the
		// interval the DSU client will (pkg/dsu stampMotion), however long.
		hadClock := bank.anchorClock.Started()
		if d, fromDevice := bank.anchorClock.Interval(frame, startPipe); fromDevice {
			anchorDt = d
		} else if hadClock {
			bank.anchor.Reset() // device clock restarted: reconnect / page reload
		}
	} else {
		bank.anchorClock = motion.FrameClock{}
		if bank.prevAnchorTsUs > 0 && frame.TimestampUs > bank.prevAnchorTsUs {
			d := float64(frame.TimestampUs-bank.prevAnchorTsUs) / 1e6
			if d >= 0.004 && d <= 0.1 {
				anchorDt = d
			} else if d > 1.0 {
				bank.anchor.Reset() // reconnect / page reload: attitude reference restarted
			}
		} else if frame.TimestampUs < bank.prevAnchorTsUs {
			bank.anchor.Reset()
		}
	}
	bank.prevAnchorTsUs = frame.TimestampUs
	if a.GetInputMode() != "usb" {
		// Diagnostics only: say once per connection why the anchor cannot run.
		refNorm := math.Sqrt(float64(frame.Qw*frame.Qw + frame.Qx*frame.Qx + frame.Qy*frame.Qy + frame.Qz*frame.Qz))
		if !sfKnown && bank.anchorWhyLogged&1 == 0 {
			bank.anchorWhyLogged |= 1
			a.logEvent("INFO", "anchor: inactive, gyro/accelerometer axis relation not known yet")
		}
		// The orientation may simply arrive a few frames after the first motion
		// sample: only report it if it stays missing for a second.
		if refNorm < motion.AnchorMinQuatNorm {
			bank.anchorNoRefRun++
			if bank.anchorNoRefRun == 60 && bank.anchorWhyLogged&2 == 0 {
				bank.anchorWhyLogged |= 2
				a.logEvent("INFO", "anchor: inactive, the phone sends no orientation (deviceorientation)")
			}
		} else {
			bank.anchorNoRefRun = 0
		}
	}
	if sfKnown {
		pk := [3]float64{rawRx * motion.DegToRad, rawRy * motion.DegToRad, rawRz * motion.DegToRad}
		dev := motion.MulVec3(motion.Transpose3(sf.Q), pk)
		ref := motion.Quat{float64(frame.Qw), float64(frame.Qx), float64(frame.Qy), float64(frame.Qz)}
		corr := motion.MulVec3(sf.Q, bank.anchor.Correction(dev, ref, anchorDt))
		rawRx += corr[0] / motion.DegToRad
		rawRy += corr[1] / motion.DegToRad
		rawRz += corr[2] / motion.DegToRad
	}

	rx, ry, rz := motion.ApplyMatrix(mat, rawRx, rawRy, rawRz)
	ry *= yawSign
	ax, ay, az := motion.ApplyMatrix(accMat, rawAcc[0], rawAcc[1], rawAcc[2])

	gyroSpeed := math.Sqrt(rx*rx + ry*ry + rz*rz)

	// 1. Gyroscope deadband (motion/deadband.go): silences resting tremor below the
	// threshold, passes motion above 2x threshold untouched.
	gyroDeadband := a.deadbandFor(bank)
	sens := math.Float64frombits(a.gyroSensitivityBits.Load())
	if sens <= 0 {
		sens = 1.00
	}

	rawDsuRx := float32(rx)
	rawDsuRy := motion.DSUYawSign * float32(ry) // see DSUYawSign / DSUAccSign in motion/sensoralign.go
	rawDsuRz := float32(rz)

	// Порог гасит только скорости около нуля; от 2·порога движение проходит
	// без изменений (motion/deadband.go).
	scale := float32(motion.DeadbandScale(gyroSpeed, gyroDeadband))
	ahrsRx := float32(rx) * scale
	ahrsRy := float32(ry) * scale
	ahrsRz := float32(rz) * scale

	dsuRx := rawDsuRx * scale
	dsuRy := rawDsuRy * scale
	dsuRz := rawDsuRz * scale

	// DSU gets deadbanded but unsmoothed rates: any low-pass on angular velocity adds
	// lag that clients integrate into overshoot.
	isStationary := gyroDeadband > 0 && gyroSpeed < gyroDeadband

	// Apply sensitivity multiplier
	if sens != 1.0 {
		dsuRx *= float32(sens)
		dsuRy *= float32(sens)
		dsuRz *= float32(sens)
	}

	// 2. Accelerometer filtering.
	// Eliminate 60 Hz electrical noise using an adaptive low-pass filter:
	// When stationary: alpha = 0.04 for rock-solid stability and zero trembling in PadTest.
	// When moving: alpha = 0.35 for responsive gravity tracking with minimal lag.
	// Never artificially force [0, -1, 0] which ruined tilted holding angles.
	if !bank.accFilterInit {
		bank.accFiltered = [3]float64{ax, ay, az}
		bank.accFilterInit = true
	}

	alpha := 0.35
	if isStationary {
		alpha = 0.04
	}
	bank.accFiltered[0] += alpha * (ax - bank.accFiltered[0])
	bank.accFiltered[1] += alpha * (ay - bank.accFiltered[1])
	bank.accFiltered[2] += alpha * (az - bank.accFiltered[2])

	finalAx := float32(bank.accFiltered[0])
	finalAy := float32(bank.accFiltered[1])
	finalAz := float32(bank.accFiltered[2])

	corrected := frame
	corrected.RotX = ahrsRx
	corrected.RotY = ahrsRy
	corrected.RotZ = ahrsRz
	corrected.AccX = finalAx
	corrected.AccY = finalAy
	corrected.AccZ = finalAz

	// Ровно то, что уходит по проводу в DSU (DSUYawSign, чувствительность,
	// DSUAccSign) -- motion/ahrs.go перенесён из песочницы "тема", которая считает
	// ориентацию по принятым DSU-пакетам, и его знаки гироскопа верны только
	// в этом кадре. Кормить его чем-то другим (как было: ahrsR*, final* до
	// знаков DSU) = другая хиральность = снова увод после резкого движения.
	dsuAx := motion.DSUAccSign[0] * finalAx
	dsuAy := motion.DSUAccSign[1] * finalAy
	dsuAz := motion.DSUAccSign[2] * finalAz

	// Поправка на наклон установки датчика (USB, mount.go): один поворот
	// на гироскоп и акселерометр, чтобы их согласованность не пострадала.
	if mc := bank.activeMount(usePrev); mc.Active() {
		r, ac := mc.ApplyToDSU(
			[3]float64{float64(dsuRx), float64(dsuRy), float64(dsuRz)},
			[3]float64{float64(dsuAx), float64(dsuAy), float64(dsuAz)})
		dsuRx, dsuRy, dsuRz = float32(r[0]), float32(r[1]), float32(r[2])
		dsuAx, dsuAy, dsuAz = float32(ac[0]), float32(ac[1]), float32(ac[2])
	}
	bank.dsuAccX.Store(math.Float64bits(float64(dsuAx)))
	bank.dsuAccY.Store(math.Float64bits(float64(dsuAy)))
	bank.dsuAccZ.Store(math.Float64bits(float64(dsuAz)))

	// dt -- тот же интервал, что получит DSU-клиент по таймстампам пакетов
	// (pkg/dsu stampMotion, motion/frameclock.go): кубик считает ровно как PadTest.
	ahrsDtSec, _ := bank.ahrsClock.Interval(frame, time.Now())
	ahrsDt := float32(ahrsDtSec)

	// Update AHRS filter (see motion/ahrs.go).
	var curP, curR, curY float64
	if bank.ahrs != nil {
		q0, q1, q2, q3 := bank.ahrs.Update(dsuRx, dsuRy, dsuRz, dsuAx, dsuAy, dsuAz, ahrsDt)
		p, r, y := bank.ahrs.GetLevel() // LEVEL/tilt UIs: no Euler singularity beyond 90°
		p, r = bank.fromCentre(p, r)    // relative to the pose of the last centering
		curP, curR, curY = p, r, y
		bank.curPitch.Store(math.Float64bits(p))
		bank.curRoll.Store(math.Float64bits(r))
		bank.curYaw.Store(math.Float64bits(y))
		bank.curAhrsQ0.Store(math.Float64bits(float64(q0)))
		bank.curAhrsQ1.Store(math.Float64bits(float64(q1)))
		bank.curAhrsQ2.Store(math.Float64bits(float64(q2)))
		bank.curAhrsQ3.Store(math.Float64bits(float64(q3)))

		var dsuClients int
		if a.dsuSrv != nil {
			dsuClients = a.dsuSrv.ActiveClients()
		}
		_, _, inHz := srv.PacketStats()
		pipeMs := float64(time.Since(startPipe).Microseconds()) / 1000.0
		sendTs := time.Now().UnixMilli()
		seq := a.liveDebugSeq.Add(1)

		a.broadcastLiveDebug(q0, q1, q2, q3, liveDebugMsg{
			Seq:        seq,
			Timestamp:  frame.Timestamp,
			RecvTs:     recvTs,
			SendTs:     sendTs,
			RawGx:      frame.RotX,
			RawGy:      frame.RotY,
			RawGz:      frame.RotZ,
			RawAx:      frame.AccX,
			RawAy:      frame.AccY,
			RawAz:      frame.AccZ,
			DevTsUs:    frame.TimestampUs,
			RefQw:      frame.Qw,
			RefQx:      frame.Qx,
			RefQy:      frame.Qy,
			RefQz:      frame.Qz,
			OutGx:      dsuRx,
			OutGy:      dsuRy,
			OutGz:      dsuRz,
			OutAx:      finalAx,
			OutAy:      finalAy,
			OutAz:      finalAz,
			StickLx:    0,
			StickLy:    0,
			InHz:       inHz,
			OutHz:      inHz,
			PipeMs:     pipeMs,
			DsuClients: dsuClients,
		})
	}

	if a.isPaused.Load() {
		// Muted during pause -- but the DSU timestamp chain still has to step
		// past this frame, or the first frame after unpausing would claim the
		// whole pause as its interval (pkg/dsu SkipMotion).
		if a.dsuSrv != nil {
			a.dsuSrv.SkipMotion(frame)
		}
		return
	}
	if a.dsuSrv != nil {
		dsuFrame := frame
		dsuFrame.RotX = dsuRx
		dsuFrame.RotY = dsuRy
		dsuFrame.RotZ = dsuRz
		dsuFrame.AccX = dsuAx
		dsuFrame.AccY = dsuAy
		dsuFrame.AccZ = dsuAz
		a.dsuSrv.SendMotion(dsuFrame)
	}

	// Stream real-time telemetry to Settings test bench if active (throttled to ~60Hz to prevent IPC queue clogging)
	if a.tuningActive.Load() && a.ctx != nil {
		nowMs := time.Now().UnixMilli()
		if nowMs-a.lastTuningEmit.Load() >= 16 {
			a.lastTuningEmit.Store(nowMs)
			_, _, inHz := srv.PacketStats()
			wailsRuntime.EventsEmit(a.ctx, "tuning:frame", TuningFrame{
				RawX:  rawDsuRx,
				RawY:  rawDsuRy,
				RawZ:  rawDsuRz,
				OutX:  dsuRx,
				OutY:  dsuRy,
				OutZ:  dsuRz,
				Hz:    float32(inHz),
				Pitch: float32(curP),
				Roll:  float32(curR),
				Yaw:   float32(curY),
			})
		}
	}
}

// finiteFrame: every number in the frame is a real number (no NaN or ±Inf).
func finiteFrame(f server.MotionFrame) bool {
	for _, v := range [...]float32{f.RotX, f.RotY, f.RotZ, f.AccX, f.AccY, f.AccZ, f.Qx, f.Qy, f.Qz, f.Qw} {
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return false
		}
	}
	return true
}
