package tray

import (
	"encoding/binary"
	"fmt"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

var (
	pCreateIconFromResourceEx = user32.NewProc("CreateIconFromResourceEx")
	pGetSystemMetrics         = user32.NewProc("GetSystemMetrics")
	pRegisterWindowMessageW   = user32.NewProc("RegisterWindowMessageW")
	pDestroyIcon              = user32.NewProc("DestroyIcon")
)

const (
	smCxSmIcon      = 49
	wmMouseMove     = 0x0200
	tipEvery        = time.Second // the hover tooltip is rebuilt at most this often
	trayRefreshTick = 800 * time.Millisecond
)

// iconFromICO builds a tray icon straight from the embedded .ico (no temp
// files): the image closest to the system's small-icon size.
func iconFromICO(ico []byte) uintptr {
	if len(ico) < 22 {
		return 0
	}
	want, _, _ := pGetSystemMetrics.Call(smCxSmIcon)
	if want == 0 {
		want = 16
	}
	n := int(binary.LittleEndian.Uint16(ico[4:6]))
	best, bestSize := -1, 0
	for i := 0; i < n && 6+16*(i+1) <= len(ico); i++ {
		e := ico[6+16*i:]
		sz := int(e[0])
		if sz == 0 {
			sz = 256
		}
		if best < 0 || (bestSize < int(want) && sz > bestSize) || (sz >= int(want) && sz < bestSize) {
			best, bestSize = i, sz
		}
	}
	if best < 0 {
		return 0
	}
	e := ico[6+16*best:]
	size := binary.LittleEndian.Uint32(e[8:12])
	off := binary.LittleEndian.Uint32(e[12:16])
	if uint64(off)+uint64(size) > uint64(len(ico)) {
		return 0
	}
	h, _, _ := pCreateIconFromResourceEx.Call(uintptr(unsafe.Pointer(&ico[off])), uintptr(size), 1, 0x00030000,
		uintptr(bestSize), uintptr(bestSize), 0)
	return h
}

func (tm *Manager) loadIcons() {
	for i, b := range [iconCount][]byte{iconOffline: trayIconOfflineBytes, iconOnline: trayIconOnlineBytes, iconPaused: trayIconPausedBytes} {
		if tm.icons[i] != 0 {
			pDestroyIcon.Call(tm.icons[i])
		}
		tm.icons[i] = iconFromICO(b)
	}
}

func (st Status) iconIndex() int {
	switch {
	case st.Online && st.Paused:
		return iconPaused
	case st.Online:
		return iconOnline
	}
	return iconOffline
}

func (tm *Manager) trayLoop(readyChan chan struct{}) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	tm.loadIcons()
	tm.currentIcon = tm.icons[iconOffline]
	msgName, _ := syscall.UTF16PtrFromString("TaskbarCreated")
	m, _, _ := pRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(msgName)))
	tm.taskbarMsg = uint32(m)

	hInstance, _, _ := pGetModuleHandleW.Call(0)
	className, _ := syscall.UTF16PtrFromString(fmt.Sprintf("PhoneGyroTray_%d", time.Now().UnixNano()))

	wndProcCallback := syscall.NewCallback(func(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
		if msg == tm.taskbarMsg && msg != 0 {
			tm.readd()
			return 0
		}
		switch msg {
		case WM_TRAYICON:
			switch lParam {
			case WM_LBUTTONUP:
				tm.onLeftClick(hwnd)
				return 0
			case WM_LBUTTONDBLCLK:
				tm.cb.Show()
				return 0
			case WM_RBUTTONUP:
				tm.showContextMenu(hwnd)
				return 0
			case wmMouseMove:
				tm.refreshTip(false)
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

	hwnd, _, _ := pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(className)),
		0, 0, 0, 0, 0, 0, 0, hInstance, 0)
	tm.hwnd = hwnd

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
	tm.applyHotkey(hwnd)
	close(readyChan)

	var msg MSG
	for {
		ret, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}

	pUnregisterHotKey.Call(hwnd, uintptr(ID_HOTKEY_RECENTER))
	pShellNotifyIconW.Call(NIM_DELETE, uintptr(unsafe.Pointer(&tm.nid)))
	for _, h := range tm.icons {
		if h != 0 {
			pDestroyIcon.Call(h)
		}
	}
	tm.ready.Store(false)
}

// readd puts the icon back after explorer.exe restarted (the taskbar was recreated).
func (tm *Manager) readd() {
	tm.nidMu.Lock()
	defer tm.nidMu.Unlock()
	tm.nid.UFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
	pShellNotifyIconW.Call(NIM_ADD, uintptr(unsafe.Pointer(&tm.nid)))
}

// onLeftClick is wired in popup.go.
func (tm *Manager) onLeftClick(hwnd uintptr) { tm.cb.Show() }

// status is Callbacks.Status with the device name defaulted.
func (tm *Manager) status() Status {
	st := tm.cb.Status()
	if st.Device == "" {
		st.Device = "iPhone"
	}
	return st
}

func (tm *Manager) updateLoop() {
	ticker := time.NewTicker(trayRefreshTick)
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
func (tm *Manager) UpdateState() { tm.refresh() }

// tr picks the string for the app's language.
func tr(lang, ru, en string) string {
	if lang == "ru" {
		return ru
	}
	return en
}

// tooltip is what the icon says on hover (Windows cuts it at 127 characters).
func tooltip(st Status) string {
	switch {
	case !st.Online:
		return tr(st.Lang, "PhoneGyro — ожидание подключения", "PhoneGyro — waiting for connection")
	case st.Paused:
		return fmt.Sprintf("PhoneGyro — %s · %s", st.Device, tr(st.Lang, "пауза", "paused"))
	}
	t := fmt.Sprintf("PhoneGyro — %s", st.Device)
	if st.Hz > 0 {
		t += fmt.Sprintf(" · %.0f %s", st.Hz, tr(st.Lang, "Гц", "Hz"))
	}
	if st.PingMs >= 0 {
		t += fmt.Sprintf(" · %d %s", st.PingMs, tr(st.Lang, "мс", "ms"))
	}
	t += fmt.Sprintf(" · %s: %d", tr(st.Lang, "эмуляторов", "emulators"), st.Emulators)
	return t
}

// setIconAndTip pushes the icon and tooltip to the shell.
func (tm *Manager) setIconAndTip(st Status) {
	tm.nidMu.Lock()
	defer tm.nidMu.Unlock()
	tm.nid.UFlags = NIF_ICON | NIF_TIP
	if h := tm.icons[st.iconIndex()]; h != 0 {
		tm.nid.HIcon = h
	}
	for i := range tm.nid.SzTip {
		tm.nid.SzTip[i] = 0
	}
	tip, _ := syscall.UTF16FromString(tooltip(st))
	if len(tip) > len(tm.nid.SzTip)-1 {
		tip = append(tip[:len(tm.nid.SzTip)-1], 0)
	}
	copy(tm.nid.SzTip[:], tip)
	pShellNotifyIconW.Call(NIM_MODIFY, uintptr(unsafe.Pointer(&tm.nid)))
}

// refreshTip rebuilds the tooltip with live numbers; only when the pointer is
// over the icon (no timer), at most once a second.
func (tm *Manager) refreshTip(force bool) {
	if !tm.ready.Load() || (!force && time.Since(tm.lastTipAt) < tipEvery) {
		return
	}
	tm.lastTipAt = time.Now()
	tm.setIconAndTip(tm.status())
}

func (tm *Manager) refresh() {
	if !tm.ready.Load() || tm.hwnd == 0 {
		return
	}
	st := tm.status()
	if tm.lastOnline == st.Online && tm.lastPaused == st.Paused && tm.lastPhone == st.Device &&
		tm.lastEmuCount == st.Emulators && tm.lastProfile == st.Profile && tm.lastLang == st.Lang {
		return
	}
	tm.lastOnline, tm.lastPaused, tm.lastPhone = st.Online, st.Paused, st.Device
	tm.lastEmuCount, tm.lastProfile, tm.lastLang = st.Emulators, st.Profile, st.Lang
	tm.setIconAndTip(st)
}
