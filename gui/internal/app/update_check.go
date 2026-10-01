package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"phonegyro-gui/internal/version"
)

// The update check is the only request PhoneGyro makes to the internet, so it is
// off by default (settings.json checkUpdates). When on, updateLoop asks GitHub
// for the latest release's tag shortly after the window is up and then every
// few hours; a failed check is retried with a growing delay. A newer release
// shows a notice once per version (ui/notices.js, "update_notice" i18n) and
// stays in the footer (Status). Nothing about the user is sent.

// latestReleaseAPI is a variable so that tests can point it at a local server.
var latestReleaseAPI = "https://api.github.com/repos/MrHoustonOff/PhoneGyro/releases/latest"

const (
	updateExeAsset   = "PhoneGyro.exe"
	updateTimeout    = 10 * time.Second
	updateFirstWait  = 4 * time.Second // after the window is up: let the start settle first
	updateEvery      = 6 * time.Hour
)

// retry delays after failed checks (the last one repeats until it works).
var updateRetry = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute}

// Update check states (UpdateStatus.State).
const (
	updOff       = "off"       // the check is switched off
	updChecking  = "checking"  // a request is running
	updUpToDate  = "uptodate"  // checked: no newer release
	updAvailable = "available" // a newer release exists
	updError     = "error"     // the last check failed
)

// UpdateStatus is what the footer shows.
type UpdateStatus struct {
	State      string `json:"state"`
	Latest     string `json:"latest,omitempty"`     // updAvailable: the new version
	ReleaseURL string `json:"releaseUrl,omitempty"` // updAvailable: where to read about it
	CheckedAt  int64  `json:"checkedAt,omitempty"`  // unix seconds of the last finished check
	Error      string `json:"error,omitempty"`
}

// updateAsEnv pretends the running build is this version, to see the notice
// without waiting for a release: PHONEGYRO_UPDATE_AS=1.0.0
const updateAsEnv = "PHONEGYRO_UPDATE_AS"

type updateState struct {
	enabled  atomic.Bool
	checking atomic.Bool

	kick chan struct{} // wake updateLoop: the setting changed or the user asked for a check

	mu       sync.Mutex
	skipped  string      // version the user said not to remind about
	pending  *UpdateInfo // found, not yet closed in the UI
	notified string      // version the notice was already raised for in this run
	status   UpdateStatus
}

func (u *updateState) wake() {
	select {
	case u.kick <- struct{}{}:
	default:
	}
}

func (u *updateState) setSkipped(v string) {
	u.mu.Lock()
	u.skipped = v
	u.mu.Unlock()
}

func (u *updateState) getSkipped() string {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.skipped
}

// UpdateInfo is what the update notice shows.
type UpdateInfo struct {
	Current     string `json:"current"`
	Latest      string `json:"latest"`
	ReleaseURL  string `json:"releaseUrl"`
	DownloadURL string `json:"downloadUrl"` // the exe itself; the release page if not found
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
	Draft   bool   `json:"draft"`
	Assets  []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

// setUpdateStatus stores the status and tells the window.
func (a *App) setUpdateStatus(s UpdateStatus) {
	u := &a.update
	u.mu.Lock()
	u.status = s
	u.mu.Unlock()
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "update:status", s)
	}
}

// GetUpdateStatus is the update check's state for the footer.
func (a *App) GetUpdateStatus() UpdateStatus {
	u := &a.update
	u.mu.Lock()
	defer u.mu.Unlock()
	s := u.status
	if s.State == "" {
		s.State = updOff
		if u.enabled.Load() {
			s.State = updChecking
		}
	}
	return s
}

// CheckUpdateNow asks for a check right away (the footer's retry after a failure).
func (a *App) CheckUpdateNow() {
	if a.update.enabled.Load() {
		a.update.wake()
	}
}

// checkForUpdate runs one check and returns how long to wait before the next
// (0 means: nothing to schedule, wait for a wake-up).
func (a *App) checkForUpdate(failures int) time.Duration {
	u := &a.update
	if !u.enabled.Load() {
		a.setUpdateStatus(UpdateStatus{State: updOff})
		return 0
	}
	if !u.checking.CompareAndSwap(false, true) {
		return updateEvery
	}
	defer u.checking.Store(false)

	prev := a.GetUpdateStatus()
	a.setUpdateStatus(UpdateStatus{State: updChecking, CheckedAt: prev.CheckedAt, Latest: prev.Latest, ReleaseURL: prev.ReleaseURL})

	current := version.Get().Release
	if v := strings.TrimSpace(os.Getenv(updateAsEnv)); v != "" {
		current = v
	}
	info, err := fetchUpdate(context.Background(), latestReleaseAPI, current)
	now := time.Now().Unix()
	if !u.enabled.Load() { // switched off while the request ran
		a.setUpdateStatus(UpdateStatus{State: updOff})
		return 0
	}
	if err != nil {
		fmt.Printf("[update] check failed: %v\n", err)
		a.setUpdateStatus(UpdateStatus{State: updError, CheckedAt: prev.CheckedAt, Error: err.Error()})
		return updateRetry[min(failures, len(updateRetry)-1)]
	}
	if info == nil {
		a.setUpdateStatus(UpdateStatus{State: updUpToDate, CheckedAt: now})
		return updateEvery
	}
	a.setUpdateStatus(UpdateStatus{State: updAvailable, Latest: info.Latest, ReleaseURL: info.ReleaseURL, CheckedAt: now})
	u.mu.Lock()
	raise := info.Latest != u.skipped && info.Latest != u.notified
	if raise {
		u.pending = info
		u.notified = info.Latest
	}
	u.mu.Unlock()
	if raise && a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "update:available", *info)
	}
	return updateEvery
}

// updateLoop checks after the window is up, then every updateEvery; a failure is
// retried sooner. Switching the setting wakes it, so it never polls while off.
func (a *App) updateLoop() {
	select {
	case <-a.netGate:
	case <-time.After(netGateMax):
	}
	time.Sleep(updateFirstWait)
	failures := 0
	for {
		wait := a.checkForUpdate(failures)
		if a.GetUpdateStatus().State == updError {
			failures++
		} else {
			failures = 0
		}
		var timer <-chan time.Time
		if wait > 0 {
			timer = time.After(wait)
		}
		select {
		case <-timer:
		case <-a.update.kick:
			failures = 0
		}
	}
}

// fetchUpdate asks url (GitHub's latest-release API) and returns the release if
// it is newer than current, nil if not.
func fetchUpdate(ctx context.Context, url, current string) (*UpdateInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, updateTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "PhoneGyro") // GitHub rejects requests without one
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var rel githubRelease
	if err := json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 1<<20)).Decode(&rel); err != nil {
		return nil, err
	}
	latest := strings.TrimPrefix(strings.TrimSpace(rel.TagName), "v")
	if rel.Draft || !newerVersion(latest, current) {
		return nil, nil
	}
	info := &UpdateInfo{
		Current:     current,
		Latest:      latest,
		ReleaseURL:  rel.HTMLURL,
		DownloadURL: rel.HTMLURL,
	}
	for _, as := range rel.Assets {
		if strings.EqualFold(as.Name, updateExeAsset) && as.URL != "" {
			info.DownloadURL = as.URL
			break
		}
	}
	return info, nil
}

// newerVersion reports whether latest ("2.1.0") is above current ("2.0.1").
// Unparsable versions are never newer: better no notice than a wrong one.
func newerVersion(latest, current string) bool {
	l, okL := parseVersion(latest)
	c, okC := parseVersion(current)
	if !okL || !okC {
		return false
	}
	for i := range l {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	return false
}

func parseVersion(s string) ([3]int, bool) {
	var v [3]int
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	if i := strings.IndexAny(s, "-+"); i >= 0 {
		s = s[:i]
	}
	parts := strings.Split(s, ".")
	if len(parts) == 0 || len(parts) > 3 {
		return v, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return v, false
		}
		v[i] = n
	}
	return v, true
}

// PendingUpdate returns the found update if its notice has not been closed yet:
// the check can finish before the window has loaded.
func (a *App) PendingUpdate() *UpdateInfo {
	a.update.mu.Lock()
	defer a.update.mu.Unlock()
	return a.update.pending
}

// CloseUpdateNotice is called when the user closes the notice; skipVersion
// stops reminding about this version (a newer one is shown again).
func (a *App) CloseUpdateNotice(skipVersion bool) {
	u := &a.update
	u.mu.Lock()
	p := u.pending
	u.pending = nil
	changed := skipVersion && p != nil && u.skipped != p.Latest
	if changed {
		u.skipped = p.Latest
	}
	u.mu.Unlock()
	if changed {
		a.saveSettings()
	}
}
