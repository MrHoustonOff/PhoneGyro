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

// Client is one subscribed DSU client (an emulator).
type Client struct {
	Name   string
	Active bool // false: subscribed but not asking for data right now
}

// Status is what the icon, its tooltip and the menu show.
type Status struct {
	Lang    string
	Theme   string // "dark" | "light": the app's theme, the menu follows it
	Accent  string // the app's accent name (settings.ValidAccent)
	Mode    string // "phone" | "usb": the selected input
	Online  bool   // the active source is connected
	Paused  bool   // connected, but the output is paused
	Device  string // its name; "" is shown as "iPhone"
	Link    string // "Wi-Fi · LAN" / "USB"; "" when unknown
	Hz      float64
	PingMs  int // -1: not measured
	Profile string
	Emulators int    // clients asking for data (cheap; the list is Callbacks.Clients)
	Clients   []Client // filled when the menu opens
}

// Callbacks connect the tray to the app. All are required.
type Callbacks struct {
	Status   func() Status
	Show     func() // open the main window
	Pause    func() // toggle the pause
	Clients  func() []Client // the subscribed DSU clients (named: costlier than Status)
	Quit     func()
}

// Manager manages the Windows notification area system tray icon and context menu.
type Manager struct {
	cb           Callbacks
	hwnd         uintptr
	nid          NOTIFYICONDATAW
	nidMu        sync.Mutex
	icons        [iconCount]uintptr
	currentIcon  uintptr
	taskbarMsg   uint32 // "TaskbarCreated": explorer.exe restarted, the icon must be added again
	lastTipAt    time.Time
	menu         []*menuItem // the open menu's items (their index is the owner-draw item data)
	menuPal      palette
	menuGdip     *session
	menuScale    float32
	menuBg       uint32
	dsuOpen      bool // the right-click menu shows the DSU client list unfolded

	ready    atomic.Bool
	stopChan chan struct{}
	stopOnce sync.Once

	lastOnline   bool
	lastPaused   bool
	lastPhone    string
	lastEmuCount int
	lastProfile  string
	lastLang     string
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

