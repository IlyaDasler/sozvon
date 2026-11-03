package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

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
		"attachments": attachmentsFromJSON(message.Attachments),
		"preview":     previewValue(message.Preview),
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
	if until, _ := a.store.RoomTimeout(roomID, user.ID); until > time.Now().UnixMilli() {
		fail(http.StatusForbidden, "Вас кикнули — пока можно только читать").write(w)
		return
	}
	perms, _ := a.store.RoomPerms(roomID, user.ID)
	if perms&8 == 0 {
		fail(http.StatusForbidden, "В этой комнате у вас нет права писать").write(w)
		return
	}
	var request struct {
		Text          string `json:"text"`
		MentionAll    bool   `json:"mentionAll"`
		ThreadRootID  *int64 `json:"threadRootId"`
		ReplyTo       *int64 `json:"replyTo"`
		ReplyToID     *int64 `json:"replyToId"`
		Enc           json.RawMessage `json:"enc"`
		PreviewURL    string          `json:"previewUrl"`
		AttachmentIDs []string        `json:"attachmentIds"`
		Attachments   []struct {
			ID string `json:"id"`
		} `json:"attachments"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if request.ReplyTo == nil && request.ReplyToID != nil {
		request.ReplyTo = request.ReplyToID
	}
	for _, id := range request.AttachmentIDs {
		request.Attachments = append(request.Attachments, struct {
			ID string `json:"id"`
		}{ID: id})
	}
	hasEnc := len(request.Enc) > 0 && string(request.Enc) != "null"
	if hasEnc {
		var envelope struct {
			Epoch int64 `json:"epoch"`
		}
		if err := json.Unmarshal(request.Enc, &envelope); err != nil {
			fail(http.StatusBadRequest, "Неверный зашифрованный конверт").write(w)
			return
		}
		current, _ := a.store.ConvEpoch("room:" + itoa(roomID))
		if envelope.Epoch > current {
			fail(http.StatusBadRequest, "Такой версии ключа у комнаты нет").write(w)
			return
		}
	}
	text := strings.TrimSpace(request.Text)
	if len([]rune(text)) > 4000 {
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

	// Вложения: только текстом можно без файлов, пустое сообщение не отправляем
	if text == "" && len(request.Attachments) == 0 && !hasEnc {
		fail(http.StatusBadRequest, "Сообщение: от 1 до 4000 символов").write(w)
		return
	}
	if len(request.Attachments) > maxAttachments {
		fail(http.StatusBadRequest, "Можно прикрепить не больше 10 файлов").write(w)
		return
	}
	var attachments []map[string]any
	if len(request.Attachments) > 0 {
		resolved, err := a.resolveAttachments(user, request.Attachments)
		if err != nil {
			err.(*apiError).write(w)
			return
		}
		attachments = resolved
	}

	message, err := a.store.CreateRoomMessage(roomID, user.ID, text, request.MentionAll, threadRoot, request.ReplyTo)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if len(attachments) > 0 {
		raw, _ := json.Marshal(attachments)
		if updated, err := a.store.SetMessageAttachments(message.ID, string(raw)); err == nil {
			message = updated
		}
	}
	// Превью ссылки: только если эта ссылка действительно есть в тексте
	if request.PreviewURL != "" && linkInText(text, request.PreviewURL) {
		if preview := a.preview.Fetch(request.PreviewURL); preview != nil {
			if raw, err := json.Marshal(preview); err == nil {
				if updated, err := a.store.SetMessagePreview(message.ID, string(raw)); err == nil {
					message = updated
				}
			}
		}
	}
	if hasEnc {
		if updated, err := a.store.SetMessageEnvelope(message.ID, string(request.Enc)); err == nil {
			message = updated
		}
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
	dm, _ := a.store.UnreadDM(user.ID)
	if dm == nil {
		dm = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"dm": dm, "rooms": rooms})
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

// previewValue — сохранённый предпросмотр ссылки как объект (или null)
func previewValue(raw string) any {
	if raw == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil
	}
	return value
}

// linkInText — ссылка из превью должна быть в самом сообщении
func linkInText(text, rawURL string) bool {
	if text == "" || rawURL == "" {
		return false
	}
	if strings.Contains(text, rawURL) {
		return true
	}
	bare := strings.TrimPrefix(strings.TrimPrefix(rawURL, "https://"), "http://")
	return bare != "" && strings.Contains(text, bare)
}
// readConv — «прочитал переписку до конца»: dm или room, плюс событие себе.
func (a *server) readConv(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Conv string `json:"conv"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	parts := strings.SplitN(request.Conv, ":", 2)
	if len(parts) != 2 {
		fail(http.StatusBadRequest, "Неверная переписка").write(w)
		return
	}
	id, err := parseInt64(parts[1])
	if err != nil {
		fail(http.StatusBadRequest, "Неверная переписка").write(w)
		return
	}
	switch parts[0] {
	case "dm":
		if _, ok := a.dmPeer(id, user.ID); !ok {
			fail(http.StatusNotFound, "Собеседник не найден").write(w)
			return
		}
		if err := a.store.MarkDMRead(user.ID, id); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	case "room":
		member, err := a.store.IsRoomMember(id, user.ID)
		if err != nil || !member {
			fail(http.StatusNotFound, "Комната не найдена").write(w)
			return
		}
		list, err := a.store.RoomMessages(id, 1, nil)
		last := int64(0)
		if err == nil && len(list) > 0 {
			last = list[len(list)-1].ID
		}
		if err := a.store.MarkRoomRead(user.ID, id, last); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	default:
		fail(http.StatusBadRequest, "Неверная переписка").write(w)
		return
	}
	a.hub.Send(user.ID, map[string]any{"type": "read", "conv": request.Conv})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}