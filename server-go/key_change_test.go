package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/realtime"
	"sozvon/server/internal/store"
)

func TestPublicKeyChangeNeedsPassword(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	app := &server{store: st, secret: []byte("key-change-secret"), limits: newLimiter(), hub: realtime.NewHub()}
	hash, _ := auth.HashPassword("test-pass-1")
	user, err := st.CreateUser("keychange", hash, "Ключ", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}

	put := func(key, password string) int {
		body, _ := json.Marshal(map[string]any{"publicKey": key, "password": password})
		req := httptest.NewRequest(http.MethodPut, "/api/me/key", bytes.NewReader(body))
		req = req.WithContext(context.WithValue(req.Context(), userKey, user))
		rec := httptest.NewRecorder()
		app.setMyKey(rec, req)
		return rec.Code
	}
	first := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	second := "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
	if code := put(first, ""); code != http.StatusOK {
		t.Fatalf("first key: %d", code)
	}
	if code := put(second, ""); code != http.StatusUnauthorized {
		t.Fatalf("change without password: %d", code)
	}
	if code := put(second, "wrong"); code != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", code)
	}
	if code := put(second, "test-pass-1"); code != http.StatusOK {
		t.Fatalf("correct password: %d", code)
	}
}

func TestPublicKeyChangeNeedsTotp(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	app := &server{store: st, secret: []byte("key-totp-secret"), limits: newLimiter(), hub: realtime.NewHub()}
	hash, _ := auth.HashPassword("test-pass-1")
	user, err := st.CreateUser("keytotp", hash, "Ключ", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	put := func(key, code string) int {
		body, _ := json.Marshal(map[string]any{"publicKey": key, "password": "test-pass-1", "totpCode": code})
		req := httptest.NewRequest(http.MethodPut, "/api/me/key", bytes.NewReader(body))
		req = req.WithContext(context.WithValue(req.Context(), userKey, user))
		rec := httptest.NewRecorder()
		app.setMyKey(rec, req)
		return rec.Code
	}
	first := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	second := "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
	if code := put(first, ""); code != http.StatusOK {
		t.Fatalf("first key: %d", code)
	}
	secret, _ := totpSecret()
	if err := st.EnableTotp(user.ID, secret, "recovery"); err != nil {
		t.Fatal(err)
	}
	if code := put(second, ""); code != http.StatusForbidden {
		t.Fatalf("change without totp: %d", code)
	}
	code, _ := totpCode(secret, uint64(time.Now().Unix()/30))
	if rc := put(second, code); rc != http.StatusOK {
		t.Fatalf("change with totp: %d", rc)
	}
}
