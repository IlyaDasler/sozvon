package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

const phoneSignupTTL = 10 * time.Minute

func normalizePhone(value string) (string, bool) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", false
	}
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, raw)
	if strings.HasPrefix(raw, "+") && len(digits) >= 8 && len(digits) <= 15 {
		return "+" + digits, true
	}
	// Частый ввод в РФ: 8XXXXXXXXXX.
	if len(digits) == 11 && strings.HasPrefix(digits, "8") {
		return "+7" + digits[1:], true
	}
	if len(digits) >= 10 && len(digits) <= 15 {
		return "+" + digits, true
	}
	return "", false
}

func (a *server) phoneDigest(phone string) string {
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte("sozvon-phone-hmac-v1|" + phone))
	return hex.EncodeToString(mac.Sum(nil))
}

func randomURLToken(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func tokenHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

type phoneStartRequest struct {
	Phone       string `json:"phone"`
	Password    string `json:"password"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	InviteCode  string `json:"inviteCode"`
}

func (a *server) phoneSignupStart(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "phone-signup") {
		fail(http.StatusTooManyRequests, "Слишком много попыток, подождите минуту").write(w)
		return
	}
	if a.telegramBotUsername == "" {
		fail(http.StatusServiceUnavailable, "Регистрация по телефону не настроена на сервере").write(w)
		return
	}
	_ = a.store.DeleteExpiredPhoneSignups(time.Now().Unix())
	var body phoneStartRequest
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if a.cfg.InviteCode != "" && strings.TrimSpace(body.InviteCode) != a.cfg.InviteCode {
		fail(http.StatusForbidden, "Неверный код приглашения. Спросите его у владельца сервера").write(w)
		return
	}
	phone, ok := normalizePhone(body.Phone)
	if !ok {
		fail(http.StatusBadRequest, "Введите номер в формате +7 999 123-45-67").write(w)
		return
	}
	username := auth.NormalizeUsername(body.Username)
	displayName := strings.TrimSpace(body.DisplayName)
	if !auth.ValidUsername(username) {
		fail(http.StatusBadRequest, "Логин: от 1 до 32 символов, без HTML-знаков; пробелы и кириллица разрешены").write(w)
		return
	}
	if !auth.ValidPassword(body.Password) {
		fail(http.StatusBadRequest, "Пароль должен быть от 8 до 128 символов").write(w)
		return
	}
	if !auth.ValidDisplayName(displayName) {
		fail(http.StatusBadRequest, "Имя должно быть от 1 до 32 символов").write(w)
		return
	}
	if _, err := a.store.UserByUsername(username); err == nil {
		fail(http.StatusConflict, "Этот логин уже занят").write(w)
		return
	} else if !errors.Is(err, store.ErrNotFound) {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	phoneHMAC := a.phoneDigest(phone)
	if _, err := a.store.PhoneSignupByUsername(username); err == nil {
		fail(http.StatusConflict, "Этот логин уже занят").write(w)
		return
	} else if !errors.Is(err, store.ErrPhoneSignupNotFound) {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if _, err := a.store.UserByPhoneHMAC(phoneHMAC); err == nil {
		// Не раскрываем, что номер уже зарегистрирован.
		fail(http.StatusConflict, "Не удалось начать регистрацию по этому номеру").write(w)
		return
	} else if !errors.Is(err, store.ErrNotFound) {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	id := randomURLToken(18)
	token := randomURLToken(24)
	poll := randomURLToken(24)
	now := time.Now().Unix()
	signup := store.PhoneSignup{
		ID: id, PhoneHMAC: phoneHMAC, PasswordHash: hash,
		Username: username, DisplayName: displayName,
		AvatarColor: colors[now%int64(len(colors))],
		TokenHash:   tokenHash(token), PollHash: tokenHash(poll),
		CreatedAt: now, ExpiresAt: now + int64(phoneSignupTTL/time.Second),
	}
	if err := a.store.CreatePhoneSignup(signup); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "secret": poll,
		"deepLink":    "https://t.me/" + a.telegramBotUsername + "?start=" + url.QueryEscape(token),
		"botUsername": a.telegramBotUsername,
		"expiresAt":   signup.ExpiresAt,
	})
}

func (a *server) phoneSignupStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID     string `json:"id"`
		Secret string `json:"secret"`
	}
	if err := decode(r, &body); err != nil || body.ID == "" || body.Secret == "" {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	signup, err := a.store.PhoneSignupByID(body.ID)
	if errors.Is(err, store.ErrPhoneSignupNotFound) {
		fail(http.StatusNotFound, "Заявка не найдена").write(w)
		return
	}
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if subtle.ConstantTimeCompare([]byte(signup.PollHash), []byte(tokenHash(body.Secret))) != 1 {
		fail(http.StatusForbidden, "Заявка не найдена").write(w)
		return
	}
	if signup.ExpiresAt <= time.Now().Unix() {
		writeJSON(w, http.StatusOK, map[string]any{"status": "expired"})
		return
	}
	if signup.UsedAt != 0 {
		writeJSON(w, http.StatusOK, map[string]any{"status": "used"})
		return
	}
	if signup.VerifiedAt == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"status": "pending"})
		return
	}
	user, err := a.store.CompletePhoneSignup(signup.ID, tokenHash(body.Secret))
	if err != nil {
		switch {
		case errors.Is(err, store.ErrPhoneSignupUsed):
			writeJSON(w, http.StatusOK, map[string]any{"status": "used"})
		case errors.Is(err, store.ErrPhoneSignupPending):
			writeJSON(w, http.StatusOK, map[string]any{"status": "pending"})
		case errors.Is(err, store.ErrPhoneSignupExpired):
			writeJSON(w, http.StatusOK, map[string]any{"status": "expired"})
		case errors.Is(err, store.ErrUsernameTaken):
			fail(http.StatusConflict, "Этот логин уже занят").write(w)
		default:
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		}
		return
	}
	token, err := a.openSession(user, r.UserAgent())
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	self, err := a.self(user)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready", "token": token, "user": self})
}
