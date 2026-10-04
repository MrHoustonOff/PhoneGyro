package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewerVersion(t *testing.T) {
	cases := []struct {
		latest, current string
		want            bool
	}{
		{"2.0.2", "2.0.1", true},
		{"2.1.0", "2.0.9", true},
		{"10.0.0", "9.9.9", true},
		{"v2.0.1", "2.0.1", false},
		{"2.0.0", "2.0.1", false},
		{"2.0.1-rc1", "2.0.1", false},
		{"2.1", "2.0.5", true},
		{"garbage", "2.0.1", false},
		{"2.0.2", "", false},
	}
	for _, c := range cases {
		if got := newerVersion(c.latest, c.current); got != c.want {
			t.Errorf("newerVersion(%q, %q) = %v, want %v", c.latest, c.current, got, c.want)
		}
	}
}

func TestFetchUpdate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Write([]byte(`{"tag_name":"v2.1.0","html_url":"https://example/rel","assets":[
			{"name":"PhoneGyro-arm64.exe","browser_download_url":"https://example/arm"},
			{"name":"PhoneGyro.exe","browser_download_url":"https://example/exe"}]}`))
	}))
	defer srv.Close()

	info, err := fetchUpdate(context.Background(), srv.URL, "2.0.1")
	if err != nil || info == nil {
		t.Fatalf("got %v, %v; want an update", info, err)
	}
	if info.Latest != "2.1.0" || info.DownloadURL != "https://example/exe" || info.ReleaseURL != "https://example/rel" {
		t.Fatalf("unexpected info %+v", info)
	}

	if info, err := fetchUpdate(context.Background(), srv.URL, "2.1.0"); err != nil || info != nil {
		t.Fatalf("same version: got %v, %v; want nil", info, err)
	}
}

func TestCloseUpdateNoticeSkips(t *testing.T) {
	app := NewApp()
	app.profilesDir = t.TempDir()
	app.update.pending = &UpdateInfo{Latest: "2.1.0"}

	app.CloseUpdateNotice(true)
	if app.PendingUpdate() != nil {
		t.Fatal("notice still pending after close")
	}
	if got := app.GetAppSettings().SkippedUpdate; got != "2.1.0" {
		t.Fatalf("SkippedUpdate = %q, want 2.1.0", got)
	}
}

// releaseServer answers GitHub's latest-release call with the given tag (or a 500).
func releaseServer(t *testing.T, tag string, fail *bool) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if *fail {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		fmt.Fprintf(w, `{"tag_name":%q,"html_url":"https://example.test/rel","draft":false,"assets":[]}`, tag)
	}))
	old := latestReleaseAPI
	latestReleaseAPI = srv.URL
	t.Cleanup(func() { latestReleaseAPI = old; srv.Close() })
}

func TestCheckForUpdateStates(t *testing.T) {
	t.Setenv(updateAsEnv, "2.0.0")
	fail := false
	releaseServer(t, "v2.1.0", &fail)
	app := NewApp()
	app.profilesDir = t.TempDir()
	app.update.enabled.Store(false) // NewApp reads the real settings of this machine

	// Switched off: nothing is asked, the footer says "off".
	if d := app.checkForUpdate(0); d != 0 || app.GetUpdateStatus().State != updOff {
		t.Fatalf("off: wait %v, status %+v", d, app.GetUpdateStatus())
	}

	app.update.enabled.Store(true)
	fail = true
	if d := app.checkForUpdate(0); d != updateRetry[0] || app.GetUpdateStatus().State != updError {
		t.Fatalf("failure: wait %v, status %+v", d, app.GetUpdateStatus())
	}
	if d := app.checkForUpdate(99); d != updateRetry[len(updateRetry)-1] {
		t.Fatalf("retry delay must cap at %v, got %v", updateRetry[len(updateRetry)-1], d)
	}

	fail = false
	if d := app.checkForUpdate(0); d != updateEvery {
		t.Fatalf("success: wait %v", d)
	}
	st := app.GetUpdateStatus()
	if st.State != updAvailable || st.Latest != "2.1.0" || st.CheckedAt == 0 {
		t.Fatalf("available: %+v", st)
	}
	if app.PendingUpdate() == nil {
		t.Fatal("the notice must be raised for a new version")
	}

	// The same version is not announced twice in one run, the footer still shows it.
	app.update.pending = nil
	app.checkForUpdate(0)
	if app.PendingUpdate() != nil || app.GetUpdateStatus().State != updAvailable {
		t.Fatalf("second check: pending=%v status=%+v", app.PendingUpdate(), app.GetUpdateStatus())
	}

	// Up to date.
	t.Setenv(updateAsEnv, "2.1.0")
	app.checkForUpdate(0)
	if st := app.GetUpdateStatus(); st.State != updUpToDate || st.CheckedAt == 0 {
		t.Fatalf("up to date: %+v", st)
	}

	// Switched off while idle.
	app.update.enabled.Store(false)
	app.checkForUpdate(0)
	if app.GetUpdateStatus().State != updOff {
		t.Fatalf("off again: %+v", app.GetUpdateStatus())
	}
}

func TestSkippedVersionIsNotRaised(t *testing.T) {
	t.Setenv(updateAsEnv, "2.0.0")
	fail := false
	releaseServer(t, "v2.1.0", &fail)
	app := NewApp()
	app.profilesDir = t.TempDir()
	app.update.enabled.Store(true)
	app.update.setSkipped("2.1.0")
	app.checkForUpdate(0)
	if app.PendingUpdate() != nil {
		t.Fatal("a skipped version must not raise the notice")
	}
	if st := app.GetUpdateStatus(); st.State != updAvailable || st.Latest != "2.1.0" {
		t.Fatalf("the footer still shows it: %+v", st)
	}
}

func TestUpdateExeAsset(t *testing.T) {
	if updateExeAsset("amd64") != "PhoneGyro.exe" || updateExeAsset("arm64") != "PhoneGyro-windows-arm64.exe" {
		t.Fatal("wrong release asset for the architecture")
	}
}
