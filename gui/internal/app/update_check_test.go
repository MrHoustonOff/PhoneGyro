package app

import (
	"context"
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
