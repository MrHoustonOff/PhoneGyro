// Package tray is the Windows notification-area icon with its menu, and the
// global recenter hotkey (registered on the tray's hidden window).
package tray

import (
	_ "embed"
	"fmt"
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
	Theme     string // "dark" | "light": the app's theme, the menu and the panel follow it
	Accent    string // the app's accent name (settings.ValidAccent)
	Online    bool   // the active source is connected
	Paused    bool   // connected, but the output is paused
	Device    string // its name; "" is shown as "iPhone"
	Link      string // "Wi-Fi · LAN" / "USB"; "" when unknown
	Mode      string // "phone" | "usb": the selected input
	Hz        float64
	PingMs    int // -1: not measured
	Emulators int // subscribed DSU clients
	Profile   string
	Profiles  []string // the six slots' names; "" = empty slot
	Slot      int      // active slot index
	CPU       float64  // process share of the machine, percent
	RAMMB     float64
	RAMTotal  float64 // total physical RAM, MB
	Version   string
	DSUPort   int
}

// Callbacks connect the tray to the app. All are required.
type Callbacks struct {
	Status   func() Status
	Show     func() // open the main window
	Quit     func()
	Recenter func() // the global hotkey was pressed, or the panel's button
	Profile  func(slot int)
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
	hist         [histLen]float32 // rate and CPU history for the panel's graphs, one point per refresh
	cpuHist      [histLen]float32
	popClosedAt  time.Time

	ready    atomic.Bool
	stopChan chan struct{}
	stopOnce sync.Once

	lastOnline   bool
	lastPaused   bool
	lastPhone    string
	lastEmuCount int
	lastProfile  string
	lastLang     string

	hotkeyMu      sync.RWMutex
	hotkeyEnabled bool
	hotkeyMods    uint32
	hotkeyVK      uint32
	hotkeyStr     string
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
			pUnregisterHotKey.Call(tm.hwnd, uintptr(ID_HOTKEY_RECENTER))
			tm.nidMu.Lock()
			pShellNotifyIconW.Call(NIM_DELETE, uintptr(unsafe.Pointer(&tm.nid)))
			tm.nidMu.Unlock()
			pPostMessageW.Call(tm.hwnd, WM_CLOSE, 0, 0)
		}
	})
}

// UpdateHotkey parses and updates the global recenter hotkey registration.
func (tm *Manager) UpdateHotkey(enabled bool, keyStr string) {
	var mods, vk uint32
	var err error
	if enabled && keyStr != "" {
		mods, vk, err = ParseHotkey(keyStr)
		if err != nil {
			fmt.Printf("[-] Failed to parse hotkey '%s': %v\n", keyStr, err)
			enabled = false
		}
	} else {
		enabled = false
	}

	tm.hotkeyMu.Lock()
	tm.hotkeyEnabled = enabled
	tm.hotkeyMods = mods
	tm.hotkeyVK = vk
	tm.hotkeyStr = keyStr
	hwnd := tm.hwnd
	tm.hotkeyMu.Unlock()

	if hwnd != 0 {
		pPostMessageW.Call(hwnd, WM_UPDATE_HOTKEY, 0, 0)
	}
}

func (tm *Manager) applyHotkey(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	pUnregisterHotKey.Call(hwnd, uintptr(ID_HOTKEY_RECENTER))

	tm.hotkeyMu.RLock()
	enabled := tm.hotkeyEnabled
	mods := tm.hotkeyMods
	vk := tm.hotkeyVK
	keyStr := tm.hotkeyStr
	tm.hotkeyMu.RUnlock()

	if enabled && vk != 0 {
		ret, _, _ := pRegisterHotKey.Call(hwnd, uintptr(ID_HOTKEY_RECENTER), uintptr(mods|MOD_NOREPEAT), uintptr(vk))
		if ret == 0 {
			fmt.Printf("[-] Failed to register global Windows hotkey: %s (id %d)\n", keyStr, ID_HOTKEY_RECENTER)
		} else {
			fmt.Printf("[+] Registered global Windows hotkey: %s (id %d)\n", keyStr, ID_HOTKEY_RECENTER)
		}
	}
}

