package app

import (
	"testing"
	"time"

	"phonegyro-gui/internal/community"
	"phonegyro-gui/internal/settings"
)

var commT0 = time.Date(2026, 10, 12, 20, 0, 0, 0, time.UTC)

func communityApp(t *testing.T) *App {
	t.Helper()
	app := NewApp()
	app.profilesDir = t.TempDir()
	app.setCommunity(community.State{})
	return app
}

// session runs one DSU session of length d starting at start; it reports
// whether the window was raised when it ended.
func session(app *App, start time.Time, d time.Duration, visible bool) bool {
	app.communityStep(1, start, visible)
	app.communityStep(2, start.Add(time.Second), visible)
	app.communityStep(1, start.Add(2*time.Second), visible)
	return app.communityStep(0, start.Add(d), visible)
}

func TestCommunityFlow(t *testing.T) {
	app := communityApp(t)
	now := commT0
	for i := 1; i < community.SessionsNeeded; i++ {
		if session(app, now, community.GoodSession, true) {
			t.Fatalf("raised after %d sessions", i)
		}
		now = now.Add(time.Hour)
	}
	if session(app, now, time.Minute, true) {
		t.Fatal("raised after a short session")
	}
	now = now.Add(time.Hour)
	if !session(app, now, community.GoodSession, true) {
		t.Fatal("not raised after the third good session")
	}
	if !app.PendingCommunityPrompt() {
		t.Fatal("not pending after raise")
	}
	// raised once: a second session end does not raise it again
	if session(app, now.Add(time.Hour), community.GoodSession, true) {
		t.Fatal("raised twice while pending")
	}
	// the counts reached settings.json
	if s, _ := settings.Load(app.profilesDir); s.Community.GoodSessions != 4 {
		t.Fatalf("saved %+v", s.Community)
	}

	if !app.communityAnswer(community.ActionLater, now) {
		t.Fatal("answer ignored")
	}
	if app.communityAnswer(community.ActionLater, now) {
		t.Fatal("a second answer was counted")
	}
	if app.PendingCommunityPrompt() {
		t.Fatal("pending after answer")
	}
	if session(app, now.Add(24*time.Hour), community.GoodSession, true) {
		t.Fatal("raised a day after 'later'")
	}
	now = now.Add(community.MinGap + time.Hour)
	if !session(app, now, community.GoodSession, true) {
		t.Fatal("not raised a week after 'later'")
	}
	app.communityAnswer(community.ActionLater, now)
	if session(app, now.AddDate(1, 0, 0), community.GoodSession, true) {
		t.Fatal("raised a third time")
	}
	s, _ := settings.Load(app.profilesDir)
	if s.Community.ShownCount != 2 || s.Community.Done {
		t.Fatalf("saved %+v", s.Community)
	}
}

func TestCommunityHiddenWindowWaits(t *testing.T) {
	app := communityApp(t)
	app.setCommunity(community.State{GoodSessions: community.SessionsNeeded})
	if session(app, commT0, time.Minute, false) || app.PendingCommunityPrompt() {
		t.Fatal("raised while the window was hidden")
	}
	if !session(app, commT0.Add(time.Hour), time.Minute, true) {
		t.Fatal("not raised at the next session end with the window shown")
	}
}

func TestCommunityStarAndNever(t *testing.T) {
	for _, action := range []string{community.ActionStar, community.ActionNever} {
		app := communityApp(t)
		app.setCommunity(community.State{GoodSessions: community.SessionsNeeded})
		if !session(app, commT0, time.Minute, true) {
			t.Fatal("not raised")
		}
		app.communityAnswer(action, commT0)
		if session(app, commT0.AddDate(1, 0, 0), community.GoodSession, true) {
			t.Fatalf("raised after %q", action)
		}
		if s, _ := settings.Load(app.profilesDir); !s.Community.Done {
			t.Fatalf("%q: not saved as done: %+v", action, s.Community)
		}
	}
}

// The dev preview answers without a raise: nothing may be counted.
func TestCommunityAnswerWithoutRaise(t *testing.T) {
	app := communityApp(t)
	if app.CommunityAnswer(community.ActionStar) {
		t.Fatal("answer counted without a raise")
	}
	if s := app.communitySnapshot(); s != (community.State{}) {
		t.Fatalf("state changed: %+v", s)
	}
}

// The settings window sends the whole AppSettings back: its (stale) community
// value must not overwrite the app's.
func TestCommunityNotTakenFromUI(t *testing.T) {
	app := communityApp(t)
	app.setCommunity(community.State{GoodSessions: 7, ShownCount: 1, Done: true})
	ui := app.GetAppSettings()
	ui.Community = community.State{}
	if _, err := app.SaveAppSettings(ui); err != nil {
		t.Fatal(err)
	}
	want := community.State{GoodSessions: 7, ShownCount: 1, Done: true}
	if got := app.communitySnapshot(); got != want {
		t.Fatalf("live %+v", got)
	}
	if s, _ := settings.Load(app.profilesDir); s.Community != want {
		t.Fatalf("saved %+v", s.Community)
	}
}

func TestCommunityCountedAtQuit(t *testing.T) {
	app := communityApp(t)
	app.communityStep(1, commT0, true)
	app.communityClose(commT0.Add(community.GoodSession))
	if s, _ := settings.Load(app.profilesDir); s.Community.GoodSessions != 1 {
		t.Fatalf("saved %+v", s.Community)
	}
	app.communityClose(commT0.Add(time.Hour))
	if app.communitySnapshot().GoodSessions != 1 {
		t.Fatal("counted twice")
	}
}
