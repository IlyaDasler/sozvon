package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/store"
)

func (a *server) keyHistory(w http.ResponseWriter, r *http.Request) {
	id, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный пользователь").write(w)
		return
	}
	items, err := a.store.KeyHistory(id)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if items == nil {
		items = []store.KeyHistoryEvent{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
