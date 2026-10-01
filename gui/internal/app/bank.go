package app

import (
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"phonegyro-gui/internal/link"
	"phonegyro-gui/internal/motion"
	"phonegyro-gui/internal/profiles"
)

// motionBank holds one input source's fully isolated pipeline state: live
// connection status, raw/AHRS telemetry, gyro bias, sensor alignment,
// calibration wizard scratch state, and the 6-slot profile system. "phone"
// and "usb" input modes each get their own bank (see App.bank/activeBank),
// so switching modes never leaks calibration, connection status, or learned
// axis alignment between two physically different devices. Every existing
// method keeps its exact behavior -- it just now reads/writes through
// whichever bank is currently active instead of fields directly on App.
type motionBank struct {
	hasClient atomic.Bool
	// connectedAt: when the source came online, UnixNano (0 = offline). Atomic:
	// the frame handler, the phone callbacks and the UI loops all touch it.
	connectedAt atomic.Int64
	// deviceName identifies whatever is actually connected on this source:
	// the phone's reported model (OnClientDevice), or a USB device's
	// self-reported name (optional PhoneGyro protocol TYPE=0x02 frame) --
	// falls back to "Controller" until something sets it, exactly like the
	// old single global field did.
	deviceName atomic.Value

	curPitch atomic.Uint64
	curRoll  atomic.Uint64
	curYaw   atomic.Uint64
	// Raw latest gyro/accel (stored as float64 bits for atomic access)
	curRotX atomic.Uint64
	curRotY atomic.Uint64
	curRotZ atomic.Uint64
	curAccX atomic.Uint64
	curAccY atomic.Uint64
	curAccZ atomic.Uint64
	curQx   atomic.Uint64
	curQy   atomic.Uint64
	curQz   atomic.Uint64
	curQw   atomic.Uint64

	// Calibration capture buffer (buffered directly at the source's live rate)
	isCapturing   atomic.Bool
	captureMu     sync.Mutex
	captureBuffer []captureSample
	calVectors    [3][3]float64
	calGravity    [3]float64 // captured gravity unit vector from step 0 rest
	// wizardGravity stages the rest step's gravity reading the same way wizardAlign
	// stages axis learning: SaveProfile is the only place that commits it, so an
	// unsaved/cancelled wizard run never pollutes the live output or a profile.
	wizardGravity      [3]float64
	wizardGravityValid bool
	// Поправка установки датчика (mount.go): mountLive — активного профиля,
	// wizardMount — посчитанная мастером калибровки для кандидата (действует на
	// превью, в профиль попадает только через SaveProfile).
	mountMu     sync.RWMutex
	mountLive   *motion.MountCorrection
	wizardMount *motion.MountCorrection
	align       *motion.SensorAligner // gyro↔accel axis learner driving the LIVE output; never written to disk directly
	// wizardAlign is a scratch aligner used only by the calibration wizard's explicit
	// "determine axes" step. It runs alongside `align` (fed the same data) so the
	// wizard's progress reflects reality, but stays fully separate: nothing here
	// touches the active profile's live output or profiles.json until the user
	// clicks Save — see SaveProfile. This mirrors how previewMatrix/usePreview keep
	// a candidate calibration matrix from affecting live output before Save.
	wizardAlignMu sync.RWMutex
	wizardAlign   *motion.SensorAligner
	// Gyroscope stationary zero-bias correction (§2 of spec)
	biasMu   sync.RWMutex
	gyroBias [3]float64
	// Profile system
	profilesMu sync.RWMutex
	profiles   [profiles.Slots]profiles.Profile // exactly 6 slots, always
	activeSlot int                              // -1 = identity/none
	// Active calibration matrix (applied to frames before DSU forwarding)
	matrixMu     sync.RWMutex
	activeMatrix [3][3]float64 // identity by default
	// Live preview matrix during calibration wizard confirm/manual screens
	previewMu     sync.RWMutex
	previewMatrix [3][3]float64
	usePreview    bool
	// AHRS filter for 3D viewport synchronization (see motion/ahrs.go — ported verbatim
	// from the "тема" sandbox after it root-caused and fixed the mirror-handed
	// gyro convention and the beta-noise-floor kick of the old Madgwick port).
	ahrs *motion.AHRS
	// Attitude anchor + accelerometer low-pass state, formerly closure-local
	// variables in startup() -- moved here so each source keeps its own.
	anchor         *motion.AttitudeAnchor
	prevAnchorTsUs uint64
	anchorClock    motion.FrameClock // интервал кадра для attitudeanchor (motion/frameclock.go)
	ahrsClock      motion.FrameClock // интервал кадра для ahrs.Update (motion/frameclock.go)
	// anchorWhyLogged: причина, по которой anchor не может работать, уже записана
	// в лог для этого подключения (бит 1 — не известна связь осей гироскопа и
	// акселерометра, бит 2 — телефон не присылает ориентацию).
	anchorWhyLogged uint8
	anchorNoRefRun  int // consecutive frames without the phone's orientation
	// resetAnchor просит обработчик кадров сбросить anchor (новое WebSocket-
	// подключение телефона: у новой страницы свой ноль ориентации). Флаг, а не
	// прямой вызов: anchor живёт только в горутине обработчика кадров.
	resetAnchor   atomic.Bool
	accFiltered   [3]float64
	accFilterInit bool
	// Живая подстройка нуля гироскопа в покое (motion/gyrobias.go), под biasMu.
	biasTracker motion.GyroBiasTracker
	// Потери канала для Live Debug (link/loss.go): USB — по SEQ, телефон — по
	// счётчикам событий датчика со страницы.
	loss link.Loss
	// Latest AHRS quaternion stored atomically for lock-free read by GetState.
	// Q0=w, Q1=x, Q2=y, Q3=z (same as AHRS return values).
	curAhrsQ0 atomic.Uint64
	curAhrsQ1 atomic.Uint64
	curAhrsQ2 atomic.Uint64
	curAhrsQ3 atomic.Uint64
	// Buffer of last 20 raw frames from this source for diagnostics
	recentFramesMu sync.Mutex
	recentFrames   []RawLogFrame
	// Full calibration session report buffer
	calLogMu     sync.Mutex
	calStepLogs  map[int]StepCaptureLog
	calValResult ValidationResult

	// frameMu serialises onMotionFrame for this bank: two phone connections at
	// once (a reload before the old socket times out, a second phone) each run
	// their own goroutine, and the anchor, the accelerometer filter and the
	// frame clocks are only ever meant to see one stream.
	frameMu sync.Mutex

	lastMotionRecvTs   atomic.Int64
	lastSensorChangeTs atomic.Int64
}

// connectedSince is when the source came online (zero time while offline).
func (b *motionBank) connectedSince() time.Time {
	if ns := b.connectedAt.Load(); ns != 0 {
		return time.Unix(0, ns)
	}
	return time.Time{}
}

// markConnected records the connection time unless one is already set.
func (b *motionBank) markConnected() { b.connectedAt.CompareAndSwap(0, time.Now().UnixNano()) }

// clearConnected marks the source offline.
func (b *motionBank) clearConnected() { b.connectedAt.Store(0) }

// newMotionBank returns a bank with the same defaults NewApp used to give
// the (formerly single, shared) App fields directly.
func newMotionBank() *motionBank {
	b := &motionBank{
		activeSlot:   -1,
		activeMatrix: motion.DefaultMatrix3x3(),
		ahrs:         motion.NewAHRS(),
		anchor:       motion.NewAttitudeAnchor(),
		calStepLogs:  make(map[int]StepCaptureLog),
	}
	b.profiles = profiles.EmptySlots()
	b.deviceName.Store("Controller")
	return b
}

// bank returns the motion pipeline state for the given mode ("phone" or
// "usb"), lazily creating it on first use. Every existing profile/AHRS/
// calibration method goes through this (or activeBank) instead of touching
// fields on App directly, so the two sources never share state.
func (a *App) bank(mode string) *motionBank {
	a.bankMu.Lock()
	defer a.bankMu.Unlock()
	if mode == "usb" {
		if a.usbBank == nil {
			a.usbBank = newMotionBank()
		}
		return a.usbBank
	}
	if a.phoneBank == nil {
		a.phoneBank = newMotionBank()
	}
	return a.phoneBank
}

// activeBank returns the bank for whichever input mode is currently selected.
func (a *App) activeBank() *motionBank {
	return a.bank(a.GetInputMode())
}

// bankDir returns the on-disk directory a given mode's profiles/sensor
// alignment persist to. "phone" keeps the original root (backward
// compatible with every existing install); "usb" gets its own subfolder so
// the two never share a profiles.json or sensor_frame.json.
func (a *App) bankDir(mode string) string {
	if mode == "usb" {
		return filepath.Join(a.profilesDir, "usb")
	}
	return a.profilesDir
}
