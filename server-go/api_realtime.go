package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/realtime"
	"sozvon/server/internal/store"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Приложение десктопное: Origin не несёт смысла, вход проверяется билетом/токеном
	CheckOrigin: func(_ *http.Request) bool { return true },
}

// ---------- статусы ----------

func (a *server) visiblePresence(user *store.User) (bool, string) {
	if !a.hub.IsOnline(user.ID) {
		return false, "offline"
	}
	status := user.Status
	if status == "" {
		status = "online"
	}
	if status == "invisible" {
		return false, "offline"
	}
	return true, status
}

// broadcastPresence — друзьям и соседям по каналам, как в Node
func (a *server) broadcastPresence(userID int64) {
	user, err := a.store.UserByID(userID)
	if err != nil {
		return
	}
	online, status := a.visiblePresence(user)
	message := map[string]any{"type": "presence", "userId": userID, "online": online, "status": status}
	ids, err := a.store.RelatedUserIDs(userID)
	if err != nil {
		return
	}
	for _, id := range ids {
		a.hub.Send(id, message)
	}
	// Себе тоже: приложение показывает свой статус из этого события
	a.hub.Send(userID, message)
}

// handleAutoStatus — клиент сообщает, что человек давно не активен (или вернулся)
func (a *server) handleAutoStatus(user *store.User, message map[string]any) {
	idle, _ := message["idle"].(bool)
	current, err := a.store.UserByID(user.ID)
	if err != nil {
		return
	}
	if idle && current.Status == "online" {
		_ = a.store.UpdateUserStatus(user.ID, "idle")
	} else if !idle && current.Status == "idle" {
		_ = a.store.UpdateUserStatus(user.ID, "online")
	}
	a.broadcastPresence(user.ID)
}

// ---------- WebSocket ----------

func (a *server) redeemTicket(value string) (int64, string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	item, exists := a.tickets[value]
	if !exists {
		return 0, "", false
	}
	delete(a.tickets, value)
	if item.expires.Before(time.Now()) {
		return 0, "", false
	}
	return item.userID, item.sid, true
}

func (a *server) websocket(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	var userID int64
	var sid string
	if ticket := query.Get("ticket"); ticket != "" {
		id, sessionID, ok := a.redeemTicket(ticket)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		userID, sid = id, sessionID
	} else if token := query.Get("token"); token != "" {
		payload, err := auth.ReadToken(a.secret, token)
		if err != nil || payload.SID == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		session, err := a.store.SessionByID(payload.SID)
		if err != nil || session.UserID != payload.UID {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		userID, sid = payload.UID, payload.SID
	} else {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	user, err := a.store.UserByID(userID)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	ws.SetReadLimit(64 * 1024)
	conn := realtime.NewConn(user.ID, sid, ws)
	first := a.hub.Add(conn)
	if first {
		a.broadcastPresence(user.ID)
	}

	// Пинг, чтобы замечать оборванные соединения
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				_ = ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second))
			}
		}
	}()

	for {
		_, raw, err := ws.ReadMessage()
		if err != nil {
			break
		}
		var message map[string]any
		if err := json.Unmarshal(raw, &message); err != nil {
			continue
		}
		kind, _ := message["type"].(string)
		switch kind {
		case "typing":
			a.handleTyping(user, message)
		case "read":
			a.handleRead(user, message)
		case "me:status":
			a.handleStatus(user, message)
		case "status:auto":
			a.handleAutoStatus(user, message)
		case "room:join":
			a.roomJoin(conn, user, message)
		case "room:leave":
			a.roomLeave(conn, user, message)
		case "room:resume":
			a.roomResume(conn, user, message)
		case "room:state":
			a.roomState(conn, user, message)
		case "room:signal":
			a.roomSignal(conn, user, message)
		case "room:preview":
			a.roomPreview(conn, user, message)
		case "room:preview:get":
			a.roomPreviewGet(conn, user, message)
		case "call:invite":
			a.callInvite(conn, user, message)
		case "call:add":
			a.callAdd(conn, user, message)
		case "call:accept":
			a.callAccept(conn, user, message)
		case "call:decline":
			a.callDecline(conn, user, message)
		case "call:hangup":
			a.callHangup(conn, user, message)
		case "signal":
			a.callSignal(conn, user, message)
		}
	}

	close(done)
	conn.CloseRaw()
	if a.hub.Remove(conn) {
		a.userDisconnected(user.ID)
		a.broadcastPresence(user.ID)
	}
}

func number(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil
	}
	return 0, false
}

func (a *server) handleTyping(user *store.User, message map[string]any) {
	if to, ok := number(message["to"]); ok && to != 0 {
		friends, _ := a.store.AreFriends(user.ID, to)
		if !friends {
			return
		}
		a.hub.Send(to, map[string]any{"type": "typing", "userId": user.ID, "conv": "dm:" + itoa(user.ID)})
		return
	}
	roomID, ok := number(message["roomId"])
	if !ok || roomID == 0 {
		return
	}
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		return
	}
	ids, err := a.store.RoomMemberIDs(roomID)
	if err != nil {
		return
	}
	event := map[string]any{"type": "typing", "userId": user.ID, "conv": "room:" + itoa(roomID)}
	for _, id := range ids {
		if id == user.ID {
			continue
		}
		a.hub.Send(id, event)
	}
}

func (a *server) handleRead(user *store.User, message map[string]any) {
	roomID, ok := number(message["roomId"])
	if !ok || roomID == 0 {
		return
	}
	lastID, _ := number(message["lastId"])
	if err := a.store.MarkRoomRead(user.ID, roomID, lastID); err != nil {
		return
	}
	// Другие устройства того же человека должны снять непрочитанное
	event := map[string]any{"type": "read", "conv": "room:" + itoa(roomID)}
	for _, id := range []int64{user.ID} {
		a.hub.Send(id, event)
	}
}

var statuses = map[string]bool{"online": true, "idle": true, "dnd": true, "invisible": true}

func (a *server) handleStatus(user *store.User, message map[string]any) {
	status, _ := message["status"].(string)
	if !statuses[status] {
		return
	}
	if err := a.store.UpdateUserStatus(user.ID, status); err != nil {
		return
	}
	a.broadcastPresence(user.ID)
}

// broadcastRoomMessage — рассылка сообщения участникам комнаты (как room:message в Node)
func (a *server) broadcastRoomMessage(roomID int64, message *store.Message, mentionAll bool, threadRoot *int64) {
	ids, err := a.store.RoomMemberIDs(roomID)
	if err != nil {
		return
	}
	body := withMeta(a.messageJSON(message), message)
	if threadRoot != nil {
		event := map[string]any{"type": "room:thread:new", "roomId": roomID, "rootId": *threadRoot, "message": body}
		for _, id := range ids {
			a.hub.Send(id, event)
		}
		return
	}
	event := map[string]any{"type": "room:message", "message": body, "mentionAll": mentionAll}
	for _, id := range ids {
		a.hub.Send(id, event)
	}
}

var _ = strings.TrimSpace
