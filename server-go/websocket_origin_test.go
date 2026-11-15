package main

import (
	"net/http/httptest"
	"testing"
)

func TestCheckWebSocketOrigin(t *testing.T) {
	tests := []struct {
		name   string
		host   string
		origin string
		xfp    string
		secure bool
		want   bool
	}{
		{name: "electron opaque origin", host: "api.example.test", origin: "null", xfp: "https", want: true},
		{name: "electron file origin", host: "api.example.test", origin: "file://", xfp: "https", want: true},
		{name: "electron missing origin", host: "api.example.test", xfp: "https", want: true},
		{name: "capacitor origin", host: "api.example.test", origin: "https://localhost", xfp: "https", want: true},
		{name: "capacitor scheme origin", host: "api.example.test", origin: "capacitor://localhost", xfp: "https", want: true},
		{name: "same origin behind tls proxy", host: "chat.example.test", origin: "https://chat.example.test", xfp: "https", want: true},
		{name: "same origin direct tls", host: "chat.example.test", origin: "https://chat.example.test", secure: true, want: true},
		{name: "same origin local dev", host: "localhost:3000", origin: "http://localhost:3000", xfp: "http", want: true},
		{name: "foreign origin", host: "api.example.test", origin: "https://attacker.example", xfp: "https", want: false},
		{name: "same host wrong scheme", host: "chat.example.test", origin: "http://chat.example.test", xfp: "https", want: false},
		{name: "same host different port", host: "chat.example.test", origin: "https://chat.example.test:444", xfp: "https", want: false},
		{name: "malformed origin", host: "chat.example.test", origin: "not-an-origin", xfp: "https", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scheme := "http"
			if tt.secure {
				scheme = "https"
			}
			req := httptest.NewRequest("GET", scheme+"://"+tt.host+"/ws", nil)
			req.Host = tt.host
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			if tt.xfp != "" {
				req.Header.Set("X-Forwarded-Proto", tt.xfp)
			}
			if got := upgrader.CheckOrigin(req); got != tt.want {
				t.Fatalf("checkWebSocketOrigin(%q, %q) = %v, want %v", tt.origin, tt.host, got, tt.want)
			}
		})
	}
}
