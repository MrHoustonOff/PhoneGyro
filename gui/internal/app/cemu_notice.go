package app

import (
	"strings"
	"sync"
	"sync/atomic"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// The Cemu notice tells the user, whenever a Cemu instance subscribes, that
// Cemu has a gyro bias bug and PhoneGyro works around it (the drift guard,
// pkg/dsu/cemubias.go). Temporary by design: it goes away together with the
// guard once a fixed Cemu is out. Everything for it lives here, in
// js/cemu-notice.js, css/cemu-notice.css, the #cemu-notice-modal markup and the
// "cemu_notice" i18n section.

// cemuFixPRURL is the Cemu pull request that fixes the bug. Empty until opened;
// the notice then says the link comes with a later update.
const cemuFixPRURL = ""

type cemuNoticeState struct {
	hidden atomic.Bool // "don't show again" (settings.json cemuNoticeHidden)

	mu        sync.Mutex
	announced map[string]bool // Cemu client addresses already announced
	pending   bool            // announced but not yet acknowledged in the UI
}

// CemuNotice is what the notice shows.
type CemuNotice struct {
	GuardOn bool   `json:"guardOn"`
	PRURL   string `json:"prUrl"`
}

func (a *App) cemuNoticePayload() CemuNotice {
	return CemuNotice{GuardOn: a.cemuDriftGuard.Load(), PRURL: cemuFixPRURL}
}

// announceCemuClients shows the notice when a Cemu client appears that has not
// been announced yet (each new Cemu instance, each PhoneGyro start). Called from
// dsuClientViews, which runs on every DSU connect.
func (a *App) announceCemuClients(views []DSUClientView) {
	n := &a.cemuNotice
	n.mu.Lock()
	present := map[string]bool{}
	fresh := false
	for _, v := range views {
		if !strings.EqualFold(v.Process, "Cemu") {
			continue
		}
		present[v.Address] = true
		if !n.announced[v.Address] {
			fresh = true
		}
	}
	// A Cemu the user disconnected has not left: no new notice when it is brought back.
	for _, k := range a.dsuSrv.KickedClients() {
		if n.announced[k.Address] {
			present[k.Address] = true
		}
	}
	n.announced = present // a Cemu that left is announced again when it comes back
	show := fresh && !n.hidden.Load()
	if show {
		n.pending = true
	}
	n.mu.Unlock()

	if show && a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "cemu:notice", a.cemuNoticePayload())
	}
}

// PendingCemuNotice returns the notice if one is waiting to be shown: Cemu
// usually subscribes before the window has loaded and missed the event.
func (a *App) PendingCemuNotice() *CemuNotice {
	a.cemuNotice.mu.Lock()
	pending := a.cemuNotice.pending && !a.cemuNotice.hidden.Load()
	a.cemuNotice.mu.Unlock()
	if !pending {
		return nil
	}
	p := a.cemuNoticePayload()
	return &p
}

// CloseCemuNotice is called when the user closes the notice; dontShowAgain
// hides it for good.
func (a *App) CloseCemuNotice(dontShowAgain bool) {
	a.cemuNotice.mu.Lock()
	a.cemuNotice.pending = false
	a.cemuNotice.mu.Unlock()
	if dontShowAgain && !a.cemuNotice.hidden.Load() {
		a.cemuNotice.hidden.Store(true)
		a.saveSettings()
	}
}
