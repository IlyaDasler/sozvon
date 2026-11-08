package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/store"
)

// ---------- пользователи в ответах ----------

func (a *server) publicUser(user *store.User) map[string]any {
	body := map[string]any{
		"id":          user.ID,
		"username":    user.Username,
		"displayName": user.DisplayName,
		"avatarColor": user.AvatarColor,
		"avatarUrl":   nil,
		"bio":         user.Bio,
		"bannerColor": nil,
		"bannerUrl":   nil,
		"game":        nil,
		"nameColor":   nil,
		"memberSince": user.CreatedAt,
		"publicKey":   nil,
	}
	if user.Avatar != "" {
		body["avatarUrl"] = "/api/avatars/" + user.Avatar + ".webp"
	}
	if user.Banner != "" {
		body["bannerUrl"] = "/api/banners/" + user.Banner
	}
	if user.BannerColor != "" {
		body["bannerColor"] = user.BannerColor
	}
	if user.Game != "" && user.PrivacyGame {
		body["game"] = user.Game
	}
	if user.NameColor != "" {
		body["nameColor"] = user.NameColor
	}
	if user.PublicKey != "" {
		body["publicKey"] = user.PublicKey
	}
	return body
}

// presence — из WebSocket-хаба и сохранённого статуса (invisible показываем как offline)
func (a *server) presence(userID int64) (bool, string) {
	if !a.hub.IsOnline(userID) {
		return false, "offline"
	}
	user, err := a.store.UserByID(userID)
	if err != nil {
		return true, "online"
	}
	if user.Status == "invisible" {
		return false, "offline"
	}
	status := user.Status
	if status == "" {
		status = "online"
	}
	return true, status
}

func (a *server) userWithPresence(user *store.User) map[string]any {
	body := a.publicUser(user)
	online, status := a.presence(user.ID)
	body["online"] = online
	body["status"] = status
	return body
}

// ---------- контакты ----------

func (a *server) contacts(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	list, err := a.store.ContactsOf(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(list))
	for _, contact := range list {
		item := a.userWithPresence(contact.User)
		var theme any
		if contact.ChatTheme != "" {
			theme = contact.ChatTheme
		}
		item["chatTheme"] = theme
		var wallpaper any
		if contact.Wallpaper != "" {
			wallpaper = "/api/wallpapers/" + contact.Wallpaper
		}
		item["wallpaperUrl"] = wallpaper
		body = append(body, item)
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *server) addContact(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Username string `json:"username"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	login := strings.ToLower(strings.TrimSpace(request.Username))
	target, err := a.store.UserByUsername(login)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			fail(http.StatusNotFound, "Пользователь не найден").write(w)
			return
		}
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if target.ID == user.ID {
		fail(http.StatusBadRequest, "Это вы").write(w)
		return
	}
	if blocked, _ := a.store.AreBlocked(target.ID, user.ID); blocked {
		fail(http.StatusForbidden, "Пользователь ограничил переписку").write(w)
		return
	}
	alreadyFriends, _ := a.store.AreFriends(user.ID, target.ID)
	reverse, _ := a.store.FriendRequestFrom(target.ID, user.ID)
	friendship := "pending"
	switch {
	case alreadyFriends:
		friendship = "friends"
	case reverse:
		// встречная заявка — сразу дружим
		if err := a.store.AcceptFriendRequest(target.ID, user.ID); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		friendship = "friends"
		// Как в Node: обоим contact:added (себе — accepted)
		a.hub.Send(target.ID, map[string]any{"type": "contact:added", "user": a.userWithPresence(user)})
		a.hub.Send(user.ID, map[string]any{"type": "contact:added", "user": a.userWithPresence(target), "accepted": true})
	default:
		if !target.FriendRequests {
			fail(http.StatusForbidden, "Пользователь не принимает заявки в друзья").write(w)
			return
		}
		if err := a.store.SendFriendRequest(user.ID, target.ID); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		// Получателю — уведомление о заявке
		request := a.publicUser(user)
		request["requestedAt"] = time.Now().UnixMilli()
		a.hub.Send(target.ID, map[string]any{"type": "friend:request", "user": request})
	}
	body := a.publicUser(target)
	body["friendship"] = friendship
	if friendship == "friends" {
		body["online"], body["status"] = a.presence(target.ID)
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *server) removeContact(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	other, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный пользователь").write(w)
		return
	}
	if err := a.store.RemoveContact(user.ID, other); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Второй участник сразу видит, что дружбы больше нет
	a.hub.Send(other, map[string]any{"type": "contact:removed", "userId": user.ID})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) friendRequests(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	incoming, err := a.store.IncomingRequests(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	outgoing, err := a.store.OutgoingRequests(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	pack := func(rows []store.RequestRow) []map[string]any {
		body := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			item := a.publicUser(row.User)
			item["requestedAt"] = row.At
			body = append(body, item)
		}
		return body
	}
	writeJSON(w, http.StatusOK, map[string]any{"incoming": pack(incoming), "outgoing": pack(outgoing)})
}

func (a *server) acceptFriendRequest(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	from, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная заявка").write(w)
		return
	}
	exists, err := a.store.FriendRequestFrom(from, user.ID)
	if err != nil || !exists {
		fail(http.StatusNotFound, "Заявка не найдена").write(w)
		return
	}
	if err := a.store.AcceptFriendRequest(from, user.ID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	other, err := a.store.UserByID(from)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Оба видят нового друга, у заявки исчезает счётчик
	a.hub.Send(user.ID, map[string]any{"type": "contact:added", "user": a.userWithPresence(other), "accepted": true})
	a.hub.Send(other.ID, map[string]any{"type": "contact:added", "user": a.userWithPresence(user)})
	a.hub.Send(other.ID, map[string]any{"type": "friend:request:removed", "userId": user.ID})
	body := a.userWithPresence(other)
	body["friendship"] = "friends"
	writeJSON(w, http.StatusOK, body)
}

func (a *server) declineFriendRequest(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	from, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная заявка").write(w)
		return
	}
	if err := a.store.DeclineFriendRequest(from, user.ID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.hub.Send(from, map[string]any{"type": "friend:request:removed", "userId": user.ID})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) blocks(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	list, err := a.store.BlocksOf(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(list))
	for _, row := range list {
		item := a.publicUser(row.User)
		item["blockedAt"] = row.At
		body = append(body, item)
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *server) blockUser(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	other, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		var request struct {
			UserID int64 `json:"userId"`
		}
		if decodeErr := decode(r, &request); decodeErr != nil || request.UserID == 0 {
			fail(http.StatusBadRequest, "Неверный пользователь").write(w)
			return
		}
		other = request.UserID
	}
	if other == user.ID {
		fail(http.StatusBadRequest, "Неверный пользователь").write(w)
		return
	}
	if err := a.store.Block(user.ID, other); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	target, err := a.store.UserByID(other)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.hub.Send(other, map[string]any{"type": "contact:removed", "userId": user.ID})
	body := a.publicUser(target)
	body["blockedAt"] = time.Now().UnixMilli()
	writeJSON(w, http.StatusOK, body)
}

func (a *server) unblockUser(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	other, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный пользователь").write(w)
		return
	}
	if err := a.store.Unblock(user.ID, other); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- каналы ----------

func (a *server) roleJSON(role store.RoleRow) map[string]any {
	return map[string]any{"id": role.ID, "name": role.Name, "color": role.Color, "perms": role.Perms}
}

func (a *server) hubJSON(hub *store.HubRow) map[string]any {
	roles := make([]map[string]any, 0, len(hub.Roles))
	for _, role := range hub.Roles {
		roles = append(roles, a.roleJSON(role))
	}
	members := make([]map[string]any, 0, len(hub.Members))
	for _, member := range hub.Members {
		item := a.userWithPresence(member.User)
		item["manager"] = member.Manager
		item["roleId"] = member.RoleID
		item["nickname"] = member.Nickname
		item["joinedAt"] = member.JoinedAt
		members = append(members, item)
	}
	groups := make([]map[string]any, 0, len(hub.Groups))
	for _, group := range hub.Groups {
		groups = append(groups, map[string]any{"id": group.ID, "name": group.Name})
	}
	emojis := make([]map[string]any, 0, len(hub.Emojis))
	for _, emoji := range hub.Emojis {
		emojis = append(emojis, map[string]any{
			"id":        emoji.ID,
			"name":      emoji.Name,
			"createdBy": emoji.CreatedBy,
			"url":       "/api/avatars/" + emoji.File + ".webp",
		})
	}
	// В серверной логике invited — массив id, клиент строит Set и сравнивает с id друзей
	invited := make([]int64, 0, len(hub.Invited))
	for _, user := range hub.Invited {
		invited = append(invited, user.ID)
	}
	bans := make([]map[string]any, 0, len(hub.Bans))
	for _, user := range hub.Bans {
		bans = append(bans, a.publicUser(user))
	}
	var iconURL any
	if hub.Icon != "" {
		iconURL = "/api/hubs/" + itoa(hub.ID) + "/icon"
	}
	return map[string]any{
		"id":               hub.ID,
		"name":             hub.Name,
		"ownerId":          hub.OwnerID,
		"iconColor":        hub.IconColor,
		"iconUrl":          iconURL,
		"createdAt":        hub.CreatedAt,
		"defaultPerms":     hub.DefaultPerms,
		"reactionsVisible": hub.ReactionsVisible,
		"groups":           groups,
		"emojis":           emojis,
		"roles":            roles,
		"members":          members,
		"invited":          invited,
		"bans":             bans,
	}
}

func (a *server) hubs(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	list, err := a.store.HubsOf(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(list))
	for _, hub := range list {
		body = append(body, a.hubJSON(hub))
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *server) createHub(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Name      string `json:"name"`
		IconColor string `json:"iconColor"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	name := strings.TrimSpace(request.Name)
	if name == "" || len([]rune(name)) > 40 {
		fail(http.StatusBadRequest, "Название канала: от 1 до 40 символов").write(w)
		return
	}
	color := request.IconColor
	if color == "" {
		color = colors[time.Now().UnixNano()%int64(len(colors))]
	}
	hub, err := a.store.CreateHub(user.ID, name, color)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, a.hubJSON(hub))
}

func (a *server) patchHub(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	id, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный канал").write(w)
		return
	}
	hub, err := a.store.HubByID(id)
	if err != nil || hub.OwnerID != user.ID {
		fail(http.StatusNotFound, "Канал не найден").write(w)
		return
	}
	var request struct {
		Name             string  `json:"name"`
		IconColor        *string `json:"iconColor"`
		ReactionsVisible *bool   `json:"reactionsVisible"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if request.ReactionsVisible != nil {
		if err := a.store.SetHubReactionsVisible(id, *request.ReactionsVisible); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	}
	if request.IconColor != nil && *request.IconColor != "" {
		if err := a.store.SetHubIconColor(id, *request.IconColor); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	}
	if name := strings.TrimSpace(request.Name); name != "" {
		if err := a.store.RenameHub(id, name); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	}
	updated, err := a.store.HubByID(id)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Настройки канала видны всем его участникам сразу
	a.broadcastHub(id)
	writeJSON(w, http.StatusOK, a.hubJSON(updated))
}

func (a *server) hubInviteBody(invite store.HubInvite) map[string]any {
	return map[string]any{
		"hub":       map[string]any{"id": invite.HubID, "name": invite.HubName, "iconColor": invite.IconColor, "iconUrl": nil, "memberCount": invite.MemberCount},
		"from":      a.publicUser(invite.From),
		"createdAt": invite.CreatedAt,
	}
}
func (a *server) hubInvites(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	list, err := a.store.HubInvitesOf(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(list))
	for _, invite := range list {
		body = append(body, a.hubInviteBody(invite))
	}
	writeJSON(w, http.StatusOK, body)
}

// ---------- комнаты ----------

func (a *server) roomJSON(room *store.RoomRow) map[string]any {
	roles := make([]map[string]any, 0, len(room.Roles))
	// Роли канала общие для всех его комнат, как в Node
	if room.HubID != nil {
		if hub, err := a.store.HubByID(*room.HubID); err == nil {
			for _, role := range hub.Roles {
				roles = append(roles, a.roleJSON(role))
			}
		}
	} else {
		for _, role := range room.Roles {
			roles = append(roles, a.roleJSON(role))
		}
	}
	members := make([]map[string]any, 0, len(room.Members))
	for _, member := range room.Members {
		item := a.userWithPresence(member.User)
		item["roleId"] = member.RoleID
		item["nickname"] = member.Nickname
		item["timeoutUntil"] = member.TimeoutUntil
		members = append(members, item)
	}
	bans := make([]map[string]any, 0, len(room.Bans))
	if room.HubID != nil {
		// В канале бан общий для всех комнат
		if hub, err := a.store.HubByID(*room.HubID); err == nil {
			for _, user := range hub.Bans {
				bans = append(bans, a.publicUser(user))
			}
		}
	} else {
		for _, user := range room.Bans {
			bans = append(bans, a.publicUser(user))
		}
	}
	var backgroundURL any
	if room.Background != "" {
		backgroundURL = "/api/avatars/" + room.Background + ".webp"
	}
	voice := a.voice.participants(room.ID)
	voiceSince := a.voice.since(room.ID)
	return map[string]any{
		"id":            room.ID,
		"name":          room.Name,
		"kind":          room.Kind,
		"hubId":         room.HubID,
		"groupId":       room.GroupID,
		"private":       room.Private,
		"position":      room.Position,
		"ownerId":       room.OwnerID,
		"createdAt":     room.CreatedAt,
		"defaultPerms":  room.DefaultPerms,
		"backgroundUrl": backgroundURL,
		"roles":         roles,
		"members":       members,
		"bans":          bans,
		"events":        a.eventsJSON(room.ID),
		"voice":         voice,
		"voiceSince":    voiceSince,
		"lastActivity":  a.store.RoomLastActivity(room.ID),
		"now":           time.Now().UnixMilli(),
	}
}

func (a *server) rooms(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	list, err := a.store.RoomsOf(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(list))
	for _, room := range list {
		body = append(body, a.roomJSON(room))
	}
	writeJSON(w, http.StatusOK, body)
}

// notifyRoom — свежая комната всем её участникам (как notifyRoom в Node)
func (a *server) notifyRoom(roomID int64) {
	room, err := a.store.RoomByID(roomID)
	if err != nil {
		return
	}
	body := a.roomJSON(room)
	// Слушатели комнаты — её участники: в канале это все, кого позвали, а в старой комнате — только приглашённые
	ids := make([]int64, 0, len(room.Members))
	for _, member := range room.Members {
		ids = append(ids, member.User.ID)
	}
	for _, id := range ids {
		a.hub.Send(id, map[string]any{"type": "room:updated", "room": body})
	}
}
func (a *server) createRoom(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		HubID     int64   `json:"hubId"`
		GroupID   *int64  `json:"groupId"`
		Name      string  `json:"name"`
		Kind      string  `json:"kind"`
		Private   bool    `json:"private"`
		MemberIDs []int64 `json:"memberIds"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if request.Kind != "voice" && request.Kind != "text" {
		fail(http.StatusBadRequest, "Комната бывает голосовой или текстовой").write(w)
		return
	}
	name := strings.TrimSpace(request.Name)
	if name == "" || len([]rune(name)) > 40 {
		fail(http.StatusBadRequest, "Название комнаты: от 1 до 40 символов").write(w)
		return
	}
	// Старые версии не знают о каналах: их комната попадает в первый канал создателя,
	// а участники — только создатель и позванные друзья.
	if request.HubID == 0 {
		hubID := int64(0)
		if hubs, err := a.store.HubsOf(user.ID); err == nil {
			for _, hub := range hubs {
				if hub.OwnerID == user.ID {
					hubID = hub.ID
					break
				}
			}
		}
		if hubID == 0 {
			hubName := "Канал " + user.DisplayName
			if runes := []rune(hubName); len(runes) > 40 {
				hubName = string(runes[:40])
			}
			hub, err := a.store.CreateHub(user.ID, hubName, user.AvatarColor)
			if err != nil {
				fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
				return
			}
			hubID = hub.ID
		}
		for _, memberID := range request.MemberIDs {
			if memberID == user.ID {
				continue
			}
			if friends, err := a.store.AreFriends(user.ID, memberID); err != nil || !friends {
				fail(http.StatusBadRequest, "Добавлять в комнату можно только своих друзей").write(w)
				return
			}
		}
		room, err := a.store.CreateLegacyRoom(hubID, user.ID, name, request.Kind, request.Private)
		if err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		for _, memberID := range request.MemberIDs {
			if memberID != user.ID {
				_ = a.store.AddRoomMember(room.ID, memberID)
			}
		}
		a.broadcastHub(hubID)
		a.notifyRoom(room.ID)
		writeJSON(w, http.StatusOK, a.roomJSON(room))
		return
	}
	member, err := a.store.IsHubMember(request.HubID, user.ID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Канал не найден").write(w)
		return
	}
	room, err := a.store.CreateRoom(request.HubID, user.ID, name, request.Kind, request.Private)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if request.GroupID != nil {
		_ = a.store.SetRoomGroup(room.ID, request.GroupID)
	}
	for _, memberID := range request.MemberIDs {
		if memberID != user.ID {
			_ = a.store.AddRoomMember(room.ID, memberID)
		}
	}
	a.notifyRoom(room.ID)
	writeJSON(w, http.StatusOK, a.roomJSON(room))
}

func (a *server) deleteHub(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный канал").write(w)
		return
	}
	hub, err := a.store.HubByID(hubID)
	if err != nil {
		fail(http.StatusNotFound, "Канал не найден").write(w)
		return
	}
	if hub.OwnerID != user.ID {
		fail(http.StatusForbidden, "Удалить канал может только создатель").write(w)
		return
	}
	rooms, _ := a.store.RoomsOfHub(hubID)
	members := make([]int64, 0, len(hub.Members))
	for _, member := range hub.Members {
		members = append(members, member.User.ID)
	}
	if err := a.store.DeleteHub(hubID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	for _, room := range rooms {
		if room.Kind == "voice" {
			_ = a.livekit.DeleteRoom(room.ID)
		}
	}
	for _, id := range members {
		a.hub.Send(id, map[string]any{"type": "hub:removed", "hubId": hubID, "reason": "deleted"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
func (a *server) patchRoom(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	id, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	room, err := a.store.RoomByID(id)
	if err != nil {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	// Менять комнату может только её владелец или менеджер канала,
	// а не любой участник канала.
	if !a.roomManager(room, user.ID) {
		fail(http.StatusForbidden, "Нет прав на изменение комнаты").write(w)
		return
	}
	var request struct {
		Name         string          `json:"name"`
		DefaultPerms *int64          `json:"defaultPerms"`
		GroupID      json.RawMessage `json:"groupId"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if len(request.GroupID) > 0 {
		var groupID *int64
		if string(request.GroupID) != "null" {
			var value int64
			if err := json.Unmarshal(request.GroupID, &value); err == nil {
				groupID = &value
			}
		}
		oldGroup := room.GroupID
		if err := a.store.SetRoomGroup(id, groupID); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		if room.HubID != nil && oldGroup != nil && (groupID == nil || *groupID != *oldGroup) {
			_ = a.store.DeleteRoomGroupIfEmpty(*room.HubID, *oldGroup)
		}
		if room.HubID != nil {
			a.broadcastHub(*room.HubID)
		}
	}
	if request.DefaultPerms != nil {
		if err := a.store.UpdateRoomDefaultPerms(id, *request.DefaultPerms); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		// Право говорить пропало — выключаем микрофон всем без него
		if *request.DefaultPerms&2 == 0 {
			a.voice.muteAll(id)
			a.broadcastVoice(id)
		}
	}
	if name := strings.TrimSpace(request.Name); name != "" {
		if err := a.store.UpdateRoomName(id, name); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	}
	updated, err := a.store.RoomByID(id)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.notifyRoom(updated.ID)
	writeJSON(w, http.StatusOK, a.roomJSON(updated))
}

func parseInt64(value string) (int64, error) {
	var id int64
	if value == "" {
		return 0, errors.New("пусто")
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return 0, errors.New("не число")
		}
		id = id*10 + int64(r-'0')
	}
	return id, nil
}

func itoa(value int64) string {
	if value == 0 {
		return "0"
	}
	digits := ""
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	return digits
}
func (a *server) setMyStatus(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Status string `json:"status"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	switch request.Status {
	case "online", "idle", "dnd", "invisible":
	default:
		fail(http.StatusBadRequest, "Неизвестный статус").write(w)
		return
	}
	if err := a.store.UpdateUserStatus(user.ID, request.Status); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Как в Node: текущее устройство сразу узнаёт, что статус применился
	a.hub.Send(user.ID, map[string]any{"type": "me:status", "status": request.Status})
	a.broadcastPresence(user.ID)
	fresh, _ := a.store.UserByID(user.ID)
	self, err := a.self(fresh)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, self)
}

// setMyGame — запущенная игра из детекта процессов клиента (или null, когда игра закрыта).
func (a *server) setMyGame(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Game *string `json:"game"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	var game *string
	if request.Game != nil {
		name := strings.TrimSpace(*request.Game)
		if runes := []rune(name); len(runes) > 60 {
			name = string(runes[:60])
		}
		if name != "" {
			game = &name
		}
	}
	if err := a.store.SetGame(user.ID, game); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	fresh, err := a.store.UserByID(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Как notifyProfile в Node: профиль уходит друзьям, соседям по каналам и себе
	event := map[string]any{"type": "user:updated", "user": a.publicUser(fresh)}
	if ids, err := a.store.RelatedUserIDs(fresh.ID); err == nil {
		for _, id := range ids {
			a.hub.Send(id, event)
		}
	}
	a.hub.Send(fresh.ID, event)
	a.broadcastPresence(fresh.ID)
	self, err := a.self(fresh)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, self)
}

func (a *server) setMyKey(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		PublicKey string `json:"publicKey"`
	}
	if err := decode(r, &request); err != nil || len(request.PublicKey) < 16 || len(request.PublicKey) > 4096 {
		fail(http.StatusBadRequest, "Неверный ключ").write(w)
		return
	}
	if err := a.store.SetPublicKey(user.ID, request.PublicKey); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	fresh, _ := a.store.UserByID(user.ID)
	// Друзья должны узнать ключ, иначе не смогут запечатать для нас сообщение
	event := map[string]any{"type": "user:updated", "user": a.publicUser(fresh)}
	if ids, err := a.store.RelatedUserIDs(fresh.ID); err == nil {
		for _, id := range ids {
			a.hub.Send(id, event)
		}
	}
	a.hub.Send(fresh.ID, event)
	self, err := a.self(fresh)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, self)
}
func (a *server) contactTheme(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	peerID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный собеседник").write(w)
		return
	}
	if _, ok := a.dmPeer(peerID, user.ID); !ok {
		fail(http.StatusNotFound, "Этого человека нет в друзьях").write(w)
		return
	}
	var request struct {
		Theme *string `json:"theme"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if request.Theme != nil {
		theme := strings.TrimSpace(*request.Theme)
		if len(theme) > 24 {
			fail(http.StatusBadRequest, "Неизвестная тема").write(w)
			return
		}
		request.Theme = &theme
	}
	if err := a.store.SetChatTheme(user.ID, peerID, request.Theme); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	var value any
	if request.Theme != nil && *request.Theme != "" {
		value = *request.Theme
	}
	a.hub.Send(peerID, map[string]any{"type": "chat:theme", "userId": user.ID, "theme": value, "by": user.ID})
	a.hub.Send(user.ID, map[string]any{"type": "chat:theme", "userId": peerID, "theme": value, "by": user.ID})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "theme": value})
}

// updatePrivacy — настройки конфиденциальности: часть проверяет сервер, часть — клиент.
func (a *server) updatePrivacy(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Typing         *bool   `json:"typing"`
		ReadReceipts   *bool   `json:"readReceipts"`
		GameActivity   *bool   `json:"gameActivity"`
		FriendRequests *bool   `json:"friendRequests"`
		InvitePolicy   *string `json:"invitePolicy"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	typing := user.PrivacyTyping
	read := user.PrivacyRead
	game := user.PrivacyGame
	requests := user.FriendRequests
	invite := user.InvitePolicy
	if request.Typing != nil {
		typing = *request.Typing
	}
	if request.ReadReceipts != nil {
		read = *request.ReadReceipts
	}
	if request.GameActivity != nil {
		game = *request.GameActivity
	}
	if request.FriendRequests != nil {
		requests = *request.FriendRequests
	}
	if request.InvitePolicy != nil {
		if *request.InvitePolicy != "all" && *request.InvitePolicy != "friends" {
			fail(http.StatusBadRequest, "Неверный вариант приглашений").write(w)
			return
		}
		invite = *request.InvitePolicy
	}
	if err := a.store.SetPrivacy(user.ID, typing, read, game, requests, invite); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.respondSelf(w, user.ID)
}
