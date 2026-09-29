package dsuclients

import (
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modIphlpapi             = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedUdpTable = modIphlpapi.NewProc("GetExtendedUdpTable")

	modUser32                    = windows.NewLazySystemDLL("user32.dll")
	procEnumWindows              = modUser32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = modUser32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = modUser32.NewProc("IsWindowVisible")
	procGetWindowTextLengthW     = modUser32.NewProc("GetWindowTextLengthW")
	procIsIconic                 = modUser32.NewProc("IsIconic")
	procShowWindow               = modUser32.NewProc("ShowWindow")
	procSetForegroundWindow      = modUser32.NewProc("SetForegroundWindow")
)

const (
	udpTableOwnerPID = 1 // UDP_TABLE_OWNER_PID
	swRestore        = 9
)

// udpPortOwners returns local IPv4 UDP port -> owning process id.
func udpPortOwners() map[int]uint32 {
	var size uint32
	procGetExtendedUdpTable.Call(0, uintptr(unsafe.Pointer(&size)), 0, windows.AF_INET, udpTableOwnerPID, 0)
	if size == 0 {
		return nil
	}
	buf := make([]byte, size+4096) // room for sockets opened in between
	size = uint32(len(buf))
	r, _, _ := procGetExtendedUdpTable.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0, windows.AF_INET, udpTableOwnerPID, 0)
	if r != 0 {
		return nil
	}
	// MIB_UDPTABLE_OWNER_PID: DWORD count, then rows of
	// {DWORD localAddr, DWORD localPort (network byte order), DWORD owningPid}.
	n := *(*uint32)(unsafe.Pointer(&buf[0]))
	out := make(map[int]uint32, n)
	for i := 0; i < int(n); i++ {
		off := 4 + i*12
		if off+12 > int(size) {
			break
		}
		raw := *(*uint32)(unsafe.Pointer(&buf[off+4]))
		port := int(raw&0xff)<<8 | int(raw>>8&0xff)
		out[port] = *(*uint32)(unsafe.Pointer(&buf[off+8]))
	}
	return out
}

// processName is the program's file name without .exe, or "" if unknown.
func processName(pid uint32) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_PATH)
	n := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &n); err != nil {
		return ""
	}
	name := filepath.Base(windows.UTF16ToString(buf[:n]))
	return strings.TrimSuffix(name, filepath.Ext(name))
}

// focusWindow brings the program's main window (its first visible, titled one)
// to the front, restoring it if minimized; false if it has none.
func focusWindow(pid uint32) bool {
	var target uintptr
	cb := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var owner uint32
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&owner)))
		if owner != pid {
			return 1
		}
		if v, _, _ := procIsWindowVisible.Call(hwnd); v == 0 {
			return 1
		}
		if l, _, _ := procGetWindowTextLengthW.Call(hwnd); l == 0 {
			return 1
		}
		target = hwnd
		return 0
	})
	procEnumWindows.Call(cb, 0)
	if target == 0 {
		return false
	}
	if iconic, _, _ := procIsIconic.Call(target); iconic != 0 {
		procShowWindow.Call(target, swRestore)
	}
	procSetForegroundWindow.Call(target)
	return true
}
