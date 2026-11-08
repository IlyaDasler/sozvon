package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

const (
	maxFileBytes   = 25 << 20
	maxAttachments = 10
	fileURLTTL     = 24 * time.Hour
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

func (a *server) fileSignature(id string, expires int64) string {
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte("file:" + id + ":" + strconv.FormatInt(expires, 10)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// fileURL — короткоживущая ссылка на вложение. Без подписи файл не отдаётся:
// случайная ссылка из переписки не работает вечно.
func (a *server) fileURL(id, name string) string {
	expires := time.Now().Add(fileURLTTL).Unix()
	return "/api/files/" + id + "/" + urlEscape(name) +
		"?expires=" + strconv.FormatInt(expires, 10) +
		"&sig=" + url.QueryEscape(a.fileSignature(id, expires))
}

func (a *server) fileURLOK(id string, r *http.Request) bool {
	expires, err := strconv.ParseInt(r.URL.Query().Get("expires"), 10, 64)
	if err != nil || expires < time.Now().Unix() || expires > time.Now().Add(2*fileURLTTL).Unix() {
		return false
	}
	sig := r.URL.Query().Get("sig")
	return hmac.Equal([]byte(sig), []byte(a.fileSignature(id, expires)))
}

func (a *server) attachmentJSON(upload *store.Upload) map[string]any {
	return map[string]any{
		"id":   upload.ID,
		"name": upload.Name,
		"mime": upload.Mime,
		"size": upload.Size,
		"kind": upload.Kind,
		"url":  a.fileURL(upload.ID, upload.Name),
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
	writeJSON(w, http.StatusOK, a.attachmentJSON(upload))
}

// serveFile — публичный маршрут: тег img не умеет передавать токен,
// поэтому доступ даёт короткоживущая подпись в URL.
func (a *server) serveFile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !fileIDPattern.MatchString(id) || !a.fileURLOK(id, r) {
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
	w.Header().Set("Cache-Control", "private, max-age=3600")
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
		list = append(list, a.attachmentJSON(upload))
		_ = a.store.MarkUploadUsed(upload.ID)
	}
	return list, nil
}

var errBadAttachment = &apiError{status: http.StatusBadRequest, body: map[string]any{"error": "Неверное вложение"}}

// attachmentsFromJSON заново подписывает ссылки на вложения: в базе
// хранятся старые URL, а срок подписи ограничен.
func (a *server) attachmentsFromJSON(raw string) []map[string]any {
	if raw == "" {
		return []map[string]any{}
	}
	var list []map[string]any
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		return []map[string]any{}
	}
	for _, item := range list {
		id, _ := item["id"].(string)
		name, _ := item["name"].(string)
		if !fileIDPattern.MatchString(id) {
			continue
		}
		if name == "" {
			name = "файл"
		}
		item["url"] = a.fileURL(id, name)
	}
	return list
}
