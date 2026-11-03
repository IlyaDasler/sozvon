package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/linkpreview"
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
	// Читали только начало — возвращаемся, иначе браузер получит обрезанный файл
	_, _ = file.Seek(0, io.SeekStart)
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
		a.announceProfile(user.ID)
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
	a.announceProfile(user.ID)
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
		a.announceProfile(user.ID)
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
	a.announceProfile(user.ID)
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
// announceProfile — новый аватар или баннер видят друзья и соседи по каналам.
func (a *server) announceProfile(userID int64) {
	fresh, err := a.store.UserByID(userID)
	if err != nil {
		return
	}
	event := map[string]any{"type": "user:updated", "user": a.publicUser(fresh)}
	if ids, err := a.store.RelatedUserIDs(userID); err == nil {
		for _, id := range ids {
			a.hub.Send(id, event)
		}
	}
	a.hub.Send(userID, event)
}
func (a *server) hubIcon(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный канал").write(w)
		return
	}
	hub, err := a.store.HubByID(hubID)
	if err != nil {
		fail(http.StatusNotFound, "Канал не найден").write(w)
		return
	}
	if !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	if r.Method == http.MethodDelete {
		if hub.Icon != "" {
			_ = os.Remove(filepath.Join(a.mediaDir(), hub.Icon+".webp"))
		}
		_ = a.store.SetHubIcon(hubID, "")
		a.broadcastHub(hubID)
		if updated := a.hubOr404(w, hubID); updated != nil {
			writeJSON(w, http.StatusOK, a.hubJSON(updated))
		}
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
	if hub.Icon != "" {
		_ = os.Remove(filepath.Join(a.mediaDir(), hub.Icon+".webp"))
	}
	_ = a.store.SetHubIcon(hubID, id)
	a.broadcastHub(hubID)
	if updated := a.hubOr404(w, hubID); updated != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(updated))
	}
}

// serveHubIcon — публичная картинка канала для списка и шапки.
func (a *server) serveHubIcon(w http.ResponseWriter, r *http.Request) {
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	hub, err := a.store.HubByID(hubID)
	if err != nil || hub.Icon == "" {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(a.mediaDir(), hub.Icon+".webp"))
}
func (a *server) linkPreview(w http.ResponseWriter, r *http.Request) {
	value := r.URL.Query().Get("url")
	if linkpreview.PreviewableURL(value) == nil {
		fail(http.StatusBadRequest, "Неверная ссылка").write(w)
		return
	}
	preview := a.preview.Fetch(value)
	writeJSON(w, http.StatusOK, preview)
}