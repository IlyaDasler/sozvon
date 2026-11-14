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

func TestPasswordResetByTelegram(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	app := &server{store: st, secret: []byte("phone-reset-secret"), limits: newLimiter()}
	app.dummyHash, _ = auth.HashPassword(auth.RandomID(16))
	oldHash, _ := auth.HashPassword("old-pass-1")
	user, err := st.CreateUser("resetphone", oldHash, "Сброс", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetUserPhone(user.ID, app.phoneDigest("+79990002233")); err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	signup := store.PhoneSignup{
		ID: "reset-api", PhoneHMAC: app.phoneDigest("+79990002233"), UserID: user.ID, Purpose: "reset",
		Username: "reset-ui", DisplayName: "Сброс",
		TokenHash: tokenHash("reset-start"), PollHash: tokenHash("reset-poll"),
		CreatedAt: now, ExpiresAt: now + 600,
	}
	if err := st.CreatePhoneSignup(signup); err != nil {
		t.Fatal(err)
	}
	if err := st.BindPhoneSignupChat(signup.ID, 99); err != nil {
		t.Fatal(err)
	}
	if err := st.MarkPhoneSignupVerified(signup.ID, 99); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"id": signup.ID, "secret": "reset-poll", "password": "new-pass-2"})
	rec := httptest.NewRecorder()
	app.passwordPhoneReset(rec, httptest.NewRequest(http.MethodPost, "/api/password/phone/reset", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("reset: %d %s", rec.Code, rec.Body.String())
	}
	loginBody, _ := json.Marshal(map[string]any{"username": "resetphone", "password": "new-pass-2"})
	loginRec := httptest.NewRecorder()
	app.login(loginRec, httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(loginBody)))
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login new password: %d %s", loginRec.Code, loginRec.Body.String())
	}
}
