package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

// Аватарки, баннеры и фоны комнат лежат рядом (как в Node) и отдаются публично по id.

const (
	maxAvatarBytes     = 5 << 20
	maxBannerBytes     = 5 << 20
	maxBackgroundBytes = 2 << 20
)

var mediaName = regexp.MustCompile(`^[a-f0-9]{32}\.webp$`)

func (a *server) mediaDir() string { return filepath.Join(a.cfg.DataDir, "avatars") }

func (a *server) storeMedia(data []byte) (string, error) {
	if err := os.MkdirAll(a.mediaDir(), 0o755); err != nil {
		return "", err
	}
	id := auth.RandomID(16)
	if err := os.WriteFile(filepath.Join(a.mediaDir(), id+".webp"), data, 0o644); err != nil {
		return "", err
	}
	return id, nil
}

// serveMedia — публичная раздача /api/avatars/<id>.webp
func (a *server) serveMedia(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if !mediaName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(filepath.Join(a.mediaDir(), name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	head := make([]byte, 512)
	count, _ := file.Read(head)
	w.Header().Set("Content-Type", http.DetectContentType(head[:count]))
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, file)
}

func readLimited(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		fail(http.StatusRequestEntityTooLarge, "Файл слишком большой").write(w)
		return nil, false
	}
	if len(body) == 0 {
		fail(http.StatusBadRequest, "Пустой файл").write(w)
		return nil, false
	}
	return body, true
}

func (a *server) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	if r.Method == http.MethodDelete {
		if user.Avatar != "" {
			_ = os.Remove(filepath.Join(a.mediaDir(), user.Avatar+".webp"))
		}
		_ = a.store.SetUserAvatar(user.ID, "")
		fresh, _ := a.store.UserByID(user.ID)
		self, _ := a.self(fresh)
		writeJSON(w, http.StatusOK, self)
		return
	}
	body, ok := readLimited(w, r, maxAvatarBytes)
	if !ok {
		return
	}
	id, err := a.storeMedia(body)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if user.Avatar != "" {
		_ = os.Remove(filepath.Join(a.mediaDir(), user.Avatar+".webp"))
	}
	_ = a.store.SetUserAvatar(user.ID, id)
	fresh, _ := a.store.UserByID(user.ID)
	self, _ := a.self(fresh)
	writeJSON(w, http.StatusOK, self)
}

func (a *server) uploadBanner(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	if r.Method == http.MethodDelete {
		if user.Banner != "" {
			_ = os.Remove(filepath.Join(a.mediaDir(), user.Banner+".webp"))
		}
		_ = a.store.SetUserBanner(user.ID, "")
		fresh, _ := a.store.UserByID(user.ID)
		self, _ := a.self(fresh)
		writeJSON(w, http.StatusOK, self)
		return
	}
	body, ok := readLimited(w, r, maxBannerBytes)
	if !ok {
		return
	}
	id, err := a.storeMedia(body)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if user.Banner != "" {
		_ = os.Remove(filepath.Join(a.mediaDir(), user.Banner+".webp"))
	}
	_ = a.store.SetUserBanner(user.ID, id)
	fresh, _ := a.store.UserByID(user.ID)
	self, _ := a.self(fresh)
	writeJSON(w, http.StatusOK, self)
}

func (a *server) roomBackground(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	room, err := a.store.RoomByID(roomID)
	if err != nil {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	if !a.roomManager(room, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	if r.Method == http.MethodDelete {
		if room.Background != "" {
			_ = os.Remove(filepath.Join(a.mediaDir(), room.Background+".webp"))
		}
		_ = a.store.SetRoomBackground(roomID, "")
	} else {
		body, ok := readLimited(w, r, maxBackgroundBytes)
		if !ok {
			return
		}
		id, err := a.storeMedia(body)
		if err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		if room.Background != "" {
			_ = os.Remove(filepath.Join(a.mediaDir(), room.Background+".webp"))
		}
		_ = a.store.SetRoomBackground(roomID, id)
	}
	updated, err := a.store.RoomByID(roomID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.notifyRoom(roomID)
	writeJSON(w, http.StatusOK, a.roomJSON(updated))
}
