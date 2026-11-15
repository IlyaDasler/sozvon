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

func TestPhoneLinkDoesNotSetPasswordBeforeTelegramConfirmation(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	app := &server{store: st, secret: []byte("phone-link-secret"), limits: newLimiter(), telegramBotUsername: "test_bot"}
	user, err := st.CreateUser("linkuser", "", "Link User", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), userKey, user)
	body, _ := json.Marshal(map[string]string{"phone": "+79991234567", "newPassword": "secure-pass-123"})
	req := httptest.NewRequest(http.MethodPost, "/api/me/phone/start", bytes.NewReader(body)).WithContext(ctx)
	rec := httptest.NewRecorder()
	app.phoneLinkStart(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("start: %d %s", rec.Code, rec.Body.String())
	}
	var pending struct {
		ID     string `json:"id"`
		Secret string `json:"secret"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &pending); err != nil || pending.ID == "" || pending.Secret == "" {
		t.Fatalf("invalid pending response: %s (%v)", rec.Body.String(), err)
	}
	stored, err := st.UserByID(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.PasswordHash != "" {
		t.Fatal("password was changed before Telegram confirmation")
	}
	if err := st.BindPhoneSignupChat(pending.ID, 42); err != nil {
		t.Fatal(err)
	}
	if err := st.MarkPhoneSignupVerified(pending.ID, 42); err != nil {
		t.Fatal(err)
	}
	statusBody, _ := json.Marshal(pending)
	statusReq := httptest.NewRequest(http.MethodPost, "/api/me/phone/status", bytes.NewReader(statusBody)).WithContext(ctx)
	statusRec := httptest.NewRecorder()
	app.phoneLinkStatus(statusRec, statusReq)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("status: %d %s", statusRec.Code, statusRec.Body.String())
	}
	stored, err = st.UserByID(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.PhoneHMAC != app.phoneDigest("+79991234567") || !auth.VerifyPassword("secure-pass-123", stored.PasswordHash) {
		t.Fatal("verified phone link did not atomically apply phone and pending password")
	}
}

func TestPhoneLinkStartRateLimitedPerAccount(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	app := &server{store: st, secret: []byte("phone-link-limit"), limits: newLimiter(), telegramBotUsername: "test_bot"}
	user, err := st.CreateUser("limitedlink", "", "Link User", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), userKey, user)
	for i := 0; i < 4; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/me/phone/start", bytes.NewBufferString("{}")).WithContext(ctx)
		rec := httptest.NewRecorder()
		app.phoneLinkStart(rec, req)
		if i < 3 && rec.Code != http.StatusBadRequest {
			t.Fatalf("attempt %d: want validation response, got %d %s", i+1, rec.Code, rec.Body.String())
		}
		if i == 3 && rec.Code != http.StatusTooManyRequests {
			t.Fatalf("fourth attempt should be rate limited, got %d %s", rec.Code, rec.Body.String())
		}
	}
}
