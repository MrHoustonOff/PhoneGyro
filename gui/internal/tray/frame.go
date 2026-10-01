package tray

import (
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The system draws a light 3D frame around a popup menu unless it is in its dark
// mode, and whether that mode takes effect depends on things outside our hands
// (Wails and WebView2 touch the same switches). So while the menu is open we
// paint that frame ourselves: the menu window is subclassed and, after the
// system has drawn its frame, ours is painted over it.

var (
	pSetWindowLongPtrW   = user32.NewProc("SetWindowLongPtrW")
	pCallWindowProcW     = user32.NewProc("CallWindowProcW")
	pWindowFromDC        = user32.NewProc("WindowFromDC")
	pGetClassNameW       = user32.NewProc("GetClassNameW")
	pGetWindowDC         = user32.NewProc("GetWindowDC")
	pReleaseDCFrame      = user32.NewProc("ReleaseDC")
	pGetWindowRect       = user32.NewProc("GetWindowRect")
	pGetClientRect       = user32.NewProc("GetClientRect")
	pClientToScreen      = user32.NewProc("ClientToScreen")
	pFillRect            = user32.NewProc("FillRect")
	pCreateSolidBrush    = syscall.NewLazyDLL("gdi32.dll").NewProc("CreateSolidBrush")
	pDeleteObjectFrame   = syscall.NewLazyDLL("gdi32.dll").NewProc("DeleteObject")

	menuSubProc = syscall.NewCallback(menuSubclassProc)
	subclassed  = map[uintptr]uintptr{} // menu window -> its original window procedure
	// frame colours as COLORREF (0x00BBGGRR): the fill and the 1px outline
	frameFill, frameLine uint32
	frameInnerW          int32 // the items' width in px: what is left of the window is border
)

const (
	gwlpWndProc     = ^uintptr(3) // -4
	wmNCPaint       = 0x0085
	wmPaintMsg      = 0x000F
	wmNCActivate    = 0x0086
	wmPrint         = 0x0317
	wmPrintClient   = 0x0318
	wmShowWindowMsg = 0x0018
	wmWindowPosDone = 0x0047
	wmNCDestroy     = 0x0082
)

func colorref(argb uint32) uint32 { return argb>>16&0xff | argb>>8&0xff<<8 | argb&0xff<<16 }

// setFrameColors sets the frame's fill and outline (ARGB).
func setFrameColors(fill, line uint32, innerW int32) {
	frameFill, frameLine, frameInnerW = colorref(fill), colorref(line), innerW
}

// adoptMenuWindow takes over painting the frame of the menu window the device
// context belongs to: it subclasses the window (once) so that after every
// paint of the system's own frame ours goes over it.
func adoptMenuWindow(hdc uintptr) {
	hwnd, _, _ := pWindowFromDC.Call(hdc)
	if hwnd == 0 || !isMenuWindow(hwnd) {
		return
	}
	if _, ok := subclassed[hwnd]; !ok {
		orig, _, _ := pSetWindowLongPtrW.Call(hwnd, gwlpWndProc, menuSubProc)
		if orig != 0 {
			subclassed[hwnd] = orig
		}
	}
	paintMenuFrame(hwnd)
}

func menuSubclassProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	orig := subclassed[hwnd]
	if orig == 0 {
		r, _, _ := pDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
		return r
	}
	r, _, _ := pCallWindowProcW.Call(orig, hwnd, uintptr(msg), wParam, lParam)
	switch msg {
	case wmNCPaint, wmPaintMsg, wmNCActivate, wmPrint, wmPrintClient, wmShowWindowMsg, wmWindowPosDone:
		paintMenuFrame(hwnd)
	case wmNCDestroy:
		delete(subclassed, hwnd)
	}
	return r
}

func isMenuWindow(hwnd uintptr) bool {
	var buf [16]uint16
	n, _, _ := pGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return windows.UTF16ToString(buf[:n]) == "#32768"
}

// paintMenuFrame covers the window's non-client area (its border) with the frame colours.
func paintMenuFrame(hwnd uintptr) {
	var wr, cr rectI
	pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&wr)))
	pGetClientRect.Call(hwnd, uintptr(unsafe.Pointer(&cr)))
	origin := POINT{}
	pClientToScreen.Call(hwnd, uintptr(unsafe.Pointer(&origin)))
	l, t := origin.X-wr.left, origin.Y-wr.top
	r, b := wr.right-(origin.X+cr.right), wr.bottom-(origin.Y+cr.bottom)
	w, h := wr.right-wr.left, wr.bottom-wr.top
	if l <= 0 && t <= 0 && r <= 0 && b <= 0 && frameInnerW > 0 && w > frameInnerW {
		// The menu draws its border inside its client area: it is whatever the items do not cover.
		bw := (w - frameInnerW) / 2
		l, t, r, b = bw, bw, bw, bw
	}
	if l <= 0 && t <= 0 && r <= 0 && b <= 0 {
		return
	}
	dc, _, _ := pGetWindowDC.Call(hwnd)
	if dc == 0 {
		return
	}
	defer pReleaseDCFrame.Call(hwnd, dc)
	fill, _, _ := pCreateSolidBrush.Call(uintptr(frameFill))
	line, _, _ := pCreateSolidBrush.Call(uintptr(frameLine))
	defer pDeleteObjectFrame.Call(fill)
	defer pDeleteObjectFrame.Call(line)
	rc := func(x0, y0, x1, y1 int32, br uintptr) {
		if x1 > x0 && y1 > y0 {
			q := rectI{x0, y0, x1, y1}
			pFillRect.Call(dc, uintptr(unsafe.Pointer(&q)), br)
		}
	}
	// the whole border band in the fill colour, then a 1px outline on its outer edge
	rc(0, 0, w, t, fill)
	rc(0, h-b, w, h, fill)
	rc(0, t, l, h-b, fill)
	rc(w-r, t, w, h-b, fill)
	rc(0, 0, w, 1, line)
	rc(0, h-1, w, h, line)
	rc(0, 0, 1, h, line)
	rc(w-1, 0, w, h, line)
}
