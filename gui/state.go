package main

import (
	"fmt"
	"math"
	"net"
	"os"
	"phonegyro/pkg/dsu"
	"runtime"
	"syscall"
	"time"
	"unsafe"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// AppState represents the live state of PhoneGyro
type AppState struct {
	Status        string  `json:"status"` // "offline", "online", "paused"
	IsPaused      bool    `json:"isPaused"`
	DeviceName    string  `json:"deviceName"` // e.g. "Controller"
	Hz            float64 `json:"hz"`
	PingMs        int     `json:"pingMs"`        // real phone link RTT (pkg/server LinkRTT); -1 = not measured / USB
	ConnectedTime string  `json:"connectedTime"` // "00:07:32"
	Pitch         float64 `json:"pitch"`         // Live pitch in degrees
	Roll          float64 `json:"roll"`          // Live roll in degrees
	Yaw           float64 `json:"yaw"`           // Live yaw in degrees
	IP            string  `json:"ip"`
	GamepadURL    string  `json:"gamepadUrl"`
	SetupURL      string  `json:"setupUrl"`
	QRCode        string  `json:"qrCode"`      // Base64 data URI
	SetupQRCode   string  `json:"setupQrCode"` // Base64 data URI for iOS profile
	// Raw sensor data for calibration wizard (live, latest sample)
	RawRotX float64 `json:"rawRotX"` // Angular velocity X in °/s
	RawRotY float64 `json:"rawRotY"` // Angular velocity Y in °/s
	RawRotZ float64 `json:"rawRotZ"` // Angular velocity Z in °/s
	RawAccX float64 `json:"rawAccX"` // Acceleration X in g
	RawAccY float64 `json:"rawAccY"` // Acceleration Y in g
	RawAccZ float64 `json:"rawAccZ"` // Acceleration Z in g
	// Raw sensor orientation quaternion (live, latest sample from device)
	Qx float64 `json:"qx"`
	Qy float64 `json:"qy"`
	Qz float64 `json:"qz"`
	Qw float64 `json:"qw"`
	// Profile system
	Profiles     []ProfileView `json:"profiles"`
	ActiveSlot   int           `json:"activeSlot"`   // -1 = none (identity matrix)
	ActiveMatrix [3][3]float64 `json:"activeMatrix"` // currently applied calibration matrix (or preview during wizard)
	// Madgwick AHRS quaternion computed from calibrated gyro/accel (matching PadTest conventions).
	// Use these (not raw Qx/Qy/Qz/Qw) for 3D rendering.
	// Q0=w, Q1=x, Q2=y, Q3=z. Apply PadTest negate to get display: (-Q1, -Q2, Q3, Q0).
	AhrsQ0        float64          `json:"ahrsQ0"`
	AhrsQ1        float64          `json:"ahrsQ1"`
	AhrsQ2        float64          `json:"ahrsQ2"`
	AhrsQ3        float64          `json:"ahrsQ3"`
	FirstLaunch   bool             `json:"firstLaunch"`
	HideAuthor    bool             `json:"hideAuthor"`
	DsuClients    int              `json:"dsuClients"`
	DsuClientList []dsu.ClientInfo `json:"dsuClientList"`
	InputMode     string           `json:"inputMode"`
	UsbConnected  bool             `json:"usbConnected"`
	UsbPort       string           `json:"usbPort"`
}

// TuningFrame conveys simultaneous raw and filtered telemetry to the frontend tuning bench
type TuningFrame struct {
	RawX  float32 `json:"rawX"`
	RawY  float32 `json:"rawY"`
	RawZ  float32 `json:"rawZ"`
	OutX  float32 `json:"outX"`
	OutY  float32 `json:"outY"`
	OutZ  float32 `json:"outZ"`
	Hz    float32 `json:"hz"`
	Pitch float32 `json:"pitch"`
	Roll  float32 `json:"roll"`
	Yaw   float32 `json:"yaw"`
}

// ShowWindow restores and brings the main application window to the foreground.
func (a *App) ShowWindow() {
	if a.ctx != nil {
		wailsRuntime.WindowShow(a.ctx)
		wailsRuntime.WindowUnminimise(a.ctx)
		wailsRuntime.WindowSetAlwaysOnTop(a.ctx, true)
		wailsRuntime.WindowSetAlwaysOnTop(a.ctx, false)
	}
}

// QuitApp cleanly terminates the entire application.
func (a *App) QuitApp() {
	a.quitting.Store(true)
	if a.trayMgr != nil {
		a.trayMgr.Stop()
	}
	if a.ctx != nil {
		wailsRuntime.Quit(a.ctx)
	}
}

// bindDSUCallbacks hooks connection lifecycle events from the DSU UDP server.
func (a *App) bindDSUCallbacks(srv *dsu.Server) {
	if srv == nil {
		return
	}
	notify := func() {
		clients := srv.GetClientsInfo()
		count := len(clients)
		if a.trayMgr != nil {
			a.trayMgr.UpdateState()
		}
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "dsu:status", map[string]any{
				"count":   count,
				"clients": clients,
			})
		}
		a.broadcastLiveDebugJSON(map[string]any{
			"type":            "dsu_update",
			"dsu_clients":     count,
			"dsu_client_list": clients,
		})
	}
	srv.OnClientConnect = func(addr *net.UDPAddr) {
		notify()
	}
	srv.OnClientDisconnect = func(addr *net.UDPAddr) {
		notify()
	}
}

// GetDSUStatus returns the current DSU clients count and connection metadata.
func (a *App) GetDSUStatus() map[string]any {
	var clients []dsu.ClientInfo
	count := 0
	if a.dsuSrv != nil {
		clients = a.dsuSrv.GetClientsInfo()
		count = len(clients)
	}
	return map[string]any{
		"count":   count,
		"clients": clients,
	}
}

func (a *App) emitStateChange() {
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "state:change", a.GetState())
	}
}

// GetState returns the current unified application state
func (a *App) GetState() AppState {
	bank := a.activeBank()
	status := "offline"
	hz := 0.0
	connectedDuration := "00:00:00"

	if bank.hasClient.Load() {
		if a.isPaused.Load() {
			status = "paused"
		} else {
			status = "online"
		}

		if !bank.connectedAt.IsZero() {
			dur := time.Since(bank.connectedAt)
			h := int(dur.Hours())
			m := int(dur.Minutes()) % 60
			s := int(dur.Seconds()) % 60
			connectedDuration = fmt.Sprintf("%02d:%02d:%02d", h, m, s)
		}

		if a.srv != nil {
			_, _, curHz := a.srv.PacketStats()
			hz = curHz
		}
	}

	bank.profilesMu.RLock()
	profilesCopy := bank.profiles
	activeSlot := bank.activeSlot
	bank.profilesMu.RUnlock()

	profilesList := make([]ProfileView, 6)
	for i := 0; i < 6; i++ {
		p := profilesCopy[i]
		p.Active = (i == activeSlot)
		profilesList[i] = toProfileView(p)
	}

	// Determine which matrix is currently effective: preview during wizard, or saved active matrix.
	bank.previewMu.RLock()
	usePrev := bank.usePreview
	effectiveMat := bank.previewMatrix
	bank.previewMu.RUnlock()
	if !usePrev {
		bank.matrixMu.RLock()
		effectiveMat = bank.activeMatrix
		bank.matrixMu.RUnlock()
	}

	devName := "Controller"
	if v := bank.deviceName.Load(); v != nil {
		if s, ok := v.(string); ok && s != "" {
			devName = s
		}
	}

	return AppState{
		Status:        status,
		IsPaused:      a.isPaused.Load(),
		DeviceName:    devName,
		Hz:            hz,
		PingMs:        a.linkPingMs(),
		ConnectedTime: connectedDuration,
		Pitch:         math.Float64frombits(bank.curPitch.Load()),
		Roll:          math.Float64frombits(bank.curRoll.Load()),
		Yaw:           math.Float64frombits(bank.curYaw.Load()),
		IP:            a.primaryIP,
		GamepadURL:    a.gamepadURL,
		SetupURL:      a.setupURL,
		QRCode:        a.qrCodePNG,
		SetupQRCode:   a.setupQRPNG,
		RawRotX:       math.Float64frombits(bank.curRotX.Load()),
		RawRotY:       math.Float64frombits(bank.curRotY.Load()),
		RawRotZ:       math.Float64frombits(bank.curRotZ.Load()),
		RawAccX:       math.Float64frombits(bank.curAccX.Load()),
		RawAccY:       math.Float64frombits(bank.curAccY.Load()),
		RawAccZ:       math.Float64frombits(bank.curAccZ.Load()),
		Qx:            math.Float64frombits(bank.curQx.Load()),
		Qy:            math.Float64frombits(bank.curQy.Load()),
		Qz:            math.Float64frombits(bank.curQz.Load()),
		Qw:            math.Float64frombits(bank.curQw.Load()),
		Profiles:      profilesList,
		ActiveSlot:    activeSlot,
		ActiveMatrix:  effectiveMat,
		AhrsQ0:        math.Float64frombits(bank.curAhrsQ0.Load()),
		AhrsQ1:        math.Float64frombits(bank.curAhrsQ1.Load()),
		AhrsQ2:        math.Float64frombits(bank.curAhrsQ2.Load()),
		AhrsQ3:        math.Float64frombits(bank.curAhrsQ3.Load()),
		FirstLaunch:   !a.firstLaunchDone,
		HideAuthor:    a.hideAuthor,
		DsuClients: func() int {
			if a.dsuSrv != nil {
				return a.dsuSrv.ActiveClientCount()
			}
			return 0
		}(),
		DsuClientList: func() []dsu.ClientInfo {
			if a.dsuSrv != nil {
				return a.dsuSrv.GetClientsInfo()
			}
			return nil
		}(),
		InputMode: a.GetInputMode(),
		UsbConnected: func() bool {
			if a.usbMgr != nil {
				connected, _ := a.usbMgr.Status()
				return connected
			}
			return false
		}(),
		UsbPort: func() string {
			if a.usbMgr != nil {
				_, port := a.usbMgr.Status()
				return port
			}
			return ""
		}(),
	}
}

// TogglePause flips stream transmission pause
func (a *App) TogglePause() AppState {
	a.toggleMu.Lock()
	defer a.toggleMu.Unlock()

	now := time.Now()
	if now.Sub(a.lastToggle) < 250*time.Millisecond {
		return a.GetState()
	}
	a.lastToggle = now

	current := a.isPaused.Load()
	next := !current
	a.isPaused.Store(next) // PC-side mute of the DSU output; the phone is not told
	a.emitStateChange()
	return a.GetState()
}

// ResetAHRS zeroes the active bank's 3D orientation filter
func (a *App) ResetAHRS() {
	bank := a.activeBank()
	if bank.ahrs != nil {
		bank.ahrs.Reset()
		a.broadcastLiveDebug(1, 0, 0, 0)
	}
}

// TriggerRecenterFromHotkey is invoked by the Windows global hotkey to reset orientation.
func (a *App) TriggerRecenterFromHotkey() {
	a.ResetAHRS()
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "recenter:triggered", "hotkey")
	}
}

// PlaySystemSound plays a native Windows sound for hardware connect/disconnect
func (a *App) PlaySystemSound(soundType string) {
	if runtime.GOOS != "windows" {
		return
	}
	mod := syscall.NewLazyDLL("winmm.dll")
	proc := mod.NewProc("PlaySoundW")

	var soundName string
	var fallbackPath string
	switch soundType {
	case "connect":
		soundName = "DeviceConnect"
		fallbackPath = `C:\Windows\Media\Windows Hardware Insert.wav`
	case "disconnect":
		soundName = "DeviceDisconnect"
		fallbackPath = `C:\Windows\Media\Windows Hardware Remove.wav`
	case "dsu":
		soundName = "DeviceConnect"
		fallbackPath = `C:\Windows\Media\Windows Notify System Generic.wav`
	case "recenter":
		soundName = "CCSelect"
		fallbackPath = `C:\Windows\Media\Windows Navigation Start.wav`
	case "defeat":
		soundName = "SystemHand"
		fallbackPath = `C:\Windows\Media\Windows Hardware Fail.wav`
	case "loss":
		// Самый мягкий системный звук: предупреждение, а не тревога.
		fallbackPath = `C:\Windows\Media\Windows Background.wav`
	default:
		return
	}

	if soundName != "" { // "loss" has no system alias, only the file below
		ptr, err := syscall.UTF16PtrFromString(soundName)
		if err == nil {
			// SND_ASYNC (0x0001) | SND_ALIAS (0x00010000) | SND_NODEFAULT (0x0002)
			ret, _, _ := proc.Call(uintptr(unsafe.Pointer(ptr)), 0, uintptr(0x0001|0x00010000|0x0002))
			if ret != 0 {
				return
			}
		}
	}

	if _, err := os.Stat(fallbackPath); err == nil {
		if fptr, ferr := syscall.UTF16PtrFromString(fallbackPath); ferr == nil {
			// SND_ASYNC (0x0001) | SND_FILENAME (0x00020000)
			_, _, _ = proc.Call(uintptr(unsafe.Pointer(fptr)), 0, uintptr(0x0001|0x00020000))
		}
	}
}

// GetResourceStats returns the most recent CPU and RAM snapshot for the process.
func (a *App) GetResourceStats() map[string]any {
	if p := a.lastResStats.Load(); p != nil {
		return *p
	}
	return map[string]any{
		"cpuPercent": 0.0,
		"ramMb":      0.0,
		"totalRamMb": 0.0,
		"ramPercent": 0.0,
	}
}
