package main

import (
	"net/http"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

// Резервная копия ключа шифрования. Пароль проверяется на сервере, но сам ключ
// запечатан на клиенте: сервер видит только ciphertext и не может его открыть.

type keyBackupBody struct {
	Password   string `json:"password"`
	Salt       string `json:"salt"`
	IV         string `json:"iv"`
	CT         string `json:"ct"`
	Iterations int    `json:"iterations"`
}

func (a *server) keyBackupRead(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "key-backup") {
		fail(http.StatusTooManyRequests, "Слишком много попыток, подождите минуту").write(w)
		return
	}
	user := r.Context().Value(userKey).(*store.User)
	if user.PasswordHash == "" {
		fail(http.StatusForbidden, "Резервная копия ключа доступна для аккаунтов с паролем").write(w)
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decode(r, &body); err != nil || body.Password == "" {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if !auth.VerifyPassword(body.Password, user.PasswordHash) {
		fail(http.StatusUnauthorized, "Неверный пароль").write(w)
		return
	}
	backup, err := a.store.KeyBackup(user.ID)
	if err == store.ErrNotFound {
		fail(http.StatusNotFound, "Резервной копии ключа нет").write(w)
		return
	}
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"salt": backup.Salt, "iv": backup.IV, "ct": backup.CT,
		"iterations": backup.Iterations, "updatedAt": backup.UpdatedAt,
	})
}

func (a *server) keyBackupPut(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "key-backup") {
		fail(http.StatusTooManyRequests, "Слишком много попыток, подождите минуту").write(w)
		return
	}
	user := r.Context().Value(userKey).(*store.User)
	if user.PasswordHash == "" {
		fail(http.StatusForbidden, "Резервная копия ключа доступна для аккаунтов с паролем").write(w)
		return
	}
	var body keyBackupBody
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if body.Password == "" || body.Salt == "" || body.IV == "" || body.CT == "" {
		fail(http.StatusBadRequest, "Неверные данные резервной копии").write(w)
		return
	}
	if len(body.Salt) > 256 || len(body.IV) > 256 || len(body.CT) > 16*1024 {
		fail(http.StatusBadRequest, "Резервная копия слишком большая").write(w)
		return
	}
	if body.Iterations < 100_000 || body.Iterations > 2_000_000 {
		fail(http.StatusBadRequest, "Неверные параметры KDF").write(w)
		return
	}
	if !auth.VerifyPassword(body.Password, user.PasswordHash) {
		fail(http.StatusUnauthorized, "Неверный пароль").write(w)
		return
	}
	if err := a.store.PutKeyBackup(user.ID, store.KeyBackup{
		Salt: body.Salt, IV: body.IV, CT: body.CT, Iterations: body.Iterations,
	}); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
