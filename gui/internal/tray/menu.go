package tray

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The right-click menu. A native Windows menu (so it keeps the system frame,
// shadow, rounded corners and keyboard handling) whose items are owner-drawn
// with GDI+: a device card, the profile, the DSU clients (a submenu), and the
// actions. It follows the app's theme and accent. GDI+ runs only while the menu
// is open; nothing is kept afterwards.
//
// The system switches to a dark menu frame through uxtheme's undocumented
// ordinals 135 / 136 (Windows 10 1903+); where they are missing the frame is
// the system's own.

const (
	mfOwnerDraw = 0x00000100
	mfPopup     = 0x00000010
	wmNull      = 0x0000
	wmMeasureItem = 0x002C
	wmDrawItem    = 0x002B
	odsSelected   = 0x0001
	odtMenu       = 1
	idTrayPause   = 1007
	idTrayDSU     = 1008
	tpmNoAnimation = 0x4000
)

type measureItemStruct struct {
	ctlType, ctlID, itemID uint32
	itemWidth, itemHeight  uint32
	itemData               uintptr
}

type drawItemStruct struct {
	ctlType, ctlID, itemID uint32
	itemAction, itemState  uint32
	hwndItem               uintptr
	hdc                    uintptr
	rc                     rectI
	itemData               uintptr
}

type rectI struct{ left, top, right, bottom int32 }

var (
	pGetDpiForMonitor        = syscall.NewLazyDLL("shcore.dll").NewProc("GetDpiForMonitor")
	pMonitorFromPoint        = user32.NewProc("MonitorFromPoint")
	pGdipTranslateWorldTrans = gdiplus.NewProc("GdipTranslateWorldTransform")
	setAppMode            uintptr
	flushMenuThemes       uintptr
	allowDarkModeForWin   uintptr // uxtheme ordinal 133: AllowDarkModeForWindow
)

func init() {
	if h, err := windows.LoadLibrary("uxtheme.dll"); err == nil {
		setAppMode, _ = windows.GetProcAddressByOrdinal(h, 135)
		flushMenuThemes, _ = windows.GetProcAddressByOrdinal(h, 136)
		allowDarkModeForWin, _ = windows.GetProcAddressByOrdinal(h, 133)
	}
}

// applyMenuTheme switches the system menus of this process to dark or light.
// menuThemeMode is the system menu mode asked for: always dark.
var menuThemeMode = "dark"

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

// applyDarkModeToWindow pins dark-mode to a specific HWND (uxtheme ordinal 133).
// This survives process-wide resets from WebView2 / Wails when the app theme changes.
func applyDarkModeToWindow(hwnd uintptr) {
	if allowDarkModeForWin != 0 {
		syscall.SyscallN(allowDarkModeForWin, hwnd, 1) // 1 = allow/force dark
	}
	if flushMenuThemes != 0 {
		syscall.SyscallN(flushMenuThemes)
	}
}


type menuKind int

const (
	kindHeader menuKind = iota
	kindInfo
	kindAction
	kindClient
	kindSeparator
)

// Segoe Fluent Icons / Segoe MDL2 Assets code points.
const (
	glyphPhone   = ""
	glyphPad     = ""
	glyphList    = ""
	glyphOpen    = ""
	glyphPause   = ""
	glyphPlay    = ""
	glyphPower   = ""
	glyphChevron = "" // down; up () while the client list is open
	glyphChevUp  = ""
)

type menuItem struct {
	kind     menuKind
	glyph    string
	label    string // small caption (info rows)
	title    string // the main text
	sub      string // second line (header) or right-hand text (client)
	dot      uint32 // status dot colour, 0 = none
	chevron  bool
	enabled  bool
	danger   bool // turns red when hovered
	primary  bool // the default action: accent glyph
	ok       bool // header: the device is online (accent chip)
	open     bool // the DSU row: its client list is unfolded
	id       uint32
	children []*menuItem
}

func (it *menuItem) size() (w, h float32) {
	switch it.kind {
	case kindHeader:
		return 268, 64
	case kindInfo:
		return 268, 46
	case kindClient:
		return 268, 36
	case kindSeparator:
		return 268, 9
	}
	return 268, 40
}

// dpiAt is the effective DPI of the monitor under the point.
func dpiAt(pt POINT) float32 {
	mon, _, _ := pMonitorFromPoint.Call(uintptr(uint32(pt.X))|uintptr(uint32(pt.Y))<<32, 2)
	var dx, dy uint32
	if r, _, _ := pGetDpiForMonitor.Call(mon, 0, uintptr(unsafe.Pointer(&dx)), uintptr(unsafe.Pointer(&dy))); r == 0 && dx != 0 {
		return float32(dx) / 96
	}
	return 1
}

func appendOwner(hMenu uintptr, flags uint32, id uint32, data int) {
	pAppendMenuW.Call(hMenu, uintptr(flags|mfOwnerDraw), uintptr(id), uintptr(data+1))
}

// buildItems is the menu's content for the status.
func buildItems(st Status, dsuOpen bool) []*menuItem {
	l := st.Lang
	p := paletteFor(st.Theme, st.Accent)

	head := &menuItem{kind: kindHeader, glyph: glyphPhone, ok: st.Online && !st.Paused}
	if st.Mode == "usb" {
		head.glyph = glyphPad
	}
	switch {
	case !st.Online:
		head.title = tr(l, "Нет устройства", "No device")
		head.sub = tr(l, "Ожидание подключения", "Waiting for connection")
		head.dot = p.danger
	case st.Paused:
		head.title, head.dot = st.Device, p.warn
		head.sub = tr(l, "Пауза", "Paused")
	default:
		head.title, head.dot = st.Device, p.accent
		head.sub = tr(l, "Онлайн", "Online")
		if st.Hz > 0 {
			head.sub += fmt.Sprintf(" · %.0f %s", st.Hz, tr(l, "Гц", "Hz"))
		}
		if st.PingMs >= 0 {
			head.sub += fmt.Sprintf(" · %d %s", st.PingMs, tr(l, "мс", "ms"))
		}
	}

	prof := &menuItem{kind: kindInfo, glyph: glyphList, label: tr(l, "Профиль", "Profile"), title: st.Profile}
	if prof.title == "" {
		prof.title = "—"
	}

	dsu := &menuItem{kind: kindInfo, glyph: glyphPad, label: tr(l, "Эмуляторы (DSU)", "Emulators (DSU)")}
	if n := len(st.Clients); n == 0 {
		dsu.title, dsu.dot = tr(l, "Нет клиентов", "No clients"), p.warn
	} else {
		dsu.title = fmt.Sprintf(tr(l, "Подключено: %d", "Connected: %d"), n)
		dsu.chevron, dsu.enabled, dsu.id, dsu.open = true, true, idTrayDSU, dsuOpen
		for _, c := range st.Clients {
			ch := &menuItem{kind: kindClient, title: c.Name, dot: p.accent, sub: tr(l, "активен", "active")}
			if !c.Active {
				ch.dot, ch.sub = p.warn, tr(l, "ожидает", "idle")
			}
			dsu.children = append(dsu.children, ch)
		}
	}

	open := &menuItem{kind: kindAction, glyph: glyphOpen, title: tr(l, "Открыть PhoneGyro", "Open PhoneGyro"), enabled: true, primary: true, id: ID_TRAY_OPEN}
	pause := &menuItem{kind: kindAction, glyph: glyphPause, title: tr(l, "Пауза", "Pause"), enabled: st.Online, id: idTrayPause}
	if st.Paused {
		pause.glyph, pause.title = glyphPlay, tr(l, "Продолжить", "Resume")
	}
	quit := &menuItem{kind: kindAction, glyph: glyphPower, title: tr(l, "Выход", "Quit"), enabled: true, danger: true, id: ID_TRAY_QUIT}
	return []*menuItem{head, prof, dsu, open, pause, quit}
}

func (tm *Manager) showContextMenu(hwnd uintptr) {
	var pt POINT
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	tm.dsuOpen = false

	st := tm.status()
	st.Clients = tm.cb.Clients()
	// Always dark, whatever the app's theme (the system switch is best effort; the
	// frame hook below makes the result the same when it does not take).
	applyMenuTheme(menuThemeMode)
	applyDarkModeToWindow(hwnd)
	sess := startGdip()
	if sess == nil {
		return
	}
	defer sess.close()
	tm.menuGdip, tm.menuScale, tm.menuBg = sess, dpiAt(pt), 0
	tm.menuPal = paletteFor("dark", st.Accent)
	defer func() { tm.menu, tm.menuGdip = nil, nil }()
	setFrameColors(tm.menuPal.raised, blend(tm.menuPal.raised, tm.menuPal.ink, 0.12), int32(268*tm.menuScale))

	flags := uint32(TPM_BOTTOMALIGN | TPM_RIGHTALIGN | TPM_RETURNCMD)
	for {
		cmd := tm.trackOnce(hwnd, st, pt, flags)
		if cmd == idTrayDSU {
			// "Dropdown": unfold or fold the client list and show the menu again in place.
			tm.dsuOpen = !tm.dsuOpen
			flags |= tpmNoAnimation
			continue
		}
		switch cmd {
		case ID_TRAY_OPEN:
			tm.cb.Show()
		case idTrayPause:
			tm.cb.Pause()
			tm.refresh()
		case ID_TRAY_QUIT:
			tm.cb.Quit()
		}
		return
	}
}

// trackOnce builds the menu for the current fold state and shows it; it returns the chosen command.
func (tm *Manager) trackOnce(hwnd uintptr, st Status, pt POINT, flags uint32) uintptr {
	pSetForegroundWindow.Call(hwnd)
	hMenu, _, _ := pCreatePopupMenu.Call()
	if hMenu == 0 {
		return 0
	}
	defer pDestroyMenu.Call(hMenu)
	items := buildItems(st, tm.dsuOpen)
	tm.menu = nil

	// An item's index in tm.menu is its owner-draw data (+1).
	add := func(it *menuItem) {
		tm.menu = append(tm.menu, it)
		fl := uint32(0)
		if !it.enabled {
			fl |= MF_GRAYED | MF_DISABLED
		}
		appendOwner(hMenu, fl, it.id, len(tm.menu)-1)
	}
	sep := func() { add(&menuItem{kind: kindSeparator}) }
	add(items[0])
	add(items[1])
	add(items[2])
	if tm.dsuOpen {
		for _, ch := range items[2].children {
			add(ch)
		}
	}
	sep()
	add(items[3])
	add(items[4])
	sep()
	add(items[5])

	cmd, _, _ := pTrackPopupMenu.Call(hMenu, uintptr(flags), uintptr(pt.X), uintptr(pt.Y), 0, hwnd, 0)
	// Without this the menu may not close on a click elsewhere (MSDN, TrackPopupMenu).
	pPostMessageW.Call(hwnd, wmNull, 0, 0)
	return cmd
}

// ptrOf is the structure a window message's lParam points to.
func ptrOf(lParam uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&lParam)) }

func (tm *Manager) item(data uintptr) *menuItem {
	i := int(data) - 1
	if i < 0 || i >= len(tm.menu) {
		return nil
	}
	return tm.menu[i]
}

// measureItem answers WM_MEASUREITEM for the open menu.
func (tm *Manager) measureItem(lParam uintptr) bool {
	m := (*measureItemStruct)(ptrOf(lParam))
	if m.ctlType != odtMenu {
		return false
	}
	it := tm.item(m.itemData)
	if it == nil || tm.menuGdip == nil {
		return false
	}
	w, h := it.size()
	m.itemWidth = uint32(w * tm.menuScale)
	m.itemHeight = uint32(h * tm.menuScale)
	return true
}

// drawItem answers WM_DRAWITEM for the open menu.
func (tm *Manager) drawItem(lParam uintptr) bool {
	d := (*drawItemStruct)(ptrOf(lParam))
	if d.ctlType != odtMenu {
		return false
	}
	it := tm.item(d.itemData)
	if it == nil || tm.menuGdip == nil {
		return false
	}
	adoptMenuWindow(d.hdc)
	sc := tm.menuScale
	p := tm.menuPal
	bg := p.raised // the whole menu is drawn in the app's own colours, whatever frame the system gives it
	w := float32(d.rc.right-d.rc.left) / sc
	h := float32(d.rc.bottom-d.rc.top) / sc

	c := tm.menuGdip.canvasForDC(d.hdc, sc)
	defer c.close()
	pGdipTranslateWorldTrans.Call(c.g, fl(float32(d.rc.left)), fl(float32(d.rc.top)), 0)

	body := c.s.pick("Segoe UI Variable Text", "Segoe UI")
	semi := c.s.pick("Segoe UI Semibold", "Segoe UI")
	icons := c.s.pick("Segoe Fluent Icons", "Segoe MDL2 Assets")

	c.fillRect(0, 0, w, h, bg)
	hot := d.itemState&odsSelected != 0 && it.enabled
	if hot {
		k := float32(0.10)
		if !p.dark {
			k = 0.07
		}
		hoverCol := blend(bg, p.ink, k)
		if it.danger {
			hoverCol = blend(bg, p.danger, 0.20)
		}
		c.fillRRect(5, 2, w-10, h-4, 8, hoverCol)
	}
	dim := float32(1)
	if !it.enabled && it.kind == kindAction {
		dim = 0.45
	}

	switch it.kind {
	case kindHeader:
		chip, glyph := withAlpha(p.ink, 0.07), p.ink3
		if it.ok {
			chip, glyph = withAlpha(p.accent, 0.16), p.accent
		}
		c.fillRRect(14, 12, 40, 40, 12, blend(bg, chip, float32(chip>>24)/255))
		c.text(it.glyph, icons, 19, styleRegular, glyph, 14, 12, 40, 40, alignCenter, false)
		c.text(it.title, semi, 14.5, styleRegular, p.ink, 64, 12, w-64-14, 21, alignLeft, true)
		x := float32(64)
		if it.dot != 0 {
			c.fillEllipse(64, 38, 7, 7, it.dot)
			x = 76
		}
		c.text(it.sub, body, 12, styleRegular, p.ink2, x, 32, w-x-14, 19, alignLeft, true)

	case kindInfo:
		c.fillRRect(14, 9, 28, 28, 8, blend(bg, p.ink, 0.07))
		c.text(it.glyph, icons, 14, styleRegular, p.ink2, 14, 9, 28, 28, alignCenter, false)
		right := float32(14)
		if it.chevron {
			chev := glyphChevron
			if it.open {
				chev = glyphChevUp
			}
			c.text(chev, icons, 10, styleRegular, p.ink3, w-right-12, 0, 12, h, alignCenter, false)
			right = 34
		} else if it.dot != 0 {
			c.fillEllipse(w-right-8, h/2-4, 8, 8, it.dot)
			right = 34
		}
		c.text(it.label, body, 11, styleRegular, p.ink3, 52, 6, w-52-right, 15, alignLeft, true)
		c.text(it.title, semi, 13, styleRegular, p.ink, 52, 21, w-52-right, 19, alignLeft, true)

	case kindAction:
		col, ink := p.ink2, p.ink
		if it.primary {
			col = p.accent
		}
		if hot && it.danger {
			col, ink = p.danger, p.danger
		}
		c.text(it.glyph, icons, 16, styleRegular, blend(bg, col, dim), 14, 0, 24, h, alignCenter, false)
		c.text(it.title, semi, 13.5, styleRegular, blend(bg, ink, dim), 48, 0, w-48-14, h, alignLeft, true)

	case kindSeparator:
		c.line(12, h/2, w-12, h/2, 1, blend(bg, p.ink, 0.14))

	case kindClient:
		c.fillEllipse(22, h/2-3.5, 7, 7, it.dot)
		c.text(it.sub, body, 11, styleRegular, p.ink3, w-86-14, 0, 86, h, alignRight, false)
		c.text(it.title, semi, 13, styleRegular, p.ink, 38, 0, w-38-86-18, h, alignLeft, true)
	}
	return true
}
