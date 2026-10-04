# Motion pipeline

How the phone's sensor data turns into Cemuhook DSU packets for the emulator.
This document describes the current code. If you change the pipeline, update it too.

```
Phone (Safari/Chrome)                       PC (PhoneGyro)                           Emulator
─────────────────────                       ──────────────                           ────────
devicemotion  ─┐                            1. Frame parsing
 gyro °/s      │  accumulated while         2. Calibration data, bias
 gravity g     ├─ the socket is busy ─WSS─► 3. Gyro↔accelerometer axis link  ──UDP──►  client's
deviceorientation                            4. Attitude anchor (anti-drift)    26760   Madgwick
 quaternion    ┘                            5. Calibration matrix → gamepad axes
                                            6. Deadband, sensitivity, EMA
                                            7. DSU convention → packet
```

A **USB controller** (Arduino Nano + MPU-6050, protocol in the PhoneGyro_hardware_protocol repository) follows the same path from §2: `gui/internal/usbdev` finds the port and parses frames (`gui/internal/hwproto`), builds a `server.MotionFrame` with the firmware clock (`ClockMicros32`), and `gui/internal/app/usb.go` passes it to `srv.InjectMotionFrame`. USB has its own set of profiles and its own tremor threshold (`gyroDeadbandUsb`); there is no quaternion, so §4 does not apply to USB.

---

## 1. Phone: `web/index.html`

### 1.1 Gyro and accelerometer (`devicemotion`)
- `readRawGyro`: `rotationRate`, packed as `(beta, gamma, alpha)`, in °/s.
  **Note:** on iOS Safari these axes are permuted relative to the accelerometer axes (in fact `(devY, devZ, devX)` arrives); on Android they match. The code does not fix this, the server determines the axes (see §3).
- `readRawAccel`: `accelerationIncludingGravity / 9.80665`, in g. The sign of gravity differs between iOS and Android.

### 1.2 No lost rotation
A frame is not sent if the WebSocket is busy (`ws.bufferedAmount > 0`). So that the rotation during that frame is not lost, `onMotion` accumulates the angle `rate × dt` and sends the **average rate over the whole unsent interval**. The total angle is preserved. If the socket stays busy longer than 0.85 s, the accumulation is dropped (those samples count as lost) and §4 catches up with the loss.

The frame timestamp is an "integration clock": the previous timestamp plus exactly the interval the rate was averaged over. The server puts it into the DSU packet (`pkg/dsu stampMotion`), so the client integrates exactly the measured rotation whatever the Wi-Fi delays. If the OS sends no samples for more than 150 ms (a frozen page), the missing samples also count as lost; this shows in Live Debug and triggers the data-loss sound.

### 1.3 Orientation (`deviceorientation`)
`onOrientation` stores the angles, and `updateQuaternion` builds a quaternion per the W3C spec (when a frame is sent, not on every event): `R = Rz(alpha)·Rx(beta)·Ry(gamma)`, device → world. The "raw" alpha is used, without a heading offset, so the reference orientation has no jumps. The OS computes this orientation at a high internal rate, so it has no 60 Hz integration errors.

### 1.4 Frame (58 bytes, little-endian)
| Offset | Field |
|---|---|
| 0..8 | `uint64` integration clock, µs (see §1.2) |
| 8..20 | gyro `float32 ×3`, °/s |
| 20..36 | quaternion `x, y, z, w` |
| 36..48 | accelerometer `float32 ×3`, g |
| 48 | `uint16` flags (reserved, always 0) |
| 50 | `uint32` total sensor events |
| 54 | `uint32` of them lost |

The first 50 bytes match the old 50-byte format. The server also accepts the page's old 46-byte frame (`uint32 Date.now()` instead of the integration clock), see `pkg/server/server.go: parseFrame`.

---

## 2. Server: input and calibration (`gui/internal/app/pipeline.go`, `onMotionFrame`)

1. **Watch**: sensor freeze detection, a buffer of recent frames, sample recording for the calibration wizard.
2. **Matrix**: the profile's `activeMatrix`, or `previewMatrix` during the wizard.
3. **Automatic bias refinement** (`gui/internal/motion/gyrobias.go`): a 1 s window counts as rest by the gyro spread (std ≤ 1°/s per axis), not by rate magnitude, plus |acc| near 1 g and a small accelerometer spread; the bias is pulled toward the window mean with a 5 s time constant.
4. **Bias subtraction** from the raw gyro.

### Calibration wizard (`CaptureGesture`, `ValidateCalibration`)
- Step 0, rest: bias and `calGravity` (the unit gravity vector in the rest pose).
- Step 1, nod forward: the axis with maximum energy and its sign give the **pitch** row, target `RotX < 0`.
- Step 2, bank right: the **roll** row, target `RotZ > 0`.
- The **yaw** row = pitch × roll, with the sign chosen so that `det = −1`.

The matrix converts **only the gyro** from packet axes to gamepad axes. It cannot be applied to the accelerometer directly, see §3.

---

## 3. Gyro and accelerometer axis link (`gui/internal/motion/sensoralign.go`)

**The task.** Find the signed permutation `Q` (`a_pk = Q·acc`) and the rotation direction `h` so that gravity in the gyro's packet axes obeys the kinematics `d(a)/dt = h·(ω × a)`.

**Method (`sensorAligner.Feed`)**
- During motion the accelerometer mostly measures the hand (a 400°/s jerk gives 1.5 g and more). So gravity is compared **only at rest moments**: rate < 30°/s, |acc| = 1 ± 0.07 g, jump < 0.03 g per frame.
- Between two such moments the gyro is integrated under each of 24 × 2 hypotheses, and for each one it is computed how far the predicted gravity departs from the measured one.
- The decision is made after ≥ 6 pairs with a tilt of ≥ 20°, with the winner's error < 10° and a ×2.5 gap to the runner-up.
- The result is stored **in the active profile** (`sensorFrame` in `profiles.json`), like `calGravity`. The gravity sign and axes differ between iOS and Android, and one shared reference broke the other device. For iOS: `Q = [[0,1,0],[0,0,1],[1,0,0]]`, `h = −1`.

**An explicit step 4 in the calibration wizard ("Axes").** This link used to be determined silently in the background during play, so on a new or clean profile the accelerometer was read as identity until the user happened to shake the phone enough in game. That gave a "gamepad on its side" right after the first connection of a new device with no explanation. Now it is a separate required wizard step (`gui/frontend/src/js/calibration.js`, `CalibrationWizard.startAxisAlignSequence`): the user moves the phone with a 3D hint on screen, `App.GetAxisAlignStatus()` shows live progress "N of 6 pairs", and `App.StartAxisAlign(forgetKnown)` resets the accumulated pairs for a clean measurement (see `sensorAligner.Reset`/`Progress`/`AxisMapping` in `gui/internal/motion/sensoralign.go`). The physics (`Feed`/`scorePairLocked`/`decideLocked`) did not change: the step just makes the same learning visible and controlled rather than a side effect of gameplay.
- **Recalibration must forget the old link.** `CalibrationWizard.startCaptureFlow()` calls `App.StartAxisAlign(true)` as soon as the wizard opens for a slot (not only at step 4): if the person pressed "calibrate", it is ALWAYS a rebuild from scratch, and the profile's old `sensorFrame` must not silently count as "already fine" at step 4.
- **Critical: tilt must be combined with rotation (yaw), otherwise step 4 never converges.** Found live (2026-09-27): the demo animation and instructions of the first version of step 4 showed only pure "nod" (pitch) and "bank" (roll), tilts lying in one plane of rotation. A simulation through `sensorAligner.Feed` confirmed this is a mathematical dead end, not bad luck: `d(gravity)/dt = h·(ω×g)` observes gravity in only 2 degrees of freedom, and if ALL rotation axes used lie in one plane (pitch+roll only, no yaw), for one of the 24×2 hypotheses a second one that is perfectly indistinguishable from the true one always exists (`decideLocked` gives `bestMean == secondMean` identically however many pairs are collected, and the counter can grow forever: 3/6, 8/6, 12/6... without ever locking). Returning to a "flat" center between tilts does not fix it, and the same happens when moving "from tilt to tilt" directly while the rotation axis stays in that plane. As soon as real rotation about the third axis (yaw/twist) is mixed into the motion, the ambiguity goes away almost at once (in simulation within 1–2 pairs). Hence both the 3D demo and the hint text of step 4 must show and ask for the tilt **together with rotation**, not pure pitch/roll in turn; see `demoStep === 3` in `gui/frontend/src/js/scene3d.js` (the `holds` list is deliberately nonzero on all three axes at once) and `calibration.step3_desc`/`align_fail_desc` in `pkg/i18n/locales/*.json`.
- Additionally: when a device with `device` = `iPhone`/`iPad` connects (`OnClientDevice` in `gui/internal/app/phone.go`), the server immediately plugs in the known iOS default as a working hypothesis (`sensorAligner.SeedGuess`) until step 4 confirms or corrects it with physics. It is a safety net in case the user plays before finishing the wizard.

**Accelerometer output matrix (`buildOutputMapping`)**
- `accMat = ±D·S·mat·Q`, where `D = diag(1,−1,−1)`, `S = diag(1, ys, 1)`, `ys = h·det(mat)`.
- The ± sign is chosen so that `calGravity` gives `AccY = −1 g` (lying flat on a table).
- This formula aligns the gyro and gravity in the internal filter `gui/internal/motion/ahrs.go`. For real clients the output is corrected in §7.

---

## 4. Attitude anchor (`gui/internal/motion/attitudeanchor.go`)

**The problem.** DSU clients integrate the gyro themselves. At 60 Hz, fast "waggling" motion accumulates 8–16° of error in a minute. Gravity later fixes the tilt, but nothing fixes yaw.

**The solution (`attitudeAnchor.Correction`)**
- The server keeps a model `est`: the orientation the client will reach by integrating our stream (`est ← est ⊗ exp(ω_out·dt)`), starting from the first frame.
- The error is `e = log(est* ⊗ q_ref)` against the phone's quaternion. A correction `2·e` rad/s, capped at 20°/s, is added to the gyro. The live gyro stays the main source; the correction only slowly pulls the accumulated angle on all three axes.
- **Convention check:** the correction turns on only when the frame-by-frame rotation of the quaternion matches the gyro (4 variants: `q`/`q*` × sign, 120 motion frames, error < 0.25, ×4 gap). If the quaternion stops matching, the correction turns off.
- **Do not accept a large error.** A lag that swallowed a rotation looks the same as a big jump. It must be caught up with, not synchronized to, otherwise a permanent offset remains in the game.
- `Reset()` is called only on a new WebSocket connection from the phone or when its clock restarted (a page reload). Turning on, off and reset are written to `phonegyro.log`.

The correction is added to the gyro in packet axes (`Q·corr`) **before** the calibration matrix, so both DSU and the internal 3D view get it.

Simulation: 60 s of fast motion with a 3% scale error gives 34.5° of drift without the correction and 0.1° with it, including after a 0.5 s lag.

---

## 5. Gamepad axes

```
rx, ry, rz = mat · gyro_pk         (ry *= yawSign)
ax, ay, az = accMat · acc
```

## 6. Filters
- **Deadband** (`gyroDeadband`, °/s): below the threshold the rate is zeroed. Above it a soft knee works, `scale = (|ω| − db)/|ω|`, with no step.
- **Sensitivity** (`gyroSensitivity`): a rate multiplier, for DSU only.
- **Accelerometer**: an EMA with `α = 0.04` at rest and `0.35` in motion. No hard clamp to `[0,−1,0]`: it broke tilt in the hands.
- **No gyro smoothing** (1-Euro was removed). Any low-pass filter on angular rate adds delay, and the client integrates it into an overshoot.

## 7. DSU output (`DSUYawSign`, `DSUAccSign` in `gui/internal/motion/sensoralign.go`)
Real clients (PadTest, Cemu) use the opposite handedness convention relative to the `gui/internal/motion/ahrs.go` clone:

```
RotY → −RotY        AccX → −AccX        AccZ → −AccZ
```

The rest value `AccY = −1 g` is preserved. This was verified in PadTest: without the correction yaw went mirrored and a held tilt crept backward. The packet is assembled by `pkg/dsu`. The timestamp strictly grows: with a device clock the step between packets equals the interval the rate was averaged over (`stampMotion`), without one it is the host's elapsed time.

**The internal 3D view** (`gui/internal/motion/ahrs.go`, Madgwick β = 0.1) gets values from **before** §7. The comments claim the clone is an exact copy of PadTest, but its signs **do not match** the real PadTest. Do not use it as the reference for the DSU convention.

---

## 8. DSU server (`pkg/dsu`)

- **A data request is a subscription.** The stream comes from the device (`SendMotion`), not in reply to requests. Cemu repeats its request after every packet it receives; answering each one makes two processes bounce thousands of packets a second, and each repeats the last rate (drift). A new subscriber gets one packet right away, at rest (`sendRestPadDataTo`).
- **Heartbeat.** If the device is silent for more than 250 ms, subscribers get zero frames at 60 Hz (`heartbeatLoop`).
- **Client list.** Clients are shown by program name (`gui/internal/dsuclients`: the Windows UDP port table + process name; `gui/internal/app/dsu_clients.go` has the methods for the UI), a click switches to the emulator window, the cross disconnects. A disconnected client stays in the list greyed out with a "Connect again" button (`Server.Readmit`: subscribe again and send a packet at once, since Cemu asks for data only after a received packet).
- **Cemu drift guard** (`pkg/dsu/cemubias.go`, temporary). Cemu 2.6 computes the gyro bias as the mean of all "slow" samples of the session (`Mahony.h updateGyroBias`), and slow aiming turns into "bias". The server repeats this sum itself and before the next packet sends a service packet with the timestamp "previous + 1 µs" and a rate that zeroes the sum. It gives no rotation (rate × 1 µs). It is enabled only for a client whose process is named exactly `Cemu` (`dsuClientViews`) and by the **Cemu Drift Guard** setting. It goes away when a Cemu with the fix is released (PR in cemu-project/Cemu).

---

## How to check pipeline changes
0. **On a new/clean profile**, go through the calibration wizard to the end, including step 4 "Axes": wait for the live lock (do not skip via the pills), otherwise steps 1–4 below will fail falsely because of the identity accelerometer.
1. **Rest, flat** in PadTest: `Accel ≈ (0, −1, 0)`, the gamepad is level.
2. **Directions:** nod, bank and turn match the phone.
3. **Holding a tilt** 45° forward and sideways for 5 s: the gamepad does not creep. Creep means the gyro and gravity disagree.
4. **Drift:** spin actively, return the phone to the starting position, and the gamepad returns too. A lag leaves no permanent offset.
5. `go test` in `gui/`: `sensoralign_test.go`, `attitudeanchor_test.go`.
