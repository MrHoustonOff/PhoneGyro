package ca

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// sign issues a leaf for ips/names straight from the root, the way someone
// holding a stolen ca.key would.
func sign(t *testing.T, cm *CertificateManager, ips []net.IP, names []string) *x509.Certificate {
	t.Helper()
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: "x"},
		NotBefore:    time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses: ips, DNSNames: names,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, cm.RootCert, &k.PublicKey, cm.RootKey)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := x509.ParseCertificate(der)
	return c
}

func verify(cm *CertificateManager, c *x509.Certificate) error {
	roots := x509.NewCertPool()
	roots.AddCert(cm.RootCert)
	_, err := c.Verify(x509.VerifyOptions{Roots: roots})
	return err
}

// The root vouches for local addresses only: a stolen key cannot fake a site.
func TestRootNameConstraints(t *testing.T) {
	cm, err := NewCertificateManager(t.TempDir(), []net.IP{net.ParseIP("192.168.1.10")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, ok := range []struct {
		ips   []string
		names []string
	}{
		{[]string{"192.168.1.10"}, nil}, {[]string{"10.1.2.3"}, nil}, {[]string{"172.20.10.2"}, nil},
		{[]string{"100.101.102.103"}, nil}, {nil, []string{"pc.local"}}, {nil, []string{"localhost"}},
	} {
		var ips []net.IP
		for _, s := range ok.ips {
			ips = append(ips, net.ParseIP(s))
		}
		if err := verify(cm, sign(t, cm, ips, ok.names)); err != nil {
			t.Errorf("%v %v rejected: %v", ok.ips, ok.names, err)
		}
	}
	for _, bad := range []struct {
		ips   []string
		names []string
	}{
		{[]string{"8.8.8.8"}, nil}, {[]string{"26.1.2.3"}, nil}, {nil, []string{"google.com"}}, {nil, []string{"apple.com"}},
	} {
		var ips []net.IP
		for _, s := range bad.ips {
			ips = append(ips, net.ParseIP(s))
		}
		if err := verify(cm, sign(t, cm, ips, bad.names)); err == nil {
			t.Errorf("%v %v accepted by the root", bad.ips, bad.names)
		}
	}
}

// A VPN adapter with a public-looking address must not end up in the leaf:
// one SAN outside the constraints would make the phone reject all of it.
func TestLeafSkipsAddressesOutsideConstraints(t *testing.T) {
	cm, err := NewCertificateManager(t.TempDir(), []net.IP{net.ParseIP("192.168.1.10"), net.ParseIP("26.5.6.7")}, []string{"custom.host"})
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := x509.ParseCertificate(cm.LeafCert.Certificate[0])
	for _, ip := range leaf.IPAddresses {
		if !PermittedIP(ip) {
			t.Fatalf("leaf carries %v", ip)
		}
	}
	for _, n := range leaf.DNSNames {
		if !PermittedDNS(n) {
			t.Fatalf("leaf carries %q", n)
		}
	}
	if err := verify(cm, leaf); err != nil {
		t.Fatalf("leaf does not verify: %v", err)
	}
}

// A root from before the constraints, or a broken one, is replaced; a good one stays.
func TestRootMigration(t *testing.T) {
	dir := t.TempDir()
	// An old-style root: no name constraints.
	k, _ := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "PhoneGyro Root CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(365 * 24 * time.Hour),
		KeyUsage: x509.KeyUsageCertSign, BasicConstraintsValid: true, IsCA: true}
	der, _ := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	kb, _ := x509.MarshalECPrivateKey(k)
	writePEM(t, filepath.Join(dir, "ca.crt"), "CERTIFICATE", der)
	writePEM(t, filepath.Join(dir, "ca.key"), "EC PRIVATE KEY", kb)

	cm, err := NewCertificateManager(dir, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if cm.Regenerated == "" || len(cm.RootCert.PermittedIPRanges) == 0 {
		t.Fatalf("old root kept (Regenerated=%q)", cm.Regenerated)
	}
	first := cm.Fingerprint()

	again, err := NewCertificateManager(dir, nil, nil)
	if err != nil || again.Regenerated != "" || again.Fingerprint() != first {
		t.Fatalf("new root not kept: %v %q", err, again.Regenerated)
	}

	if err := os.WriteFile(filepath.Join(dir, "ca.key"), []byte("garbage"), 0o600); err != nil {
		t.Fatal(err)
	}
	broken, err := NewCertificateManager(dir, nil, nil)
	if err != nil || broken.Regenerated == "" || broken.Fingerprint() == first {
		t.Fatalf("broken root not replaced: %v", err)
	}
	if !strings.Contains(broken.Regenerated, "key") {
		t.Fatalf("reason: %q", broken.Regenerated)
	}
}

func writePEM(t *testing.T, path, typ string, b []byte) {
	t.Helper()
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: b}), 0o600); err != nil {
		t.Fatal(err)
	}
}

// The leaf survives a restart while the addresses stay the same (Android's
// "proceed anyway" is remembered per certificate), and is re-signed when a new
// address appears.
func TestLeafReusedAcrossStarts(t *testing.T) {
	dir := t.TempDir()
	ips := []net.IP{net.ParseIP("192.168.1.10")}
	a, err := NewCertificateManager(dir, ips, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewCertificateManager(dir, ips, nil)
	if err != nil {
		t.Fatal(err)
	}
	if string(a.LeafCert.Certificate[0]) != string(b.LeafCert.Certificate[0]) {
		t.Fatal("leaf re-signed on a plain restart")
	}
	c, err := NewCertificateManager(dir, append(ips, net.ParseIP("10.9.8.7")), nil)
	if err != nil {
		t.Fatal(err)
	}
	if string(c.LeafCert.Certificate[0]) == string(b.LeafCert.Certificate[0]) {
		t.Fatal("leaf kept although a new address appeared")
	}
	leaf, _ := x509.ParseCertificate(c.LeafCert.Certificate[0])
	if err := verify(c, leaf); err != nil {
		t.Fatal(err)
	}
}
