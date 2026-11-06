package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

const (
	maxFileBytes   = 25 << 20
	maxAttachments = 10
)

var fileIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

var inlineTypes = map[string][]string{
	"image": {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"},
	"video": {"video/mp4", "video/webm", "video/ogg", "video/quicktime"},
	"audio": {"audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/mp4", "audio/aac", "audio/flac", "audio/x-m4a"},
}

func kindOf(mime string) string {
	for kind, types := range inlineTypes {
		for _, value := range types {
			if value == mime {
				return kind
			}
		}
	}
	return "file"
}

func cleanMime(header string) string {
	mime := strings.ToLower(strings.TrimSpace(strings.Split(header, ";")[0]))
	if !regexp.MustCompile(`^[a-z0-9.+-]+/[a-z0-9.+-]+$`).MatchString(mime) {
		return "application/octet-stream"
	}
	return mime
}

func cleanName(name string) string {
	if index := strings.LastIndexAny(name, `/\`); index >= 0 {
		name = name[index+1:]
	}
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '"' {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "файл"
	}
	runes := []rune(name)
	if len(runes) > 120 {
		name = string(runes[:120])
	}
	return name
}

func (a *server) filesDir() string {
	return filepath.Join(a.cfg.DataDir, "files")
}

func attachmentJSON(upload *store.Upload) map[string]any {
	return map[string]any{
		"id":   upload.ID,
		"name": upload.Name,
		"mime": upload.Mime,
		"size": upload.Size,
		"kind": upload.Kind,
		"url":  "/api/files/" + upload.ID + "/" + urlEscape(upload.Name),
	}
}

func urlEscape(value string) string {
	replacer := strings.NewReplacer(" ", "%20", "#", "%23", "?", "%3F", "%", "%25", "/", "%2F")
	return replacer.Replace(value)
}

func (a *server) upload(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	if !a.userLimit(user.ID, "upload", a.cfg.UploadRateLimit, time.Minute) {
		fail(http.StatusTooManyRequests, "Слишком много файлов подряд, подождите минуту").write(w)
		return
	}
	name := cleanName(r.URL.Query().Get("name"))
	mime := cleanMime(r.Header.Get("Content-Type"))
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxFileBytes))
	if err != nil {
		fail(http.StatusRequestEntityTooLarge, "Слишком большой файл: можно до 25 МБ").write(w)
		return
	}
	if len(body) == 0 {
		fail(http.StatusBadRequest, "Пустой файл").write(w)
		return
	}
	if err := os.MkdirAll(a.filesDir(), 0o755); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	id := auth.RandomID(16)
	if err := os.WriteFile(filepath.Join(a.filesDir(), id), body, 0o644); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	upload, err := a.store.CreateUpload(id, user.ID, name, mime, int64(len(body)), kindOf(mime))
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, attachmentJSON(upload))
}

// serveFile — публичный маршрут: тег img не умеет передавать токен
func (a *server) serveFile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !fileIDPattern.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	upload, err := a.store.UploadByID(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(filepath.Join(a.filesDir(), id))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	inline := upload.Kind != "file"
	contentType := "application/octet-stream"
	if inline {
		contentType = upload.Mime
	}
	w.Header().Set("Content-Type", contentType)
	disposition := "attachment"
	if inline {
		disposition = "inline"
	}
	w.Header().Set("Content-Disposition", disposition+"; filename*=UTF-8''"+urlEscape(upload.Name))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	_, _ = io.Copy(w, file)
}

// resolveAttachments — проверяет загрузки и помечает их использованными
func (a *server) resolveAttachments(user *store.User, raw []struct {
	ID string `json:"id"`
}) ([]map[string]any, error) {
	list := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if !fileIDPattern.MatchString(item.ID) {
			return nil, errBadAttachment
		}
		upload, err := a.store.UploadByID(item.ID)
		if err != nil || upload.OwnerID != user.ID {
			return nil, errBadAttachment
		}
		list = append(list, attachmentJSON(upload))
		_ = a.store.MarkUploadUsed(upload.ID)
	}
	return list, nil
}

var errBadAttachment = &apiError{status: http.StatusBadRequest, body: map[string]any{"error": "Неверное вложение"}}

func attachmentsFromJSON(raw string) []map[string]any {
	if raw == "" {
		return []map[string]any{}
	}
	var list []map[string]any
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		return []map[string]any{}
	}
	return list
}
