package tray

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The plain menu (right click): the fallback next to the panel (popup.go). It
// follows the app theme through uxtheme's undocumented dark-menu switches
// (ordinals 135 / 136, Windows 10 1903+); where they are missing the menu is
// simply the system's.

const (
	mfsDefault    = 0x00001000 // MFS_DEFAULT: the bold item (what a double click does)
	miimState     = 0x00000001
	wmNull        = 0x0000
	idTrayRecentr = 1006
)

type menuItemInfo struct {
	cbSize        uint32
	fMask         uint32
	fType         uint32
	fState        uint32
	wID           uint32
	hSubMenu      uintptr
	hbmpChecked   uintptr
	hbmpUnchecked uintptr
	dwItemData    uintptr
	dwTypeData    *uint16
	cch           uint32
	hbmpItem      uintptr
}

var (
	pSetMenuItemInfoW = user32.NewProc("SetMenuItemInfoW")
	setAppMode        uintptr
	flushMenuThemes   uintptr
)

func init() {
	if h, err := windows.LoadLibrary("uxtheme.dll"); err == nil {
		setAppMode, _ = windows.GetProcAddressByOrdinal(h, 135)
		flushMenuThemes, _ = windows.GetProcAddressByOrdinal(h, 136)
	}
}

// applyMenuTheme switches the system menus of this process to dark or light.
func applyMenuTheme(theme string) {
	if setAppMode == 0 {
		return
	}
	mode := uintptr(3) // ForceLight
	if theme == "dark" {
		mode = 2 // ForceDark
	}
	syscall.SyscallN(setAppMode, mode)
	if flushMenuThemes != 0 {
		syscall.SyscallN(flushMenuThemes)
	}
}

func appendMenuItem(hMenu uintptr, flags uint32, id uint32, text string) {
	if text == "" && flags&MF_SEPARATOR != 0 {
		pAppendMenuW.Call(hMenu, uintptr(flags), uintptr(id), 0)
		return
	}
	textPtr, _ := syscall.UTF16PtrFromString(text)
	pAppendMenuW.Call(hMenu, uintptr(flags), uintptr(id), uintptr(unsafe.Pointer(textPtr)))
}

func setMenuDefault(hMenu uintptr, id uint32) {
	mi := menuItemInfo{fMask: miimState, fState: mfsDefault}
	mi.cbSize = uint32(unsafe.Sizeof(mi))
	pSetMenuItemInfoW.Call(hMenu, uintptr(id), 0, uintptr(unsafe.Pointer(&mi)))
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
	applyMenuTheme(st.Theme)
	l := st.Lang

	phone := tr(l, "Телефон: ожидание подключения", "Phone: waiting for connection")
	if st.Online {
		phone = fmt.Sprintf("%s — %s", st.Device, tr(l, "онлайн", "online"))
		if st.Paused {
			phone = fmt.Sprintf("%s — %s", st.Device, tr(l, "пауза", "paused"))
		}
	}
	emu := tr(l, "Эмуляторы: нет подключений", "Emulators: no clients")
	if st.Emulators > 0 {
		emu = fmt.Sprintf(tr(l, "Эмуляторы: подключено (%d)", "Emulators: connected (%d)"), st.Emulators)
	}
	prof := fmt.Sprintf("%s: %s", tr(l, "Профиль", "Profile"), st.Profile)

	appendMenuItem(hMenu, MF_STRING, ID_TRAY_OPEN, tr(l, "Открыть PhoneGyro", "Open PhoneGyro"))
	setMenuDefault(hMenu, ID_TRAY_OPEN)
	recFlags := uint32(MF_STRING)
	if !st.Online {
		recFlags |= MF_GRAYED
	}
	appendMenuItem(hMenu, recFlags, idTrayRecentr, tr(l, "Центрировать", "Recenter"))
	appendMenuItem(hMenu, MF_SEPARATOR, 0, "")
	appendMenuItem(hMenu, MF_GRAYED|MF_DISABLED, ID_TRAY_PHONE, phone)
	appendMenuItem(hMenu, MF_GRAYED|MF_DISABLED, ID_TRAY_EMU, emu)
	appendMenuItem(hMenu, MF_GRAYED|MF_DISABLED, ID_TRAY_PROFILE, prof)
	appendMenuItem(hMenu, MF_SEPARATOR, 0, "")
	appendMenuItem(hMenu, MF_STRING, ID_TRAY_QUIT, tr(l, "Выход", "Quit"))

	cmd, _, _ := pTrackPopupMenu.Call(hMenu, TPM_BOTTOMALIGN|TPM_RIGHTALIGN|TPM_RETURNCMD,
		uintptr(pt.X), uintptr(pt.Y), 0, hwnd, 0)
	// Without this the menu may not close on a click elsewhere (MSDN, TrackPopupMenu).
	pPostMessageW.Call(hwnd, wmNull, 0, 0)

	switch cmd {
	case ID_TRAY_OPEN:
		tm.cb.Show()
	case idTrayRecentr:
		tm.cb.Recenter()
	case ID_TRAY_QUIT:
		tm.cb.Quit()
	}
}
