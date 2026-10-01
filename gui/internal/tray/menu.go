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
	pExcludeClipRect         = syscall.NewLazyDLL("gdi32.dll").NewProc("ExcludeClipRect")
	pGetDpiForMonitor        = syscall.NewLazyDLL("shcore.dll").NewProc("GetDpiForMonitor")
	pMonitorFromPoint        = user32.NewProc("MonitorFromPoint")
	pGdipTranslateWorldTrans = gdiplus.NewProc("GdipTranslateWorldTransform")
	setAppMode               uintptr
	flushMenuThemes          uintptr
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
	glyphChevron = ""
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
		return 256, 36
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
func buildItems(st Status) []*menuItem {
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
		dsu.chevron, dsu.enabled = true, true
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
	pSetForegroundWindow.Call(hwnd)

	hMenu, _, _ := pCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer pDestroyMenu.Call(hMenu)

	st := tm.status()
	st.Clients = tm.cb.Clients()
	applyMenuTheme(st.Theme)
	sess := startGdip()
	if sess == nil {
		return
	}
	defer sess.close()
	tm.menuGdip, tm.menuScale, tm.menuBg = sess, dpiAt(pt), 0
	tm.menuPal = paletteFor(st.Theme, st.Accent)
	items := buildItems(st)
	tm.menu = nil
	defer func() { tm.menu, tm.menuGdip = nil, nil }()

	// An item's index in tm.menu is its owner-draw data (+1); children follow their parent.
	add := func(m uintptr, it *menuItem) {
		tm.menu = append(tm.menu, it)
		idx := len(tm.menu) - 1
		flags := uint32(0)
		if !it.enabled {
			flags |= MF_GRAYED | MF_DISABLED
		}
		if len(it.children) > 0 {
			sub, _, _ := pCreatePopupMenu.Call()
			for _, ch := range it.children {
				tm.menu = append(tm.menu, ch)
				appendOwner(sub, MF_GRAYED|MF_DISABLED, 0, len(tm.menu)-1)
			}
			pAppendMenuW.Call(m, uintptr(flags|mfOwnerDraw|mfPopup), sub, uintptr(idx+1))
			return
		}
		appendOwner(m, flags, it.id, idx)
	}
	add(hMenu, items[0])
	add(hMenu, items[1])
	add(hMenu, items[2])
	add(hMenu, &menuItem{kind: kindSeparator})
	add(hMenu, items[3])
	add(hMenu, items[4])
	add(hMenu, &menuItem{kind: kindSeparator})
	add(hMenu, items[5])

	cmd, _, _ := pTrackPopupMenu.Call(hMenu, TPM_BOTTOMALIGN|TPM_RIGHTALIGN|TPM_RETURNCMD,
		uintptr(pt.X), uintptr(pt.Y), 0, hwnd, 0)
	// Without this the menu may not close on a click elsewhere (MSDN, TrackPopupMenu).
	pPostMessageW.Call(hwnd, wmNull, 0, 0)

	switch cmd {
	case ID_TRAY_OPEN:
		tm.cb.Show()
	case idTrayPause:
		tm.cb.Pause()
		tm.refresh()
	case ID_TRAY_QUIT:
		tm.cb.Quit()
	}
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
			c.text(glyphChevron, icons, 10, styleRegular, p.ink3, w-right-12, 0, 12, h, alignCenter, false)
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
		c.fillEllipse(16, h/2-3.5, 7, 7, it.dot)
		c.text(it.sub, body, 11, styleRegular, p.ink3, w-86-14, 0, 86, h, alignRight, false)
		c.text(it.title, semi, 13, styleRegular, p.ink, 32, 0, w-32-86-18, h, alignLeft, true)
	}
	if len(it.children) > 0 {
		// Windows draws its own black submenu arrow after the item; keep it off our colours.
		pExcludeClipRect.Call(d.hdc, uintptr(d.rc.right-int32(28*sc)), uintptr(d.rc.top), uintptr(d.rc.right), uintptr(d.rc.bottom))
	}
	return true
}
