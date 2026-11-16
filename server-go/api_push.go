package main

import (
	"fmt"
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

// pushModerationNotification never puts report text, category, or resolution
// details on the lock screen. The app fetches the authenticated durable notice
// after the user taps it.
func (a *server) pushModerationNotification(notice store.ModerationNotification) {
	if a.push == nil || notice.UserID <= 0 {
		return
	}
	tokens, err := a.store.PushTokensForUsers([]int64{notice.UserID})
	if err != nil {
		slogPush("moderation token lookup", err)
		return
	}
	title, body, data := moderationPushPayload(notice)
	go a.push.send(tokens, title, body, data)
}

func moderationPushPayload(notice store.ModerationNotification) (string, string, map[string]string) {
	title := strings.TrimSpace(notice.Title)
	if title == "" {
		title = "Уведомление по жалобе"
	}
	data := map[string]string{
		"type":     "moderation",
		"kind":     notice.Kind,
		"noticeId": fmt.Sprint(notice.ID),
		"reportId": fmt.Sprint(notice.ReportID),
	}
	return title, "Откройте Созвон, чтобы посмотреть уведомление.", data
}
