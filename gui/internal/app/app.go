package app

import (
	"context"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"phonegyro/pkg/ca"
	"phonegyro/pkg/dsu"
	"phonegyro/pkg/i18n"
	"phonegyro/pkg/pairing"
	"phonegyro/pkg/server"
	"phonegyro/web"

	"phonegyro-gui/internal/dsuclients"
	"phonegyro-gui/internal/motion"
	"phonegyro-gui/internal/settings"
	"phonegyro-gui/internal/tray"
	"phonegyro-gui/internal/usbdev"
	"phonegyro-gui/internal/version"
	"phonegyro-gui/internal/winstate"

	"github.com/gorilla/websocket"
)

func init() {
	_ = mime.AddExtensionType(".glb", "model/gltf-binary")
}

// App struct manages desktop backend and PhoneGyro services
type App struct {
	ctx      context.Context
	i18nMgr  *i18n.Manager
	srv      *server.Server
	dsuSrv   *dsu.Server
	usbMgr   *usbdev.Manager
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
	quatStream       atomic.Bool // ahrs:quat has a listener (SetQuatStream)
	// Multi-window theme and language synchronization
	themeMu         sync.RWMutex
	currentTheme    string
	debugLogOn      atomic.Bool   // settings.json debugLog (debug.go)
	debugPanel      atomic.Bool   // settings.json debugPanel
	debugLog        debugLogState // logs/debug.log
	hub             debugHub      // debughub.go
	accent          string        // UI accent colour (settings.json accent), guarded by themeMu
	currentLang     string
	firstLaunchDone bool
	hideAuthor      bool
	splash          atomic.Bool // play the launch animation
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
	cemuNotice        cemuNoticeState
	update            updateState
	firewall          firewallState
	dsuNames          dsuclients.Namer // program names of local DSU clients (dsu_clients.go)
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
	closeActionMu sync.RWMutex
	closeAction   string // "ask", "minimize", "quit"
	quitting      atomic.Bool
	// uiHidden: the main window is hidden in the tray (hideWindow/ShowWindow);
	// the UI-only event streams pause meanwhile (emitStateChange, streamQuat).
	uiHidden atomic.Bool
	// uiUnloaded: the hidden window's page was replaced by about:blank (hideWindow);
	// showOnReady: ShowWindow reloaded it and waits for it to show the window;
	// windowPlaced: the first page load already put the window in place;
	// trayGen: bumped by every hide/show, so a stale timer does nothing.
	uiUnloaded   atomic.Bool
	showOnReady  atomic.Bool
	windowPlaced atomic.Bool
	trayGen      atomic.Uint64
	trayMgr      *tray.Manager
	// Input Mode ("phone" vs "usb")
	inputModeMu sync.RWMutex
	inputMode   string
	// The listeners (DSU UDP, HTTP/HTTPS) start once the UI has finished its launch
	// animation (UIReady), so Windows' firewall prompt does not cover it.
	netGate     chan struct{}
	netGateOnce sync.Once

	// Main window placement (winstate): the handle once the window is up, and
	// the saved placement to restore when it still fits the monitors.
	winHwnd    uintptr
	winRestore *winstate.State
}

// NewApp creates a new App application struct
func NewApp() *App {
	mgr, err := i18n.NewManager("ru")
	if err != nil {
		fmt.Printf("[-] Failed to init i18n manager: %v\n", err)
	}

	primaryIP := pairing.GetPrimaryIP(pairing.GetLocalIPv4s())

	// Determine profiles dir
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = "."
	}
	profilesDir := filepath.Join(appData, "phonegyro")

	app := &App{
		netGate:     make(chan struct{}),
		i18nMgr:     mgr,
		primaryIP:   primaryIP,
		profilesDir: profilesDir,
	}
	app.update.kick = make(chan struct{}, 1)
	app.phoneBank = newMotionBank()
	app.usbBank = newMotionBank()
	app.applySettings(settings.Defaults())

	// Ensure logs directory exists
	_ = os.MkdirAll(filepath.Join(profilesDir, "logs"), 0755)

	// Load persisted settings and profiles for BOTH banks up front, so
	// switching input mode later immediately reflects whatever was saved for
	// that mode last time, without needing a lazy first-load.
	app.loadSettings()
	app.rebuildURLsAndQRCodes() // gamepad/setup URLs and their QR codes (ports come from settings)
	app.loadProfilesInto(app.phoneBank, app.bankDir("phone"))
	app.loadProfilesInto(app.usbBank, app.bankDir("usb"))
	app.logEvent("INFO", "PhoneGyro initialized: IP=%s, Theme=%s, Lang=%s, DSU=%d, HTTP=%d, HTTPS=%d", primaryIP, app.currentTheme, app.currentLang, app.dsuPort, app.httpPort, app.httpsPort)

	return app
}

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
	a.hubPhase("startup")

	a.trayMgr = tray.New(tray.Callbacks{
		Status: a.trayStatus,
		Show:   a.ShowWindow,
		Quit:   a.QuitApp,
		Pause:  func() { a.TogglePause() },
	})
	a.trayMgr.Start()

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
	} else if caMgr.Regenerated != "" {
		a.logEvent("WARN", "certificate: new root CA (%s); the phone has to install it again", caMgr.Regenerated)
	}
	a.caMgr = caMgr
	a.hubPhase("certificates ready")

	// 2. Cemuhook DSU Server (UDP)
	macBytes, err := settings.ParseMAC(a.getDSUMAC())
	if err != nil {
		macBytes = dsu.GenerateRandomMAC()
		a.setDSUMAC(settings.FormatMAC(macBytes))
	}
	dsuSrv := dsu.NewServer(a.dsuPort, macBytes)
	a.bindDSUCallbacks(dsuSrv)
	a.dsuSrv = dsuSrv // listens after the launch animation (startNetwork)

	// Each bank gets its own aligner (own sensor_frame.json) so a learned
	// axis mapping never leaks between the phone and a USB device.
	a.phoneBank.align = motion.NewSensorAligner(a.bankDir("phone"))
	a.usbBank.align = motion.NewSensorAligner(a.bankDir("usb"))
	a.initProfileSensorFrame(a.phoneBank, a.bankDir("phone"))
	a.initProfileSensorFrame(a.usbBank, a.bankDir("usb"))

	// 3. Web & Telemetry Server (HTTP / HTTPS)
	var srv *server.Server
	srv = server.NewServer(caMgr, a.httpPort, a.httpsPort, web.IndexHTML, func(frame server.MotionFrame) {
		a.onMotionFrame(srv, frame)
	})

	a.bindPhoneCallbacks(srv)

	// LiveDebug standalone 3D window routes and WebSocket streamer
	a.serveLiveDebug(srv)
	a.serveMobileAssets(srv) // the phone page's fonts and textures (mobile_assets.go)

	srv.SetAppVersion(version.Get().Display)
	srv.SetInputMode(a.GetInputMode())
	a.srv = srv

	a.usbMgr = usbdev.New(a.usbHost())
	if a.GetInputMode() == "usb" {
		a.usbMgr.Start()
	}

	// Background loops (loops.go).
	go a.streamQuat(ctx)
	go a.heartbeat()
	go a.watchLinkLoss(ctx)
	a.startResourceMonitor()
	go a.watchNetwork()
	a.hubPhase("services up")
	go a.updateLoop()              // update_check.go; idle unless the check is switched on
	go a.startNetwork(dsuSrv, srv) // opens the ports after the launch animation, then watches the firewall
}

// netGateMax is how long the listeners wait for the UI to finish its launch
// animation; past it they start anyway (a window that never reports must not
// leave the phone and the emulators without a server).
const netGateMax = 20 * time.Second

// UIReady is called by the window when its launch animation is over (or right
// away when there is none). Only then do the servers start listening, so the
// first-launch Windows Firewall prompt appears over a finished UI.
func (a *App) UIReady() {
	a.netGateOnce.Do(func() { close(a.netGate) })
}

func (a *App) startNetwork(dsuSrv *dsu.Server, srv *server.Server) {
	select {
	case <-a.netGate:
	case <-time.After(netGateMax):
	}
	if err := dsuSrv.Start(); err != nil {
		fmt.Printf("[-] DSU start error: %v\n", err)
	}
	a.hubPhase("DSU server up")
	if err := srv.Start(); err != nil {
		fmt.Printf("[-] Server start error: %v\n", err)
	}
	a.hubPhase("HTTP server up")
	a.watchFirewall() // firewall.go
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
