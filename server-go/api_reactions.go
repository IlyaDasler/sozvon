package main

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/store"
)

// Реакции, пины, правка и удаление сообщений в комнате.

func (a *server) enrichRoomMessages(roomID int64, bodies []map[string]any, messages []*store.Message, viewer int64) {
	ids := make([]int64, 0, len(messages))
	for _, message := range messages {
		ids = append(ids, message.ID)
	}
	reactions, err := a.store.ReactionsFor("room", ids, viewer)
	if err != nil {
		reactions = map[int64][]map[string]any{}
	}
	pinned, err := a.store.PinnedSet("room", roomID)
	if err != nil {
		pinned = map[int64]bool{}
	}
	for index, body := range bodies {
		if index >= len(messages) {
			break
		}
		id := messages[index].ID
		list := reactions[id]
		if list == nil {
			list = []map[string]any{}
		}
		body["reactions"] = list
		body["pinned"] = pinned[id]
	}
}

func (a *server) roomMessageReactions(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, _ := parseInt64(chi.URLParam(r, "id"))
	messageID, _ := parseInt64(chi.URLParam(r, "messageId"))
	if roomID == 0 || messageID == 0 {
		fail(http.StatusBadRequest, "Неверные параметры").write(w)
		return
	}
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	roomMessageRoom, _, err := a.store.MessageRoom(messageID)
	if err != nil || roomMessageRoom != roomID {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	if r.Method == http.MethodGet {
		list, err := a.store.ReactionUsers("room", messageID)
		if err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		// Клиент ждёт имена: [{emoji, users:[…]}], а не только id
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
	if err := decode(r, &request); err != nil || request.Emoji == "" || len([]rune(request.Emoji)) > 8 {
		fail(http.StatusBadRequest, "Неверный смайлик").write(w)
		return
	}
	list, err := a.store.ToggleReaction("room", messageID, user.ID, request.Emoji)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	ids, _ := a.store.RoomMemberIDs(roomID)
	event := map[string]any{"type": "room:message:reactions", "id": messageID, "roomId": roomID, "reactions": list}
	for _, id := range ids {
		a.hub.Send(id, event)
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *server) roomPins(w http.ResponseWriter, _ *http.Request) {
	// GET /rooms/{id}/pins обрабатывается ниже с проверкой участника
}

func (a *server) roomPinsList(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, _ := parseInt64(chi.URLParam(r, "id"))
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	ids, err := a.store.PinnedIDs("room", roomID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	messages := make([]*store.Message, 0, len(ids))
	for _, id := range ids {
		if message, err := a.store.RoomMessageByID(id); err == nil {
			messages = append(messages, message)
		}
	}
	bodies := make([]map[string]any, 0, len(messages))
	for _, message := range messages {
		body := a.messageJSON(message)
		body["replies"] = message.Replies
		bodies = append(bodies, body)
	}
	a.enrichRoomMessages(roomID, bodies, messages, user.ID)
	writeJSON(w, http.StatusOK, bodies)
}

func (a *server) roomPin(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, _ := parseInt64(chi.URLParam(r, "id"))
	messageID, _ := parseInt64(chi.URLParam(r, "messageId"))
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	roomIDOfMessage, _, err := a.store.MessageRoom(messageID)
	if err != nil || roomIDOfMessage != roomID {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	pinned := r.Method == http.MethodPut
	if pinned {
		err = a.store.AddPin("room", roomID, messageID, user.ID)
	} else {
		err = a.store.RemovePin("room", messageID)
	}
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	ids, _ := a.store.RoomMemberIDs(roomID)
	event := map[string]any{"type": "room:message:pinned", "id": messageID, "pinned": pinned, "roomId": roomID}
	for _, id := range ids {
		a.hub.Send(id, event)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) roomEditMessage(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, _ := parseInt64(chi.URLParam(r, "id"))
	messageID, _ := parseInt64(chi.URLParam(r, "messageId"))
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	messageRoomID, fromID, err := a.store.MessageRoom(messageID)
	if err != nil || messageRoomID != roomID {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	if fromID != user.ID {
		fail(http.StatusForbidden, "Изменить можно только своё сообщение").write(w)
		return
	}
	var request struct {
		Enc json.RawMessage `json:"enc"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if len(request.Enc) == 0 || string(request.Enc) == "null" {
		fail(http.StatusBadRequest, "Неверный зашифрованный конверт").write(w)
		return
	}
	message, err := a.store.SetMessageEnc(messageID, string(request.Enc))
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := withMeta(a.messageJSON(message), message)
	a.enrichRoomMessages(roomID, []map[string]any{body}, []*store.Message{message}, user.ID)
	ids, _ := a.store.RoomMemberIDs(roomID)
	for _, id := range ids {
		a.hub.Send(id, map[string]any{"type": "room:message:edited", "message": body})
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *server) roomDeleteMessage(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, _ := parseInt64(chi.URLParam(r, "id"))
	messageID, _ := parseInt64(chi.URLParam(r, "messageId"))
	messageRoomID, fromID, err := a.store.MessageRoom(messageID)
	if err != nil || messageRoomID != roomID {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	member, _ := a.store.IsRoomMember(roomID, user.ID)
	if !member {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	if fromID != user.ID {
		room, err := a.store.RoomByID(roomID)
		if err != nil || !a.roomManager(room, user.ID) {
			fail(http.StatusForbidden, "Удалять чужие сообщения может только тот, кто настраивает комнату").write(w)
			return
		}
	}
	if err := a.store.DeleteMessage(messageID); err != nil {
		fail(http.StatusNotFound, "Сообщение не найдено").write(w)
		return
	}
	ids, _ := a.store.RoomMemberIDs(roomID)
	for _, id := range ids {
		a.hub.Send(id, map[string]any{"type": "room:message:deleted", "roomId": roomID, "id": messageID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
