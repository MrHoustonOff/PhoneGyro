package tray

import (
	_ "embed"
	"fmt"
	"math"
	"syscall"
	"time"
	"unsafe"
)

// The panel's window: a layered popup (per-pixel alpha, so the corners and the
// shadow are anti-aliased) created when the tray icon is clicked and destroyed
// as soon as it loses focus. It lives on the tray thread, so it costs nothing
// while closed: no WebView, no timers, no GDI+.

//go:embed fonts/Onest-Regular.ttf
var fontOnest []byte

//go:embed fonts/Onest-SemiBold.ttf
var fontOnestSemi []byte

//go:embed fonts/AlegreyaSans-ExtraBold.ttf
var fontAlegreya []byte

//go:embed fonts/JetBrainsMono-Regular.ttf
var fontMonoData []byte

//go:embed fonts/JetBrainsMono-SemiBold.ttf
var fontMonoSemiData []byte

var (
	gdi32   = syscall.NewLazyDLL("gdi32.dll")
	shcore  = syscall.NewLazyDLL("shcore.dll")

	pCreateDIBSection     = gdi32.NewProc("CreateDIBSection")
	pCreateCompatibleDC   = gdi32.NewProc("CreateCompatibleDC")
	pSelectObject         = gdi32.NewProc("SelectObject")
	pDeleteObject         = gdi32.NewProc("DeleteObject")
	pDeleteDC             = gdi32.NewProc("DeleteDC")
	pUpdateLayeredWindow  = user32.NewProc("UpdateLayeredWindow")
	pShowWindow           = user32.NewProc("ShowWindow")
	pSetTimer             = user32.NewProc("SetTimer")
	pKillTimer            = user32.NewProc("KillTimer")
	pSetCursor            = user32.NewProc("SetCursor")
	pLoadCursorW          = user32.NewProc("LoadCursorW")
	pMonitorFromPointPop  = user32.NewProc("MonitorFromPoint")
	pGetMonitorInfoPop    = user32.NewProc("GetMonitorInfoW")
	pGetForegroundWindow  = user32.NewProc("GetForegroundWindow")
	pTrackMouseEvent      = user32.NewProc("TrackMouseEvent")
	pGetDpiForMonitor     = shcore.NewProc("GetDpiForMonitor")
	pShellNotifyIconRect  = shell32.NewProc("Shell_NotifyIconGetRect")
	pGetDC                = user32.NewProc("GetDC")
	pReleaseDC            = user32.NewProc("ReleaseDC")
)

const (
	wsPopup         = 0x80000000
	wsExLayered     = 0x00080000
	wsExToolWindow  = 0x00000080
	wsExTopmost     = 0x00000008
	swShow          = 5
	wmTimer         = 0x0113
	wmMouseMovePop  = 0x0200
	wmMouseLeave    = 0x02A3
	wmLButtonUp     = 0x0202
	wmKeyDown       = 0x0100
	wmActivate      = 0x0006
	wmSetCursor     = 0x0020
	vkEscape        = 0x1B
	ulwAlpha        = 2
	tmeLeave        = 0x2
	idcHand         = 32649
	idcArrow        = 32512
	timerAnim       = 1
	timerRefresh    = 2
	animDuration    = 200 * time.Millisecond
	refreshEvery    = 1000
	reopenGuard     = 300 * time.Millisecond
	idProfileBase   = 3000
	mfChecked       = 0x8
	tpmReturnCmd    = 0x0100
	biRGB           = 0
	dibRGBColors    = 0
)

type rectI struct{ left, top, right, bottom int32 }

type notifyIconIdentifier struct {
	cbSize uint32
	hWnd   uintptr
	uID    uint32
	guid   [16]byte
}

type bitmapInfoHeader struct {
	size          uint32
	width, height int32
	planes        uint16
	bitCount      uint16
	compression   uint32
	sizeImage     uint32
	xppm, yppm    int32
	clrUsed       uint32
	clrImportant  uint32
}

type trackMouseEvent struct {
	cbSize      uint32
	flags       uint32
	hwndTrack   uintptr
	hoverTime   uint32
}

type popup struct {
	tm       *Manager
	hwnd     uintptr
	sess     *session
	cv       *canvas
	m        *panelModel
	hdc, hbm uintptr
	oldBmp   uintptr
	bits     unsafe.Pointer
	w, h     int32
	scale    float32
	x, y     int32 // final position of the window
	start    time.Time
	menuOpen bool
	tracking bool
}

var (
	cur         *popup // at most one panel exists
	popupClass  *uint16
	popupWndPrc uintptr
)

// onLeftClick toggles the panel.
func (tm *Manager) onLeftClick(hwnd uintptr) {
	if cur != nil {
		cur.close()
		return
	}
	if time.Since(tm.popClosedAt) < reopenGuard {
		return // the click that took the focus away has just closed it
	}
	tm.openPanel(hwnd)
}

func (tm *Manager) openPanel(owner uintptr) {
	st := tm.status()

	var anchor rectI
	id := notifyIconIdentifier{hWnd: tm.hwnd, uID: 1}
	id.cbSize = uint32(unsafe.Sizeof(id))
	if r, _, _ := pShellNotifyIconRect.Call(uintptr(unsafe.Pointer(&id)), uintptr(unsafe.Pointer(&anchor))); r != 0 {
		var pt POINT
		pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
		anchor = rectI{pt.X, pt.Y, pt.X, pt.Y}
	}
	acx, acy := (anchor.left+anchor.right)/2, (anchor.top+anchor.bottom)/2

	mon, _, _ := pMonitorFromPointPop.Call(packPoint(acx, acy), 2)
	var wa rectI
	mi := struct {
		size          uint32
		monitor, work rectI
		flags         uint32
	}{}
	mi.size = uint32(unsafe.Sizeof(mi))
	if r, _, _ := pGetMonitorInfoPop.Call(mon, uintptr(unsafe.Pointer(&mi))); r != 0 {
		wa = mi.work
	} else {
		wa = rectI{0, 0, 1920, 1040}
	}
	dpi := uint32(96)
	var dx, dy uint32
	if r, _, _ := pGetDpiForMonitor.Call(mon, 0, uintptr(unsafe.Pointer(&dx)), uintptr(unsafe.Pointer(&dy))); r == 0 && dx != 0 {
		dpi = dx
	}
	scale := float32(dpi) / 96

	p := &popup{tm: tm, scale: scale}
	p.w = int32(math.Ceil(float64(panelW+2*shadowM) * float64(scale)))
	p.h = int32(math.Ceil(float64(panelH+2*shadowM) * float64(scale)))
	gap := int32(8 * scale)
	margin := int32(shadowM * scale)

	// above the icon when the taskbar is at the bottom, below it when at the top
	p.x = acx - p.w/2
	if acy > (wa.top+wa.bottom)/2 {
		p.y = anchor.top - gap + margin - p.h
	} else {
		p.y = anchor.bottom + gap - margin
	}
	p.x = clamp32(p.x, wa.left+gap-margin, wa.right-gap+margin-p.w)
	p.y = clamp32(p.y, wa.top+gap-margin, wa.bottom-gap+margin-p.h)

	if !p.build(st) {
		return
	}
	if !registerPopupClass() {
		p.free()
		return
	}
	hInstance, _, _ := pGetModuleHandleW.Call(0)
	hwnd, _, _ := pCreateWindowExW.Call(wsExLayered|wsExToolWindow|wsExTopmost,
		uintptr(unsafe.Pointer(popupClass)), uintptr(unsafe.Pointer(popupClass)), wsPopup,
		uintptr(p.x), uintptr(p.y), uintptr(p.w), uintptr(p.h), 0, 0, hInstance, 0)
	if hwnd == 0 {
		p.free()
		return
	}
	p.hwnd = hwnd
	cur = p
	p.start = time.Now()
	p.present(0, int32(12*scale))
	pShowWindow.Call(hwnd, swShow)
	pSetForegroundWindow.Call(hwnd)
	pSetTimer.Call(hwnd, timerAnim, 15, 0)
	pSetTimer.Call(hwnd, timerRefresh, refreshEvery, 0)
}

func packPoint(x, y int32) uintptr { return uintptr(uint32(x)) | uintptr(uint32(y))<<32 }

func clamp32(v, lo, hi int32) int32 {
	if hi < lo {
		return lo
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func registerPopupClass() bool {
	if popupClass != nil {
		return true
	}
	name, _ := syscall.UTF16PtrFromString("PhoneGyroTrayPanel")
	popupWndPrc = syscall.NewCallback(popupProc)
	hInstance, _, _ := pGetModuleHandleW.Call(0)
	wc := WNDCLASSEXW{CbSize: uint32(unsafe.Sizeof(WNDCLASSEXW{})), LpfnWndProc: popupWndPrc, HInstance: hInstance, LpszClassName: name}
	if r, _, _ := pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return false
	}
	popupClass = name
	return true
}

// build prepares the GDI+ session, the DIB the window shows and the first frame.
func (p *popup) build(st Status) bool {
	p.sess = startGdip()
	if p.sess == nil {
		return false
	}
	for _, f := range [][]byte{fontOnest, fontOnestSemi, fontAlegreya, fontMonoData, fontMonoSemiData} {
		p.sess.loadFont(f)
	}
	hdcScreen, _, _ := pGetDC.Call(0)
	p.hdc, _, _ = pCreateCompatibleDC.Call(hdcScreen)
	pReleaseDC.Call(0, hdcScreen)
	bi := bitmapInfoHeader{width: p.w, height: -p.h, planes: 1, bitCount: 32, compression: biRGB}
	bi.size = uint32(unsafe.Sizeof(bi))
	p.hbm, _, _ = pCreateDIBSection.Call(p.hdc, uintptr(unsafe.Pointer(&bi)), dibRGBColors, uintptr(unsafe.Pointer(&p.bits)), 0, 0)
	if p.hbm == 0 || p.bits == nil {
		p.free()
		return false
	}
	p.oldBmp, _, _ = pSelectObject.Call(p.hdc, p.hbm)
	p.cv = newCanvas(p.sess, p.bits, int(p.w), int(p.h), p.scale)
	p.m = &panelModel{st: st, pal: paletteFor(st.Theme, st.Accent), hist: p.tm.hist, cpuHist: p.tm.cpuHist}
	p.m.paint(p.cv)
	return true
}

// present pushes the DIB to the screen with the given alpha and vertical offset.
func (p *popup) present(alpha uint8, yOff int32) {
	pos := POINT{p.x, p.y + yOff}
	size := struct{ cx, cy int32 }{p.w, p.h}
	src := POINT{}
	blend := [4]byte{0, 0, alpha, 1} // AC_SRC_OVER, flags, SourceConstantAlpha, AC_SRC_ALPHA
	pUpdateLayeredWindow.Call(p.hwnd, 0, uintptr(unsafe.Pointer(&pos)), uintptr(unsafe.Pointer(&size)), p.hdc,
		uintptr(unsafe.Pointer(&src)), 0, uintptr(unsafe.Pointer(&blend)), ulwAlpha)
}

func (p *popup) repaint() {
	p.m.paint(p.cv)
	p.present(255, 0)
}

func (p *popup) close() {
	if p.hwnd != 0 {
		pDestroyWindow.Call(p.hwnd)
	}
}

// free releases everything the panel holds.
func (p *popup) free() {
	if p.cv != nil {
		p.cv.close()
		p.cv = nil
	}
	if p.sess != nil {
		p.sess.close()
		p.sess = nil
	}
	if p.hdc != 0 {
		if p.oldBmp != 0 {
			pSelectObject.Call(p.hdc, p.oldBmp)
		}
		pDeleteDC.Call(p.hdc)
		p.hdc = 0
	}
	if p.hbm != 0 {
		pDeleteObject.Call(p.hbm)
		p.hbm = 0
	}
}

func popupProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	p := cur
	if p == nil || p.hwnd != hwnd {
		ret, _, _ := pDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
		return ret
	}
	switch msg {
	case wmTimer:
		switch wParam {
		case timerAnim:
			t := float64(time.Since(p.start)) / float64(animDuration)
			if t >= 1 {
				pKillTimer.Call(hwnd, timerAnim)
				p.present(255, 0)
				return 0
			}
			e := 1 - math.Pow(1-t, 3)
			p.present(uint8(255*e), int32(float64(12*p.scale)*(1-e)))
		case timerRefresh:
			if fg, _, _ := pGetForegroundWindow.Call(); fg != p.hwnd && !p.menuOpen && time.Since(p.start) > time.Second {
				p.close() // never got (or lost) the focus without a deactivation message
				return 0
			}
			if !p.menuOpen {
				p.m.st = p.tm.status()
				p.m.pal = paletteFor(p.m.st.Theme, p.m.st.Accent)
				p.m.hist, p.m.cpuHist = p.tm.hist, p.tm.cpuHist
				p.repaint()
			}
		}
		return 0

	case wmMouseMovePop:
		x := float32(int16(lParam&0xffff)) / p.scale
		y := float32(int16(lParam>>16&0xffff)) / p.scale
		if !p.tracking {
			te := trackMouseEvent{flags: tmeLeave, hwndTrack: hwnd}
			te.cbSize = uint32(unsafe.Sizeof(te))
			pTrackMouseEvent.Call(uintptr(unsafe.Pointer(&te)))
			p.tracking = true
		}
		if id := p.m.hit(x, y); id != p.m.hover {
			p.m.hover = id
			p.repaint()
		}
		return 0

	case wmMouseLeave:
		p.tracking = false
		if p.m.hover != hitNone {
			p.m.hover = hitNone
			p.repaint()
		}
		return 0

	case wmSetCursor:
		c := uintptr(idcArrow)
		if p.m.hover != hitNone && p.m.enabled(p.m.hover) {
			c = idcHand
		}
		h, _, _ := pLoadCursorW.Call(0, c)
		pSetCursor.Call(h)
		return 1

	case wmLButtonUp:
		x := float32(int16(lParam&0xffff)) / p.scale
		y := float32(int16(lParam>>16&0xffff)) / p.scale
		p.click(p.m.hit(x, y))
		return 0

	case wmKeyDown:
		if wParam == vkEscape {
			p.close()
		}
		return 0

	case wmActivate:
		if wParam&0xffff == 0 && !p.menuOpen { // WA_INACTIVE
			p.close()
		}
		return 0

	case WM_DESTROY:
		pKillTimer.Call(hwnd, timerAnim)
		pKillTimer.Call(hwnd, timerRefresh)
		p.free()
		p.tm.popClosedAt = time.Now()
		cur = nil
		return 0
	}
	ret, _, _ := pDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
	return ret
}

func (p *popup) click(id hitID) {
	if !p.m.enabled(id) {
		return
	}
	switch id {
	case hitOpen:
		p.close()
		p.tm.cb.Show()
	case hitRecenter:
		p.tm.cb.Recenter()
	case hitQuit:
		p.close()
		p.tm.cb.Quit()
	case hitProfile:
		p.profileMenu()
	}
}

// profileMenu lets the user pick a profile from a native menu under the row.
func (p *popup) profileMenu() {
	st := p.tm.status()
	hMenu, _, _ := pCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer pDestroyMenu.Call(hMenu)
	for i := 0; i < 6; i++ {
		name := ""
		if i < len(st.Profiles) {
			name = st.Profiles[i]
		}
		if name == "" {
			name = fmt.Sprintf(tr(st.Lang, "Слот %d", "Slot %d"), i+1)
		}
		fl := uint32(MF_STRING)
		if i == st.Slot {
			fl |= mfChecked
		}
		appendMenuItem(hMenu, fl, uint32(idProfileBase+i), name)
	}
	applyMenuTheme(st.Theme)
	var row hitRect
	for _, r := range p.m.rects {
		if r.id == hitProfile {
			row = r
		}
	}
	sx := p.x + int32((row.x+row.w-6)*p.scale)
	sy := p.y + int32(row.y*p.scale)
	p.menuOpen = true
	cmd, _, _ := pTrackPopupMenu.Call(hMenu, TPM_BOTTOMALIGN|TPM_RIGHTALIGN|tpmReturnCmd, uintptr(sx), uintptr(sy), 0, p.hwnd, 0)
	p.menuOpen = false
	pPostMessageW.Call(p.hwnd, wmNull, 0, 0)
	if cmd >= idProfileBase && cmd < idProfileBase+6 && p.tm.cb.Profile != nil {
		p.tm.cb.Profile(int(cmd) - idProfileBase)
		p.m.st = p.tm.status()
		p.repaint()
	}
	if fg, _, _ := pGetForegroundWindow.Call(); fg != p.hwnd {
		p.close() // the click that dismissed the menu went elsewhere
	}
}
