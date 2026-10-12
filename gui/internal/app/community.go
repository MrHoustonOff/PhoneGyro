package app

import (
	"sync"
	"time"

	"phonegyro-gui/internal/community"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// The community window asks the user, once or twice, to star PhoneGyro on
// GitHub (internal/community decides when). It is raised when the last DSU
// client of a long enough session disconnects, with any DSU client, and only
// while the window is on screen. Everything for it lives here, in
// js/ui/community.js, the app-comm rules of css/app.css and the "community"
// i18n section.

type communityState struct {
	mu      sync.Mutex
	state   community.State // settings.json "community"
	sess    community.Sessions
	pending bool // raised but not yet answered in the UI
}

func (a *App) communitySnapshot() community.State {
	a.community.mu.Lock()
	defer a.community.mu.Unlock()
	return a.community.state
}

func (a *App) setCommunity(s community.State) {
	s.Normalize()
	a.community.mu.Lock()
	a.community.state = s
	a.community.mu.Unlock()
}

// communityVisible: the page is loaded and the window is not hidden in the tray.
// A minimised window still counts: the page shows the window when it comes back.
func (a *App) communityVisible() bool {
	return a.ctx != nil && !a.uiHidden.Load() && !a.uiUnloaded.Load()
}

// communityObserve is called with the DSU client count on every connect and
// disconnect.
func (a *App) communityObserve(clients int) {
	if a.communityStep(clients, time.Now(), a.communityVisible() && !a.noPopups.Load()) && a.ctx != nil {
		a.logEvent("INFO", "community: asking for a star")
		wailsRuntime.EventsEmit(a.ctx, "community:prompt")
	}
}

// communityStep records the session and reports whether the window should be
// raised now.
func (a *App) communityStep(clients int, now time.Time, visible bool) (raise bool) {
	c := &a.community
	c.mu.Lock()
	ended, good := c.sess.Observe(clients, now)
	if good {
		c.state.GoodSessions++
	}
	if ended && visible && !c.pending && c.state.Due(now) {
		c.pending = true
		raise = true
	}
	sessions := c.state.GoodSessions
	c.mu.Unlock()

	if good {
		a.logEvent("INFO", "community: good DSU session #%d", sessions)
		a.saveSettings()
	}
	return raise
}

// communityClose counts a session still running when the app quits.
func (a *App) communityClose(now time.Time) {
	c := &a.community
	c.mu.Lock()
	good := c.sess.Close(now)
	if good {
		c.state.GoodSessions++
	}
	c.mu.Unlock()
	if good {
		a.saveSettings()
	}
}

// PendingCommunityPrompt reports whether the window is waiting to be shown:
// the page was reloading when it was raised.
func (a *App) PendingCommunityPrompt() bool {
	a.community.mu.Lock()
	defer a.community.mu.Unlock()
	return a.community.pending && !a.community.state.Done
}

// CommunityAnswer records the user's answer ("star", "later", "never"). It
// does nothing unless the window was raised by the app (the dev preview is not).
func (a *App) CommunityAnswer(action string) bool {
	return a.communityAnswer(action, time.Now())
}

func (a *App) communityAnswer(action string, now time.Time) bool {
	c := &a.community
	c.mu.Lock()
	if !c.pending {
		c.mu.Unlock()
		return false
	}
	c.pending = false
	c.state.Answered(action, now)
	s := c.state
	c.mu.Unlock()

	a.logEvent("INFO", "community: answered %q (shown %d, done %v)", action, s.ShownCount, s.Done)
	a.saveSettings()
	return true
}
