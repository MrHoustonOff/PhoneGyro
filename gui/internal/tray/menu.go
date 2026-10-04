package tray

import (
	"fmt"
	"syscall"
	"unsafe"
)

// The right-click menu is a plain Windows popup menu: system font, system
// colours, the system's own light or dark look. Nothing is drawn by hand.

var pSetMenuDefaultItem = user32.NewProc("SetMenuDefaultItem")

const idTrayPause = 1006

func (tm *Manager) showContextMenu(hwnd uintptr) {
	var pt POINT
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	// Without this the menu does not close when the user clicks elsewhere.
	pSetForegroundWindow.Call(hwnd)

	hMenu, _, _ := pCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer pDestroyMenu.Call(hMenu)

	st := tm.status()
	l := st.Lang
	device := tr(l, "Телефон: ожидание подключения", "Phone: waiting for connection")
	if st.Mode == "usb" {
		device = tr(l, "USB-контроллер: ожидание подключения", "USB controller: waiting for connection")
	}
	if st.Online {
		device = fmt.Sprintf("%s — %s", st.Device, tr(l, "онлайн", "online"))
		if st.Paused {
			device = fmt.Sprintf("%s — %s", st.Device, tr(l, "пауза", "paused"))
		}
	}
	profile := tr(l, "Профиль: не выбран", "Profile: none")
	if st.Profile != "" {
		profile = fmt.Sprintf("%s: %s", tr(l, "Профиль", "Profile"), st.Profile)
	}

	appendMenuItem(hMenu, MF_STRING, ID_TRAY_OPEN, tr(l, "Открыть PhoneGyro", "Open PhoneGyro"))
	pSetMenuDefaultItem.Call(hMenu, ID_TRAY_OPEN, 0) // bold, like a double click on the icon
	appendMenuItem(hMenu, MF_SEPARATOR, 0, "")
	appendMenuItem(hMenu, MF_GRAYED, ID_TRAY_PHONE, device)
	if len(st.Emulators) == 0 {
		appendMenuItem(hMenu, MF_GRAYED, ID_TRAY_EMU, tr(l, "Эмуляторы: нет подключений", "Emulators: none"))
	} else {
		appendMenuItem(hMenu, MF_GRAYED, ID_TRAY_EMU, tr(l, "Эмуляторы:", "Emulators:"))
		for _, name := range st.Emulators {
			appendMenuItem(hMenu, MF_GRAYED, ID_TRAY_EMU, "    • "+name)
		}
	}
	appendMenuItem(hMenu, MF_GRAYED, ID_TRAY_PROFILE, profile)
	appendMenuItem(hMenu, MF_SEPARATOR, 0, "")
	if st.Online {
		pause := tr(l, "Пауза", "Pause")
		if st.Paused {
			pause = tr(l, "Продолжить", "Resume")
		}
		appendMenuItem(hMenu, MF_STRING, idTrayPause, pause)
	}
	appendMenuItem(hMenu, MF_STRING, ID_TRAY_QUIT, tr(l, "Выход", "Quit"))

	cmd, _, _ := pTrackPopupMenu.Call(hMenu, TPM_BOTTOMALIGN|TPM_RIGHTALIGN|TPM_RETURNCMD,
		uintptr(pt.X), uintptr(pt.Y), 0, hwnd, 0)
	switch cmd {
	case ID_TRAY_OPEN:
		tm.cb.Show()
	case idTrayPause:
		tm.cb.Pause()
	case ID_TRAY_QUIT:
		tm.cb.Quit()
	}
}

func appendMenuItem(hMenu uintptr, flags uint32, id uint32, text string) {
	if flags&MF_SEPARATOR != 0 {
		pAppendMenuW.Call(hMenu, uintptr(flags), uintptr(id), 0)
		return
	}
	p, _ := syscall.UTF16PtrFromString(text)
	pAppendMenuW.Call(hMenu, uintptr(flags), uintptr(id), uintptr(unsafe.Pointer(p)))
}
