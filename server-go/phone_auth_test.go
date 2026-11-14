package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

func TestPhoneSignupCompletesAndLogsIn(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	app := &server{store: st, secret: []byte("phone-api-secret"), limits: newLimiter()}
	app.dummyHash, _ = auth.HashPassword(auth.RandomID(16))
	phone := "+79990001122"
	password := "test-pass-1"
	hash, _ := auth.HashPassword(password)
	now := time.Now().Unix()
	poll := "poll-secret"
	signup := store.PhoneSignup{
		ID: "signup-api", PhoneHMAC: app.phoneDigest(phone), PasswordHash: hash,
		Username: "phoneapi", DisplayName: "Телефон API", AvatarColor: "#0090ff",
		TokenHash: tokenHash("start"), PollHash: tokenHash(poll),
		CreatedAt: now, ExpiresAt: now + 600,
	}
	if err := st.CreatePhoneSignup(signup); err != nil {
		t.Fatal(err)
	}
	if err := st.BindPhoneSignupChat(signup.ID, 55); err != nil {
		t.Fatal(err)
	}
	if err := st.MarkPhoneSignupVerified(signup.ID, 55); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"id": signup.ID, "secret": poll})
	rec := httptest.NewRecorder()
	app.phoneSignupStatus(rec, httptest.NewRequest(http.MethodPost, "/api/phone/signup/status", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d %s", rec.Code, rec.Body.String())
	}
	var completed struct {
		Status string `json:"status"`
		Token  string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &completed); err != nil {
		t.Fatal(err)
	}
	if completed.Status != "ready" || completed.Token == "" {
		t.Fatalf("answer: %s", rec.Body.String())
	}
	loginBody, _ := json.Marshal(map[string]any{"username": phone, "password": password})
	loginRec := httptest.NewRecorder()
	app.login(loginRec, httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(loginBody)))
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", loginRec.Code, loginRec.Body.String())
	}
}
