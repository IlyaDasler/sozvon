package linkpreview

import (
	"context"
	"net"
	"strings"
	"testing"
)

func TestPreviewableURLRejectsCredentialsAndUnsupportedURLs(t *testing.T) {
	for _, raw := range []string{
		"https://user:secret@example.com/path",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"https://",
		"https://example.com/" + strings.Repeat("x", 2049),
	} {
		if got := PreviewableURL(raw); got != nil {
			t.Errorf("PreviewableURL(%q) = %q, want nil", raw, got)
		}
	}
	if got := PreviewableURL("https://example.com/article"); got == nil {
		t.Fatal("valid public HTTP URL was rejected")
	}
}

func TestIsPublicIPRejectsLocalAndReservedRanges(t *testing.T) {
	for _, raw := range []string{
		"0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
		"172.16.0.1", "192.168.1.1", "::", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1",
	} {
		ip := net.ParseIP(raw)
		if ip == nil {
			t.Fatalf("test address did not parse: %s", raw)
		}
		if isPublicIP(ip) {
			t.Errorf("private or reserved address %s was classified as public", raw)
		}
	}
	for _, raw := range []string{"1.1.1.1", "2606:4700:4700::1111"} {
		ip := net.ParseIP(raw)
		if ip == nil || !isPublicIP(ip) {
			t.Errorf("public address %s was classified as blocked", raw)
		}
	}
}

func TestSafeDialRejectsLoopbackBeforeConnecting(t *testing.T) {
	fetcher := New(false)
	conn, err := fetcher.safeDial(context.Background(), "tcp", net.JoinHostPort("127.0.0.1", "80"))
	if conn != nil {
		_ = conn.Close()
		t.Fatal("safeDial connected to loopback")
	}
	if err == nil {
		t.Fatal("safeDial accepted loopback")
	}
}
