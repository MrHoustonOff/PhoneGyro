// Package dsuclients names DSU clients on this PC after the program behind them
// ("Cemu", "PadTest") instead of a bare address, and brings that program's
// window to the front.
//
// The program is found the way Resource Monitor / "netstat -ano" do: Windows'
// own UDP table maps the client's local port to its process id, and the image
// name comes from OpenProcess with PROCESS_QUERY_LIMITED_INFORMATION (the least
// access there is: no memory reads, no injection, no admin rights). Only
// loopback clients can be named -- a client on another PC is just an address.
package dsuclients

import (
	"net"
	"sync"
	"time"

	"phonegyro/pkg/dsu"
)

// View is a subscribed DSU client as the UI shows it.
type View struct {
	dsu.ClientInfo
	Process string `json:"process,omitempty"`
	PID     uint32 `json:"pid,omitempty"`
}

// DefaultTTL is how long a client's name and the UDP port table are cached
// (the state goes to the UI 15 times a second).
const DefaultTTL = 5 * time.Second

// Namer names clients, caching per address. The zero value is ready to use.
type Namer struct {
	TTL time.Duration // 0 = DefaultTTL, negative = no caching (tests)

	namesMu sync.Mutex
	names   map[string]name

	portsMu sync.Mutex
	ports   map[int]uint32 // UDP port -> owning process, see portOwners
	portsAt time.Time
}

type name struct {
	pid  uint32
	name string
	at   time.Time
}

// expired tells whether something cached at `at` is to be read again.
func (n *Namer) expired(at, now time.Time) bool {
	switch {
	case n.TTL < 0:
		return true
	case n.TTL == 0:
		return now.Sub(at) > DefaultTTL
	}
	return now.Sub(at) > n.TTL
}

// Name fills Process/PID for loopback clients.
func (n *Namer) Name(clients []dsu.ClientInfo) []View {
	out := make([]View, len(clients))
	now := time.Now()
	var owners map[int]uint32
	n.namesMu.Lock()
	defer n.namesMu.Unlock()
	if n.names == nil {
		n.names = map[string]name{}
	}
	for i, c := range clients {
		out[i].ClientInfo = c
		ip := net.ParseIP(c.IP)
		if ip == nil || !ip.IsLoopback() {
			continue
		}
		cached, ok := n.names[c.Address]
		if !ok || n.expired(cached.at, now) {
			if owners == nil {
				owners = udpPortOwners()
			}
			cached = name{at: now}
			if pid, found := owners[c.Port]; found {
				cached.pid, cached.name = pid, processName(pid)
			}
			n.names[c.Address] = cached
		}
		out[i].Process, out[i].PID = cached.name, cached.pid
	}
	for addr, e := range n.names {
		if now.Sub(e.at) > 10*DefaultTTL {
			delete(n.names, addr)
		}
	}
	return out
}

// PortOpen tells whether a local UDP port is still held by some program; known
// is false if the port table is unavailable.
func (n *Namer) PortOpen(port int) (open, known bool) {
	owners := n.portOwners(false)
	if _, open := owners[port]; !open {
		owners = n.portOwners(true) // the port may be newer than the cached table
	}
	_, open = owners[port]
	return open, owners != nil
}

// portOwners is udpPortOwners at most once per TTL unless fresh; nil if the
// table is unavailable.
func (n *Namer) portOwners(fresh bool) map[int]uint32 {
	n.portsMu.Lock()
	defer n.portsMu.Unlock()
	if fresh || n.ports == nil || n.expired(n.portsAt, time.Now()) {
		n.ports, n.portsAt = udpPortOwners(), time.Now()
	}
	return n.ports
}

// Focus brings the window of the program behind a named client to the front:
// "ok", "unknown" (not a named local client) or "no window".
func (n *Namer) Focus(address string) string {
	n.namesMu.Lock()
	e, ok := n.names[address]
	n.namesMu.Unlock()
	if !ok || e.pid == 0 {
		return "unknown"
	}
	if !focusWindow(e.pid) {
		return "no window"
	}
	return "ok"
}
