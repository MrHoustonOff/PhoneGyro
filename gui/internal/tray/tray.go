// Package tray is the Windows notification-area icon with its menu, and the
// global recenter hotkey (registered on the tray's hidden window).
package tray

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

//go:embed icons/tray_offline.ico
var trayIconOfflineBytes []byte

//go:embed icons/tray_online.ico
var trayIconOnlineBytes []byte

// Status is what the icon, its tooltip and the menu show.
type Status struct {
	Lang      string
	Online    bool   // the active source is connected
	Device    string // its name; "" is shown as "iPhone"
	Emulators int    // subscribed DSU clients
	Profile   string // active profile name
}

// Callbacks connect the tray to the app. All are required.
type Callbacks struct {
	Status   func() Status
	Show     func() // open the main window
	Quit     func()
	Recenter func() // the global hotkey was pressed
}

// Manager manages the Windows notification area system tray icon and context menu.
type Manager struct {
	cb           Callbacks
	hwnd         uintptr
	nid          NOTIFYICONDATAW
	nidMu        sync.Mutex
	hIconOffline uintptr
	hIconOnline  uintptr
	currentIcon  uintptr

	ready    atomic.Bool
	stopChan chan struct{}
	stopOnce sync.Once

	lastOnline   bool
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

func (tm *Manager) trayLoop(readyChan chan struct{}) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// 1. Prepare temp icon files
	tempDir := filepath.Join(os.TempDir(), "phonegyro_tray")
	_ = os.MkdirAll(tempDir, 0755)

	offPath := filepath.Join(tempDir, "tray_off.ico")
	onPath := filepath.Join(tempDir, "tray_on.ico")
	_ = os.WriteFile(offPath, trayIconOfflineBytes, 0644)
	_ = os.WriteFile(onPath, trayIconOnlineBytes, 0644)

	offPtr, _ := syscall.UTF16PtrFromString(offPath)
	onPtr, _ := syscall.UTF16PtrFromString(onPath)

	hOff, _, _ := pLoadImageW.Call(0, uintptr(unsafe.Pointer(offPtr)), IMAGE_ICON, 0, 0, LR_LOADFROMFILE|LR_DEFAULTSIZE)
	hOn, _, _ := pLoadImageW.Call(0, uintptr(unsafe.Pointer(onPtr)), IMAGE_ICON, 0, 0, LR_LOADFROMFILE|LR_DEFAULTSIZE)

	tm.hIconOffline = hOff
	tm.hIconOnline = hOn
	tm.currentIcon = hOff

	// 2. Register window class
	hInstance, _, _ := pGetModuleHandleW.Call(0)
	className, _ := syscall.UTF16PtrFromString(fmt.Sprintf("PhoneGyroTray_%d", time.Now().UnixNano()))

	wndProcCallback := syscall.NewCallback(func(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
		switch msg {
		case WM_TRAYICON:
			switch lParam {
			case WM_LBUTTONUP, WM_LBUTTONDBLCLK:
				tm.cb.Show()
				return 0

			case WM_RBUTTONUP:
				tm.showContextMenu(hwnd)
				return 0
			}

		case WM_UPDATE_HOTKEY:
			tm.applyHotkey(hwnd)
			return 0

		case WM_HOTKEY:
			if wParam == uintptr(ID_HOTKEY_RECENTER) {
				tm.cb.Recenter()
				return 0
			}

		case WM_CLOSE:
			pDestroyWindow.Call(hwnd)
			return 0

		case WM_DESTROY:
			pPostQuitMessage.Call(0)
			return 0
		}

		ret, _, _ := pDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
		return ret
	})

	wcex := WNDCLASSEXW{
		CbSize:        uint32(unsafe.Sizeof(WNDCLASSEXW{})),
		LpfnWndProc:   wndProcCallback,
		HInstance:     hInstance,
		LpszClassName: className,
	}
	pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wcex)))

	// 3. Create hidden message window
	hwnd, _, _ := pCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(className)),
		0, 0, 0, 0, 0,
		0, 0, hInstance, 0,
	)
	tm.hwnd = hwnd

	// 4. Register tray icon
	tm.nid = NOTIFYICONDATAW{
		CbSize:           uint32(unsafe.Sizeof(NOTIFYICONDATAW{})),
		HWnd:             hwnd,
		UID:              1,
		UFlags:           NIF_MESSAGE | NIF_ICON | NIF_TIP,
		UCallbackMessage: WM_TRAYICON,
		HIcon:            tm.currentIcon,
	}
	tip, _ := syscall.UTF16FromString("PhoneGyro")
	copy(tm.nid.SzTip[:], tip)

	pShellNotifyIconW.Call(NIM_ADD, uintptr(unsafe.Pointer(&tm.nid)))
	tm.ready.Store(true)

	// Register global hotkey if already configured
	tm.applyHotkey(hwnd)

	close(readyChan)

	// 5. Message pump
	var msg MSG
	for {
		ret, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}

	// 6. Cleanup
	pUnregisterHotKey.Call(hwnd, uintptr(ID_HOTKEY_RECENTER))
	pShellNotifyIconW.Call(NIM_DELETE, uintptr(unsafe.Pointer(&tm.nid)))
	tm.ready.Store(false)
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

func (tm *Manager) showContextMenu(hwnd uintptr) {
	var pt POINT
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	pSetForegroundWindow.Call(hwnd)

	hMenu, _, _ := pCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer pDestroyMenu.Call(hMenu)

	st := tm.status()
	isRu := st.Lang == "ru"
	hasPhone, phoneName, emuCount, profileName := st.Online, st.Device, st.Emulators, st.Profile

	var openStr, phoneStr, emuStr, profStr, quitStr string

	if isRu {
		openStr = "Открыть PhoneGyro"
		quitStr = "Выход"
		if hasPhone {
			phoneStr = fmt.Sprintf("📱 %s (Онлайн)", phoneName)
		} else {
			phoneStr = "📱 Телефон: Ожидание подключения"
		}
		if emuCount > 0 {
			emuStr = fmt.Sprintf("🎮 Эмуляторы: Подключен (%d)", emuCount)
		} else {
			emuStr = "🎮 Эмуляторы: Нет подключений"
		}
		profStr = fmt.Sprintf("⚡ Профиль: %s", profileName)
	} else {
		openStr = "Open PhoneGyro"
		quitStr = "Quit"
		if hasPhone {
			phoneStr = fmt.Sprintf("📱 %s (Online)", phoneName)
		} else {
			phoneStr = "📱 Phone: Waiting for connection"
		}
		if emuCount > 0 {
			emuStr = fmt.Sprintf("🎮 Emulators: Connected (%d)", emuCount)
		} else {
			emuStr = "🎮 Emulators: No clients"
		}
		profStr = fmt.Sprintf("⚡ Profile: %s", profileName)
	}

	// Append Menu Items
	appendMenuItem(hMenu, MF_STRING, ID_TRAY_OPEN, openStr)
	appendMenuItem(hMenu, MF_SEPARATOR, 0, "")
	appendMenuItem(hMenu, MF_GRAYED|MF_DISABLED, ID_TRAY_PHONE, phoneStr)
	appendMenuItem(hMenu, MF_GRAYED|MF_DISABLED, ID_TRAY_EMU, emuStr)
	appendMenuItem(hMenu, MF_GRAYED|MF_DISABLED, ID_TRAY_PROFILE, profStr)
	appendMenuItem(hMenu, MF_SEPARATOR, 0, "")
	appendMenuItem(hMenu, MF_STRING, ID_TRAY_QUIT, quitStr)

	cmd, _, _ := pTrackPopupMenu.Call(
		hMenu,
		TPM_BOTTOMALIGN|TPM_RIGHTALIGN|TPM_RETURNCMD,
		uintptr(pt.X),
		uintptr(pt.Y),
		0,
		hwnd,
		0,
	)

	switch cmd {
	case ID_TRAY_OPEN:
		tm.cb.Show()
	case ID_TRAY_QUIT:
		tm.cb.Quit()
	}
}

// status is Callbacks.Status with the device name defaulted.
func (tm *Manager) status() Status {
	st := tm.cb.Status()
	if st.Device == "" {
		st.Device = "iPhone"
	}
	return st
}

func appendMenuItem(hMenu uintptr, flags uint32, id uint32, text string) {
	if text == "" && flags&MF_SEPARATOR != 0 {
		pAppendMenuW.Call(hMenu, uintptr(flags), uintptr(id), 0)
		return
	}
	textPtr, _ := syscall.UTF16PtrFromString(text)
	pAppendMenuW.Call(hMenu, uintptr(flags), uintptr(id), uintptr(unsafe.Pointer(textPtr)))
}

func (tm *Manager) updateLoop() {
	ticker := time.NewTicker(800 * time.Millisecond)
	defer ticker.Stop()

	tm.refresh()

	for {
		select {
		case <-tm.stopChan:
			return
		case <-ticker.C:
			tm.refresh()
		}
	}
}

// UpdateState immediately refreshes the tray icon and menu state.
func (tm *Manager) UpdateState() {
	tm.refresh()
}

func (tm *Manager) refresh() {
	if !tm.ready.Load() || tm.hwnd == 0 {
		return
	}

	st := tm.status()
	hasPhone, phoneName, emuCount, profileName, lang := st.Online, st.Device, st.Emulators, st.Profile, st.Lang

	stateChanged := tm.lastOnline != hasPhone ||
		tm.lastPhone != phoneName ||
		tm.lastEmuCount != emuCount ||
		tm.lastProfile != profileName ||
		tm.lastLang != lang

	if !stateChanged {
		return
	}

	tm.lastOnline = hasPhone
	tm.lastPhone = phoneName
	tm.lastEmuCount = emuCount
	tm.lastProfile = profileName
	tm.lastLang = lang

	isRu := lang == "ru"

	// Select icon
	var iconToSet uintptr
	if hasPhone && tm.hIconOnline != 0 {
		iconToSet = tm.hIconOnline
	} else if tm.hIconOffline != 0 {
		iconToSet = tm.hIconOffline
	}

	// Select tooltip
	var tipText string
	if isRu {
		if hasPhone {
			tipText = fmt.Sprintf("PhoneGyro — %s (Онлайн)", phoneName)
		} else {
			tipText = "PhoneGyro — Ожидание подключения"
		}
	} else {
		if hasPhone {
			tipText = fmt.Sprintf("PhoneGyro — %s (Online)", phoneName)
		} else {
			tipText = "PhoneGyro — Waiting for connection"
		}
	}

	tm.nidMu.Lock()
	defer tm.nidMu.Unlock()

	tm.nid.UFlags = NIF_ICON | NIF_TIP
	if iconToSet != 0 {
		tm.nid.HIcon = iconToSet
	}
	tipUTF16, _ := syscall.UTF16FromString(tipText)
	copy(tm.nid.SzTip[:], tipUTF16)

	pShellNotifyIconW.Call(NIM_MODIFY, uintptr(unsafe.Pointer(&tm.nid)))
}
