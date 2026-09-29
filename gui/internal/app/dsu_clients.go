package app

import (
	"net"
	"strings"
	"time"

	"phonegyro-gui/internal/dsuclients"
)

// DSUClientView is a subscribed DSU client as the UI shows it: for a client on
// this PC, the program behind it ("Cemu", "PadTest") instead of a bare address
// (internal/dsuclients).
type DSUClientView = dsuclients.View

// dsuClientViews is the subscribed clients with their program names. It also
// keeps the drift guard (pkg/dsu/cemubias.go) on for exactly the clients that
// are Cemu while the setting is on: it runs on every connect, even with the
// window hidden.
func (a *App) dsuClientViews() []DSUClientView {
	if a.dsuSrv == nil {
		return nil
	}
	views := a.dsuNames.Name(a.dsuSrv.GetClientsInfo())
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

// dsuKickedViews is the clients the user disconnected, named like the live ones.
// A local one stays listed while its program keeps the port open: a Cemu that
// lost its stream stops asking but is still there and can be brought back.
func (a *App) dsuKickedViews() []DSUClientView {
	if a.dsuSrv == nil {
		return nil
	}
	views := a.dsuNames.Name(a.dsuSrv.KickedClients())
	out := make([]DSUClientView, 0, len(views))
	for _, v := range views {
		gone := false
		if ip := net.ParseIP(v.IP); ip != nil && ip.IsLoopback() {
			open, known := a.dsuNames.PortOpen(v.Port)
			gone = known && !open // the port table failed: keep it listed
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

// FocusDSUClient brings the window of the program behind a local client to the
// front (clicking "Cemu" in the list switches to Cemu).
func (a *App) FocusDSUClient(address string) string {
	return a.dsuNames.Focus(address)
}
