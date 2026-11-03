package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
)

const TokenTTL = 30 * 24 * time.Hour

var usernameRe = regexp.MustCompile(`^[a-z0-9_.]{3,24}$`)

// Secret — тот же секрет, что у Node: JWT_SECRET или dataDir/secret.key.
// Файл создаётся один раз, поэтому токены переживают смену реализации.
func Secret(dataDir string) ([]byte, error) {
	if value := os.Getenv("JWT_SECRET"); value != "" {
		return []byte(value), nil
	}
	file := filepath.Join(dataDir, "secret.key")
	body, err := os.ReadFile(file)
	if err == nil {
		return []byte(strings.TrimSpace(string(body))), nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	raw := make([]byte, 48)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	value := hex.EncodeToString(raw)
	if err := os.WriteFile(file, []byte(value), 0o600); err != nil {
		return nil, fmt.Errorf("secret.key: %w", err)
	}
	return []byte(value), nil
}

func sign(secret []byte, payload string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}

func b64(data []byte) string { return base64.RawURLEncoding.EncodeToString(data) }

// SignToken повторяет формат Node: base64url(JSON).base64url(HMAC-SHA256), TTL 30 дней.
func SignToken(secret []byte, userID int64, sessionID string) string {
	payload, _ := json.Marshal(map[string]any{
		"uid": userID,
		"sid": sessionID,
		"exp": time.Now().Add(TokenTTL).UnixMilli(),
	})
	encoded := b64(payload)
	return encoded + "." + b64(sign(secret, encoded))
}

type Token struct {
	UID int64  `json:"uid"`
	SID string `json:"sid"`
	Exp int64  `json:"exp"`
	Kind string `json:"kind"`
}

func ReadToken(secret []byte, token string) (*Token, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, errors.New("плохой токен")
	}
	expected := sign(secret, parts[0])
	given, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || subtle.ConstantTimeCompare(expected, given) != 1 {
		return nil, errors.New("подпись не совпала")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	var payload Token
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if payload.Exp <= time.Now().UnixMilli() || payload.Kind != "" {
		return nil, errors.New("токен истёк")
	}
	return &payload, nil
}

// HashPassword: scrypt$salt$hash, параметры по умолчанию Node (N=16384, r=8, p=1, 64 байта).
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash, err := scrypt.Key([]byte(password), salt, 16384, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("scrypt$%s$%s", base64.StdEncoding.EncodeToString(salt), base64.StdEncoding.EncodeToString(hash)), nil
}

func VerifyPassword(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 3 || parts[0] != "scrypt" {
		// Профили без пароля: тратим столько же времени, чтобы не выдавать существование логина
		salt := make([]byte, 16)
		hash, _ := scrypt.Key([]byte(password), salt, 16384, 8, 1, 64)
		return len(hash) == 0
	}
	salt, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	expected, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	actual, err := scrypt.Key([]byte(password), salt, 16384, 8, 1, len(expected))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(expected, actual) == 1
}

func ValidUsername(value string) bool { return usernameRe.MatchString(value) }

func ValidPassword(value string) bool { return len(value) >= 8 && len(value) <= 128 }

func ValidDisplayName(value string) bool {
	runes := []rune(value)
	return len(runes) >= 1 && len(runes) <= 32
}

// DeviceName — как в Node: приложение и ОС из User-Agent.
func DeviceName(userAgent string) string {
	app := "Браузер"
	if match := regexp.MustCompile(`Sozvon/(\d+\.\d+)`).FindStringSubmatch(userAgent); match != nil {
		app = "Созвон " + match[1]
	}
	osName := ""
	switch {
	case strings.Contains(userAgent, "Windows"):
		osName = "Windows"
	case strings.Contains(userAgent, "Android"):
		osName = "Android"
	case strings.Contains(userAgent, "iPhone"), strings.Contains(userAgent, "iPad"):
		osName = "iOS"
	case strings.Contains(userAgent, "Mac OS"):
		osName = "macOS"
	case strings.Contains(userAgent, "Linux"):
		osName = "Linux"
	}
	if osName == "" {
		return app
	}
	return app + " · " + osName
}

func RandomID(bytes int) string {
	raw := make([]byte, bytes)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return hex.EncodeToString(raw)
}
