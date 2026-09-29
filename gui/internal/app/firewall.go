package app

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"phonegyro-gui/internal/firewall"
)

// Windows Firewall must let the phone's connections through (internal/firewall).
// Settings show the verdict with an "Allow" button; in phone mode, a startup
// alert (js/firewall.js, #firewall-modal) asks again every launch until it is
// allowed. USB mode needs no network, so it is never nagged.

// How long to wait at startup for the user to answer Windows' own prompt,
// which comes up on the very first launch.
const (
	firewallFirstCheck = 3 * time.Second
	firewallPoll       = 3 * time.Second
	firewallPromptWait = 2 * time.Minute
)

type firewallState struct {
	mu      sync.Mutex
	pending *firewall.Status // startup alert not yet shown or closed
}

// FirewallResult is AllowFirewall's outcome: "ok", "cancelled" (UAC declined)
// or "error", plus the verdict afterwards.
type FirewallResult struct {
	Result string          `json:"result"`
	Detail string          `json:"detail,omitempty"`
	Status firewall.Status `json:"status"`
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
	return firewall.Check(exePath())
}

// AllowFirewall asks for admin rights (UAC) and allows PhoneGyro through the
// firewall for the networks in use.
func (a *App) AllowFirewall() FirewallResult {
	res := FirewallResult{Result: "ok"}
	if err := firewall.RequestAllow(); err != nil {
		res.Result, res.Detail = "error", err.Error()
		if errors.Is(err, firewall.ErrCancelled) {
			res.Result = "cancelled"
		}
		fmt.Printf("[firewall] allow: %s %s\n", res.Result, res.Detail)
	}
	res.Status = a.GetFirewallStatus()
	if res.Status.State == firewall.Allowed {
		a.firewall.mu.Lock()
		a.firewall.pending = nil
		a.firewall.mu.Unlock()
	}
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "firewall:status", res.Status)
	}
	return res
}

// watchFirewall checks the firewall once the app is up and raises the alert
// in phone mode if the phone would be blocked. While there is no rule at all,
// Windows is most likely showing its own prompt: wait for that answer first.
func (a *App) watchFirewall() {
	time.Sleep(firewallFirstCheck)
	exe := exePath()
	st := firewall.Check(exe)
	for waited := time.Duration(0); st.State == firewall.Pending && waited < firewallPromptWait; waited += firewallPoll {
		time.Sleep(firewallPoll)
		st = firewall.Check(exe)
	}
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
