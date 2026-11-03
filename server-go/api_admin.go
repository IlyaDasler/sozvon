package main

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/store"
)

// Управление каналом и комнатой: приглашения, участники, роли, баны.
// Проверка прав простая: владелец или менеджер канала.

func (a *server) hubManager(hubID, userID int64) bool {
	ok, err := a.store.HubIsManager(hubID, userID)
	return err == nil && ok
}

func (a *server) roomManager(room *store.RoomRow, userID int64) bool {
	if room.OwnerID == userID {
		return true
	}
	if room.HubID != nil {
		return a.hubManager(*room.HubID, userID)
	}
	return false
}

func (a *server) hubOr404(w http.ResponseWriter, hubID int64) *store.HubRow {
	hub, err := a.store.HubByID(hubID)
	if err != nil {
		fail(http.StatusNotFound, "Канал не найден").write(w)
		return nil
	}
	return hub
}

func (a *server) roomOr404(w http.ResponseWriter, roomID int64) *store.RoomRow {
	room, err := a.store.RoomByID(roomID)
	if err != nil {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return nil
	}
	return room
}

// ---------- приглашения в канал ----------

// broadcastHub — полный объект канала всем участникам (как notifyHub в Node)
// broadcastHubRooms — свежие комнаты канала всем участникам (как notifyRoom в Node)
func (a *server) broadcastHubRooms(hubID int64) {
	hub, err := a.store.HubByID(hubID)
	if err != nil {
		return
	}
	rooms, err := a.store.RoomsOfHub(hubID)
	if err != nil {
		return
	}
	for _, room := range rooms {
		body := a.roomJSON(room)
		for _, member := range hub.Members {
			a.hub.Send(member.User.ID, map[string]any{"type": "room:updated", "room": body})
		}
	}
}
func (a *server) broadcastHub(hubID int64) {
	hub, err := a.store.HubByID(hubID)
	if err != nil {
		return
	}
	body := a.hubJSON(hub)
	for _, member := range hub.Members {
		a.hub.Send(member.User.ID, map[string]any{"type": "hub:updated", "hub": body})
	}
}
func (a *server) hubInvite(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный канал").write(w)
		return
	}
	if !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	var request struct {
		UserIDs []int64 `json:"userIds"`
	}
	if err := decode(r, &request); err != nil || len(request.UserIDs) == 0 {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if err := a.store.InviteToHub(hubID, user.ID, request.UserIDs); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Приглашённым — событие, чтобы приложение обновило список
	for _, invited := range request.UserIDs {
		if list, err := a.store.HubInvitesOf(invited); err == nil {
			for _, inv := range list {
				if inv.HubID == hubID {
					a.hub.Send(invited, map[string]any{"type": "hub:invite", "invite": a.hubInviteBody(inv)})
					break
				}
			}
		}
	}
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

func (a *server) acceptHubInvite(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверное приглашение").write(w)
		return
	}
	if err := a.store.AcceptHubInvite(hubID, user.ID); err != nil {
		fail(http.StatusNotFound, "Приглашение не найдено").write(w)
		return
	}
	hub := a.hubOr404(w, hubID)
	if hub == nil {
		return
	}
			a.broadcastHubRooms(hubID)
		a.broadcastHub(hubID)
		_ = hub
	writeJSON(w, http.StatusOK, a.hubJSON(hub))
}

func (a *server) declineHubInvite(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверное приглашение").write(w)
		return
	}
	if err := a.store.DeclineHubInvite(hubID, user.ID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- участники канала ----------

func (a *server) hubMember(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный канал").write(w)
		return
	}
	memberID, err := parseInt64(chi.URLParam(r, "userId"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный участник").write(w)
		return
	}
	if memberID != user.ID && !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	if err := a.store.RemoveHubMember(hubID, memberID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.hub.Send(memberID, map[string]any{"type": "hub:removed", "hubId": hubID})
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

func (a *server) hubMemberManager(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil || !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	memberID, _ := parseInt64(chi.URLParam(r, "userId"))
	var request struct {
		Manager bool `json:"manager"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if err := a.store.SetHubManager(hubID, memberID, request.Manager); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

func (a *server) hubMemberNickname(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный канал").write(w)
		return
	}
	memberID, _ := parseInt64(chi.URLParam(r, "userId"))
	if memberID != user.ID && !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	name := ""
	if r.Method == http.MethodPut {
		var request struct {
			Name string `json:"name"`
		}
		if err := decode(r, &request); err != nil {
			fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
			return
		}
		name = request.Name
	}
	if err := a.store.SetHubNickname(hubID, memberID, name); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

func (a *server) hubMemberRole(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil || !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	memberID, _ := parseInt64(chi.URLParam(r, "userId"))
	var request struct {
		RoleID int64 `json:"roleId"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if err := a.store.AssignHubRole(hubID, memberID, request.RoleID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

func (a *server) hubBan(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверный канал").write(w)
		return
	}
	if !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	if r.Method == http.MethodDelete {
		memberID, err := parseInt64(chi.URLParam(r, "userId"))
		if err != nil {
			fail(http.StatusBadRequest, "Неверный пользователь").write(w)
			return
		}
		if err := a.store.UnbanFromHub(hubID, memberID); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		if hub := a.hubOr404(w, hubID); hub != nil {
			writeJSON(w, http.StatusOK, a.hubJSON(hub))
		}
		return
	}
	var request struct {
		UserID int64 `json:"userId"`
	}
	if err := decode(r, &request); err != nil || request.UserID == 0 {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if err := a.store.BanFromHub(hubID, request.UserID, user.ID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.hub.Send(request.UserID, map[string]any{"type": "hub:removed", "hubId": hubID})
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

func (a *server) hubRole(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil || !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	if r.Method == http.MethodPost {
		var request struct {
			Name  string `json:"name"`
			Color string `json:"color"`
			Perms int64  `json:"perms"`
		}
		if err := decode(r, &request); err != nil {
			fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
			return
		}
		if _, err := a.store.CreateHubRole(hubID, request.Name, request.Color, request.Perms); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	} else {
		roleID, err := parseInt64(chi.URLParam(r, "roleId"))
		if err != nil {
			fail(http.StatusBadRequest, "Неверная роль").write(w)
			return
		}
		if r.Method == http.MethodDelete {
			if err := a.store.DeleteHubRole(hubID, roleID); err != nil {
				fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
				return
			}
		} else {
			var request struct {
				Name  *string `json:"name"`
				Color *string `json:"color"`
				Perms *int64  `json:"perms"`
			}
			if err := decode(r, &request); err != nil {
				fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
				return
			}
			if err := a.store.UpdateHubRole(hubID, roleID, request.Name, request.Color, request.Perms); err != nil {
				fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
				return
			}
		}
	}
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

// ---------- комнаты ----------

func (a *server) roomDelete(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	room := a.roomOr404(w, roomID)
	if room == nil {
		return
	}
	if !a.roomManager(room, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	if room.HubID != nil && room.Kind == "voice" {
		_ = a.livekit.DeleteRoom(roomID)
	}
	if err := a.store.DeleteRoom(roomID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if room.HubID != nil {
		if ids, err := a.store.RoomMemberIDs(*room.HubID); err == nil {
			for _, id := range ids {
				a.hub.Send(id, map[string]any{"type": "room:removed", "roomId": roomID})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) roomAdminAction(w http.ResponseWriter, r *http.Request, action string) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	room := a.roomOr404(w, roomID)
	if room == nil {
		return
	}
	if !a.roomManager(room, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	switch action {
	case "bans":
		if r.Method == http.MethodDelete {
			userID, _ := parseInt64(chi.URLParam(r, "userId"))
			if room.HubID != nil {
				_ = a.store.UnbanFromHub(*room.HubID, userID)
			} else {
				_ = a.store.UnbanFromRoom(roomID, userID)
			}
		} else {
			var request struct {
				UserID int64 `json:"userId"`
			}
			if err := decode(r, &request); err != nil || request.UserID == 0 {
				fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
				return
			}
			if room.HubID != nil {
				// В канале бан общий: убираем из канала и всех его комнат
				_ = a.store.BanFromHub(*room.HubID, request.UserID, user.ID)
				a.hub.Send(request.UserID, map[string]any{"type": "hub:removed", "hubId": *room.HubID, "reason": "banned"})
				a.broadcastHub(*room.HubID)
			} else {
				_ = a.store.BanFromRoom(roomID, request.UserID, user.ID)
			}
			if part := a.voice.participant(roomID, request.UserID); part != nil && part.conn != nil {
				part.conn.Send(map[string]any{"type": "room:left", "roomId": roomID, "reason": "banned"})
			}
			a.voice.leave(roomID, request.UserID)
			a.broadcastVoice(roomID)
		}
	case "members":
		userID, _ := parseInt64(chi.URLParam(r, "userId"))
		_ = a.store.RemoveRoomMember(roomID, userID)
	case "role":
		userID, _ := parseInt64(chi.URLParam(r, "userId"))
		var request struct {
			RoleID int64 `json:"roleId"`
		}
		if err := decode(r, &request); err != nil {
			fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
			return
		}
		if room.HubID != nil {
			_ = a.store.AssignHubRole(*room.HubID, userID, request.RoleID)
			if role, err := a.store.HubRoleByID(*room.HubID, request.RoleID); err == nil && role.Perms&2 != 0 {
				a.voice.setMuted(roomID, userID, false)
			}
		} else {
			_ = a.store.EnsureRoomMember(roomID, userID)
			_ = a.store.AssignRoomRole(roomID, userID, request.RoleID)
			if role, err := a.store.RoomRoleByID(roomID, request.RoleID); err == nil && role.Perms&2 != 0 {
				a.voice.setMuted(roomID, userID, false)
			}
		}
		a.broadcastVoice(roomID)
	case "roles":
		if room.HubID != nil {
			if err := a.hubRoomRoles(r, roomID, *room.HubID, user); err != nil {
				err.(*apiError).write(w)
			}
			break
		}
		if r.Method == http.MethodPost {
			var request struct {
				Name  string `json:"name"`
				Color string `json:"color"`
				Perms int64  `json:"perms"`
			}
			if err := decode(r, &request); err != nil {
				fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
				return
			}
			_, _ = a.store.CreateRoomRole(roomID, request.Name, request.Color, request.Perms)
		} else if r.Method == http.MethodDelete {
			roleID, _ := parseInt64(chi.URLParam(r, "roleId"))
			_ = a.store.DeleteRoomRole(roomID, roleID)
		} else {
			roleID, _ := parseInt64(chi.URLParam(r, "roleId"))
			var request struct {
				Name  *string `json:"name"`
				Color *string `json:"color"`
				Perms *int64  `json:"perms"`
			}
			if err := decode(r, &request); err != nil {
				fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
				return
			}
			_ = a.store.UpdateRoomRole(roomID, roleID, request.Name, request.Color, request.Perms)
		}
	default:
		fail(http.StatusNotFound, "Не найдено").write(w)
		return
	}
	a.notifyRoom(roomID)
	updated, err := a.store.RoomByID(roomID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, a.roomJSON(updated))
}
func (a *server) roomBans(w http.ResponseWriter, r *http.Request)    { a.roomAdminAction(w, r, "bans") }
func (a *server) roomMembers(w http.ResponseWriter, r *http.Request) { a.roomAdminAction(w, r, "members") }
func (a *server) roomRole(w http.ResponseWriter, r *http.Request)    { a.roomAdminAction(w, r, "role") }
func (a *server) roomRoles(w http.ResponseWriter, r *http.Request)   { a.roomAdminAction(w, r, "roles") }

func (a *server) hubAddMembers(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil || !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	var request struct {
		UserID  int64   `json:"userId"`
		UserIDs []int64 `json:"userIds"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	ids := request.UserIDs
	if request.UserID != 0 {
		ids = append(ids, request.UserID)
	}
	for _, id := range ids {
		if err := a.store.AddHubMember(hubID, id); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		a.hub.Send(id, map[string]any{"type": "hub:added", "hubId": hubID})
	}
	a.broadcastHubRooms(hubID)
	a.broadcastHub(hubID)
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

// hubRoomRoles — роли комнаты канала живут в канале (как в Node)
func (a *server) hubRoomRoles(r *http.Request, roomID, hubID int64, user *store.User) error {
	switch r.Method {
	case http.MethodPost:
		var request struct {
			Name  string `json:"name"`
			Color string `json:"color"`
			Perms int64  `json:"perms"`
		}
		if err := decode(r, &request); err != nil {
			return &apiError{status: http.StatusBadRequest, body: map[string]any{"error": "Неверный формат запроса"}}
		}
		if _, err := a.store.CreateHubRole(hubID, request.Name, request.Color, request.Perms); err != nil {
			return &apiError{status: http.StatusInternalServerError, body: map[string]any{"error": "Внутренняя ошибка сервера"}}
		}
	case http.MethodDelete:
		roleID, _ := parseInt64(chi.URLParam(r, "roleId"))
		if err := a.store.DeleteHubRole(hubID, roleID); err != nil {
			return &apiError{status: http.StatusInternalServerError, body: map[string]any{"error": "Внутренняя ошибка сервера"}}
		}
	default:
		roleID, _ := parseInt64(chi.URLParam(r, "roleId"))
		var request struct {
			Name  *string `json:"name"`
			Color *string `json:"color"`
			Perms *int64  `json:"perms"`
		}
		if err := decode(r, &request); err != nil {
			return &apiError{status: http.StatusBadRequest, body: map[string]any{"error": "Неверный формат запроса"}}
		}
		if err := a.store.UpdateHubRole(hubID, roleID, request.Name, request.Color, request.Perms); err != nil {
			return &apiError{status: http.StatusInternalServerError, body: map[string]any{"error": "Внутренняя ошибка сервера"}}
		}
	}
	a.broadcastHubRooms(hubID)
	a.broadcastHub(hubID)
	_ = roomID
	_ = user
	return nil
}

// roomTimeouts — кик на время: только чтение, из голоса выкидываем сразу.
func (a *server) roomTimeouts(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	room, err := a.store.RoomByID(roomID)
	if err != nil {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	if !a.roomManager(room, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	if r.Method == http.MethodDelete {
		userID, _ := parseInt64(chi.URLParam(r, "userId"))
		_ = a.store.ClearRoomTimeout(roomID, userID)
		a.notifyRoom(roomID)
		updated, _ := a.store.RoomByID(roomID)
		writeJSON(w, http.StatusOK, a.roomJSON(updated))
		return
	}
	var request struct {
		UserID  int64 `json:"userId"`
		Seconds int64 `json:"seconds"`
	}
	if err := decode(r, &request); err != nil || request.UserID == 0 || request.Seconds < 1 {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	_ = a.store.EnsureRoomMember(roomID, request.UserID)
	if err := a.store.SetRoomTimeout(roomID, request.UserID, request.Seconds); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Из голоса — сразу, с причиной
	if part := a.voice.participant(roomID, request.UserID); part != nil && part.conn != nil {
		part.conn.Send(map[string]any{"type": "room:left", "roomId": roomID, "reason": "kicked"})
	}
	a.voice.setMuted(roomID, request.UserID, true)
	a.voice.leave(roomID, request.UserID)
	a.broadcastVoice(roomID)
	a.notifyRoom(roomID)
	updated, _ := a.store.RoomByID(roomID)
	writeJSON(w, http.StatusOK, a.roomJSON(updated))
}
