// Package tray is the Windows notification-area icon with its menu.
package tray

import (
	_ "embed"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

//go:embed icons/tray_offline.ico
var trayIconOfflineBytes []byte

//go:embed icons/tray_online.ico
var trayIconOnlineBytes []byte

//go:embed icons/tray_paused.ico
var trayIconPausedBytes []byte

// Icon states (design: Brand, "tray states"): ring + dot, offline / online / paused.
const (
	iconOffline = iota
	iconOnline
	iconPaused
	iconCount
)

// Status is what the icon, its tooltip and the menu show.
type Status struct {
	Lang      string
	Mode      string // "phone" | "usb": the selected input
	Online    bool   // the active source is connected
	Paused    bool   // connected, but the output is paused
	Device    string // its name; "" is shown as "iPhone"
	Hz        float64
	PingMs    int // -1: not measured
	Profile   string
	Emulators []string // names of the clients asking for data ("Cemu", or an address)
}

// Callbacks connect the tray to the app. All are required.
type Callbacks struct {
	Status func() Status
	Show   func() // open the main window
	Pause  func() // toggle the pause
	Quit   func()
}

// Manager manages the Windows notification area system tray icon and context menu.
type Manager struct {
	cb          Callbacks
	hwnd        uintptr
	nid         NOTIFYICONDATAW
	nidMu       sync.Mutex
	icons       [iconCount]uintptr
	currentIcon uintptr
	taskbarMsg  uint32 // "TaskbarCreated": explorer.exe restarted, the icon must be added again
	lastTipAt   time.Time

	ready    atomic.Bool
	stopChan chan struct{}
	stopOnce sync.Once

	lastOnline  bool
	lastPaused  bool
	lastPhone   string
	lastEmu     string
	lastProfile string
	lastLang    string
}

// New initializes a pure Win32 tray manager.
func New(cb Callbacks) *Manager {
	return &Manager{
		cb:       cb,
		stopChan: make(chan struct{}),
	}
}

// Start launches the dedicated Win32 thread and tray message loop.
func (tm *Manager) Start() {
	readyChan := make(chan struct{})
	go tm.trayLoop(readyChan)
	<-readyChan
	go tm.updateLoop()
}

// Stop terminates the tray icon and exits the Win32 message loop.
func (tm *Manager) Stop() {
	tm.stopOnce.Do(func() {
		close(tm.stopChan)
		if tm.hwnd != 0 {
			tm.nidMu.Lock()
			pShellNotifyIconW.Call(NIM_DELETE, uintptr(unsafe.Pointer(&tm.nid)))
			tm.nidMu.Unlock()
			pPostMessageW.Call(tm.hwnd, WM_CLOSE, 0, 0)
		}
	})
}
