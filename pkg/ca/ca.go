package ca

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"encoding/xml"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CertificateManager handles creation and persistence of the Root CA and Leaf certificates.
type CertificateManager struct {
	storageDir string
	RootCert   *x509.Certificate
	RootKey    *ecdsa.PrivateKey
	LeafCert   *tls.Certificate
	// Regenerated says why the stored root CA was replaced (empty: loaded, or
	// created on the first start).
	Regenerated string
	leafKey     *ecdsa.PrivateKey
	mu          sync.RWMutex
	knownIPs    map[string]net.IP
	knownDNS    map[string]bool
}

// NewCertificateManager creates or loads the local Root CA and signs a Leaf certificate.
func NewCertificateManager(storageDir string, hostIPs []net.IP, hostnames []string) (*CertificateManager, error) {
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create cert storage dir: %w", err)
	}

	cm := &CertificateManager{
		storageDir: storageDir,
		knownIPs:   make(map[string]net.IP),
		knownDNS:   make(map[string]bool),
	}

	if err := cm.loadOrGenerateRootCA(); err != nil {
		return nil, fmt.Errorf("root CA error: %w", err)
	}

	// Register defaults
	cm.knownIPs["127.0.0.1"] = net.ParseIP("127.0.0.1")
	cm.knownDNS["localhost"] = true
	cm.knownDNS["gamepad.local"] = true

	for _, ip := range hostIPs {
		if ip != nil && !ip.IsLoopback() {
			if ip4 := ip.To4(); ip4 != nil {
				cm.knownIPs[ip4.String()] = ip4
			} else {
				cm.knownIPs[ip.String()] = ip
			}
		}
	}

	// Proactively register all non-loopback IPv4 addresses on all host interfaces
	for _, ip := range scanHostIPv4s() {
		cm.knownIPs[ip.String()] = ip
	}

	for _, h := range hostnames {
		h = strings.TrimSpace(h)
		if h != "" {
			cm.knownDNS[h] = true
		}
	}

	cm.mu.Lock()
	defer cm.mu.Unlock()
	if cm.loadLeafLocked() {
		return cm, nil
	}
	if err := cm.generateLeafCertLocked(); err != nil {
		return nil, fmt.Errorf("leaf certificate error: %w", err)
	}
	return cm, nil
}

func (cm *CertificateManager) loadOrGenerateRootCA() error {
	caCertPath := filepath.Join(cm.storageDir, "ca.crt")
	caKeyPath := filepath.Join(cm.storageDir, "ca.key")

	if fileExists(caCertPath) && fileExists(caKeyPath) {
		cert, key, err := loadRootCA(caCertPath, caKeyPath)
		if err == nil {
			cm.RootCert = cert
			cm.RootKey = key
			return nil
		}
		// Unreadable, mismatched, expiring or from before the name constraints:
		// a new CA (the phone has to install it once more, docs/tls.*.md).
		cm.Regenerated = err.Error()
	}

	// Generate new Root CA using ECDSA P-384
	privKey, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	if err != nil {
		return fmt.Errorf("failed to generate CA private key: %w", err)
	}

	serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialNumberLimit)
	if err != nil {
		return fmt.Errorf("failed to generate serial number: %w", err)
	}

	now := time.Now().Add(-1 * time.Hour)
	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization:       []string{"PhoneGyro"},
			OrganizationalUnit: []string{"Local Motion Controller"},
			CommonName:         rootCommonName(),
		},
		NotBefore:             now,
		NotAfter:              now.Add(3650 * 24 * time.Hour), // 10 years validity
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            1,
		// The phone trusts this CA for local addresses only: a leaked ca.key
		// cannot vouch for any site on the internet (docs/tls.en.md).
		PermittedIPRanges:   PermittedIPRanges(),
		PermittedDNSDomains: PermittedDNSDomains,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &privKey.PublicKey, privKey)
	if err != nil {
		return fmt.Errorf("failed to create root certificate: %w", err)
	}

	parsedCert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return err
	}

	// Save to disk
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyBytes, err := x509.MarshalECPrivateKey(privKey)
	if err != nil {
		return err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes})

	if err := os.WriteFile(caCertPath, certPEM, 0644); err != nil {
		return err
	}
	if err := os.WriteFile(caKeyPath, keyPEM, 0600); err != nil {
		return err
	}

	cm.RootCert = parsedCert
	cm.RootKey = privKey
	return nil
}

func (cm *CertificateManager) generateLeafCertLocked() error {
	if cm.leafKey == nil {
		leafKey, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
		if err != nil {
			return fmt.Errorf("failed to generate leaf key: %w", err)
		}
		cm.leafKey = leafKey
	}

	serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialNumberLimit)
	if err != nil {
		return fmt.Errorf("failed to generate leaf serial: %w", err)
	}

	// Only addresses the root may vouch for: one SAN outside its name
	// constraints (a VPN adapter on 25.x or 26.x, say) makes the phone reject
	// the whole leaf, for every address.
	var ips []net.IP
	for _, ip := range cm.knownIPs {
		if ip != nil && PermittedIP(ip) {
			ips = append(ips, ip)
		}
	}

	var dnsNames []string
	for name := range cm.knownDNS {
		if PermittedDNS(name) {
			dnsNames = append(dnsNames, name)
		}
	}

	now := time.Now().Add(-1 * time.Hour)
	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"PhoneGyro"},
			CommonName:   "gamepad.local",
		},
		NotBefore:             now,
		NotAfter:              now.Add(365 * 24 * time.Hour), // 365 days (strictly <= 398 days per Apple TLS policy)
		KeyUsage:              x509.KeyUsageDigitalSignature, // ECDSA requires only digitalSignature
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  false,
		IPAddresses:           ips,
		DNSNames:              dnsNames,
	}

	leafDER, err := x509.CreateCertificate(rand.Reader, &template, cm.RootCert, &cm.leafKey.PublicKey, cm.RootKey)
	if err != nil {
		return fmt.Errorf("failed to sign leaf certificate: %w", err)
	}

	tlsCert := tls.Certificate{
		Certificate: [][]byte{leafDER, cm.RootCert.Raw},
		PrivateKey:  cm.leafKey,
	}

	cm.LeafCert = &tlsCert
	cm.saveLeafLocked(leafDER)
	return nil
}

// The leaf is kept on disk (leaf.crt, leaf.key) and reused while it still
// covers this PC's addresses: Chrome on Android remembers "proceed anyway" for
// one certificate, so a leaf re-signed at every start brought its warning back
// at every start.
const (
	leafCertFile    = "leaf.crt"
	leafKeyFile     = "leaf.key"
	leafMinValidity = 30 * 24 * time.Hour
)

// loadLeafLocked takes the stored leaf if the current root signed it, it is
// valid for another month and it names every known address and name.
func (cm *CertificateManager) loadLeafLocked() bool {
	certPEM, err1 := os.ReadFile(filepath.Join(cm.storageDir, leafCertFile))
	keyPEM, err2 := os.ReadFile(filepath.Join(cm.storageDir, leafKeyFile))
	if err1 != nil || err2 != nil {
		return false
	}
	cb, _ := pem.Decode(certPEM)
	kb, _ := pem.Decode(keyPEM)
	if cb == nil || kb == nil {
		return false
	}
	leaf, err := x509.ParseCertificate(cb.Bytes)
	if err != nil || leaf.CheckSignatureFrom(cm.RootCert) != nil || time.Until(leaf.NotAfter) < leafMinValidity {
		return false
	}
	key, err := x509.ParseECPrivateKey(kb.Bytes)
	if err != nil {
		return false
	}
	if pub, ok := leaf.PublicKey.(*ecdsa.PublicKey); !ok || !pub.Equal(&key.PublicKey) {
		return false
	}
	have := map[string]bool{}
	for _, ip := range leaf.IPAddresses {
		have[ip.String()] = true
	}
	for _, n := range leaf.DNSNames {
		have[n] = true
	}
	for k, ip := range cm.knownIPs {
		if ip != nil && PermittedIP(ip) && !have[k] {
			return false
		}
	}
	for n := range cm.knownDNS {
		if PermittedDNS(n) && !have[n] {
			return false
		}
	}
	cm.leafKey = key
	cm.LeafCert = &tls.Certificate{Certificate: [][]byte{leaf.Raw, cm.RootCert.Raw}, PrivateKey: key}
	return true
}

func (cm *CertificateManager) saveLeafLocked(der []byte) {
	kb, err := x509.MarshalECPrivateKey(cm.leafKey)
	if err != nil {
		return
	}
	_ = os.WriteFile(filepath.Join(cm.storageDir, leafKeyFile), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}), 0600)
	_ = os.WriteFile(filepath.Join(cm.storageDir, leafCertFile), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0644)
}

// GetCertificate dynamically inspects incoming TLS ClientHello to ensure the connecting IP is in the leaf cert SAN.
func (cm *CertificateManager) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	var connIP net.IP
	if hello != nil && hello.Conn != nil {
		if tcpAddr, ok := hello.Conn.LocalAddr().(*net.TCPAddr); ok && tcpAddr.IP != nil {
			if ip4 := tcpAddr.IP.To4(); ip4 != nil {
				connIP = ip4
			} else {
				connIP = tcpAddr.IP
			}
		}
	}

	// Fast path: check under read lock
	// The SNI name is the client's to choose: it is never added to the leaf
	// (any client on the LAN could otherwise grow it and make the server re-sign
	// a P-384 certificate on every handshake). The phone connects by IP; the
	// names the leaf carries are the ones given to NewCertificateManager.
	cm.mu.RLock()
	ipKnown := (connIP == nil) || (cm.knownIPs[connIP.String()] != nil)
	if ipKnown && cm.LeafCert != nil {
		cert := cm.LeafCert
		cm.mu.RUnlock()
		return cert, nil
	}
	cm.mu.RUnlock()

	// Slow path: update known IPs/DNS and regenerate leaf certificate
	cm.mu.Lock()
	defer cm.mu.Unlock()

	needRebuild := false
	if connIP != nil && cm.knownIPs[connIP.String()] == nil {
		cm.knownIPs[connIP.String()] = connIP
		needRebuild = true
	}

	for _, hostIP := range scanHostIPv4s() {
		if cm.knownIPs[hostIP.String()] == nil {
			cm.knownIPs[hostIP.String()] = hostIP
			needRebuild = true
		}
	}

	if needRebuild || cm.LeafCert == nil {
		if err := cm.generateLeafCertLocked(); err != nil {
			if cm.LeafCert != nil {
				return cm.LeafCert, nil
			}
			return nil, err
		}
	}

	return cm.LeafCert, nil
}

// AddHostIPs dynamically registers new host IPs and regenerates the leaf cert if necessary.
func (cm *CertificateManager) AddHostIPs(ips []net.IP) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	changed := false
	for _, ip := range ips {
		if ip != nil && !ip.IsLoopback() {
			ipStr := ip.String()
			if cm.knownIPs[ipStr] == nil {
				if ip4 := ip.To4(); ip4 != nil {
					cm.knownIPs[ipStr] = ip4
				} else {
					cm.knownIPs[ipStr] = ip
				}
				changed = true
			}
		}
	}

	if changed {
		_ = cm.generateLeafCertLocked()
	}
}

// EnsureIP checks if a specific IP is already in SAN, and regenerates leaf cert if not.
func (cm *CertificateManager) EnsureIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	ipStr := ip.String()

	cm.mu.RLock()
	if cm.knownIPs[ipStr] != nil && cm.LeafCert != nil {
		cm.mu.RUnlock()
		return true
	}
	cm.mu.RUnlock()

	cm.mu.Lock()
	defer cm.mu.Unlock()
	if ip4 := ip.To4(); ip4 != nil {
		cm.knownIPs[ipStr] = ip4
	} else {
		cm.knownIPs[ipStr] = ip
	}
	return cm.generateLeafCertLocked() == nil
}

func scanHostIPv4s() []net.IP {
	var ips []net.IP
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip != nil {
				ip4 := ip.To4()
				if ip4 != nil && !ip4.IsLoopback() && !ip4.IsUnspecified() {
					ips = append(ips, ip4)
				}
			}
		}
	}
	return ips
}

// GenerateMobileConfig produces an Apple .mobileconfig XML profile containing the Root CA certificate.
func (cm *CertificateManager) GenerateMobileConfig() ([]byte, error) {
	if cm.RootCert == nil {
		return nil, fmt.Errorf("root certificate not initialized")
	}

	certBase64 := base64.StdEncoding.EncodeToString(cm.RootCert.Raw)
	profileUUID, err := newUUID()
	if err != nil {
		return nil, err
	}
	payloadUUID, err := newUUID()
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	buf.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadCertificateFileName</key>
			<string>PhoneGyroRootCA.cer</string>
			<key>PayloadContent</key>
			<data>
`)
	// Write wrapped base64
	for i := 0; i < len(certBase64); i += 64 {
		end := i + 64
		if end > len(certBase64) {
			end = len(certBase64)
		}
		buf.WriteString("\t\t\t" + certBase64[i:end] + "\n")
	}

	buf.WriteString(fmt.Sprintf(`			</data>
			<key>PayloadDescription</key>
			<string>Installs the local PhoneGyro Root CA for motion controller connectivity.</string>
			<key>PayloadDisplayName</key>
			<string>PhoneGyro Root CA</string>
			<key>PayloadIdentifier</key>
			<string>com.phonegyro.ca.%[3]s.credential</string>
			<key>PayloadType</key>
			<string>com.apple.security.root</string>
			<key>PayloadUUID</key>
			<string>%[1]s</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>Enables secure local HTTPS for motion sensors on iOS devices.</string>
	<key>PayloadDisplayName</key>
	<string>%[4]s</string>
	<key>PayloadIdentifier</key>
	<string>com.phonegyro.ca.%[3]s</string>
	<key>PayloadOrganization</key>
	<string>PhoneGyro</string>
	<key>PayloadRemovalDisallowed</key>
	<false/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>%[2]s</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
`, payloadUUID, profileUUID, cm.Fingerprint(), xmlEscape(cm.RootCert.Subject.CommonName)))

	return buf.Bytes(), nil
}

// RootCertPEM returns the Root CA certificate in PEM format.
func (cm *CertificateManager) RootCertPEM() []byte {
	if cm.RootCert == nil {
		return nil
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cm.RootCert.Raw})
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false
	}
	return !info.IsDir()
}

func newUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // Version 4
	b[8] = (b[8] & 0x3f) | 0x80 // Variant RFC 4122
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// PermittedDNSDomains: the names the root may vouch for.
var PermittedDNSDomains = []string{"local", "localhost"}

// PermittedIPRanges: the addresses the root may vouch for -- private, CGNAT
// (hotspots, Tailscale), link-local and loopback; never a public address.
func PermittedIPRanges() []*net.IPNet {
	var out []*net.IPNet
	for _, c := range []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10",
		"169.254.0.0/16", "127.0.0.0/8",
		"fc00::/7", "fe80::/10", "::1/128",
	} {
		_, n, _ := net.ParseCIDR(c)
		out = append(out, n)
	}
	return out
}

// PermittedDNS reports whether the root may vouch for name (it ends in one of
// PermittedDNSDomains, label-wise, as RFC 5280 name constraints match).
func PermittedDNS(name string) bool {
	name = strings.ToLower(strings.TrimSuffix(name, "."))
	for _, d := range PermittedDNSDomains {
		if name == d || strings.HasSuffix(name, "."+d) {
			return true
		}
	}
	return false
}

// PermittedIP reports whether the root may vouch for ip.
func PermittedIP(ip net.IP) bool {
	for _, n := range PermittedIPRanges() {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// rootMinValidity: a root that expires sooner is replaced at start.
const rootMinValidity = 30 * 24 * time.Hour

// loadRootCA reads the stored root and checks it is still usable.
func loadRootCA(certPath, keyPath string) (*x509.Certificate, *ecdsa.PrivateKey, error) {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, nil, err
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, nil, err
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return nil, nil, fmt.Errorf("root cert: not PEM")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("root cert: %w", err)
	}
	keyBlock, _ := pem.Decode(keyPEM)
	if keyBlock == nil {
		return nil, nil, fmt.Errorf("root key: not PEM")
	}
	key, err := x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("root key: %w", err)
	}
	if pub, ok := cert.PublicKey.(*ecdsa.PublicKey); !ok || !pub.Equal(&key.PublicKey) {
		return nil, nil, fmt.Errorf("root key does not match the certificate")
	}
	if len(cert.PermittedIPRanges) == 0 {
		return nil, nil, fmt.Errorf("root without name constraints (made by an older PhoneGyro)")
	}
	if time.Until(cert.NotAfter) < rootMinValidity {
		return nil, nil, fmt.Errorf("root expires %s", cert.NotAfter.Format("2006-01-02"))
	}
	return cert, key, nil
}

// rootCommonName names the root after this PC, so that on a phone trusting
// several PCs each one is told apart in the settings.
func rootCommonName() string {
	if h, err := os.Hostname(); err == nil && strings.TrimSpace(h) != "" {
		return "PhoneGyro Root CA (" + strings.TrimSpace(h) + ")"
	}
	return "PhoneGyro Root CA"
}

// Fingerprint is the first 8 bytes of the root's SHA-256, in hex: it tells
// roots of different PCs (and a regenerated root) apart.
func (cm *CertificateManager) Fingerprint() string {
	if cm.RootCert == nil {
		return ""
	}
	sum := sha256.Sum256(cm.RootCert.Raw)
	return hex.EncodeToString(sum[:8])
}

func xmlEscape(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
