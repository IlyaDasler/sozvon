package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

// Баннеры и обои чата — публичные картинки, как в Node.
// Go-загрузки баннеров исторически лежат в avatars, старые Node-баннеры — в banners,
// поэтому раздача проверяет оба места. Обои всегда лежат в wallpapers.

const maxWallpaperBytes = 3 << 20

var (
	mediaFile = regexp.MustCompile(`^[a-f0-9]{32}\.(webp|gif|png|jpg)$`)
	mediaID   = regexp.MustCompile(`^[a-f0-9]{32}$`)
)

func imageContentType(file string) string {
	switch strings.ToLower(filepath.Ext(file)) {
	case ".webp":
		return "image/webp"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	}
	return ""
}

func (a *server) serveImageFrom(w http.ResponseWriter, r *http.Request, file string) {
	handle, err := os.Open(file)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer handle.Close()
	contentType := imageContentType(file)
	if contentType == "" {
		head := make([]byte, 512)
		count, _ := handle.Read(head)
		_, _ = handle.Seek(0, io.SeekStart)
		contentType = http.DetectContentType(head[:count])
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	_, _ = io.Copy(w, handle)
}

func (a *server) serveBanner(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if mediaID.MatchString(name) {
		a.serveImageFrom(w, r, filepath.Join(a.cfg.DataDir, "avatars", name+".webp"))
		return
	}
	if mediaFile.MatchString(name) {
		a.serveImageFrom(w, r, filepath.Join(a.cfg.DataDir, "banners", name))
		return
	}
	http.NotFound(w, r)
}

func (a *server) serveWallpaper(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if !mediaFile.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	a.serveImageFrom(w, r, filepath.Join(a.cfg.DataDir, "wallpapers", name))
}

func imageExtension(body []byte) string {
	switch http.DetectContentType(body) {
	case "image/webp":
		return ".webp"
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	default:
		return ""
	}
}

func (a *server) contactWallpaper(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	peerID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный собеседник").write(w)
		return
	}
	if _, ok := a.dmPeer(peerID, user.ID); !ok {
		fail(http.StatusNotFound, "Этого человека нет в друзьях").write(w)
		return
	}
	old, _ := a.store.ChatWallpaperOf(user.ID, peerID)
	removeOld := func() {
		if old != "" {
			_ = os.Remove(filepath.Join(a.cfg.DataDir, "wallpapers", old))
		}
	}
	if r.Method == http.MethodDelete {
		removeOld()
		if err := a.store.SetChatWallpaper(user.ID, peerID, nil); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		notify := map[string]any{"type": "chat:wallpaper", "userId": user.ID, "peerId": peerID, "url": nil, "by": user.ID}
		a.hub.Send(peerID, notify)
		self := map[string]any{"type": "chat:wallpaper", "userId": peerID, "peerId": user.ID, "url": nil, "by": user.ID}
		a.hub.Send(user.ID, self)
		writeJSON(w, http.StatusOK, map[string]any{"url": nil})
		return
	}
	body, ok := readLimited(w, r, maxWallpaperBytes)
	if !ok {
		return
	}
	ext := imageExtension(body)
	if ext == "" {
		fail(http.StatusBadRequest, "Нужна картинка PNG, JPEG, WebP или GIF").write(w)
		return
	}
	dir := filepath.Join(a.cfg.DataDir, "wallpapers")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	name := auth.RandomID(16) + ext
	if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	removeOld()
	if err := a.store.SetChatWallpaper(user.ID, peerID, &name); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	url := "/api/wallpapers/" + name
	notify := map[string]any{"type": "chat:wallpaper", "userId": user.ID, "peerId": peerID, "url": url, "by": user.ID}
	a.hub.Send(peerID, notify)
	self := map[string]any{"type": "chat:wallpaper", "userId": peerID, "peerId": user.ID, "url": url, "by": user.ID}
	a.hub.Send(user.ID, self)
	writeJSON(w, http.StatusOK, map[string]any{"url": url})
}
