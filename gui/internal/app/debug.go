package app

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// The debug panel (frontend js/debug/panel.js, Settings → Performance) shows
// what the app is doing and, with "debug log" on, writes it to logs/debug.log:
// one summary line a second plus a line per anomaly. Nothing here runs while
// the panel is closed; the frontend asks for GetDebugStats only then.

const (
	debugLogName = "debug.log"
	debugLogMax  = 5 << 20 // bytes; then debug.log becomes debug.1.log
)

var appStart = time.Now()

type debugLogState struct {
	mu   sync.Mutex
	f    *os.File
	size int64
}

// DebugStats is the Go side of the debug panel.
type DebugStats struct {
	UptimeSec   float64 `json:"uptimeSec"`
	Goroutines  int     `json:"goroutines"`
	HeapMB      float64 `json:"heapMb"`      // live heap
	HeapSysMB   float64 `json:"heapSysMb"`   // heap reserved from the OS
	SysMB       float64 `json:"sysMb"`       // everything the Go runtime holds
	NumGC       uint32  `json:"numGc"`       // collections so far
	LastPauseMs float64 `json:"lastPauseMs"` // the last GC pause
	GCCPU       float64 `json:"gcCpu"`       // share of CPU spent in GC since start, %
	CPUPercent  float64 `json:"cpuPercent"`  // app + WebView2, share of the machine (resmon)
	RAMMB       float64 `json:"ramMb"`
	LogOn       bool    `json:"logOn"`
}

// GetDebugStats reads the Go runtime (ReadMemStats briefly stops the world:
// cheap at this heap size, and only asked for while the panel is open).
func (a *App) GetDebugStats() DebugStats {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	s := DebugStats{
		UptimeSec:  time.Since(appStart).Seconds(),
		Goroutines: runtime.NumGoroutine(),
		HeapMB:     float64(m.HeapAlloc) / (1 << 20),
		HeapSysMB:  float64(m.HeapSys) / (1 << 20),
		SysMB:      float64(m.Sys) / (1 << 20),
		NumGC:      m.NumGC,
		GCCPU:      m.GCCPUFraction * 100,
		LogOn:      a.debugLogOn.Load(),
	}
	if m.NumGC > 0 {
		s.LastPauseMs = float64(m.PauseNs[(m.NumGC+255)%256]) / 1e6
	}
	if p := a.lastResStats.Load(); p != nil {
		if v, ok := (*p)["cpuPercent"].(float64); ok {
			s.CPUPercent = v
		}
		if v, ok := (*p)["ramMb"].(float64); ok {
			s.RAMMB = v
		}
	}
	return s
}

// WriteDebugLog appends the panel's lines to logs/debug.log (only while the
// debug log setting is on). Rotates at 5 MB, keeping one old file.
func (a *App) WriteDebugLog(lines []string) {
	if !a.debugLogOn.Load() || a.profilesDir == "" || len(lines) == 0 {
		return
	}
	d := &a.debugLog
	d.mu.Lock()
	defer d.mu.Unlock()
	dir := filepath.Join(a.profilesDir, "logs")
	path := filepath.Join(dir, debugLogName)
	if d.f == nil {
		_ = os.MkdirAll(dir, 0755)
		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			return
		}
		d.f = f
		if st, err := f.Stat(); err == nil {
			d.size = st.Size()
		}
	}
	ts := time.Now().Format("2006-01-02 15:04:05.000")
	var b strings.Builder
	for _, l := range lines {
		fmt.Fprintf(&b, "[%s] %s\n", ts, strings.TrimSpace(l))
	}
	n, _ := d.f.WriteString(b.String())
	d.size += int64(n)
	if d.size > debugLogMax {
		d.f.Close()
		d.f = nil
		_ = os.Rename(path, filepath.Join(dir, "debug.1.log"))
	}
}

// closeDebugLog is called when the setting goes off and at shutdown.
func (a *App) closeDebugLog() {
	a.debugLog.mu.Lock()
	if a.debugLog.f != nil {
		a.debugLog.f.Close()
		a.debugLog.f = nil
	}
	a.debugLog.mu.Unlock()
}

// DisableDebug is the debug panel's close button: it turns the panel and the
// debug log off in settings.json (the hotkey only hides it for now).
func (a *App) DisableDebug() {
	a.debugPanel.Store(false)
	a.debugLogOn.Store(false)
	a.closeDebugLog()
	a.saveSettings()
}
