package main

import (
	"net/http"

	"sozvon/server/internal/store"
)

func (a *server) securityEvents(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	items, err := a.store.SecurityEvents(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if items == nil {
		items = []store.SecurityEvent{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
