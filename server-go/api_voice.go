package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"net/http"
	"sync"
	"time"

	"sozvon/server/internal/livekit"
	"sozvon/server/internal/realtime"
	"sozvon/server/internal/store"
)

// Голосовые комнаты: кто в голосе, микрофон/камера/экран, пересылка WebRTC-сигналов.
// Как идёт звук — p2p (каждый с каждым) или через LiveKit — решается при входе.

type voiceParticipant struct {
	conn     *realtime.Conn
	muted    bool
	deafened bool
	video    bool
	screen   bool
	preview  string
	joinedAt int64
	timer    *time.Timer
}

type voiceRoom struct {
	media     string
	startedAt int64
	parts     map[int64]*voiceParticipant
}

type voiceManager struct {
	mu    sync.Mutex
	rooms map[int64]*voiceRoom
}

func newVoiceManager() *voiceManager {
	return &voiceManager{rooms: map[int64]*voiceRoom{}}
}

func (v *voiceManager) room(roomID int64) *voiceRoom {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.rooms[roomID]
}

func (v *voiceManager) participant(roomID, userID int64) *voiceParticipant {
	v.mu.Lock()
	defer v.mu.Unlock()
	room := v.rooms[roomID]
	if room == nil {
		return nil
	}
	return room.parts[userID]
}

func (v *voiceManager) roomOf(userID int64) int64 {
	v.mu.Lock()
	defer v.mu.Unlock()
	for roomID, room := range v.rooms {
		if _, exists := room.parts[userID]; exists {
			return roomID
		}
	}
	return 0
}

func (v *voiceManager) mediaOf(roomID int64) string {
	v.mu.Lock()
	defer v.mu.Unlock()
	if room := v.rooms[roomID]; room != nil {
		return room.media
	}
	return ""
}

func (v *voiceManager) since(roomID int64) any {
	v.mu.Lock()
	defer v.mu.Unlock()
	if room := v.rooms[roomID]; room != nil {
		return room.startedAt
	}
	return nil
}

// join возвращает список тех, кто уже был в комнате (без новичка)
func (v *voiceManager) join(roomID, userID int64, conn *realtime.Conn, media string, muted, deafened bool) []int64 {
	v.mu.Lock()
	defer v.mu.Unlock()
	room, exists := v.rooms[roomID]
	if !exists {
		room = &voiceRoom{media: media, startedAt: time.Now().UnixMilli(), parts: map[int64]*voiceParticipant{}}
		v.rooms[roomID] = room
	}
	peers := make([]int64, 0, len(room.parts))
	for id := range room.parts {
		if id != userID {
			peers = append(peers, id)
		}
	}
	room.parts[userID] = &voiceParticipant{conn: conn, muted: muted, deafened: deafened, joinedAt: time.Now().UnixMilli()}
	return peers
}

func (v *voiceManager) leave(roomID, userID int64) (conn *realtime.Conn, media string, removed bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	room := v.rooms[roomID]
	if room == nil {
		return nil, "", false
	}
	part, exists := room.parts[userID]
	if !exists {
		return nil, "", false
	}
	if part.timer != nil {
		part.timer.Stop()
	}
	delete(room.parts, userID)
	media = room.media
	conn = part.conn
	if len(room.parts) == 0 {
		delete(v.rooms, roomID)
	}
	return conn, media, true
}

func (v *voiceManager) pause(userID int64, conn *realtime.Conn, wait time.Duration, onGone func(roomID int64)) {
	v.mu.Lock()
	for roomID, room := range v.rooms {
		part, exists := room.parts[userID]
		if !exists || part.conn == nil || part.conn != conn || part.timer != nil {
			continue
		}
		part.conn = nil
		part.timer = time.AfterFunc(wait, func() {
			if _, _, removed := v.leave(roomID, userID); removed {
				onGone(roomID)
			}
		})
	}
	v.mu.Unlock()
}

func (v *voiceManager) resume(roomID, userID int64, conn *realtime.Conn) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	room := v.rooms[roomID]
	if room == nil {
		return false
	}
	part, exists := room.parts[userID]
	if !exists {
		return false
	}
	if part.timer != nil {
		part.timer.Stop()
		part.timer = nil
	}
	if part.conn != nil && part.conn != conn {
		return false
	}
	part.conn = conn
	return true
}

func (v *voiceManager) updateState(roomID, userID int64, conn *realtime.Conn, message map[string]any) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	room := v.rooms[roomID]
	part := room.parts[userID]
	if part == nil || part.conn != conn {
		return false
	}
	for _, key := range []string{"muted", "deafened", "video", "screen"} {
		if value, exists := message[key]; exists {
			flag, _ := value.(bool)
			switch key {
			case "muted":
				part.muted = flag
			case "deafened":
				part.deafened = flag
			case "video":
				part.video = flag
			case "screen":
				part.screen = flag
			}
		}
	}
	if !part.screen {
		part.preview = ""
	}
	return true
}

func (v *voiceManager) muteAll(roomID int64) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if room := v.rooms[roomID]; room != nil {
		for _, part := range room.parts {
			part.muted = true
		}
	}
}

func (v *voiceManager) participants(roomID int64) []map[string]any {
	v.mu.Lock()
	defer v.mu.Unlock()
	room := v.rooms[roomID]
	if room == nil {
		return []map[string]any{}
	}
	list := make([]map[string]any, 0, len(room.parts))
	for userID, part := range room.parts {
		list = append(list, map[string]any{
			"userId":   userID,
			"muted":    part.muted,
			"deafened": part.deafened,
			"video":    part.video,
			"screen":   part.screen,
			"joinedAt": part.joinedAt,
		})
	}
	return list
}

// ---------- обработчики ----------

func (a *server) broadcastVoice(roomID int64) {
	media := a.voice.mediaOf(roomID)
	event := map[string]any{
		"type":         "room:voice",
		"roomId":       roomID,
		"since":        a.voice.since(roomID),
		"participants": a.voice.participants(roomID),
		"media":        media,
		"now":          time.Now().UnixMilli(),
	}
	ids, err := a.store.RoomMemberIDs(roomID)
	if err != nil {
		return
	}
	for _, id := range ids {
		a.hub.Send(id, event)
	}
}

func (a *server) roomJoin(conn *realtime.Conn, user *store.User, message map[string]any) {
	roomID, ok := number(message["roomId"])
	if !ok || roomID == 0 {
		return
	}
	room, err := a.store.RoomByID(roomID)
	fail := func(reason string) {
		conn.Send(map[string]any{"type": "room:error", "roomId": roomID, "reason": reason})
	}
	if err != nil || room.Kind != "voice" {
		fail("not-member")
		return
	}
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		fail("not-member")
		return
	}
	if a.calls.busy(user.ID) {
		fail("in-call")
		return
	}
	perms, _ := a.store.RoomPerms(roomID, user.ID)
	if perms&1 == 0 {
		fail("no-access")
		return
	}
	if current := a.voice.roomOf(user.ID); current != 0 {
		// Это же место со старого устройства: запоминаем его, чтобы честно сказать
		// «вы подключились с другого устройства», а не оставлять призрак в комнате.
		old := a.voice.participant(current, user.ID)
		a.voice.leave(current, user.ID)
		if old != nil && old.conn != nil && old.conn != conn {
			old.conn.Send(map[string]any{"type": "room:left", "roomId": current, "reason": "moved"})
		}
		a.broadcastVoice(current)
	}
	memberCount := len(a.voice.participants(roomID)) + 1
	// Как в Node: медиасервер выбирается по числу участников комнаты, а не сидящих в голосе
	roomCount := memberCount
	if ids, err := a.store.RoomMemberIDs(roomID); err == nil {
		roomCount = len(ids)
	}
	media := a.voice.mediaOf(roomID)
	if media == "" {
		media = a.livekit.MediaFor(roomCount)
	}
	sfuRequested, _ := message["sfu"].(bool)
	if media == "sfu" && !sfuRequested {
		fail("old-version")
		return
	}
	if media == "p2p" && memberCount > 10 {
		fail("full")
		return
	}
	muted, _ := message["muted"].(bool)
	if perms&2 == 0 {
		muted = true
	}
	deafened, _ := message["deafened"].(bool)
	peers := a.voice.join(roomID, user.ID, conn, media, muted, deafened)

	var grant map[string]any
	if media == "sfu" {
		grant = a.livekit.JoinGrant(roomID, user.ID, user.DisplayName, true, true)
	}
	joined := map[string]any{"type": "room:joined", "roomId": roomID, "peers": peers, "media": media}
	if grant != nil {
		joined["livekit"] = grant
	}
	conn.Send(joined)
	a.broadcastVoice(roomID)
}

func (a *server) roomLeave(conn *realtime.Conn, user *store.User, message map[string]any) {
	roomID, ok := number(message["roomId"])
	if !ok {
		return
	}
	part := a.voice.participant(roomID, user.ID)
	if part == nil || part.conn != conn {
		return
	}
	if _, media, removed := a.voice.leave(roomID, user.ID); removed {
		if media == "sfu" && len(a.voice.participants(roomID)) == 0 {
			_ = a.livekit.DeleteRoom(roomID)
		}
		a.broadcastVoice(roomID)
	}
}

func (a *server) roomResume(conn *realtime.Conn, user *store.User, message map[string]any) {
	roomID, ok := number(message["roomId"])
	if !ok {
		return
	}
	if a.voice.resume(roomID, user.ID, conn) {
		conn.Send(map[string]any{"type": "room:resumed", "roomId": roomID})
		a.broadcastVoice(roomID)
		return
	}
	conn.Send(map[string]any{"type": "room:resume:failed", "roomId": roomID})
}

func (a *server) roomState(conn *realtime.Conn, user *store.User, message map[string]any) {
	roomID, ok := number(message["roomId"])
	if !ok {
		return
	}
	if a.voice.updateState(roomID, user.ID, conn, message) {
		a.broadcastVoice(roomID)
	}
}

func (a *server) roomSignal(conn *realtime.Conn, user *store.User, message map[string]any) {
	roomID, ok := number(message["roomId"])
	if !ok {
		return
	}
	to, ok := number(message["to"])
	if !ok {
		return
	}
	self := a.voice.participant(roomID, user.ID)
	if self == nil || self.conn != conn {
		return
	}
	target := a.voice.participant(roomID, to)
	if target == nil || target.conn == nil {
		return
	}
	target.conn.Send(map[string]any{"type": "room:signal", "roomId": roomID, "from": user.ID, "data": message["data"]})
}

func (a *server) roomPreview(conn *realtime.Conn, user *store.User, message map[string]any) {
	roomID, ok := number(message["roomId"])
	if !ok {
		return
	}
	part := a.voice.participant(roomID, user.ID)
	if part == nil || part.conn != conn || !part.screen {
		return
	}
	image, _ := message["image"].(string)
	if image == "" || len(image) > 40_000 || !hasPrefix(image, "data:image/jpeg;base64,") {
		return
	}
	a.voice.mu.Lock()
	part.preview = image
	a.voice.mu.Unlock()
	a.broadcastVoice(roomID)
}

func (a *server) roomPreviewGet(conn *realtime.Conn, user *store.User, message map[string]any) {
	roomID, ok := number(message["roomId"])
	if !ok {
		return
	}
	userID, ok := number(message["userId"])
	if !ok {
		return
	}
	member, _ := a.store.IsRoomMember(roomID, user.ID)
	if !member {
		return
	}
	part := a.voice.participant(roomID, userID)
	image := any(nil)
	if part != nil && part.screen && part.preview != "" {
		image = part.preview
	}
	conn.Send(map[string]any{"type": "room:preview", "roomId": roomID, "userId": userID, "image": image})
}

// voicePause — обрыв связи: держим место в комнате, пока идёт окно ожидания
func (a *server) voicePause(conn *realtime.Conn, user *store.User) {
	a.voice.pause(user.ID, conn, a.cfg.ReconnectWait, func(roomID int64) {
		a.broadcastVoice(roomID)
	})
}

// ---------- ICE ----------

func (a *server) ice(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	servers := make([]map[string]any, 0, 2)
	if len(a.cfg.StunURLs) > 0 {
		servers = append(servers, map[string]any{"urls": a.cfg.StunURLs})
	}
	if len(a.cfg.TurnURLs) > 0 && a.cfg.TurnSecret != "" {
		expires := time.Now().Unix() + 24*3600
		username := itoa(expires) + ":" + itoa(user.ID)
		mac := hmac.New(sha1.New, []byte(a.cfg.TurnSecret))
		mac.Write([]byte(username))
		credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))
		servers = append(servers, map[string]any{
			"urls":       a.cfg.TurnURLs,
			"username":   username,
			"credential": credential,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"iceServers": servers})
}

func hasPrefix(value, prefix string) bool {
	return len(value) >= len(prefix) && value[:len(prefix)] == prefix
}

var _ = livekit.Options{}

func (v *voiceManager) setMuted(roomID, userID int64, muted bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if room := v.rooms[roomID]; room != nil {
		if part := room.parts[userID]; part != nil {
			part.muted = muted
		}
	}
}
