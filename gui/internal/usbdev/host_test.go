package usbdev

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	"phonegyro/pkg/server"
)

// testHost is a Host that records what the manager told the app.
type testHost struct {
	Host
	mu        sync.Mutex
	log       strings.Builder
	names     []string
	gaps      []int
	frames    []server.MotionFrame
	recenters int
	detached  []bool // forgetName of each Detached
	statuses  []Status
}

func newTestHost(t *testing.T) *testHost {
	h := &testHost{}
	h.Host = Host{
		Log: func(level, format string, args ...any) {
			h.mu.Lock()
			defer h.mu.Unlock()
			fmt.Fprintf(&h.log, "[%s] "+format+"\n", append([]any{level}, args...)...)
		},
		Changed:  func() {},
		Name:     func(name string) { h.names = append(h.names, name) },
		Loss:     func(gap int) { h.gaps = append(h.gaps, gap) },
		Recenter: func() { h.recenters++ },
		Motion:   func(f server.MotionFrame) { h.frames = append(h.frames, f) },
		Detached: func(forgetName bool) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.detached = append(h.detached, forgetName)
		},
		Status: func(s Status) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.statuses = append(h.statuses, s)
		},
	}
	return h
}

func (h *testHost) logText() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.log.String()
}
