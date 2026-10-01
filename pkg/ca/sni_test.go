package ca

import (
	"crypto/tls"
	"net"
	"testing"
)

// A client chooses the SNI name: it must neither grow the leaf nor make the
// server sign a new certificate for every handshake.
func TestGetCertificate_IgnoresUnknownSNI(t *testing.T) {
	cm, err := NewCertificateManager(t.TempDir(), []net.IP{net.ParseIP("192.168.1.10")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	before := cm.LeafCert
	for _, name := range []string{"evil.example", "a.b.c", "x1", "x2"} {
		c, err := cm.GetCertificate(&tls.ClientHelloInfo{ServerName: name})
		if err != nil || c != before {
			t.Fatalf("SNI %q: cert changed (err %v)", name, err)
		}
	}
	if len(cm.knownDNS) != 2 {
		t.Fatalf("knownDNS grew: %v", cm.knownDNS)
	}
}
