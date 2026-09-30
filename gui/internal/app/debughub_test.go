package app

import (
	"bufio"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestDebugHubReplaysTheStart: what happened before the debug window connected
// (the start phases) reaches it first, then live events follow.
func TestDebugHubReplaysTheStart(t *testing.T) {
	a := &App{}
	a.startDebugHub()
	defer a.stopDebugHub()
	if a.hub.port == 0 {
		t.Fatal("hub did not listen")
	}
	a.hubPhase("before the window")

	resp, err := http.Get("http://127.0.0.1:" + strconv.Itoa(a.hub.port) + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	got := make(chan hubEvent, 16)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			line, ok := strings.CutPrefix(sc.Text(), "data: ")
			if !ok {
				continue
			}
			var ev hubEvent
			if json.Unmarshal([]byte(line), &ev) == nil {
				got <- ev
			}
		}
	}()

	want := []string{"settings loaded", "before the window", "after connect"}
	time.AfterFunc(200*time.Millisecond, func() { a.hubPhase("after connect") })
	deadline := time.After(3 * time.Second)
	for i := 0; i < len(want); {
		select {
		case ev := <-got:
			if ev.Kind != "phase" {
				continue // Go samples interleave
			}
			name := ev.Data.(map[string]any)["name"]
			if name != want[i] {
				t.Fatalf("phase %d = %v, want %s", i, name, want[i])
			}
			i++
		case <-deadline:
			t.Fatalf("got %d of %d phases", i, len(want))
		}
	}
}
