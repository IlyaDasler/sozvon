package realtime

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Hub — кто сейчас онлайн. У человека может быть несколько клиентов (устройств).
type Hub struct {
	mu    sync.Mutex
	users map[int64]map[*Conn]struct{}
}

type Conn struct {
	UserID int64
	SID    string
	ws     *websocket.Conn
	mu     sync.Mutex
}

func NewHub() *Hub {
	return &Hub{users: map[int64]map[*Conn]struct{}{}}
}

func (h *Hub) Add(conn *Conn) (first bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set, exists := h.users[conn.UserID]
	if !exists {
		set = map[*Conn]struct{}{}
		h.users[conn.UserID] = set
	}
	set[conn] = struct{}{}
	return !exists
}

func (h *Hub) Remove(conn *Conn) (last bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set, exists := h.users[conn.UserID]
	if !exists {
		return false
	}
	delete(set, conn)
	if len(set) == 0 {
		delete(h.users, conn.UserID)
		return true
	}
	return false
}

func (h *Hub) IsOnline(userID int64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.users[userID]) > 0
}

func (h *Hub) Send(userID int64, message any) {
	h.mu.Lock()
	set := h.users[userID]
	conns := make([]*Conn, 0, len(set))
	for conn := range set {
		conns = append(conns, conn)
	}
	h.mu.Unlock()
	for _, conn := range conns {
		conn.Send(message)
	}
}

func (h *Hub) DropSession(userID int64, sid string) {
	h.mu.Lock()
	set := h.users[userID]
	conns := make([]*Conn, 0, len(set))
	for conn := range set {
		if conn.SID == sid {
			conns = append(conns, conn)
		}
	}
	h.mu.Unlock()
	for _, conn := range conns {
		conn.Close(4401, "session closed")
	}
}

func (c *Conn) Send(message any) {
	body, err := json.Marshal(message)
	if err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.ws.WriteMessage(websocket.TextMessage, body)
}

func (c *Conn) Close(code int, reason string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason), deadline())
	_ = c.ws.Close()
}

// CloseRaw закрывает без сообщения (обрыв, мусор от клиента).
func (c *Conn) CloseRaw() {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.ws.Close()
}
func NewConn(userID int64, sid string, ws *websocket.Conn) *Conn {
	return &Conn{UserID: userID, SID: sid, ws: ws}
}

func deadline() time.Time { return time.Now().Add(2 * time.Second) }

// CloseSession — закрыть живые соединения конкретного устройства.
func (h *Hub) CloseSession(userID int64, sid string) {
	h.closeMatching(userID, func(conn *Conn) bool { return conn.SID == sid })
}

// CloseOtherSessions — закрыть все соединения человека, кроме указанного.
func (h *Hub) CloseOtherSessions(userID int64, sid string) {
	h.closeMatching(userID, func(conn *Conn) bool { return conn.SID != sid })
}

func (h *Hub) closeMatching(userID int64, match func(*Conn) bool) {
	h.mu.Lock()
	set := h.users[userID]
	var closing []*Conn
	for conn := range set {
		if match(conn) {
			closing = append(closing, conn)
			delete(set, conn)
		}
	}
	if len(set) == 0 {
		delete(h.users, userID)
	}
	h.mu.Unlock()
	for _, conn := range closing {
		conn.CloseRaw()
	}
}
