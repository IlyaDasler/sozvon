package main

import (
	"net/http"
	"strings"
	"time"

	"log/slog"
	"sozvon/server/internal/auth"

	"sozvon/server/internal/store"
)

const accountRestoreDays = 30

func (a *server) accountDelete(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	if user.DeletedAt != 0 {
		writeJSON(w, http.StatusOK, map[string]any{"deletedAt": user.DeletedAt})
		return
	}
	var body struct {
		Password string `json:"password"`
		Confirm  string `json:"confirm"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if strings.TrimSpace(body.Confirm) != "УДАЛИТЬ" {
		fail(http.StatusBadRequest, "Введите слово УДАЛИТЬ для подтверждения").write(w)
		return
	}
	if user.PasswordHash != "" && !auth.VerifyPassword(body.Password, user.PasswordHash) {
		fail(http.StatusUnauthorized, "Неверный пароль").write(w)
		return
	}
	now := time.Now().Unix()
	if err := a.store.SoftDeleteUser(user.ID, now); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deletedAt": now, "restoreUntil": now + accountRestoreDays*86400})
}

func (a *server) accountRestore(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	if user.DeletedAt == 0 {
		self, err := a.self(user)
		if err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"user": self})
		return
	}
	if err := a.store.RestoreUser(user.ID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	fresh, err := a.store.UserByID(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	self, err := a.self(fresh)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": self})
}

// accountPurgeLoop окончательно удаляет аккаунты, у которых истекли 30 дней.
func (a *server) accountPurgeLoop() {
	purge := func() {
		cutoff := time.Now().Unix() - accountRestoreDays*86400
		if n, err := a.store.PurgeDeletedUsers(cutoff); err != nil {
			slog.Error("не удалось удалить истёкшие аккаунты", "error", err)
		} else if n > 0 {
			slog.Info("удалены аккаунты с истёкшим сроком", "count", n)
		}
	}
	purge()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		purge()
	}
}
