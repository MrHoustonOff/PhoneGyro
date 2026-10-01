package server

import (
	"net/http/httptest"
	"testing"
)

func TestHTTPRedirectKeepsHost(t *testing.T) {
	srv := NewServer(nil, 8080, 8443, nil, nil)
	r := httptest.NewRequest("GET", "http://192.168.1.10:8080/x?y=1", nil)
	w := httptest.NewRecorder()
	srv.HTTPMux.ServeHTTP(w, r)
	if got := w.Header().Get("Location"); got != "https://192.168.1.10:8443/x?y=1" {
		t.Fatalf("Location = %q", got)
	}
}

func TestSameOrigin(t *testing.T) {
	for origin, want := range map[string]bool{
		"":                          true,
		"https://192.168.1.10:8443": true,
		"https://evil.example":      false,
		"https://192.168.1.10:9999": false,
	} {
		r := httptest.NewRequest("GET", "https://192.168.1.10:8443/ws", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if got := sameOrigin(r); got != want {
			t.Errorf("sameOrigin(%q) = %v, want %v", origin, got, want)
		}
	}
}
