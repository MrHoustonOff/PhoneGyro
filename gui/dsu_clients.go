package main

import (
	"net"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"phonegyro/pkg/dsu"
)

// DSUClientView is a subscribed DSU client as the UI shows it: for a client on
// this PC, the program behind it ("Cemu", "PadTest") instead of a bare address.
type DSUClientView struct {
	dsu.ClientInfo
	Process string `json:"process,omitempty"`
	PID     uint32 `json:"pid,omitempty"`
}

// The program is found the way Resource Monitor / "netstat -ano" do: Windows'
// own UDP table maps the client's local port to its process id, and the image
// name comes from OpenProcess with PROCESS_QUERY_LIMITED_INFORMATION (the least
// access there is: no memory reads, no injection, no admin rights). Only
// loopback clients can be named -- a client on another PC is just an address.
var (
	modIphlpapi             = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedUdpTable = modIphlpapi.NewProc("GetExtendedUdpTable")

	procEnumWindows              = modUser32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = modUser32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = modUser32.NewProc("IsWindowVisible")
	procGetWindowTextLengthW     = modUser32.NewProc("GetWindowTextLengthW")
	procIsIconic                 = modUser32.NewProc("IsIconic")
	procShowWindow               = modUser32.NewProc("ShowWindow")
	procSetForegroundWindow      = modUser32.NewProc("SetForegroundWindow")
)

const (
	udpTableOwnerPID  = 1 // UDP_TABLE_OWNER_PID
	swRestore         = 9
	dsuClientNamesTTL = 5 * time.Second
)

type dsuClientName struct {
	pid  uint32
	name string
	at   time.Time
}

var (
	dsuNamesMu sync.Mutex
	dsuNames   = map[string]dsuClientName{}
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

// nameDSUClients fills Process/PID for loopback clients, caching per address
// (the state goes to the UI 15 times a second).
func nameDSUClients(clients []dsu.ClientInfo) []DSUClientView {
	out := make([]DSUClientView, len(clients))
	now := time.Now()
	var owners map[int]uint32
	dsuNamesMu.Lock()
	defer dsuNamesMu.Unlock()
	for i, c := range clients {
		out[i].ClientInfo = c
		ip := net.ParseIP(c.IP)
		if ip == nil || !ip.IsLoopback() {
			continue
		}
		cached, ok := dsuNames[c.Address]
		if !ok || now.Sub(cached.at) > dsuClientNamesTTL {
			if owners == nil {
				owners = udpPortOwners()
			}
			cached = dsuClientName{at: now}
			if pid, found := owners[c.Port]; found {
				cached.pid, cached.name = pid, processName(pid)
			}
			dsuNames[c.Address] = cached
		}
		out[i].Process, out[i].PID = cached.name, cached.pid
	}
	for addr, e := range dsuNames {
		if now.Sub(e.at) > 10*dsuClientNamesTTL {
			delete(dsuNames, addr)
		}
	}
	return out
}

// dsuClientViews is the subscribed clients with their program names. It also
// keeps the drift guard (pkg/dsu/cemubias.go) on for exactly the clients that
// are Cemu while the setting is on: it runs on every connect, even with the
// window hidden.
func (a *App) dsuClientViews() []DSUClientView {
	if a.dsuSrv == nil {
		return nil
	}
	views := nameDSUClients(a.dsuSrv.GetClientsInfo())
	for i, v := range views {
		want := a.cemuDriftGuard.Load() && strings.EqualFold(v.Process, "Cemu")
		if want != v.CemuGuard {
			a.dsuSrv.SetCemuGuard(v.Address, want)
			views[i].CemuGuard = want
		}
	}
	a.announceCemuClients(views)
	return views
}

// DisconnectDSUClient disconnects a subscribed client by its address. It stays
// ignored while it keeps asking (see dsu.Server.Kick) and is listed as
// disconnected until the user brings it back (ReconnectDSUClient).
func (a *App) DisconnectDSUClient(address string) string {
	if a.dsuSrv == nil || !a.dsuSrv.Kick(address) {
		return "not found"
	}
	a.logEvent("INFO", "DSU: client %s disconnected by the user", address)
	a.emitStateChange()
	return "ok"
}

// ReconnectDSUClient undoes DisconnectDSUClient: the client gets the stream
// again (dsu.Server.Readmit).
func (a *App) ReconnectDSUClient(address string) string {
	if a.dsuSrv == nil || !a.dsuSrv.Readmit(address) {
		return "not found"
	}
	a.logEvent("INFO", "DSU: client %s reconnected by the user", address)
	a.emitStateChange()
	return "ok"
}

// dsuKickedRemoteTTL: a disconnected client on another PC is no longer listed
// once it has been silent this long -- whether its program still runs cannot be
// seen from here.
const dsuKickedRemoteTTL = 5 * time.Second

var (
	dsuPortsMu sync.Mutex
	dsuPorts   map[int]uint32 // UDP port -> owning process, see dsuPortOwnersCached
	dsuPortsAt time.Time
)

// dsuKickedViews is the clients the user disconnected, named like the live ones.
// A local one stays listed while its program keeps the port open: a Cemu that
// lost its stream stops asking but is still there and can be brought back.
func (a *App) dsuKickedViews() []DSUClientView {
	if a.dsuSrv == nil {
		return nil
	}
	views := nameDSUClients(a.dsuSrv.KickedClients())
	out := make([]DSUClientView, 0, len(views))
	for _, v := range views {
		gone := false
		if ip := net.ParseIP(v.IP); ip != nil && ip.IsLoopback() {
			owners := dsuPortOwnersCached(false)
			if _, open := owners[v.Port]; !open {
				owners = dsuPortOwnersCached(true) // the port may be newer than the cached table
			}
			_, open := owners[v.Port]
			gone = owners != nil && !open // the port table failed: keep it listed
		} else {
			gone = v.LastSeenMs > dsuKickedRemoteTTL.Milliseconds()
		}
		if gone {
			a.dsuSrv.ForgetKicked(v.Address)
			continue
		}
		out = append(out, v)
	}
	return out
}

// dsuPortOwnersCached is udpPortOwners at most once per dsuClientNamesTTL (the
// state goes to the UI 15 times a second) unless fresh; nil if the table is
// unavailable.
func dsuPortOwnersCached(fresh bool) map[int]uint32 {
	dsuPortsMu.Lock()
	defer dsuPortsMu.Unlock()
	if fresh || dsuPorts == nil || time.Since(dsuPortsAt) > dsuClientNamesTTL {
		dsuPorts, dsuPortsAt = udpPortOwners(), time.Now()
	}
	return dsuPorts
}

// FocusDSUClient brings the window of the program behind a local client to the
// front (clicking "Cemu" in the list switches to Cemu).
func (a *App) FocusDSUClient(address string) string {
	dsuNamesMu.Lock()
	e, ok := dsuNames[address]
	dsuNamesMu.Unlock()
	if !ok || e.pid == 0 {
		return "unknown"
	}
	var target uintptr
	cb := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var pid uint32
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
		if pid != e.pid {
			return 1
		}
		if v, _, _ := procIsWindowVisible.Call(hwnd); v == 0 {
			return 1
		}
		if l, _, _ := procGetWindowTextLengthW.Call(hwnd); l == 0 {
			return 1
		}
		target = hwnd
		return 0 // the first visible, titled window: the program's main one
	})
	procEnumWindows.Call(cb, 0)
	if target == 0 {
		return "no window"
	}
	if iconic, _, _ := procIsIconic.Call(target); iconic != 0 {
		procShowWindow.Call(target, swRestore)
	}
	procSetForegroundWindow.Call(target)
	return "ok"
}
