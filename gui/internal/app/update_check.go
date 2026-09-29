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
// off by default (settings.json checkUpdates). When on, it asks GitHub once per
// start for the latest release's tag and, if that is newer, shows a notice with
// links (js/update-notice.js, #update-modal, the "update_notice" i18n section).
// Nothing about the user is sent; any failure is silent.

const (
	latestReleaseAPI = "https://api.github.com/repos/MrHoustonOff/PhoneGyro/releases/latest"
	updateExeAsset   = "PhoneGyro.exe"
	updateTimeout    = 5 * time.Second
)

// updateAsEnv pretends the running build is this version, to see the notice
// without waiting for a release: PHONEGYRO_UPDATE_AS=1.0.0
const updateAsEnv = "PHONEGYRO_UPDATE_AS"

type updateState struct {
	enabled  atomic.Bool
	checking atomic.Bool

	mu      sync.Mutex
	skipped string      // version the user said not to remind about
	pending *UpdateInfo // found, not yet closed in the UI
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

// checkForUpdate runs once at startup and when the setting is switched on.
func (a *App) checkForUpdate() {
	u := &a.update
	if !u.enabled.Load() || !u.checking.CompareAndSwap(false, true) {
		return
	}
	defer u.checking.Store(false)

	current := version.Get().Release
	if v := strings.TrimSpace(os.Getenv(updateAsEnv)); v != "" {
		current = v
	}
	info, err := fetchUpdate(context.Background(), latestReleaseAPI, current)
	if err != nil {
		fmt.Printf("[update] check failed: %v\n", err)
		return
	}
	if info == nil || info.Latest == u.getSkipped() {
		return
	}
	u.mu.Lock()
	u.pending = info
	u.mu.Unlock()
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "update:available", *info)
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
