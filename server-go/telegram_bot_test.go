package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sozvon/server/internal/store"
)

func TestTelegramContactShareConfirmsPhone(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	var sent int
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sent++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"result":[]}`))
	}))
	t.Cleanup(fake.Close)

	app := &server{
		store: st, secret: []byte("test-phone-secret"),
		telegramToken: "123:test", telegramAPIBase: fake.URL,
		telegramBotUsername: "test_bot",
	}
	phone := "+79991234567"
	token := "start-token"
	poll := "poll-secret"
	now := time.Now().Unix()
	signup := store.PhoneSignup{
		ID: "signup-1", PhoneHMAC: app.phoneDigest(phone),
		PasswordHash: "hash", Username: "phoneuser", DisplayName: "Телефон",
		AvatarColor: "#0090ff", TokenHash: tokenHash(token), PollHash: tokenHash(poll),
		CreatedAt: now, ExpiresAt: now + 600,
	}
	if err := st.CreatePhoneSignup(signup); err != nil {
		t.Fatal(err)
	}
	from := &telegramUser{ID: 42}
	chat := &telegramChat{ID: 42}
	app.handleTelegramUpdate(telegramUpdate{Message: &telegramMessage{
		From: from, Chat: chat, Text: "/start " + token,
	}})
	if _, err := st.PhoneSignupForChat(42); err != nil {
		t.Fatalf("чат не привязан: %v", err)
	}
	// Чужой контакт не подтверждает номер.
	app.handleTelegramUpdate(telegramUpdate{Message: &telegramMessage{
		From: from, Chat: chat, Contact: &telegramContact{PhoneNumber: phone, UserID: 99},
	}})
	pending, _ := st.PhoneSignupByID(signup.ID)
	if pending.VerifiedAt != 0 {
		t.Fatal("чужой контакт подтвердил номер")
	}
	// Свой контакт подтверждает.
	app.handleTelegramUpdate(telegramUpdate{Message: &telegramMessage{
		From: from, Chat: chat, Contact: &telegramContact{PhoneNumber: phone, UserID: 42},
	}})
	verified, _ := st.PhoneSignupByID(signup.ID)
	if verified.VerifiedAt == 0 {
		t.Fatal("свой контакт не подтвердил номер")
	}
	user, err := st.CompletePhoneSignup(signup.ID, tokenHash(poll))
	if err != nil {
		t.Fatal(err)
	}
	if user.Username != "phoneuser" {
		t.Fatalf("username=%s", user.Username)
	}
	if _, err := st.UserByPhoneHMAC(app.phoneDigest(phone)); err != nil {
		t.Fatalf("phone lookup: %v", err)
	}
	if sent == 0 {
		t.Fatal("бот не отправил ни одного сообщения")
	}
}
