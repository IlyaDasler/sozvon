package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/store"
)

// Личные переписки: история, отправка, правка и удаление (шифрование — конверт внутри).

func (a *server) dmJSON(message *store.DMMessage) map[string]any {
	body := map[string]any{
		"id":          message.ID,
		"fromId":      message.FromID,
		"toId":        message.ToID,
		"text":        message.Text,
		"attachments": attachmentsFromJSON(message.Attachments),
		"preview":     nil,
		"enc":         encValue(message.Enc),
		"replyTo":     message.ReplyTo,
		"mentionAll":  message.MentionAll,
		"threadRoot":  message.ThreadRoot,
		"editedAt":    message.EditedAt,
		"createdAt":   message.CreatedAt,
	}
	if message.Preview != "" {
		var preview any
		if json.Unmarshal([]byte(message.Preview), &preview) == nil {
			body["preview"] = preview
		}
	}
	return body
}

func (a *server) dmPeer(peerID, userID int64) (*store.User, bool) {
	if peerID == userID {
		return nil, false
	}
	friends, err := a.store.AreFriends(userID, peerID)
	if err != nil || !friends {
		return nil, false
	}
	peer, err := a.store.UserByID(peerID)
	if err != nil {
		return nil, false
	}
	return peer, true
}

func (a *server) dmMessages(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	peerID, err := parseInt64(chi.URLParam(r, "peerId"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный собеседник").write(w)
		return
	}
	if _, ok := a.dmPeer(peerID, user.ID); !ok {
		fail(http.StatusNotFound, "Собеседник не найден").write(w)
		return
	}
	before := int64(0)
	if value := r.URL.Query().Get("before"); value != "" {
		before, _ = strconv.ParseInt(value, 10, 64)
	}
	limit := 50
	list, err := a.store.DMHistory(user.ID, peerID, before, limit)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(list))
	for _, message := range list {
		body = append(body, a.dmJSON(message))
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *server) sendDM(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	peerID, err := parseInt64(chi.URLParam(r, "peerId"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный собеседник").write(w)
		return
	}
	if _, ok := a.dmPeer(peerID, user.ID); !ok {
		fail(http.StatusNotFound, "Собеседник не найден").write(w)
		return
	}
	if !a.userLimit(user.ID, "message", a.cfg.MessageRateLimit, 10*time.Second) {
		fail(http.StatusTooManyRequests, "Вы пишете слишком быстро, подождите несколько секунд").write(w)
		return
	}
	var request struct {
		Text          string          `json:"text"`
		Enc           json.RawMessage `json:"enc"`
		PreviewURL    string          `json:"previewUrl"`
		AttachmentIDs []string        `json:"attachmentIds"`
		ReplyToID     *int64          `json:"replyToId"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	text := request.Text
	hasEnc := len(request.Enc) > 0 && string(request.Enc) != "null"
	if !hasEnc && text == "" && len(request.AttachmentIDs) == 0 {
		fail(http.StatusBadRequest, "Напишите сообщение или прикрепите файл").write(w)
		return
	}
	envelope := ""
	if hasEnc {
		envelope = string(request.Enc)
	}
	attachments := "[]"
	if len(request.AttachmentIDs) > 0 {
		ids := make([]struct {
			ID string `json:"id"`
		}, 0, len(request.AttachmentIDs))
		for _, id := range request.AttachmentIDs {
			ids = append(ids, struct {
				ID string `json:"id"`
			}{ID: id})
		}
		resolved, err := a.resolveAttachments(user, ids)
		if err != nil {
			fail(http.StatusBadRequest, "Неверное вложение").write(w)
			return
		}
		if raw, err := json.Marshal(resolved); err == nil {
			attachments = string(raw)
		}
	}
	previewJSON := ""
	if request.PreviewURL != "" && linkInText(text, request.PreviewURL) {
		if preview := a.preview.Fetch(request.PreviewURL); preview != nil {
			if raw, err := json.Marshal(preview); err == nil {
				previewJSON = string(raw)
			}
		}
	}
	message, err := a.store.InsertDM(user.ID, peerID, text, attachments, previewJSON, envelope, request.ReplyToID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	event := map[string]any{"type": "message", "message": a.dmJSON(message)}
	a.hub.Send(user.ID, event)
	a.hub.Send(peerID, event)
	writeJSON(w, http.StatusOK, a.dmJSON(message))
}

func (a *server) editDM(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	messageID, _ := parseInt64(chi.URLParam(r, "id"))
	message, err := a.store.DMByID(messageID)
	if err != nil || message.FromID != user.ID {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	var request struct {
		Enc json.RawMessage `json:"enc"`
	}
	if err := decode(r, &request); err != nil || len(request.Enc) == 0 {
		fail(http.StatusBadRequest, "Неверный зашифрованный конверт").write(w)
		return
	}
	updated, err := a.store.SetDMEnc(messageID, string(request.Enc))
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	event := map[string]any{"type": "message:edited", "message": a.dmJSON(updated)}
	a.hub.Send(user.ID, event)
	a.hub.Send(message.ToID, event)
	writeJSON(w, http.StatusOK, a.dmJSON(updated))
}

func (a *server) deleteDM(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	messageID, _ := parseInt64(chi.URLParam(r, "id"))
	message, err := a.store.DMByID(messageID)
	if err != nil || (message.FromID != user.ID && message.ToID != user.ID) {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	if err := a.store.DeleteDM(messageID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	event := map[string]any{"type": "message:deleted", "id": messageID, "fromId": message.FromID, "toId": message.ToID}
	a.hub.Send(message.FromID, event)
	a.hub.Send(message.ToID, event)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

var _ = time.Now

// dmPins — закреплённые сообщения переписки (пока пусто, как только закрепов нет)
func (a *server) dmPins(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	peerID, _ := parseInt64(chi.URLParam(r, "peerId"))
	if _, ok := a.dmPeer(peerID, user.ID); !ok {
		fail(http.StatusNotFound, "Собеседник не найден").write(w)
		return
	}
	ids, err := a.store.DMPinnedIDs(user.ID, peerID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		if message, err := a.store.DMByID(id); err == nil {
			item := a.dmJSON(message)
			item["pinned"] = true
			body = append(body, item)
		}
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *server) dmPin(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	peerID, _ := parseInt64(chi.URLParam(r, "peerId"))
	messageID, _ := parseInt64(chi.URLParam(r, "id"))
	if _, ok := a.dmPeer(peerID, user.ID); !ok {
		fail(http.StatusNotFound, "Собеседник не найден").write(w)
		return
	}
	message, err := a.store.DMByID(messageID)
	if err != nil || (message.FromID != user.ID && message.ToID != user.ID) {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	pinned := r.Method == http.MethodPut
	if pinned {
		err = a.store.AddPin("dm", peerID, messageID, user.ID)
	} else {
		err = a.store.RemovePin("dm", messageID)
	}
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.hub.Send(user.ID, map[string]any{"type": "message:pinned", "id": messageID, "peerId": peerID, "pinned": pinned})
	a.hub.Send(peerID, map[string]any{"type": "message:pinned", "id": messageID, "peerId": user.ID, "pinned": pinned})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
func (a *server) dmReactions(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	peerID, _ := parseInt64(chi.URLParam(r, "peerId"))
	messageID, _ := parseInt64(chi.URLParam(r, "id"))
	if _, ok := a.dmPeer(peerID, user.ID); !ok {
		fail(http.StatusNotFound, "Собеседник не найден").write(w)
		return
	}
	message, err := a.store.DMByID(messageID)
	if err != nil || (message.FromID != user.ID && message.ToID != user.ID) {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	if r.Method == http.MethodGet {
		list, err := a.store.ReactionUsers("dm", messageID)
		if err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		named := make([]map[string]any, 0, len(list))
		for _, group := range list {
			users := make([]map[string]any, 0)
			if ids, ok := group["userIds"].([]int64); ok {
				for _, id := range ids {
					if member, err := a.store.UserByID(id); err == nil {
						users = append(users, a.publicUser(member))
					}
				}
			}
			named = append(named, map[string]any{"emoji": group["emoji"], "users": users})
		}
		writeJSON(w, http.StatusOK, named)
		return
	}
	var request struct {
		Emoji string `json:"emoji"`
	}
	if err := decode(r, &request); err != nil || request.Emoji == "" {
		fail(http.StatusBadRequest, "Неверный смайлик").write(w)
		return
	}
	list, err := a.store.ToggleReaction("dm", messageID, user.ID, request.Emoji)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.hub.Send(user.ID, map[string]any{"type": "message:reactions", "id": messageID, "peerId": peerID, "reactions": list})
	a.hub.Send(peerID, map[string]any{"type": "message:reactions", "id": messageID, "peerId": user.ID, "reactions": list})
	writeJSON(w, http.StatusOK, list)
}
