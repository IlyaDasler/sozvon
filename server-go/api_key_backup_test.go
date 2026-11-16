package main

import (
	"net/http/httptest"
	"testing"
)

func TestKeyBackupClientCompatibilityUsesExplicitAndroidCapability(t *testing.T) {
	cases := []struct {
		name       string
		version    string
		userAgent  string
		capability string
		tooOld     bool
	}{
		{name: "current desktop", version: "3.8.6", tooOld: false},
		{name: "old desktop", version: "3.5.0", tooOld: true},
		{name: "Android without capability", version: "1.0.383", userAgent: "Mozilla/5.0 (Linux; Android 15; wv)", tooOld: true},
		{name: "Android with backup capability", version: "1.0.383", userAgent: "Mozilla/5.0 (Linux; Android 15; wv)", capability: "key-backup-v1", tooOld: false},
		{name: "unknown Android capability", version: "1.0.383", userAgent: "Mozilla/5.0 (Linux; Android 15; wv)", capability: "key-backup-v2", tooOld: true},
		{name: "desktop cannot claim Android backup capability", version: "3.5.0", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", capability: "key-backup-v1", tooOld: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			target := "/api/key-backup"
			if tc.capability != "" {
				target += "?capability=" + tc.capability
			}
			r := httptest.NewRequest("POST", target, nil)
			r.Header.Set("X-Client-Version", tc.version)
			r.Header.Set("User-Agent", tc.userAgent)
			if got := keyBackupClientTooOld(r); got != tc.tooOld {
				t.Fatalf("keyBackupClientTooOld() = %v, want %v", got, tc.tooOld)
			}
		})
	}
}
