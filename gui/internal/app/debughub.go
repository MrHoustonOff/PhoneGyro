package app

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"phonegyro-gui/internal/version"
)

// The debug hub: with the debug window or the debug log on (Settings →
// Performance), it starts first thing in Run, before the main window, servers
// and DSU, so the start itself is recorded.
//
//   events   every event (start phases, Go and UI samples, warnings, JS errors)
//            goes into a ring buffer and to the subscribers
//   window   a separate process (PhoneGyro.exe --debugwin, debugwin.go) reads
//            them from a Server-Sent Events stream on 127.0.0.1:<random port>;
//            a new subscriber first gets the whole buffer, so nothing from
//            before it connected is lost
//   log      with the debug log on, logs/debug.log gets a session header, a
//            summary line a second and a line per warning, error and phase
//
// Nothing of it runs while both settings are off.

const (
	hubRing     = 2000 // events kept for a late subscriber
	hubSampleMs = 500  // Go and link sample period
)

type hubEvent struct {
	T    float64 `json:"t"`    // ms since the process started
	Kind string  `json:"kind"` // phase | go | ui | log
	Data any     `json:"data"`
}

type debugHub struct {
	mu       sync.Mutex
	ring     []hubEvent
	subs     map[chan []byte]struct{}
	port     int
	running  atomic.Bool
	stop     chan struct{}
	win      *exec.Cmd
	winAlive atomic.Bool // the debug window process runs
	lastUI   map[string]any
	lastGo   DebugStats
}

// hubActive: the hub is up (the debug window or the log is on).
func (a *App) hubActive() bool { return a.hub.running.Load() }

// startDebugHub runs in Run right after the settings load, when either debug
// setting is on. Idempotent.
func (a *App) startDebugHub() {
	h := &a.hub
	if !h.running.CompareAndSwap(false, true) {
		return
	}
	h.subs = map[chan []byte]struct{}{}
	h.stop = make(chan struct{})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err == nil {
		h.port = ln.Addr().(*net.TCPAddr).Port
		mux := http.NewServeMux()
		mux.HandleFunc("/events", a.hubServeEvents)
		mux.HandleFunc("/disable", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			go a.DisableDebug()
		})
		go func() { _ = http.Serve(ln, mux) }()
	}
	v := version.Get()
	a.debugLogLine(fmt.Sprintf("INFO session: PhoneGyro %s · pid %d · hub :%d", v.Display, os.Getpid(), h.port))
	a.hubPhase("settings loaded")
	go a.hubSampler()
	if a.debugPanel.Load() {
		a.startDebugWindow()
	}
}

// stopDebugHub closes the window and stops sampling once both settings are off.
func (a *App) stopDebugHub() {
	h := &a.hub
	if !h.running.CompareAndSwap(true, false) {
		return
	}
	close(h.stop)
	a.stopDebugWindow()
}

// syncDebug applies the two debug settings after they change.
func (a *App) syncDebug() {
	on := a.debugPanel.Load() || a.debugLogOn.Load()
	if on && !a.hubActive() {
		a.startDebugHub()
		return
	}
	if !on {
		a.stopDebugHub()
		return
	}
	if a.debugPanel.Load() {
		a.startDebugWindow()
	} else {
		a.stopDebugWindow()
	}
}

func (a *App) hubPublish(kind string, data any) {
	if !a.hubActive() {
		return
	}
	ev := hubEvent{T: float64(time.Since(appStart).Microseconds()) / 1000, Kind: kind, Data: data}
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h := &a.hub
	h.mu.Lock()
	h.ring = append(h.ring, ev)
	if len(h.ring) > hubRing {
		h.ring = h.ring[len(h.ring)-hubRing:]
	}
	for c := range h.subs {
		select {
		case c <- b:
		default: // a stuck reader loses samples, never blocks the app
		}
	}
	h.mu.Unlock()
}

// hubPhase marks a start (or stop) phase: the window's timeline, one log line.
func (a *App) hubPhase(name string) {
	if !a.hubActive() {
		return
	}
	a.hubPublish("phase", map[string]any{"name": name})
	a.debugLogLine(fmt.Sprintf("INFO phase: %s at %.0f ms", name, float64(time.Since(appStart).Microseconds())/1000))
}

func (a *App) hubServeEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	fl, ok := w.(http.Flusher)
	if !ok {
		return
	}
	h := &a.hub
	c := make(chan []byte, 256)
	h.mu.Lock()
	backlog := append([]hubEvent(nil), h.ring...)
	h.subs[c] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.subs, c)
		h.mu.Unlock()
	}()
	for _, ev := range backlog {
		if b, err := json.Marshal(ev); err == nil {
			fmt.Fprintf(w, "data: %s\n\n", b)
		}
	}
	fl.Flush()
	for {
		select {
		case b := <-c:
			fmt.Fprintf(w, "data: %s\n\n", b)
			fl.Flush()
		case <-r.Context().Done():
			return
		case <-h.stop:
			return
		}
	}
}

// hubSampler: the Go runtime and the link, twice a second; one summary log
// line a second with the latest UI sample.
func (a *App) hubSampler() {
	t := time.NewTicker(hubSampleMs * time.Millisecond)
	defer t.Stop()
	n := 0
	for {
		select {
		case <-a.hub.stop:
			return
		case <-t.C:
		}
		s := a.GetDebugStats()
		link := map[string]any{}
		if a.ctx != nil {
			st := a.GetState()
			link = map[string]any{"status": st.Status, "input": st.InputMode, "hz": st.Hz, "ping": st.PingMs, "dsu": st.DsuClients}
		}
		a.hub.mu.Lock()
		a.hub.lastGo = s
		ui := a.hub.lastUI
		a.hub.mu.Unlock()
		a.hubPublish("go", map[string]any{"stats": s, "link": link})
		if n++; n%2 == 0 {
			a.debugLogLine(summaryLine(s, link, ui))
		}
	}
}

func summaryLine(s DebugStats, link, ui map[string]any) string {
	f := func(m map[string]any, k string) string {
		if m == nil {
			return "-"
		}
		switch v := m[k].(type) {
		case float64:
			return strconv.FormatFloat(v, 'f', 1, 64)
		case nil:
			return "-"
		default:
			return fmt.Sprint(v)
		}
	}
	return fmt.Sprintf("ui fps=%s p50/p95/p99/max=%s/%s/%s/%sms long=%s gap=%sms js=%sMB dom=%s | go cpu=%.1f%% ram=%.0fMB heap=%.1fMB gc=%d pause=%.2fms gor=%d | link %s/%s hz=%s ping=%s dsu=%s",
		f(ui, "fps"), f(ui, "p50"), f(ui, "p95"), f(ui, "p99"), f(ui, "worst"), f(ui, "longTasks"), f(ui, "maxGap"), f(ui, "heapJs"), f(ui, "dom"),
		s.CPUPercent, s.RAMMB, s.HeapMB, s.NumGC, s.LastPauseMs, s.Goroutines,
		f(link, "status"), f(link, "input"), f(link, "hz"), f(link, "ping"), f(link, "dsu"))
}

// debugLogLine writes one line when the debug log is on.
func (a *App) debugLogLine(line string) {
	if a.debugLogOn.Load() {
		a.WriteDebugLog([]string{line})
	}
}

// PushDebug is the main window's collector (js/debug/collect.js): a UI sample
// ("ui") or an event ("log": {level, msg}; "phase": {name}).
func (a *App) PushDebug(kind string, data map[string]any) {
	if !a.hubActive() {
		return
	}
	switch kind {
	case "ui":
		a.hub.mu.Lock()
		a.hub.lastUI = data
		a.hub.mu.Unlock()
		a.hubPublish("ui", data)
	case "phase":
		name, _ := data["name"].(string)
		a.hubPhase("ui: " + name)
	case "log":
		lvl, _ := data["level"].(string)
		msg, _ := data["msg"].(string)
		a.hubPublish("log", map[string]any{"level": lvl, "msg": msg})
		a.debugLogLine(fmt.Sprintf("%s %s", lvl, msg))
	}
}

// IsDebugActive tells the main window whether to collect (and keeps the
// localStorage mirror right).
func (a *App) IsDebugActive() bool { return a.hubActive() }

// startDebugWindow spawns PhoneGyro.exe --debugwin with the hub's port and our
// pid (the window closes itself when we exit).
func (a *App) startDebugWindow() {
	h := &a.hub
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.winAlive.Load() {
		return
	}
	exe, err := os.Executable()
	if err != nil || h.port == 0 {
		return
	}
	_, _, _ = procAllowSetForegroundWindow.Call(uintptr(0xFFFFFFFF))
	cmd := exec.Command(exe, "--debugwin", "--port="+strconv.Itoa(h.port), "--parent="+strconv.Itoa(os.Getpid()))
	if cmd.Start() == nil {
		h.win = cmd
		h.winAlive.Store(true)
		go func() { _ = cmd.Wait(); h.winAlive.Store(false) }()
		go a.hubPhase("debug window started")
	}
}

func (a *App) stopDebugWindow() {
	h := &a.hub
	h.mu.Lock()
	c := h.win
	h.win = nil
	h.mu.Unlock()
	if c != nil && c.Process != nil {
		_ = c.Process.Kill()
	}
}

// ToggleDebugWindow is Ctrl+Shift+Alt+D in the main window: show or close the
// debug window without touching the settings (the hub starts if needed).
func (a *App) ToggleDebugWindow() {
	if a.hub.winAlive.Load() {
		a.stopDebugWindow()
		return
	}
	a.startDebugHub()
	a.startDebugWindow()
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "debug:active", true)
	}
}
