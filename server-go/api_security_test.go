package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"sozvon/server/internal/store"
)

func TestDecodeRejectsOversizedJSON(t *testing.T) {
	var payload map[string]string
	body := `{"value":"` + strings.Repeat("x", (16<<10)+1) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/test", bytes.NewBufferString(body))
	if err := decode(req, &payload); err == nil {
		t.Fatal("JSON body larger than 16 KiB was accepted")
	}

	valid := httptest.NewRequest(http.MethodPost, "/api/test", bytes.NewBufferString(`{"value":"ok"}`))
	if err := decode(valid, &payload); err != nil {
		t.Fatalf("small valid JSON body rejected: %v", err)
	}
	if payload["value"] != "ok" {
		t.Fatalf("decoded value = %q, want ok", payload["value"])
	}
}

func TestSecurityHeadersAreApplied(t *testing.T) {
	base := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := (&server{}).securityHeaders(base)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	for header, want := range map[string]string{
		"X-Content-Type-Options":    "nosniff",
		"X-Frame-Options":           "DENY",
		"Referrer-Policy":           "no-referrer",
		"Strict-Transport-Security": "max-age=15552000",
	} {
		if got := response.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

func TestMeResponseIsNeverCached(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	user, err := st.CreateUser("cachecheck", "", "Cache Check", "#336699")
	if err != nil {
		t.Fatal(err)
	}
	app := &server{store: st}
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request = request.WithContext(context.WithValue(request.Context(), userKey, user))
	response := httptest.NewRecorder()
	app.me(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("/me status = %d, body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("/me Cache-Control = %q, want private, no-store", got)
	}
}

func TestLinkPreviewIsRateLimitedPerUser(t *testing.T) {
	app := &server{limits: newLimiter()}
	user := &store.User{ID: 456}
	for i := 0; i < 31; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/link-preview?url=not-a-url", nil)
		req = req.WithContext(context.WithValue(req.Context(), userKey, user))
		response := httptest.NewRecorder()
		app.linkPreview(response, req)
		want := http.StatusBadRequest
		if i == 30 {
			want = http.StatusTooManyRequests
		}
		if response.Code != want {
			t.Fatalf("attempt %d: status = %d, want %d", i+1, response.Code, want)
		}
	}
}
