package main

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

// Почтовые коды: регистрация по почте, сброс пароля и смена адреса.

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)

func normalizeEmail(value string) string { return strings.ToLower(strings.TrimSpace(value)) }

func validEmail(email string) bool { return len(email) <= 254 && emailPattern.MatchString(email) }

func (a *server) requireMail() error {
	if a.mail == nil || !a.mail.Enabled() {
		return errors.New("Письма с кодами пока не отправляются: на сервере не настроена почта. Попробуйте позже")
	}
	return nil
}

func (a *server) sendEmailCode(w http.ResponseWriter, purpose, email string) bool {
	if err := a.requireMail(); err != nil {
		fail(http.StatusServiceUnavailable, err.Error()).write(w)
		return false
	}
	if err := a.mail.Send(purpose, email); err != nil {
		if err.Error() == "код уже отправлен" {
			fail(http.StatusTooManyRequests, "Код уже отправлен. Повторно — через минуту").write(w)
			return false
		}
		fail(http.StatusBadGateway, "Не удалось отправить письмо. Проверьте адрес почты").write(w)
		return false
	}
	return true
}

func (a *server) verifyEmailCode(w http.ResponseWriter, purpose, email, code string) bool {
	switch a.mail.Check(purpose, email, code) {
	case "ok":
		return true
	case "wrong":
		fail(http.StatusBadRequest, "Неверный код из письма").write(w)
	default:
		fail(http.StatusBadRequest, "Код устарел — запросите новый").write(w)
	}
	return false
}

func (a *server) registerCode(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "email-code") {
		fail(http.StatusTooManyRequests, "Слишком много запросов кодов. Попробуйте позже").write(w)
		return
	}
	var body struct {
		Email      string `json:"email"`
		InviteCode string `json:"inviteCode"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if a.cfg.InviteCode != "" && strings.TrimSpace(body.InviteCode) != a.cfg.InviteCode {
		fail(http.StatusForbidden, "Неверный код приглашения. Спросите его у владельца сервера").write(w)
		return
	}
	email := normalizeEmail(body.Email)
	if !validEmail(email) {
		fail(http.StatusBadRequest, "Проверьте адрес почты").write(w)
		return
	}
	if _, err := a.store.UserByEmail(email); err == nil {
		fail(http.StatusConflict, "Эта почта уже зарегистрирована — войдите или восстановите пароль").write(w)
		return
	} else if !errors.Is(err, store.ErrNotFound) {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if !a.sendEmailCode(w, "register", email) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// registerByEmail — регистрация по коду из письма; логин придумываем сами.
func (a *server) registerByEmail(w http.ResponseWriter, r *http.Request, body registerBody) {
	email := normalizeEmail(body.Email)
	if !validEmail(email) {
		fail(http.StatusBadRequest, "Проверьте адрес почты").write(w)
		return
	}
	if !auth.ValidPassword(body.Password) {
		fail(http.StatusBadRequest, "Пароль должен быть от 8 до 128 символов").write(w)
		return
	}
	displayName := strings.TrimSpace(body.DisplayName)
	if displayName == "" {
		displayName = strings.Split(email, "@")[0]
		if len([]rune(displayName)) > 32 {
			displayName = string([]rune(displayName)[:32])
		}
	}
	if !auth.ValidDisplayName(displayName) {
		fail(http.StatusBadRequest, "Имя должно быть от 1 до 32 символов").write(w)
		return
	}
	if _, err := a.store.UserByEmail(email); err == nil {
		fail(http.StatusConflict, "Эта почта уже зарегистрирована — войдите или восстановите пароль").write(w)
		return
	} else if !errors.Is(err, store.ErrNotFound) {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if err := a.requireMail(); err != nil {
		fail(http.StatusServiceUnavailable, err.Error()).write(w)
		return
	}
	if !a.verifyEmailCode(w, "register", email, body.Code) {
		return
	}
	username := a.makeUsername(email)
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	user, err := a.store.CreateUserWithEmail(username, hash, displayName, colors[time.Now().UnixNano()%int64(len(colors))], email, email)
	if err != nil {
		fail(http.StatusConflict, "Этот логин уже занят").write(w)
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
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": self})
}

func (a *server) makeUsername(email string) string {
	base := strings.ToLower(strings.Split(email, "@")[0])
	var clean strings.Builder
	for _, symbol := range base {
		if (symbol >= 'a' && symbol <= 'z') || (symbol >= '0' && symbol <= '9') || symbol == '_' || symbol == '.' {
			clean.WriteRune(symbol)
		} else {
			clean.WriteRune('_')
		}
	}
	value := clean.String()
	if len(value) > 20 {
		value = value[:20]
	}
	if len(value) < 3 {
		value = (value + "user")[:3]
	}
	if _, err := a.store.UserByUsername(value); errors.Is(err, store.ErrNotFound) {
		return value
	}
	for {
		candidate := value + strconv.Itoa(10+int(time.Now().UnixNano()%9990))
		if _, err := a.store.UserByUsername(candidate); errors.Is(err, store.ErrNotFound) {
			return candidate
		}
	}
}

func (a *server) passwordCode(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "password-code") {
		fail(http.StatusTooManyRequests, "Слишком много запросов кодов. Попробуйте позже").write(w)
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	email := normalizeEmail(body.Email)
	if !validEmail(email) {
		fail(http.StatusBadRequest, "Проверьте адрес почты").write(w)
		return
	}
	// Есть ли такой профиль — не сообщаем; письмо уходит только владельцу почты
	if user, err := a.store.UserByEmail(email); err == nil && user != nil {
		if !a.sendEmailCode(w, "reset", email) {
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) passwordReset(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "password-reset") {
		fail(http.StatusTooManyRequests, "Слишком много попыток. Попробуйте позже").write(w)
		return
	}
	var body struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	email := normalizeEmail(body.Email)
	if !validEmail(email) {
		fail(http.StatusBadRequest, "Проверьте адрес почты").write(w)
		return
	}
	if !auth.ValidPassword(body.Password) {
		fail(http.StatusBadRequest, "Пароль должен быть от 8 до 128 символов").write(w)
		return
	}
	user, err := a.store.UserByEmail(email)
	if err != nil || user == nil {
		fail(http.StatusBadRequest, "Неверный код из письма").write(w)
		return
	}
	if err := a.requireMail(); err != nil {
		fail(http.StatusServiceUnavailable, err.Error()).write(w)
		return
	}
	if !a.verifyEmailCode(w, "reset", email, body.Code) {
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
	// Пароль сменили — остальные устройства выходят
	list, _ := a.store.SessionsOf(user.ID)
	for _, session := range list {
		_ = a.store.DeleteSession(session.ID)
	}
	if user.TotpSecret != "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "needLogin": true})
		return
	}
	// Письмо не заменяет вход: сразу пускаем человека с новым паролем
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
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": self})
}

func (a *server) emailCode(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	if !a.authLimit(r, "email-code") {
		fail(http.StatusTooManyRequests, "Слишком много запросов кодов. Попробуйте позже").write(w)
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	email := normalizeEmail(body.Email)
	if !validEmail(email) {
		fail(http.StatusBadRequest, "Проверьте адрес почты").write(w)
		return
	}
	if existing, err := a.store.UserByEmail(email); err == nil && existing != nil && existing.ID != user.ID {
		fail(http.StatusConflict, "Эта почта уже зарегистрирована").write(w)
		return
	}
	if !a.sendEmailCode(w, "register", email) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) updateEmail(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	if r.Method == http.MethodDelete {
		if err := a.store.SetEmail(user.ID, "", ""); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		a.respondSelf(w, user.ID)
		return
	}
	var body struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"newPassword"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	email := normalizeEmail(body.Email)
	if !validEmail(email) {
		fail(http.StatusBadRequest, "Проверьте адрес почты").write(w)
		return
	}
	if err := a.requireMail(); err != nil {
		fail(http.StatusServiceUnavailable, err.Error()).write(w)
		return
	}
	if !a.verifyEmailCode(w, "register", email, body.Code) {
		return
	}
	if user.PasswordHash == "" {
		if !auth.ValidPassword(body.NewPassword) {
			fail(http.StatusBadRequest, "Придумайте пароль для аккаунта: от 8 до 128 символов").write(w)
			return
		}
		hash, err := auth.HashPassword(body.NewPassword)
		if err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		if err := a.store.UpdatePassword(user.ID, hash); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	}
	if err := a.store.SetEmail(user.ID, email, email); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.respondSelf(w, user.ID)
}

func (a *server) respondSelf(w http.ResponseWriter, userID int64) {
	fresh, err := a.store.UserByID(userID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	self, err := a.self(fresh)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, self)
}

// mailResend — ошибка «код уже отправлен», чтобы отдать 429.
var mailResend = resendError{}

type resendError struct{}

// registerBody — общая форма регистрации: по логину или по почте с кодом.
type registerBody struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	InviteCode  string `json:"inviteCode"`
	Email       string `json:"email"`
	Code        string `json:"code"`
}

func (resendError) Error() string { return "resend" }
