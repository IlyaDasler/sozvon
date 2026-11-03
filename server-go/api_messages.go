package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/store"
)

func (a *server) messageJSON(message *store.Message) map[string]any {
	// Вложения и шифрование появятся отдельной фазой; форма как в Node — пустые значения
	body := map[string]any{
		"id":          message.ID,
		"roomId":      message.RoomID,
		"fromId":      message.FromID,
		"text":        message.Text,
		"attachments": []any{},
		"preview":     nil,
		"enc":         encValue(message.Enc),
		"replyTo":     message.ReplyTo,
		"mentionAll":  message.MentionAll,
		"threadRoot":  message.ThreadRoot,
		"editedAt":    message.EditedAt,
		"createdAt":   message.CreatedAt,
		"reactions":   []any{},
		"pinned":      false,
	}
	return body
}

// withMeta добавляет счётчик ответов и автора корня — их Node отдаёт в ответе на отправку и в ленте
func withMeta(body map[string]any, message *store.Message) map[string]any {
	if message.Replies > 0 {
		body["replies"] = message.Replies
	}
	if message.RootFrom != nil {
		body["rootFrom"] = *message.RootFrom
	}
	return body
}

func (a *server) roomMessages(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	var before *int64
	if value := r.URL.Query().Get("before"); value != "" {
		if parsed, err := parseInt64(value); err == nil {
			before = &parsed
		}
	}
	limit := 50
	if value := r.URL.Query().Get("limit"); value != "" {
		if parsed, err := parseInt64(value); err == nil && parsed > 0 && parsed <= 200 {
			limit = int(parsed)
		}
	}
	list, err := a.store.RoomMessages(roomID, limit, before)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(list))
	for _, message := range list {
		item := a.messageJSON(message)
		// в ленте Node показывает счётчик ответов всегда, даже ноль
		item["replies"] = message.Replies
		if message.RootFrom != nil {
			item["rootFrom"] = *message.RootFrom
		}
		body = append(body, item)
	}
	a.enrichRoomMessages(roomID, body, list, user.ID)
	writeJSON(w, http.StatusOK, body)
}

func (a *server) sendRoomMessage(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	var request struct {
		Text         string `json:"text"`
		MentionAll   bool   `json:"mentionAll"`
		ThreadRootID *int64 `json:"threadRootId"`
		ReplyTo      *int64 `json:"replyTo"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	text := strings.TrimSpace(request.Text)
	if text == "" || len([]rune(text)) > 4000 {
		fail(http.StatusBadRequest, "Сообщение: от 1 до 4000 символов").write(w)
		return
	}

	// Ответ в треде привязываем к корню: если отвечают на ответ — берём его корень
	var threadRoot *int64
	if request.ThreadRootID != nil {
		root, err := a.store.RoomMessageByID(*request.ThreadRootID)
		if err != nil || root.RoomID != roomID {
			fail(http.StatusNotFound, "Сообщение не найдено").write(w)
			return
		}
		target := root.ID
		if root.ThreadRoot != nil {
			target = *root.ThreadRoot
		}
		threadRoot = &target
	}

	message, err := a.store.CreateRoomMessage(roomID, user.ID, text, request.MentionAll, threadRoot, request.ReplyTo)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.broadcastRoomMessage(roomID, message, request.MentionAll, threadRoot)
	writeJSON(w, http.StatusOK, withMeta(a.messageJSON(message), message))
}

func (a *server) threadMessages(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	rootID, err := parseInt64(chi.URLParam(r, "messageId"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверное сообщение").write(w)
		return
	}
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	root, err := a.store.RoomMessageByID(rootID)
	if err != nil || root.RoomID != roomID {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	list, err := a.store.ThreadMessages(roomID, rootID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(list))
	for _, message := range list {
		// В треде Node отдаёт «плоскую» форму без replies/rootFrom
		body = append(body, a.messageJSON(message))
	}
	a.enrichRoomMessages(roomID, body, list, user.ID)
	writeJSON(w, http.StatusOK, body)
}

func (a *server) unread(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	rooms, err := a.store.UnreadRooms(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dm": []any{}, "rooms": rooms})
}

func (a *server) markRoomRead(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	var request struct {
		LastID int64 `json:"lastId"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if err := a.store.MarkRoomRead(user.ID, roomID, request.LastID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// encValue — сохранённый зашифрованный конверт как объект (или null)
func encValue(raw string) any {
	if raw == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil
	}
	return value
}
