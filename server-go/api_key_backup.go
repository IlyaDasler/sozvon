package main

import (
	"net/http"

	"sozvon/server/internal/version"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

// Резервная копия ключа шифрования. Пароль проверяется на сервере, но сам ключ
// запечатан на клиенте: сервер видит только ciphertext и не может его открыть.

type keyBackupBody struct {
	Password         string `json:"password"`
	Salt             string `json:"salt"`
	IV               string `json:"iv"`
	CT               string `json:"ct"`
	Iterations       int    `json:"iterations"`
	LegacySalt       string `json:"legacySalt"`
	LegacyIV         string `json:"legacyIv"`
	LegacyCT         string `json:"legacyCt"`
	LegacyIterations int    `json:"legacyIterations"`
}

func keyBackupClientTooOld(r *http.Request) bool {
	return version.Compare(r.Header.Get("X-Client-Version"), "3.6.8") < 0
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
	passwordOK := auth.VerifyPassword(body.Password, user.PasswordHash)
	if !passwordOK {
		if hashes, err := a.store.PasswordHistory(user.ID, 5); err == nil {
			for _, hash := range hashes {
				if auth.VerifyPassword(body.Password, hash) {
					passwordOK = true
					break
				}
			}
		}
	}
	if !passwordOK {
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
	oldClient := keyBackupClientTooOld(r)
	if oldClient && backup.LegacySalt == "" {
		writeJSON(w, http.StatusUpgradeRequired, map[string]any{"error": "Обновите Созвон, чтобы восстановить ключ", "updateRequired": true})
		return
	}
	salt, iv, ct, iterations := backup.Salt, backup.IV, backup.CT, backup.Iterations
	if oldClient {
		salt, iv, ct, iterations = backup.LegacySalt, backup.LegacyIV, backup.LegacyCT, backup.LegacyIterations
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"salt": salt, "iv": iv, "ct": ct, "iterations": iterations,
		"updatedAt": backup.UpdatedAt,
	})
}

func (a *server) keyBackupPut(w http.ResponseWriter, r *http.Request) {
	if keyBackupClientTooOld(r) {
		writeJSON(w, http.StatusUpgradeRequired, map[string]any{"error": "Обновите Созвон, чтобы сохранить ключ", "updateRequired": true})
		return
	}
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
	if len(body.Salt) > 256 || len(body.IV) > 256 || len(body.CT) > 16*1024 ||
		len(body.LegacySalt) > 256 || len(body.LegacyIV) > 256 || len(body.LegacyCT) > 16*1024 {
		fail(http.StatusBadRequest, "Резервная копия слишком большая").write(w)
		return
	}
	if body.Iterations < 100_000 || body.Iterations > 2_000_000 ||
		(body.LegacySalt != "" && (body.LegacyIterations < 100_000 || body.LegacyIterations > 2_000_000)) {
		fail(http.StatusBadRequest, "Неверные параметры KDF").write(w)
		return
	}
	if !auth.VerifyPassword(body.Password, user.PasswordHash) {
		fail(http.StatusUnauthorized, "Неверный пароль").write(w)
		return
	}
	if err := a.store.PutKeyBackup(user.ID, store.KeyBackup{
		Salt: body.Salt, IV: body.IV, CT: body.CT, Iterations: body.Iterations,
		LegacySalt: body.LegacySalt, LegacyIV: body.LegacyIV, LegacyCT: body.LegacyCT,
		LegacyIterations: body.LegacyIterations,
	}); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
