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

func TestDeviceNameUsesNativeClientVersion(t *testing.T) {
	got := DeviceNameWithVersion("Mozilla/5.0 (Linux; Android 16; SM-F966B) AppleWebKit/537.36", "1.0.367")
	if got != "Созвон 1.0.367 · Android" {
		t.Fatalf("device label = %q, want native app and platform", got)
	}
}

func TestUsernamesAllowUnicodeAndNormalizeForUniqueness(t *testing.T) {
	if !ValidUsername("Соломон Ицхакович") {
		t.Fatal("кириллица и пробелы должны быть допустимы")
	}
	if !ValidUsername("Solo Das") {
		t.Fatal("пробелы должны быть допустимы")
	}
	if ValidUsername("<script>") {
		t.Fatal("HTML-опасные знаки должны быть запрещены")
	}
	if ValidUsername("a\x00b") {
		t.Fatal("управляющие символы должны быть запрещены")
	}
	if got := NormalizeUsername("  Соломон   Ицхакович "); got != "соломон ицхакович" {
		t.Fatalf("normalize=%q", got)
	}
}

func TestDeviceKeyHash(t *testing.T) {
	hash := HashDeviceKey("device-secret")
	if hash == "" || hash == "device-secret" {
		t.Fatal("device key must be hashed")
	}
	if !CheckDeviceKey(hash, "device-secret") {
		t.Fatal("correct device key rejected")
	}
	if CheckDeviceKey(hash, "other-secret") {
		t.Fatal("wrong device key accepted")
	}
	if CheckDeviceKey("", "device-secret") {
		t.Fatal("empty hash accepted")
	}
}
