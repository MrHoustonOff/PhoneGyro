// Package community decides when PhoneGyro asks the user, once, to star the
// project on GitHub: after a few real play sessions, at the moment the last DSU
// client disconnects, and never while a game is running.
//
// It holds no app state and does no I/O: internal/app feeds it the DSU client
// count and persists State in settings.json.
package community

import "time"

const (
	// GoodSession is how long DSU clients must stay connected, without a break,
	// for a session to count.
	GoodSession = 15 * time.Minute
	// SessionsNeeded good sessions come before the first ask.
	SessionsNeeded = 3
	// MaxShows: the window is answered at most this many times. The first answer
	// "remind me later" (or Esc, or the cross) leaves one more; "star" and
	// "don't show again" end it at once.
	MaxShows = 2
	// MinGap between two asks.
	MinGap = 7 * 24 * time.Hour
)

// Actions the window reports (CustomEvent "pg-community", detail.action).
const (
	ActionStar  = "star"
	ActionLater = "later"
	ActionNever = "never"
)

// State is what settings.json keeps ("community"). ShownCount and LastShown
// change when the user answers the window, not when it is raised: an ask that
// never reached the screen (the page was reloading, the app closed) is not spent.
type State struct {
	GoodSessions int       `json:"goodSessions"`
	ShownCount   int       `json:"shownCount"`
	LastShown    time.Time `json:"lastShown"`
	Done         bool      `json:"done"`
}

// Normalize repairs a hand-edited or damaged file: no negative counts.
func (s *State) Normalize() {
	if s.GoodSessions < 0 {
		s.GoodSessions = 0
	}
	if s.ShownCount < 0 {
		s.ShownCount = 0
	}
}

// Due reports whether the window should be offered now (the app adds its own
// "the window is visible" condition).
func (s State) Due(now time.Time) bool {
	if s.Done || s.GoodSessions < SessionsNeeded || s.ShownCount >= MaxShows {
		return false
	}
	if s.LastShown.IsZero() {
		return true
	}
	// A date more than a day ahead is a clock that went back or a damaged file:
	// waiting for it could mean never, so it counts as long ago.
	if s.LastShown.After(now.Add(24 * time.Hour)) {
		return true
	}
	return now.Sub(s.LastShown) >= MinGap
}

// Answered records the user's choice in the window. An unknown action counts
// as "later".
func (s *State) Answered(action string, now time.Time) {
	s.ShownCount++
	s.LastShown = now
	if action == ActionStar || action == ActionNever {
		s.Done = true
	}
}

// Sessions turns the DSU client count into play sessions: a session starts when
// the first client connects and ends when the last one leaves.
type Sessions struct {
	active bool
	start  time.Time
}

// Observe takes the current number of DSU clients. ended is true exactly once
// per session, when the count drops to zero; good says whether that session
// lasted GoodSession.
func (s *Sessions) Observe(clients int, now time.Time) (ended, good bool) {
	switch {
	case clients > 0 && !s.active:
		s.active, s.start = true, now
	case clients <= 0 && s.active:
		s.active = false
		return true, now.Sub(s.start) >= GoodSession
	}
	return false, false
}

// Close ends a session that is still running (the app is quitting): good says
// whether it lasted GoodSession. A session that is not running reports false.
func (s *Sessions) Close(now time.Time) (good bool) {
	if !s.active {
		return false
	}
	s.active = false
	return now.Sub(s.start) >= GoodSession
}
