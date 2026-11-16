package main

import (
	"embed"
	"net/http"
	"strings"
	"time"

	"sozvon/server/internal/store"
)

//go:embed admin_ui.html admin_ui.js admin_ui.css appeal_ui.html appeal_ui.js
var adminUIFiles embed.FS

func adminAsset(name, contentType string) []byte {
	data, err := adminUIFiles.ReadFile(name)
	if err != nil {
		return []byte("not found")
	}
	return data
}

func (a *server) adminPage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/admin" && r.URL.Path != "/admin/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	_, _ = w.Write(adminAsset("admin_ui.html", "text/html"))
}

func (a *server) adminJS(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(adminAsset("admin_ui.js", "application/javascript"))
}

func (a *server) adminCSS(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(adminAsset("admin_ui.css", "text/css"))
}

func (a *server) createReport(w http.ResponseWriter, r *http.Request) {
	user, ok := r.Context().Value(userKey).(*store.User)
	if !ok || user == nil {
		fail(http.StatusUnauthorized, "Требуется вход").write(w)
		return
	}
	if !a.userLimit(user.ID, "report", 5, 10*time.Minute) {
		fail(http.StatusTooManyRequests, "Слишком часто").write(w)
		return
	}
	var body struct {
		TargetType string `json:"targetType"`
		TargetID   int64  `json:"targetId"`
		Category   string `json:"category"`
		Reason     string `json:"reason"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат").write(w)
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if (body.TargetType != "user" && body.TargetType != "channel") || body.TargetID <= 0 ||
		strings.TrimSpace(body.Category) == "" || len(body.Reason) < 3 || len(body.Reason) > 2000 {
		fail(http.StatusBadRequest, "Заполните категорию и причину").write(w)
		return
	}
	if body.TargetType == "user" && body.TargetID == user.ID {
		fail(http.StatusBadRequest, "Нельзя пожаловаться на себя").write(w)
		return
	}
	id, err := a.store.CreateReport(user.ID, body.TargetType, body.TargetID, strings.TrimSpace(body.Category), body.Reason)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось сохранить жалобу").write(w)
		return
	}
	if report, err := a.store.ModerationReportByID(id); err == nil {
		if notices, err := a.store.CreateReportNotifications(*report); err == nil {
			for _, notice := range notices {
				a.hub.Send(notice.UserID, map[string]any{"type": "moderation:notification", "notification": notice})
				a.pushModerationNotification(notice)
			}
		} else {
			slogWarn("create report notifications", err)
		}
	} else {
		slogWarn("read created report", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

func (a *server) createAppeal(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "appeal") {
		fail(http.StatusTooManyRequests, "Слишком много попыток").write(w)
		return
	}
	var body struct {
		Username string `json:"username"`
		Contact  string `json:"contact"`
		Reason   string `json:"reason"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат").write(w)
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if len(body.Reason) < 10 || len(body.Reason) > 4000 {
		fail(http.StatusBadRequest, "Опишите ситуацию (10–4000 символов)").write(w)
		return
	}
	id, err := a.store.CreateAppeal(strings.TrimSpace(body.Username), strings.TrimSpace(body.Contact), body.Reason)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось сохранить апелляцию").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

func (a *server) appealPage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/appeal" && r.URL.Path != "/appeal/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	_, _ = w.Write(adminAsset("appeal_ui.html", "text/html"))
}

func (a *server) appealJS(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(adminAsset("appeal_ui.js", "application/javascript"))
}
