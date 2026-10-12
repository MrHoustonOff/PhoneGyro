package community

import (
	"encoding/json"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 12, 20, 0, 0, 0, time.UTC)

func TestDue(t *testing.T) {
	ready := State{GoodSessions: SessionsNeeded}
	cases := []struct {
		name string
		s    State
		now  time.Time
		want bool
	}{
		{"fresh install", State{}, t0, false},
		{"one session short", State{GoodSessions: SessionsNeeded - 1}, t0, false},
		{"enough sessions, never shown", ready, t0, true},
		{"many sessions", State{GoodSessions: 50}, t0, true},
		{"done (star or never)", State{GoodSessions: 9, Done: true}, t0, false},
		{"answered once, a week later", State{GoodSessions: 5, ShownCount: 1, LastShown: t0.Add(-MinGap)}, t0, true},
		{"answered once, a second short of a week", State{GoodSessions: 5, ShownCount: 1, LastShown: t0.Add(-MinGap + time.Second)}, t0, false},
		{"answered once, yesterday", State{GoodSessions: 5, ShownCount: 1, LastShown: t0.Add(-24 * time.Hour)}, t0, false},
		{"answered the maximum", State{GoodSessions: 99, ShownCount: MaxShows, LastShown: t0.AddDate(-1, 0, 0)}, t0, false},
		{"over the maximum (damaged file)", State{GoodSessions: 99, ShownCount: MaxShows + 5}, t0, false},
		{"last shown a few hours ahead (clock drift)", State{GoodSessions: 5, ShownCount: 1, LastShown: t0.Add(3 * time.Hour)}, t0, false},
		{"last shown years ahead (clock went back)", State{GoodSessions: 5, ShownCount: 1, LastShown: t0.AddDate(5, 0, 0)}, t0, true},
	}
	for _, c := range cases {
		if got := c.s.Due(c.now); got != c.want {
			t.Errorf("%s: Due = %v, want %v (%+v)", c.name, got, c.want, c.s)
		}
	}
}

func TestAnswered(t *testing.T) {
	for _, c := range []struct {
		action   string
		wantDone bool
	}{
		{ActionStar, true}, {ActionNever, true}, {ActionLater, false}, {"", false}, {"garbage", false},
	} {
		s := State{GoodSessions: 3}
		s.Answered(c.action, t0)
		if s.Done != c.wantDone || s.ShownCount != 1 || !s.LastShown.Equal(t0) || s.GoodSessions != 3 {
			t.Errorf("Answered(%q) -> %+v", c.action, s)
		}
	}
}

// The whole life of the window: never before the third good session, at most
// twice, a week apart, and never again after "star" or "don't show again".
func TestLifecycle(t *testing.T) {
	var s State
	now := t0
	for i := 0; i < SessionsNeeded-1; i++ {
		s.GoodSessions++
		if s.Due(now) {
			t.Fatalf("due after %d sessions", s.GoodSessions)
		}
	}
	s.GoodSessions++
	if !s.Due(now) {
		t.Fatal("not due after the third session")
	}
	s.Answered(ActionLater, now)
	if s.Due(now.Add(time.Hour)) || s.Due(now.Add(MinGap-time.Minute)) {
		t.Fatal("due again within a week of 'later'")
	}
	now = now.Add(MinGap)
	if !s.Due(now) {
		t.Fatal("not due a week after 'later'")
	}
	s.Answered(ActionLater, now)
	if s.Due(now.AddDate(1, 0, 0)) {
		t.Fatalf("due after %d answers", s.ShownCount)
	}

	var once State
	once.GoodSessions = SessionsNeeded
	once.Answered(ActionStar, t0)
	if once.Due(t0.AddDate(1, 0, 0)) {
		t.Fatal("due after 'star'")
	}
	var never State
	never.GoodSessions = SessionsNeeded
	never.Answered(ActionNever, t0)
	if never.Due(t0.AddDate(1, 0, 0)) {
		t.Fatal("due after 'never'")
	}
}

func TestNormalize(t *testing.T) {
	s := State{GoodSessions: -4, ShownCount: -1}
	s.Normalize()
	if s.GoodSessions != 0 || s.ShownCount != 0 {
		t.Fatalf("Normalize -> %+v", s)
	}
}

func TestSessions(t *testing.T) {
	var s Sessions
	at := func(d time.Duration) time.Time { return t0.Add(d) }

	if ended, _ := s.Observe(0, at(0)); ended {
		t.Fatal("ended with no session")
	}
	s.Observe(1, at(0))
	s.Observe(2, at(time.Minute)) // a second client joins: same session
	s.Observe(1, at(2*time.Minute))
	if ended, good := s.Observe(0, at(GoodSession)); !ended || !good {
		t.Fatalf("15:00 session: ended %v good %v", ended, good)
	}
	if ended, _ := s.Observe(0, at(GoodSession+time.Second)); ended {
		t.Fatal("a session ended twice")
	}

	s.Observe(1, at(time.Hour))
	if ended, good := s.Observe(0, at(time.Hour+GoodSession-time.Second)); !ended || good {
		t.Fatalf("14:59 session: ended %v good %v", ended, good)
	}

	// a reconnect starts a new session: the clock does not carry over
	s.Observe(1, at(2*time.Hour))
	s.Observe(0, at(2*time.Hour+10*time.Minute))
	s.Observe(1, at(2*time.Hour+10*time.Minute+time.Second))
	if _, good := s.Observe(0, at(2*time.Hour+20*time.Minute)); good {
		t.Fatal("two short sessions were counted as one")
	}

	// repeated counts are not new sessions
	s.Observe(3, at(3*time.Hour))
	s.Observe(3, at(3*time.Hour+time.Minute))
	if _, good := s.Observe(0, at(3*time.Hour+GoodSession+time.Minute)); !good {
		t.Fatal("a long session with repeated counts was not counted")
	}
	// a negative count (never happens) is treated as zero
	s.Observe(1, at(4*time.Hour))
	if ended, _ := s.Observe(-1, at(4*time.Hour+time.Second)); !ended {
		t.Fatal("negative count did not end the session")
	}
}

func TestSessionsClose(t *testing.T) {
	var s Sessions
	if s.Close(t0) {
		t.Fatal("Close without a session counted")
	}
	s.Observe(1, t0)
	if !s.Close(t0.Add(GoodSession)) {
		t.Fatal("a long session open at quit was not counted")
	}
	if s.Close(t0.Add(2 * GoodSession)) {
		t.Fatal("Close counted the same session twice")
	}
	s.Observe(1, t0)
	if s.Close(t0.Add(time.Minute)) {
		t.Fatal("a short session open at quit was counted")
	}
}

// settings.json keeps the field names the plan names, and reads old files and
// garbage dates without failing.
func TestStateJSON(t *testing.T) {
	s := State{GoodSessions: 4, ShownCount: 1, LastShown: t0, Done: true}
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"goodSessions":4,"shownCount":1,"lastShown":"2026-10-12T20:00:00Z","done":true}`
	if string(b) != want {
		t.Fatalf("json %s, want %s", b, want)
	}
	var back State
	if err := json.Unmarshal(b, &back); err != nil || back != s {
		t.Fatalf("round trip: %+v, %v", back, err)
	}
	var empty State
	if err := json.Unmarshal([]byte(`{}`), &empty); err != nil || empty != (State{}) {
		t.Fatalf("empty object: %+v, %v", empty, err)
	}
}
