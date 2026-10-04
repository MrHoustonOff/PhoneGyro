package winstate

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modUser32                    = windows.NewLazySystemDLL("user32.dll")
	procEnumWindows              = modUser32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = modUser32.NewProc("GetWindowThreadProcessId")
	procGetWindowTextW           = modUser32.NewProc("GetWindowTextW")
	procGetWindowPlacement       = modUser32.NewProc("GetWindowPlacement")
	procSetWindowPlacement       = modUser32.NewProc("SetWindowPlacement")
	procMonitorFromRect          = modUser32.NewProc("MonitorFromRect")
	procMonitorFromPoint         = modUser32.NewProc("MonitorFromPoint")
	procGetMonitorInfoW          = modUser32.NewProc("GetMonitorInfoW")
	procGetDpiForSystem          = modUser32.NewProc("GetDpiForSystem")
)

const (
	swShowNormal    = 1
	swShowMaximized = 3
	monitorNearest  = 2 // MONITOR_DEFAULTTONEAREST
	monitorNull     = 0 // MONITOR_DEFAULTTONULL
	windowTitle     = "PhoneGyro"
	// Window must show at least this much of its width and height on one monitor.
	minVisible = 0.8
)

type rect struct{ left, top, right, bottom int32 }

type windowPlacement struct {
	length, flags, showCmd uint32
	minPos, maxPos         [2]int32
	normal                 rect
}

type monitorInfo struct {
	size    uint32
	monitor rect
	work    rect
	flags   uint32
}

// FindMain returns the handle of this process's visible main window (0 if none yet).
func FindMain() uintptr {
	var found uintptr
	pid := uint32(os.Getpid())
	cb := windows.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var owner uint32
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&owner)))
		if owner != pid {
			return 1
		}
		var buf [64]uint16
		n, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
		if windows.UTF16ToString(buf[:n]) == windowTitle {
			found = hwnd
			return 0
		}
		return 1
	})
	procEnumWindows.Call(cb, 0)
	return found
}

// Capture reads the window's placement.
func Capture(hwnd uintptr) (State, bool) {
	if hwnd == 0 {
		return State{}, false
	}
	wp := windowPlacement{length: uint32(unsafe.Sizeof(windowPlacement{}))}
	if r, _, _ := procGetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&wp))); r == 0 {
		return State{}, false
	}
	s := State{Left: wp.normal.left, Top: wp.normal.top, Right: wp.normal.right, Bottom: wp.normal.bottom,
		Maximised: wp.showCmd == swShowMaximized}
	return s, s.Width() > 0 && s.Height() > 0
}

// Apply moves and sizes the window to s (maximised if it was).
func Apply(hwnd uintptr, s State) {
	if hwnd == 0 {
		return
	}
	wp := windowPlacement{length: uint32(unsafe.Sizeof(windowPlacement{})), showCmd: swShowNormal,
		normal: rect{s.Left, s.Top, s.Right, s.Bottom}}
	if s.Maximised {
		wp.showCmd = swShowMaximized
	}
	procSetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&wp)))
}

func monitorWork(m uintptr) (rect, bool) {
	mi := monitorInfo{size: uint32(unsafe.Sizeof(monitorInfo{}))}
	if r, _, _ := procGetMonitorInfoW.Call(m, uintptr(unsafe.Pointer(&mi))); r == 0 {
		return rect{}, false
	}
	return mi.work, true
}

// Usable reports whether s still fits: the monitor it was on exists, the window
// fits that monitor's work area and at least minVisible of it is on screen.
func (s State) Usable() bool {
	r := rect{s.Left, s.Top, s.Right, s.Bottom}
	m, _, _ := procMonitorFromRect.Call(uintptr(unsafe.Pointer(&r)), monitorNull)
	if m == 0 {
		return false
	}
	wa, ok := monitorWork(m)
	if !ok || s.Width() > wa.right-wa.left || s.Height() > wa.bottom-wa.top {
		return false
	}
	vw := min32(r.right, wa.right) - max32(r.left, wa.left)
	vh := min32(r.bottom, wa.bottom) - max32(r.top, wa.top)
	return float64(vw) >= minVisible*float64(s.Width()) && float64(vh) >= minVisible*float64(s.Height())
}

// FitZoom is the biggest scale (≤ 1) at which a 1280×720 window (the default
// size, in device-independent pixels) fits the primary monitor's work area.
func FitZoom() float64 {
	m, _, _ := procMonitorFromPoint.Call(0, monitorNearest) // POINT{0,0} is one packed 8-byte argument
	wa, ok := monitorWork(m)
	if !ok {
		return 1
	}
	scale := 1.0
	if dpi, _, _ := procGetDpiForSystem.Call(); dpi > 0 {
		scale = float64(dpi) / 96
	}
	w := float64(wa.right-wa.left) / scale
	h := float64(wa.bottom-wa.top) / scale
	fit := 1.0
	if f := w / 1280; f < fit {
		fit = f
	}
	if f := h / 720; f < fit {
		fit = f
	}
	return Snap(fit)
}

func min32(a, b int32) int32 {
	if a < b {
		return a
	}
	return b
}

func max32(a, b int32) int32 {
	if a > b {
		return a
	}
	return b
}
