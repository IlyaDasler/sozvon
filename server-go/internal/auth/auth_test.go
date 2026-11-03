package auth

import (
	"strings"
	"testing"
	"time"
)

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("test-pass-1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "scrypt$") {
		t.Fatalf("формат хеша не тот: %s", hash)
	}
	if !VerifyPassword("test-pass-1", hash) {
		t.Fatal("верный пароль не прошёл")
	}
	if VerifyPassword("другой", hash) {
		t.Fatal("неверный пароль прошёл")
	}
	if VerifyPassword("что угодно", "") {
		t.Fatal("пустой хеш не должен приниматься")
	}
}

func TestTokenRoundTrip(t *testing.T) {
	secret := []byte("secret-for-tests")
	token := SignToken(secret, 42, "abcdef")
	payload, err := ReadToken(secret, token)
	if err != nil {
		t.Fatal(err)
	}
	if payload.UID != 42 || payload.SID != "abcdef" {
		t.Fatalf("payload: %+v", payload)
	}
	if _, err := ReadToken([]byte("другой секрет"), token); err == nil {
		t.Fatal("чужой секрет принял токен")
	}
	if _, err := ReadToken(secret, "мусор"); err == nil {
		t.Fatal("мусор принят за токен")
	}
}

func TestExpiredToken(t *testing.T) {
	secret := []byte("secret")
	// Подписываем вручную просроченный payload
	payload := `eyJ1aWQiOjEsInNpZCI6ImEiLCJleHAiOjF9`
	expired := payload + "." + b64(sign(secret, payload))
	if _, err := ReadToken(secret, expired); err == nil {
		t.Fatal("просроченный токен принят")
	}
	_ = time.Now()
}
