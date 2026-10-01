package app

import (
	"fmt"
	"os"
	"sync"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"phonegyro-gui/internal/firewall"
)

// Windows Firewall must let the phone's connections through (internal/firewall).
// Settings show the verdict; in phone mode a startup alert (js/ui/notices.js)
// points at the guide's manual-rule steps every launch until the rule exists.
// USB mode needs no network, so it is never nagged.

// How long to wait at startup for the user to answer Windows' own prompt,
// which comes up the first time this exe opens a port.
const (
	firewallFirstCheck = 3 * time.Second
	firewallPoll       = 3 * time.Second
	firewallPromptWait = 2 * time.Minute
)

// Waiting is GetFirewallStatus's state while Windows' prompt is (probably) up.
const firewallWaiting = "waiting"

type firewallState struct {
	mu      sync.Mutex
	pending *firewall.Status // startup alert not yet shown or closed
	waiting bool             // Windows' prompt is up: no verdict yet
}

func exePath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return exe
}

// GetFirewallStatus is the firewall's current verdict on PhoneGyro.
func (a *App) GetFirewallStatus() firewall.Status {
	st := firewall.Check(exePath())
	a.firewall.mu.Lock()
	waiting := a.firewall.waiting
	a.firewall.mu.Unlock()
	if waiting && st.State != firewall.Allowed && st.State != firewall.Off {
		st.State = firewallWaiting
	}
	return st
}

// firewallPromptExpected: no rule names this exe yet, so opening a port makes
// Windows ask. Checked before the servers listen; once they do, Windows may
// already hold block rules while its prompt is still open.
func (a *App) firewallPromptExpected() bool {
	return firewall.Check(exePath()).State == firewall.Pending
}

// watchFirewall checks the firewall once the app is up and raises the alert in
// phone mode if the phone would be blocked. If Windows was about to ask
// (prompted), its answer comes first: the verdict waits until the rule allows
// PhoneGyro or firewallPromptWait has passed, so the alert never lands on top
// of Windows' own prompt.
func (a *App) watchFirewall(prompted bool) {
	exe := exePath()
	if prompted {
		a.setFirewallWaiting(true)
		defer a.setFirewallWaiting(false)
	}
	time.Sleep(firewallFirstCheck)
	st := firewall.Check(exe)
	for waited := time.Duration(0); waited < firewallPromptWait; waited += firewallPoll {
		settled := st.State == firewall.Allowed || st.State == firewall.Off || st.State == firewall.Unknown
		if settled || (!prompted && st.State != firewall.Pending) {
			break
		}
		time.Sleep(firewallPoll)
		st = firewall.Check(exe)
	}
	a.setFirewallWaiting(false)
	fmt.Printf("[firewall] %s (%s network) %s\n", st.State, st.Network, st.Detail)
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "firewall:status", st)
	}
	if (st.State != firewall.Blocked && st.State != firewall.Pending) || a.GetInputMode() != "phone" {
		return
	}
	a.firewall.mu.Lock()
	a.firewall.pending = &st
	a.firewall.mu.Unlock()
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "firewall:alert", st)
	}
}

func (a *App) setFirewallWaiting(on bool) {
	a.firewall.mu.Lock()
	a.firewall.waiting = on
	a.firewall.mu.Unlock()
}

// PendingFirewallAlert returns the startup alert if the window missed its event.
func (a *App) PendingFirewallAlert() *firewall.Status {
	a.firewall.mu.Lock()
	defer a.firewall.mu.Unlock()
	return a.firewall.pending
}

// CloseFirewallAlert is called when the alert is closed; it comes back next launch.
func (a *App) CloseFirewallAlert() {
	a.firewall.mu.Lock()
	a.firewall.pending = nil
	a.firewall.mu.Unlock()
}
