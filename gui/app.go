package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"math"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"phonegyro/pkg/ca"
	"phonegyro/pkg/dsu"
	"phonegyro/pkg/i18n"
	"phonegyro/pkg/pairing"
	"phonegyro/pkg/server"
	"phonegyro/web"

	"phonegyro-gui/internal/link"
	"phonegyro-gui/internal/motion"
	"phonegyro-gui/internal/resmon"

	"github.com/gorilla/websocket"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func init() {
	_ = mime.AddExtensionType(".glb", "model/gltf-binary")
}

const (
	HTTPPort  = 8080
	HTTPSPort = 8443
)

// CurrentProfileVersion is the calibration data generation SaveProfile stamps on every
// save. Bump it whenever a new field becomes load-bearing for correct output (it was 3
// when SensorFrame — the learned accelerometer axis mapping — became required).
const CurrentProfileVersion = 3

// motionBank holds one input source's fully isolated pipeline state: live
// connection status, raw/AHRS telemetry, gyro bias, sensor alignment,
// calibration wizard scratch state, and the 6-slot profile system. "phone"
// and "usb" input modes each get their own bank (see App.bank/activeBank),
// so switching modes never leaks calibration, connection status, or learned
// axis alignment between two physically different devices. Every existing
// method keeps its exact behavior -- it just now reads/writes through
// whichever bank is currently active instead of fields directly on App.
type motionBank struct {
	hasClient   atomic.Bool
	connectedAt time.Time
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
	profiles   [6]Profile // exactly 6 slots, always
	activeSlot int        // -1 = identity/none
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

	lastMotionRecvTs   atomic.Int64
	lastSensorChangeTs atomic.Int64
}

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
	for i := range b.profiles {
		b.profiles[i] = Profile{
			Slot:   i,
			Name:   "",
			Device: "Unknown",
			Icon:   "default",
			Matrix: motion.DefaultMatrix3x3(),
			Active: false,
		}
	}
	b.deviceName.Store("Controller")
	return b
}

// App struct manages desktop backend and PhoneGyro services
type App struct {
	ctx      context.Context
	i18nMgr  *i18n.Manager
	srv      *server.Server
	dsuSrv   *dsu.Server
	usbMgr   *usbDeviceManager
	caMgr    *ca.CertificateManager
	isPaused atomic.Bool
	// bankMu guards lazy-initializing phoneBank/usbBank; the banks' own
	// internal fields have their own finer-grained locks as before.
	bankMu      sync.Mutex
	phoneBank   *motionBank
	usbBank     *motionBank
	clientAddr  string
	primaryIP   string
	gamepadURL  string
	setupURL    string
	qrCodePNG   string
	setupQRPNG  string
	toggleMu    sync.Mutex
	lastToggle  time.Time
	profilesDir string
	// LiveDebug standalone window WebSocket clients and process handle
	liveDebugMu      sync.RWMutex
	liveDebugClients map[*websocket.Conn]struct{}
	liveDebugSeq     atomic.Uint64
	liveDebugCmdMu   sync.Mutex
	liveDebugCmd     *exec.Cmd
	// Multi-window theme and language synchronization
	themeMu         sync.RWMutex
	currentTheme    string
	currentLang     string
	firstLaunchDone bool
	hideAuthor      bool
	// Process resource monitor (CPU / RAM)
	stopResmon   func()
	lastResStats atomic.Pointer[map[string]any]
	// Advanced configuration settings
	dsuPort           int
	dsuMAC            string
	dsuMACMu          sync.RWMutex
	httpPort          int
	httpsPort         int
	gyroDeadzoneBits  atomic.Uint64
	stillnessHint     atomic.Bool
	disconnectAlert   atomic.Bool
	silenceDisconnect atomic.Bool
	cemuDriftGuard    atomic.Bool // drift guard for Cemu clients (pkg/dsu/cemubias.go)
	soundMode         string
	soundVolume       atomic.Int32
	soundVolumesMu    sync.RWMutex
	soundVolumes      map[string]int
	// Adaptive 1-Euro DSU filter and dynamic response parameters
	gyroDeadbandBits    atomic.Uint64 // float64 (deg/s, default 0.10): phone
	gyroDeadbandUsbBits atomic.Uint64 // float64 (deg/s, default 0.50): USB controller (deadband.go)
	gyroSensitivityBits atomic.Uint64 // float64 (multiplier, default 1.00)
	tuningActive        atomic.Bool
	lastTuningEmit      atomic.Int64
	lastLiveDebugNs     atomic.Int64 // last telemetry message to Live Debug (rate cap)
	fontScaleBits       atomic.Uint64
	// System Tray & Window Lifecycle
	minimizeToTray atomic.Bool
	closeActionMu  sync.RWMutex
	closeAction    string // "ask", "minimize", "quit"
	quitting       atomic.Bool
	trayMgr        *TrayManager
	// Global Windows Hotkeys
	hotkeyRecenterEnabled atomic.Bool
	hotkeyRecenterKeyMu   sync.RWMutex
	hotkeyRecenterKey     string
	// Input Mode ("phone" vs "usb")
	inputModeMu sync.RWMutex
	inputMode   string
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

// NewApp creates a new App application struct
func NewApp() *App {
	mgr, err := i18n.NewManager("ru")
	if err != nil {
		fmt.Printf("[-] Failed to init i18n manager: %v\n", err)
	}

	lanIPs := pairing.GetLocalIPv4s()
	primaryIP := pairing.GetPrimaryIP(lanIPs)

	setupURL := fmt.Sprintf("http://%s:%d/ca.mobileconfig", primaryIP, HTTPPort)
	appURL := fmt.Sprintf("https://%s:%d/", primaryIP, HTTPSPort)

	// Pre-generate Gamepad QR code PNG for instant display on start
	qrBytes, err := pairing.GenerateQRPNG(appURL, 240)
	qrBase64 := ""
	if err == nil {
		qrBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(qrBytes)
	}

	// Pre-generate Setup CA profile QR code PNG for iOS setup guide
	setupQRBytes, err := pairing.GenerateQRPNG(setupURL, 240)
	setupQRBase64 := ""
	if err == nil {
		setupQRBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(setupQRBytes)
	}

	// Determine profiles dir
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = "."
	}
	profilesDir := filepath.Join(appData, "phonegyro")

	app := &App{
		i18nMgr:      mgr,
		primaryIP:    primaryIP,
		dsuPort:      26760,
		httpPort:     HTTPPort,
		httpsPort:    HTTPSPort,
		setupURL:     setupURL,
		gamepadURL:   appURL,
		qrCodePNG:    qrBase64,
		setupQRPNG:   setupQRBase64,
		profilesDir:  profilesDir,
		currentTheme: "dark",
		currentLang:  "ru",
	}
	app.phoneBank = newMotionBank()
	app.usbBank = newMotionBank()
	app.gyroDeadzoneBits.Store(math.Float64bits(0.20))
	app.gyroDeadbandBits.Store(math.Float64bits(defaultDeadbandPhone))
	app.gyroDeadbandUsbBits.Store(math.Float64bits(defaultDeadbandUSB))
	app.gyroSensitivityBits.Store(math.Float64bits(1.00))
	app.fontScaleBits.Store(math.Float64bits(1.00))
	app.stillnessHint.Store(true)
	app.disconnectAlert.Store(true)
	app.silenceDisconnect.Store(true)
	app.cemuDriftGuard.Store(true)
	app.soundMode = "cute"
	app.soundVolume.Store(1)
	app.soundVolumes = defaultSoundVolumes()
	app.minimizeToTray.Store(true)
	app.hotkeyRecenterEnabled.Store(true)
	app.hotkeyRecenterKey = "Ctrl+Shift+R"

	// Ensure logs directory exists
	_ = os.MkdirAll(filepath.Join(profilesDir, "logs"), 0755)

	// Load persisted settings and profiles for BOTH banks up front, so
	// switching input mode later immediately reflects whatever was saved for
	// that mode last time, without needing a lazy first-load.
	app.loadSettings()
	app.rebuildURLsAndQRCodes()
	app.loadProfilesInto(app.phoneBank, app.bankDir("phone"))
	app.loadProfilesInto(app.usbBank, app.bankDir("usb"))
	app.logEvent("INFO", "PhoneGyro initialized: IP=%s, Theme=%s, Lang=%s, DSU=%d, HTTP=%d, HTTPS=%d", primaryIP, app.currentTheme, app.currentLang, app.dsuPort, app.httpPort, app.httpsPort)

	return app
}

const CurrentProfileSchemaVersion = 2

// logEvent writes a timestamped line to %APPDATA%/phonegyro/logs/phonegyro.log
func (a *App) logEvent(level, format string, args ...any) {
	if a.profilesDir == "" {
		return
	}
	logDir := filepath.Join(a.profilesDir, "logs")
	_ = os.MkdirAll(logDir, 0755)
	logPath := filepath.Join(logDir, "phonegyro.log")

	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	msg := fmt.Sprintf(format, args...)
	ts := time.Now().Format("2006-01-02 15:04:05.000")
	fmt.Fprintf(f, "[%s] [%s] %s\n", ts, level, msg)
}

// startup is called at application startup: initializes services in background
func (a *App) startup(ctx context.Context) {
	a.routeStdLog()
	a.ctx = ctx

	a.trayMgr = NewTrayManager(a)
	a.trayMgr.Start()
	a.trayMgr.UpdateHotkey(a.hotkeyRecenterEnabled.Load(), a.getHotkeyRecenterKey())

	// 1. Certificate Authority
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = "."
	}
	caDir := filepath.Join(appData, "phonegyro", "ca")

	lanIPs := pairing.GetLocalIPv4s()
	caMgr, err := ca.NewCertificateManager(caDir, lanIPs, nil)
	if err != nil {
		fmt.Printf("[-] CA init error: %v\n", err)
	}
	a.caMgr = caMgr

	// 2. Cemuhook DSU Server (UDP)
	macBytes, err := parseMAC(a.getDSUMAC())
	if err != nil {
		macBytes = dsu.GenerateRandomMAC()
		a.setDSUMAC(formatMAC(macBytes))
	}
	dsuSrv := dsu.NewServer(a.dsuPort, macBytes)
	a.bindDSUCallbacks(dsuSrv)
	if err := dsuSrv.Start(); err != nil {
		fmt.Printf("[-] DSU start error: %v\n", err)
	}
	a.dsuSrv = dsuSrv

	// Each bank gets its own aligner (own sensor_frame.json) so a learned
	// axis mapping never leaks between the phone and a USB device.
	a.phoneBank.align = motion.NewSensorAligner(a.bankDir("phone"))
	a.usbBank.align = motion.NewSensorAligner(a.bankDir("usb"))
	a.initProfileSensorFrame(a.phoneBank, a.bankDir("phone"))
	a.initProfileSensorFrame(a.usbBank, a.bankDir("usb"))

	// 3. Web & Telemetry Server (HTTP / HTTPS)
	var srv *server.Server
	srv = server.NewServer(caMgr, a.httpPort, a.httpsPort, web.IndexHTML, func(frame server.MotionFrame) {
		startPipe := time.Now()
		recvTs := startPipe.UnixMilli()
		// The transport layer guarantees only one source is ever actually
		// live at a time (phone WS connections are refused/closed while USB
		// mode is active, and vice versa via usbMgr.Start/Stop), so picking
		// the bank by current input mode is race-free in practice.
		bank := a.activeBank()
		bank.lastMotionRecvTs.Store(recvTs)
		if frame.HasEventCounters {
			bank.loss.ObservePhone(frame.SensorEvents, frame.SensorDropped)
		} else if frame.SampleClock == server.ClockNone {
			bank.loss.MarkNoData() // старая страница телефона: счётчиков нет
		}

		if !bank.hasClient.Load() {
			bank.hasClient.Store(true)
			if bank.connectedAt.IsZero() {
				bank.connectedAt = time.Now()
			}
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

		// dt -- тот же интервал, что получит DSU-клиент по таймстампам пакетов
		// (pkg/dsu stampMotion, motion/frameclock.go): кубик считает ровно как PadTest.
		ahrsDtSec, _ := bank.ahrsClock.Interval(frame, time.Now())
		ahrsDt := float32(ahrsDtSec)

		// Update AHRS filter (see motion/ahrs.go).
		var curP, curR, curY float64
		if bank.ahrs != nil {
			q0, q1, q2, q3 := bank.ahrs.Update(dsuRx, dsuRy, dsuRz, dsuAx, dsuAy, dsuAz, ahrsDt)
			p, r, y := bank.ahrs.GetLevel() // LEVEL/tilt UIs: no Euler singularity beyond 90°
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
	})

	var disconnectTimer *time.Timer
	var disconnectMu sync.Mutex

	srv.OnClientConnect = func(remoteAddr string) {
		disconnectMu.Lock()
		if disconnectTimer != nil {
			disconnectTimer.Stop()
			disconnectTimer = nil
		}
		disconnectMu.Unlock()

		// This callback fires only for phone WebSocket connections -- USB has
		// its own separate lifecycle handling in usb.go -- so it always
		// targets phoneBank directly, never activeBank().
		a.phoneBank.hasClient.Store(true)
		a.phoneBank.resetAnchor.Store(true)
		a.clientAddr = remoteAddr
		if a.phoneBank.connectedAt.IsZero() {
			a.phoneBank.connectedAt = time.Now()
		}
		a.emitStateChange()
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "device:connected", true)
		}
		a.broadcastLiveDebugJSON(map[string]any{
			"type":      "device_status",
			"connected": true,
		})
	}

	srv.OnClientDisconnect = func(remoteAddr string) {
		disconnectMu.Lock()
		defer disconnectMu.Unlock()

		_, clients, _ := srv.PacketStats()
		if clients > 0 {
			return
		}

		// Emit immediate disconnection event for active calibration/monitoring
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "device:connection-lost", true)
		}

		if disconnectTimer != nil {
			disconnectTimer.Stop()
		}
		disconnectTimer = time.AfterFunc(2500*time.Millisecond, func() {
			_, c, _ := srv.PacketStats()
			if c <= 0 {
				a.phoneBank.hasClient.Store(false)
				a.phoneBank.connectedAt = time.Time{}
				a.phoneBank.deviceName.Store("Controller")
				a.emitStateChange()
				if a.ctx != nil {
					wailsRuntime.EventsEmit(a.ctx, "device:disconnected", true)
				}
				a.broadcastLiveDebugJSON(map[string]any{
					"type":      "device_status",
					"connected": false,
				})
			}
		})
	}

	srv.OnClientVisibility = func(visible bool) {
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "device:visibility", visible)
		}
		if !visible && a.silenceDisconnect.Load() {
			srv.DisconnectAllClients()
		}
	}

	srv.OnClientDevice = func(device string) {
		if device != "" {
			a.phoneBank.deviceName.Store(device)
			a.emitStateChange()
			if device == "iPhone" || device == "iPad" {
				a.phoneBank.align.SeedGuess(motion.IOSSensorFrame())
			}
		}
	}

	// LiveDebug standalone 3D window routes and WebSocket streamer
	subFS, err := fs.Sub(assets, "frontend/src")
	if err == nil {
		liveUpgrader := websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		}

		registerLiveDebug := func(mux *http.ServeMux) {
			// Files the Live Debug page loads by relative path, for the browser
			// fallback of OpenLiveDebugWindow (the --livedebug window serves them from
			// its own asset server). Without /js/ and /css/ the page loads bare.
			files := http.FileServer(http.FS(subFS))
			mux.Handle("/assets/", files)
			mux.Handle("/js/", files)
			mux.Handle("/css/", files)
			mux.Handle("/main.css", files)
			mux.Handle("/livedebug/assets/", http.StripPrefix("/livedebug", files))
			mux.HandleFunc("/livedebug", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				data, err := fs.ReadFile(subFS, "livedebug.html")
				if err != nil {
					http.Error(w, "Not found", http.StatusNotFound)
					return
				}
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				w.WriteHeader(http.StatusOK)
				w.Write(data)
			})
			mux.HandleFunc("/livedebug/", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				if r.URL.Path == "/livedebug/" {
					data, err := fs.ReadFile(subFS, "livedebug.html")
					if err != nil {
						http.Error(w, "Not found", http.StatusNotFound)
						return
					}
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
					w.WriteHeader(http.StatusOK)
					w.Write(data)
					return
				}
				http.NotFound(w, r)
			})
			mux.HandleFunc("/livedebug/ping", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"status":"ok"}`))
			})
			mux.HandleFunc("/livedebug/recenter", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				if r.Method == http.MethodPost {
					a.ResetAHRS()
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"status":"ok"}`))
			})
			mux.HandleFunc("/livedebug/theme", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				val := r.URL.Query().Get("value")
				if val != "" {
					a.SetTheme(val)
				}
				a.themeMu.RLock()
				curT := a.currentTheme
				a.themeMu.RUnlock()
				if curT == "" {
					curT = "dark"
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]string{"theme": curT})
			})
			mux.HandleFunc("/livedebug/lang", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				val := r.URL.Query().Get("value")
				if val != "" {
					a.SetLang(val)
				}
				a.themeMu.RLock()
				curL := a.currentLang
				a.themeMu.RUnlock()
				if curL == "" {
					curL = "ru"
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]string{"lang": curL})
			})
			mux.HandleFunc("/livedebug/font-scale", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				val := r.URL.Query().Get("value")
				if val != "" {
					if scale, err := strconv.ParseFloat(val, 64); err == nil && scale >= 0.70 && scale <= 1.60 {
						a.SetFontScale(scale)
					}
				}
				curS := math.Float64frombits(a.fontScaleBits.Load())
				if curS < 0.70 || curS > 1.60 {
					curS = 1.00
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]float64{"fontScale": curS})
			})
			mux.HandleFunc("/livedebug/status", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusOK)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				var dsuClients []DSUClientView
				dsuCount := 0
				if a.dsuSrv != nil {
					dsuClients = a.dsuClientViews()
					dsuCount = len(dsuClients)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"device_connected": a.activeBank().hasClient.Load(),
					"dsu_clients":      dsuCount,
					"dsu_client_list":  dsuClients,
				})
			})
			mux.HandleFunc("/livedebug/show-in-folder", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				filePath := r.URL.Query().Get("path")
				if filePath != "" {
					go func() {
						_ = exec.Command("explorer.exe", "/select,", filepath.Clean(filePath)).Start()
					}()
				}
				w.WriteHeader(http.StatusOK)
			})
			mux.HandleFunc("/livedebug/ws", func(w http.ResponseWriter, r *http.Request) {
				conn, err := liveUpgrader.Upgrade(w, r, nil)
				if err != nil {
					return
				}

				// Send immediate initial theme, language, and device connection sync frame
				a.themeMu.RLock()
				curT := a.currentTheme
				curL := a.currentLang
				a.themeMu.RUnlock()
				if curT == "" {
					curT = "dark"
				}
				if curL == "" {
					curL = "ru"
				}
				var dsuClients []DSUClientView
				dsuCount := 0
				if a.dsuSrv != nil {
					dsuClients = a.dsuClientViews()
					dsuCount = len(dsuClients)
				}
				syncBytes, _ := json.Marshal(map[string]any{
					"type":             "sync",
					"theme":            curT,
					"lang":             curL,
					"device_connected": a.activeBank().hasClient.Load(),
					"dsu_clients":      dsuCount,
					"dsu_client_list":  dsuClients,
				})

				a.liveDebugMu.Lock()
				if a.liveDebugClients == nil {
					a.liveDebugClients = make(map[*websocket.Conn]struct{})
				}
				_ = conn.SetWriteDeadline(time.Now().Add(100 * time.Millisecond))
				_ = conn.WriteMessage(websocket.TextMessage, syncBytes)
				a.liveDebugClients[conn] = struct{}{}
				a.liveDebugMu.Unlock()

				go func(c *websocket.Conn) {
					defer func() {
						a.liveDebugMu.Lock()
						delete(a.liveDebugClients, c)
						a.liveDebugMu.Unlock()
						c.Close()
					}()

					for {
						_, msgBytes, err := c.ReadMessage()
						if err != nil {
							break
						}
						var req map[string]string
						if json.Unmarshal(msgBytes, &req) == nil {
							if req["action"] == "recenter" {
								a.ResetAHRS()
							}
						}
					}
				}(conn)
			})
		}

		registerLiveDebug(srv.HTTPMux)
		registerLiveDebug(srv.HTTPSMux)
	}

	srv.SetAppVersion(a.GetAppVersion().Display)
	if err := srv.Start(); err != nil {
		fmt.Printf("[-] Server start error: %v\n", err)
	}
	srv.SetInputMode(a.GetInputMode())
	a.srv = srv

	a.usbMgr = newUSBDeviceManager(a)
	if a.GetInputMode() == "usb" {
		a.usbMgr.Start()
	}

	// 60 Hz orientation stream for the main window's live 3D previews
	// (calibration confirm/manual screens). The full AppState below goes out at
	// only 15 Hz -- too slow for a 3D model without interpolation, and
	// interpolating would add lag on top. Four floats, sent only when changed.
	go func() {
		ticker := time.NewTicker(16 * time.Millisecond)
		defer ticker.Stop()
		var last [4]uint64
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				bank := a.activeBank()
				if !bank.hasClient.Load() || a.ctx == nil {
					continue
				}
				q := [4]uint64{bank.curAhrsQ0.Load(), bank.curAhrsQ1.Load(), bank.curAhrsQ2.Load(), bank.curAhrsQ3.Load()}
				if q == last {
					continue
				}
				last = q
				wailsRuntime.EventsEmit(a.ctx, "ahrs:quat", map[string]float64{
					"q0": math.Float64frombits(q[0]),
					"q1": math.Float64frombits(q[1]),
					"q2": math.Float64frombits(q[2]),
					"q3": math.Float64frombits(q[3]),
				})
			}
		}
	}()

	// Orientation heartbeat (15 Hz = 66ms) for smooth main GUI telemetry
	go func() {
		ticker := time.NewTicker(66 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			bank := a.activeBank()
			if bank.hasClient.Load() {
				// Sensor silence & frozen data watchdog (2.0 seconds)
				if a.silenceDisconnect.Load() && a.srv != nil {
					nowMs := time.Now().UnixMilli()
					silenceDuration := nowMs - bank.lastMotionRecvTs.Load()
					frozenDuration := nowMs - bank.lastSensorChangeTs.Load()
					// Grace period of 2 seconds after initial connection
					if time.Since(bank.connectedAt) > 2*time.Second {
						if silenceDuration > 2000 || frozenDuration > 2000 {
							a.srv.DisconnectAllClients()
						}
					}
				}

				a.emitStateChange()
				// Only send fallback heartbeat to 3D window if no live motion packet arrived recently (> 150ms)
				if time.Now().UnixMilli()-bank.lastMotionRecvTs.Load() > 150 {
					q0 := float32(math.Float64frombits(bank.curAhrsQ0.Load()))
					q1 := float32(math.Float64frombits(bank.curAhrsQ1.Load()))
					q2 := float32(math.Float64frombits(bank.curAhrsQ2.Load()))
					q3 := float32(math.Float64frombits(bank.curAhrsQ3.Load()))
					a.liveDebugMu.RLock()
					numDebug := len(a.liveDebugClients)
					a.liveDebugMu.RUnlock()
					if numDebug > 0 {
						var inHz float64
						if a.srv != nil {
							_, _, inHz = a.srv.PacketStats()
						}
						a.broadcastLiveDebug(q0, q1, q2, q3, liveDebugMsg{
							InHz: inHz,
						})
					}
				}
			}
		}
	}()

	// Тихий звук при сильной потере данных (link/alarm.go): решение по настоящим
	// счётчикам канала активного источника, звук играет фронтенд ("link:loss").
	go func() {
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		var alarm link.Alarm
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				bank := a.activeBank()
				kind, total, merged, lost := bank.loss.Snapshot()
				active := bank.hasClient.Load() && !a.isPaused.Load()
				var connectedFor time.Duration
				if at := bank.connectedAt; !at.IsZero() {
					connectedFor = now.Sub(at)
				}
				if reason, ok := alarm.Check(now, active, connectedFor, kind, total, merged, lost); ok {
					a.logEvent("WARN", "link: heavy data loss (%s)", reason)
					if a.ctx != nil {
						wailsRuntime.EventsEmit(a.ctx, "link:loss", reason)
					}
				}
			}
		}
	}()

	// Process resource monitor (CPU / RAM)
	a.stopResmon = resmon.RunLoop(1500*time.Millisecond, func(s resmon.Stats) {
		ramPercent := 0.0
		if s.TotalRAMBytes > 0 {
			ramPercent = (float64(s.RAMBytes) / float64(s.TotalRAMBytes)) * 100.0
		}
		statsPayload := map[string]any{
			"cpuPercent": s.CPUPercent,
			"ramMb":      float64(s.RAMBytes) / (1024 * 1024),
			"totalRamMb": float64(s.TotalRAMBytes) / (1024 * 1024),
			"ramPercent": ramPercent,
		}
		a.lastResStats.Store(&statsPayload)
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "resource-stats", statsPayload)
		}
	})

	// Background network IP watcher (detects DHCP updates, USB tethering, or Wi-Fi reconnects)
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			lanIPs := pairing.GetLocalIPv4s()
			if len(lanIPs) == 0 {
				continue
			}
			newPrimary := pairing.GetPrimaryIP(lanIPs)
			if newPrimary != "" && newPrimary != a.primaryIP {
				a.primaryIP = newPrimary
				a.rebuildURLsAndQRCodes()
				if a.caMgr != nil {
					a.caMgr.AddHostIPs(lanIPs)
				}
				a.emitStateChange()
				if a.ctx != nil {
					wailsRuntime.EventsEmit(a.ctx, "network:ip-changed", newPrimary)
				}
				a.logEvent("INFO", "Network adapter change detected: primary IP updated to %s", newPrimary)
			}
		}
	}()
}

// shutdown is called when the Wails application terminates
func (a *App) shutdown(ctx context.Context) {
	if a.trayMgr != nil {
		a.trayMgr.Stop()
		a.trayMgr = nil
	}

	if a.stopResmon != nil {
		a.stopResmon()
		a.stopResmon = nil
	}

	// Terminate child Live Debug process if running
	a.liveDebugCmdMu.Lock()
	if a.liveDebugCmd != nil && a.liveDebugCmd.Process != nil {
		_ = a.liveDebugCmd.Process.Kill()
		a.liveDebugCmd = nil
	}
	a.liveDebugCmdMu.Unlock()

	if a.srv != nil {
		a.srv.Stop()
	}
	if a.dsuSrv != nil {
		a.dsuSrv.Stop()
	}
	if a.usbMgr != nil {
		a.usbMgr.Stop()
	}
	a.liveDebugMu.Lock()
	for conn := range a.liveDebugClients {
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"action":"shutdown"}`))
		conn.Close()
	}
	a.liveDebugClients = make(map[*websocket.Conn]struct{})
	a.liveDebugMu.Unlock()
}
