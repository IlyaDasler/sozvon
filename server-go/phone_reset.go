package main

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"time"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

// Сброс пароля по телефону: подтверждение номера через Telegram Contact Share.
// Секрет заявки остаётся на устройстве, поэтому статус и смена пароля публичные,
// но подделать их без секрета нельзя.

func (a *server) passwordPhoneStart(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "password-phone") {
		fail(http.StatusTooManyRequests, "Слишком много попыток, подождите минуту").write(w)
		return
	}
	if a.telegramBotUsername == "" {
		fail(http.StatusServiceUnavailable, "Сброс по телефону не настроен на сервере").write(w)
		return
	}
	var body struct {
		Phone string `json:"phone"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	phone, ok := normalizePhone(body.Phone)
	if !ok {
		fail(http.StatusBadRequest, "Введите номер в формате +7 999 123-45-67").write(w)
		return
	}
	phoneHMAC := a.phoneDigest(phone)
	user, err := a.store.UserByPhoneHMAC(phoneHMAC)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			// Не раскрываем, есть ли такой аккаунт.
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	now := time.Now().Unix()
	id := randomURLToken(18)
	token := randomURLToken(24)
	poll := randomURLToken(24)
	signup := store.PhoneSignup{
		ID: id, PhoneHMAC: phoneHMAC, UserID: user.ID, Purpose: "reset",
		Username: "reset-" + randomURLToken(6), DisplayName: user.DisplayName,
		TokenHash: tokenHash(token), PollHash: tokenHash(poll),
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

func (a *server) passwordPhoneStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID     string `json:"id"`
		Secret string `json:"secret"`
	}
	if err := decode(r, &body); err != nil || body.ID == "" || body.Secret == "" {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	signup, err := a.store.PhoneSignupByID(body.ID)
	if err != nil || signup.Purpose != "reset" || subtle.ConstantTimeCompare([]byte(signup.PollHash), []byte(tokenHash(body.Secret))) != 1 {
		fail(http.StatusNotFound, "Заявка не найдена").write(w)
		return
	}
	if signup.ExpiresAt <= time.Now().Unix() {
		writeJSON(w, http.StatusOK, map[string]any{"status": "expired"})
		return
	}
	if signup.VerifiedAt == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"status": "pending"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

func (a *server) passwordPhoneReset(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID       string `json:"id"`
		Secret   string `json:"secret"`
		Password string `json:"password"`
	}
	if err := decode(r, &body); err != nil || body.ID == "" || body.Secret == "" {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if !auth.ValidPassword(body.Password) {
		fail(http.StatusBadRequest, "Пароль должен быть от 8 до 128 символов").write(w)
		return
	}
	signup, err := a.store.PhoneSignupByID(body.ID)
	if err != nil || signup.Purpose != "reset" || signup.UserID == 0 || subtle.ConstantTimeCompare([]byte(signup.PollHash), []byte(tokenHash(body.Secret))) != 1 {
		fail(http.StatusNotFound, "Заявка не найдена").write(w)
		return
	}
	if signup.ExpiresAt <= time.Now().Unix() || signup.VerifiedAt == 0 {
		fail(http.StatusBadRequest, "Подтверждение не завершено или срок истёк").write(w)
		return
	}
	user, err := a.store.UserByID(signup.UserID)
	if err != nil || user.DeletedAt != 0 {
		fail(http.StatusBadRequest, "Аккаунт недоступен").write(w)
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if err := a.store.UpdatePassword(user.ID, hash); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	list, _ := a.store.SessionsOf(user.ID)
	for _, session := range list {
		_ = a.store.DeleteSession(session.ID)
	}
	_ = a.store.DeletePhoneSignup(signup.ID, tokenHash(body.Secret))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
