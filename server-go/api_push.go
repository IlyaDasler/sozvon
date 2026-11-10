package main

import (
	"net/http"
	"strings"

	"sozvon/server/internal/store"
)

func (a *server) registerPushToken(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Token    string `json:"token"`
		Platform string `json:"platform"`
	}
	if err := decode(r, &request); err != nil || strings.TrimSpace(request.Token) == "" {
		fail(http.StatusBadRequest, "Нет FCM-токена").write(w)
		return
	}
	platform := request.Platform
	if platform == "" {
		platform = "android"
	}
	if err := a.store.SavePushToken(user.ID, strings.TrimSpace(request.Token), platform); err != nil {
		fail(http.StatusInternalServerError, "Не удалось сохранить токен").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *server) deletePushToken(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Token string `json:"token"`
	}
	if err := decode(r, &request); err != nil || request.Token == "" {
		fail(http.StatusBadRequest, "Нет FCM-токена").write(w)
		return
	}
	_ = a.store.DeletePushToken(user.ID, request.Token)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
