package main

import (
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
	if user.Game != "" {
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

// presence пока без WebSocket: как у Node до подключения — offline/false
func (a *server) presence(userID int64) (bool, string) {
	return false, "offline"
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
	default:
		if err := a.store.SendFriendRequest(user.ID, target.ID); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
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
	if err != nil || other == user.ID {
		fail(http.StatusBadRequest, "Неверный пользователь").write(w)
		return
	}
	if err := a.store.Block(user.ID, other); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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
		emojis = append(emojis, map[string]any{"id": emoji.ID, "name": emoji.Name, "file": emoji.File})
	}
	invited := make([]map[string]any, 0, len(hub.Invited))
	for _, user := range hub.Invited {
		invited = append(invited, a.publicUser(user))
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
		Name string `json:"name"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
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
	writeJSON(w, http.StatusOK, a.hubJSON(updated))
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
		body = append(body, map[string]any{
			"hub":       map[string]any{"id": invite.HubID, "name": invite.HubName, "iconColor": invite.IconColor, "iconUrl": nil, "memberCount": invite.MemberCount},
			"from":      a.publicUser(invite.From),
			"createdAt": invite.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, body)
}

// ---------- комнаты ----------

func (a *server) roomJSON(room *store.RoomRow) map[string]any {
	roles := make([]map[string]any, 0, len(room.Roles))
	for _, role := range room.Roles {
		roles = append(roles, a.roleJSON(role))
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
	for _, user := range room.Bans {
		bans = append(bans, a.publicUser(user))
	}
	var backgroundURL any
	if room.Background != "" {
		backgroundURL = "/api/room-backgrounds/" + room.Background
	}
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
		"events":        []any{},
		"voice":         []any{},
		"voiceSince":    nil,
		"lastActivity":  0,
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

func (a *server) createRoom(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		HubID   int64  `json:"hubId"`
		Name    string `json:"name"`
		Kind    string `json:"kind"`
		Private bool   `json:"private"`
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
	if request.HubID == 0 {
		fail(http.StatusBadRequest, "Не указан канал").write(w)
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
	writeJSON(w, http.StatusOK, a.roomJSON(room))
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
	if room.HubID != nil {
		member, _ := a.store.IsHubMember(*room.HubID, user.ID)
		if !member && room.OwnerID != user.ID {
			fail(http.StatusNotFound, "Комната не найдена").write(w)
			return
		}
	}
	var request struct {
		Name string `json:"name"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
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
