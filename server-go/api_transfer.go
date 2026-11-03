package main

import (
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/store"
)

// Перенос ключа шифрования на другое устройство: код превращается в id, сервер
// держит запечатанный ключ десять минут и отдаёт его один раз тому же человеку.

var transferIDPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type transferEntry struct {
	userID  int64
	blob    string
	expires time.Time
}

var transfers = struct {
	mu   sync.Mutex
	data map[string]transferEntry
}{data: map[string]transferEntry{}}

func (a *server) keyTransferPut(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		ID   string `json:"id"`
		Blob string `json:"blob"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if !transferIDPattern.MatchString(request.ID) || request.Blob == "" || len(request.Blob) > 16*1024 {
		fail(http.StatusBadRequest, "Неверные данные переноса").write(w)
		return
	}
	transfers.mu.Lock()
	now := time.Now()
	for id, entry := range transfers.data {
		if entry.expires.Before(now) {
			delete(transfers.data, id)
		}
	}
	transfers.data[request.ID] = transferEntry{userID: user.ID, blob: request.Blob, expires: now.Add(10 * time.Minute)}
	transfers.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) keyTransferGet(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	id := chi.URLParam(r, "id")
	transfers.mu.Lock()
	entry, ok := transfers.data[id]
	if ok && entry.userID == user.ID && entry.expires.After(time.Now()) {
		delete(transfers.data, id)
	} else {
		ok = false
	}
	transfers.mu.Unlock()
	if !ok {
		fail(http.StatusNotFound, "Код не подошёл или устарел — создайте новый на старом устройстве").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"blob": entry.blob})
}
