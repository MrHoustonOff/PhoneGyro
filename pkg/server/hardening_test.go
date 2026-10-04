package server

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"phonegyro/pkg/ca"
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

func freePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// Rebind: the server answers on the new ports, the old ones are free, and the
// leaf is served to a client without SNI (the phone connects by IP).
func TestRebind(t *testing.T) {
	cm, err := ca.NewCertificateManager(t.TempDir(), []net.IP{net.ParseIP("127.0.0.1")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	h1, s1 := freePort(t), freePort(t)
	srv := NewServer(cm, h1, s1, []byte("page"), nil)
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer srv.Stop()
	h2, s2 := freePort(t), freePort(t)
	if err := srv.Rebind(h2, s2); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/mode", h2))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	conn, err := tls.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", s2), &tls.Config{InsecureSkipVerify: true})
	if err != nil {
		t.Fatal(err)
	}
	if cs := conn.ConnectionState(); len(cs.PeerCertificates) == 0 || len(cs.PeerCertificates[0].IPAddresses) == 0 {
		t.Fatal("no leaf with IP SANs served without SNI")
	}
	conn.Close()
	if l, err := net.Listen("tcp", fmt.Sprintf(":%d", h1)); err != nil {
		t.Fatalf("old HTTP port still taken: %v", err)
	} else {
		l.Close()
	}
}
