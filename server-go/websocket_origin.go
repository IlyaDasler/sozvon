package main

import (
	"net/http"
	"net/url"
	"strings"
)

// Electron file:// windows can send an opaque or absent Origin. Native
// Capacitor has a stable local origin. Browser clients must be same-origin.
func checkWebSocketOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" || origin == "null" {
		return true
	}
	// Chromium serializes the origin of packaged Electron file:// pages as
	// "file://" (an opaque origin with no host).
	if origin == "file://" || origin == "file://localhost" {
		return true
	}
	if origin == "https://localhost" || origin == "capacitor://localhost" || origin == "http://localhost" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return false
	}

	scheme := ""
	if r.TLS != nil {
		scheme = "https"
	} else {
		// The app is normally behind Caddy, which sets X-Forwarded-Proto.
		scheme = strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]))
		if scheme == "" {
			scheme = "http"
		}
	}
	return strings.EqualFold(parsed.Scheme, scheme) && strings.EqualFold(parsed.Host, r.Host)
}
