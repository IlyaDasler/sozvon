package main

import (
	"sync"
	"time"

	"sozvon/server/internal/realtime"
	"sozvon/server/internal/store"
)

// Звонки на двоих: приглашение, ответ, отбой и пересылка SDP/ICE.
// Групповые звонки и голосовые комнаты — следующий кусок фазы 5.
const ringTimeout = 45 * time.Second

type callMember struct {
	conn  *realtime.Conn
	group bool
}

type call struct {
	id      string
	state   string // ringing | active
	members map[int64]*callMember
	ringing map[int64]*time.Timer
}

type callManager struct {
	mu    sync.Mutex
	calls map[string]*call
}

func newCallManager() *callManager {
	return &callManager{calls: map[string]*call{}}
}

func (m *callManager) get(id string) *call {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls[id]
}

func (m *callManager) busy(userID int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, c := range m.calls {
		if _, exists := c.members[userID]; exists {
			return true
		}
		if _, exists := c.ringing[userID]; exists {
			return true
		}
	}
	return false
}

func (m *callManager) setGroup(id string, userID int64, group bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if call, exists := m.calls[id]; exists {
		if member, ok := call.members[userID]; ok {
			member.group = group
		}
	}
}

func (m *callManager) setRinging(id string, userID int64, timer *time.Timer) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	call, exists := m.calls[id]
	if !exists {
		return false
	}
	call.ringing[userID] = timer
	return true
}

func (m *callManager) create(id string, caller int64, callerConn *realtime.Conn) *call {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := &call{id: id, state: "ringing", members: map[int64]*callMember{}, ringing: map[int64]*time.Timer{}}
	c.members[caller] = &callMember{conn: callerConn}
	m.calls[id] = c
	return c
}

func (m *callManager) delete(id string) *call {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.calls[id]
	delete(m.calls, id)
	return c
}

func (m *callManager) removeUser(userID int64) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, c := range m.calls {
		if _, exists := c.members[userID]; exists {
			delete(c.members, userID)
			for _, timer := range c.ringing {
				timer.Stop()
			}
			if len(c.members) < 2 {
				delete(m.calls, id)
			}
			return id
		}
	}
	return ""
}

// ---------- обработчики ----------

func (a *server) callInvite(conn *realtime.Conn, user *store.User, message map[string]any) {
	to, ok := number(message["to"])
	if !ok || to == 0 || to == user.ID {
		return
	}
	friends, _ := a.store.AreFriends(user.ID, to)
	if !friends {
		conn.Send(map[string]any{"type": "call:unavailable", "reason": "not-contact"})
		return
	}
	if !a.hub.IsOnline(to) {
		conn.Send(map[string]any{"type": "call:unavailable", "reason": "offline"})
		return
	}
	if a.calls.busy(to) || a.calls.busy(user.ID) {
		conn.Send(map[string]any{"type": "call:unavailable", "reason": "busy"})
		return
	}
	id := authRandomID()
	group, _ := messageBool(message, "group")
	a.calls.create(id, user.ID, conn)
	a.calls.setGroup(id, user.ID, group)
	if _, err := a.store.UserByID(to); err != nil {
		a.calls.delete(id)
		return
	}
	timer := time.AfterFunc(ringTimeout, func() { a.endCall(id, "timeout") })
	if !a.calls.setRinging(id, to, timer) {
		timer.Stop()
		return
	}

	conn.Send(map[string]any{"type": "call:ringing", "callId": id, "to": to})
	a.hub.Send(to, map[string]any{"type": "call:incoming", "callId": id, "from": a.publicUser(user)})
}

func (a *server) callAccept(conn *realtime.Conn, user *store.User, message map[string]any) {
	id, _ := message["callId"].(string)
	call := a.calls.get(id)
	if call == nil {
		return
	}
	a.calls.mu.Lock()
	timer, ringing := call.ringing[user.ID]
	if !ringing {
		a.calls.mu.Unlock()
		return
	}
	timer.Stop()
	delete(call.ringing, user.ID)
	peers := make([]int64, 0, len(call.members))
	for memberID := range call.members {
		peers = append(peers, memberID)
	}
	group, _ := messageBool(message, "group")
	call.members[user.ID] = &callMember{conn: conn, group: group}
	wasRinging := call.state == "ringing"
	if wasRinging {
		call.state = "active"
	}
	members := make([]int64, 0, len(call.members))
	for memberID := range call.members {
		members = append(members, memberID)
	}
	a.calls.mu.Unlock()

	if wasRinging {
		for _, memberID := range members {
			if memberID == user.ID {
				continue
			}
			a.hub.Send(memberID, map[string]any{"type": "call:accepted", "callId": id})
		}
		return
	}
	conn.Send(map[string]any{"type": "call:joined", "callId": id, "peers": peers})
	for _, memberID := range members {
		if memberID == user.ID {
			continue
		}
		a.hub.Send(memberID, map[string]any{"type": "call:member", "callId": id, "userId": user.ID, "state": "joined"})
	}
}

func (a *server) callDecline(_ *realtime.Conn, user *store.User, message map[string]any) {
	id, _ := message["callId"].(string)
	call := a.calls.get(id)
	if call == nil {
		return
	}
	a.calls.mu.Lock()
	timer, ringing := call.ringing[user.ID]
	if ringing {
		timer.Stop()
		delete(call.ringing, user.ID)
	}
	state := call.state
	a.calls.mu.Unlock()
	if !ringing {
		return
	}
	if state == "ringing" {
		a.endCall(id, "declined")
		return
	}
	a.hub.Send(user.ID, map[string]any{"type": "call:ended", "callId": id, "reason": "declined"})
	a.callMembers(id, user.ID, "declined")
}

func (a *server) callHangup(_ *realtime.Conn, user *store.User, message map[string]any) {
	id, _ := message["callId"].(string)
	a.leaveCall(id, user.ID, "hangup")
}

func (a *server) callSignal(conn *realtime.Conn, user *store.User, message map[string]any) {
	id, _ := message["callId"].(string)
	call := a.calls.get(id)
	if call == nil {
		return
	}
	a.calls.mu.Lock()
	member, ok := call.members[user.ID]
	if !ok || member.conn != conn || call.state != "active" {
		a.calls.mu.Unlock()
		return
	}
	targets := []int64{}
	if to, ok := number(message["to"]); ok && to != 0 {
		if other, exists := call.members[to]; exists && other.conn != nil {
			targets = append(targets, to)
		}
	} else if len(call.members) == 2 {
		for memberID := range call.members {
			if memberID != user.ID {
				targets = append(targets, memberID)
			}
		}
	}
	a.calls.mu.Unlock()
	for _, target := range targets {
		a.hub.Send(target, map[string]any{"type": "signal", "callId": id, "from": user.ID, "data": message["data"]})
	}
}

// ---------- внутреннее ----------

func (a *server) callMembers(id string, except int64, memberState string) {
	call := a.calls.get(id)
	if call == nil {
		return
	}
	a.calls.mu.Lock()
	members := make([]int64, 0, len(call.members))
	for memberID := range call.members {
		if memberID != except {
			members = append(members, memberID)
		}
	}
	a.calls.mu.Unlock()
	for _, memberID := range members {
		a.hub.Send(memberID, map[string]any{"type": "call:member", "callId": id, "userId": except, "state": memberState})
	}
}

func (a *server) endCall(id string, reason string) {
	call := a.calls.delete(id)
	if call == nil {
		return
	}
	a.calls.mu.Lock()
	members := make([]int64, 0, len(call.members))
	for memberID := range call.members {
		members = append(members, memberID)
	}
	ringing := make([]int64, 0, len(call.ringing))
	for memberID, timer := range call.ringing {
		timer.Stop()
		ringing = append(ringing, memberID)
	}
	a.calls.mu.Unlock()
	event := map[string]any{"type": "call:ended", "callId": id, "reason": reason}
	for _, memberID := range members {
		a.hub.Send(memberID, event)
	}
	for _, memberID := range ringing {
		a.hub.Send(memberID, event)
	}
}

func (a *server) leaveCall(id string, userID int64, reason string) {
	call := a.calls.get(id)
	if call == nil {
		return
	}
	a.calls.mu.Lock()
	_, isMember := call.members[userID]
	if !isMember {
		a.calls.mu.Unlock()
		return
	}
	delete(call.members, userID)
	remaining := len(call.members)
	a.calls.mu.Unlock()
	if remaining < 2 {
		a.endCall(id, reason)
		return
	}
	a.callMembers(id, userID, "left")
}

// userDisconnected — обрыв связи: выходим из звонка (в Node было окно ожидания)
func (a *server) userDisconnected(userID int64) {
	id := a.calls.removeUser(userID)
	if id == "" {
		return
	}
	a.endCall(id, "disconnected")
}

func messageBool(message map[string]any, key string) (bool, bool) {
	value, exists := message[key]
	flag, ok := value.(bool)
	return flag, exists && ok
}

// callAdd — позвать друга в идущий звонок
func (a *server) callAdd(conn *realtime.Conn, user *store.User, message map[string]any) {
	id, _ := message["callId"].(string)
	to, ok := number(message["to"])
	if !ok || to == 0 {
		return
	}
	call := a.calls.get(id)
	if call == nil {
		return
	}
	fail := func(reason string) {
		conn.Send(map[string]any{"type": "call:add:failed", "callId": id, "to": to, "reason": reason})
	}
	a.calls.mu.Lock()
	member, exists := call.members[user.ID]
	active := call.state == "active"
	size := len(call.members) + len(call.ringing)
	allGroup := true
	for _, m := range call.members {
		if !m.group {
			allGroup = false
			break
		}
	}
	a.calls.mu.Unlock()
	if !exists || member.conn != conn || !active {
		return
	}
	if friends, _ := a.store.AreFriends(user.ID, to); !friends {
		fail("not-contact")
		return
	}
	if !a.hub.IsOnline(to) {
		fail("offline")
		return
	}
	if a.calls.busy(to) {
		fail("busy")
		return
	}
	if size >= 10 {
		fail("full")
		return
	}
	if !allGroup {
		fail("old-version")
		return
	}
	target, err := a.store.UserByID(to)
	if err != nil {
		fail("offline")
		return
	}
	timer := time.AfterFunc(ringTimeout, func() { a.stopRinging(id, to, "missed") })
	if !a.calls.setRinging(id, to, timer) {
		timer.Stop()
		return
	}
	a.calls.mu.Lock()
	others := make([]map[string]any, 0, len(call.members))
	for memberID := range call.members {
		if memberUser, err := a.store.UserByID(memberID); err == nil {
			others = append(others, a.publicUser(memberUser))
		}
	}
	a.calls.mu.Unlock()
	a.hub.Send(to, map[string]any{"type": "call:incoming", "callId": id, "from": a.publicUser(user), "group": true, "others": others})
	a.callMembers(id, to, "ringing")
	_ = target
}

// stopRinging — человек не ответил или отказался, звонок остальным продолжается
func (a *server) stopRinging(id string, userID int64, state string) {
	call := a.calls.get(id)
	if call == nil {
		return
	}
	a.calls.mu.Lock()
	timer, ringing := call.ringing[userID]
	if ringing {
		timer.Stop()
		delete(call.ringing, userID)
	}
	a.calls.mu.Unlock()
	if !ringing {
		return
	}
	reason := "declined"
	if state == "missed" {
		reason = "timeout"
	}
	a.hub.Send(userID, map[string]any{"type": "call:ended", "callId": id, "reason": reason})
	a.callMembers(id, userID, state)
}