package main

import (
	"net/url"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

// Группы комнат и смайлики канала (как в Node).

var emojiNamePattern = regexp.MustCompile(`^[a-zа-яё0-9_]{2,24}$`)

func (a *server) hubGroups(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil || !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	var request struct {
		Name    string  `json:"name"`
		RoomIDs []int64 `json:"roomIds"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	name := strings.TrimSpace(request.Name)
	if name == "" || len([]rune(name)) > 40 {
		fail(http.StatusBadRequest, "Название группы — от 1 до 40 символов").write(w)
		return
	}
	if _, err := a.store.CreateRoomGroup(hubID, name, request.RoomIDs); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.broadcastHubRooms(hubID)
	a.broadcastHub(hubID)
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

func (a *server) hubGroup(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	groupID, err2 := parseInt64(chi.URLParam(r, "groupId"))
	if err != nil || err2 != nil || !a.hubManager(hubID, user.ID) {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	if r.Method == http.MethodDelete {
		if err := a.store.DeleteRoomGroup(hubID, groupID); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	} else {
		var request struct {
			Name string `json:"name"`
		}
		if err := decode(r, &request); err != nil {
			fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
			return
		}
		name := strings.TrimSpace(request.Name)
		if name == "" || len([]rune(name)) > 40 {
			fail(http.StatusBadRequest, "Название группы — от 1 до 40 символов").write(w)
			return
		}
		if err := a.store.RenameRoomGroup(groupID, name); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
	}
	a.broadcastHubRooms(hubID)
	a.broadcastHub(hubID)
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

func (a *server) hubEmoji(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	hubID, err := parseInt64(chi.URLParam(r, "id"))
	member, memberErr := a.store.IsHubMember(hubID, user.ID)
	if err != nil || memberErr != nil || !member {
		fail(http.StatusForbidden, "Нет прав").write(w)
		return
	}
	name := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "name")))
	// Клиент присылает имя уже закодированным; chi декодирует один раз
	if decoded, err := url.QueryUnescape(name); err == nil && decoded != name {
		name = strings.ToLower(strings.TrimSpace(decoded))
	}
	if !emojiNamePattern.MatchString(name) {
		fail(http.StatusBadRequest, "Имя смайлика — от 2 до 24 букв, цифр или _").write(w)
		return
	}
	if r.Method == http.MethodDelete {
		// Клиент удаляет по id, старые версии — по имени
		var file string
		var err error
		if id, parseErr := parseInt64(name); parseErr == nil {
			file, err = a.store.DeleteHubEmojiByID(hubID, id)
		} else {
			file, err = a.store.DeleteHubEmoji(hubID, name)
		}
		if err != nil {
			fail(http.StatusNotFound, "Смайлик не найден").write(w)
			return
		}
		_ = os.Remove(filepath.Join(a.mediaDir(), file+".webp"))
		a.broadcastHub(hubID)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	body, ok := readLimited(w, r, maxAvatarBytes)
	if !ok {
		return
	}
	// Приложение присылает WebP; проверяем сигнатуру, чтобы не хранить что попало
	if len(body) < 12 || string(body[0:4]) != "RIFF" || string(body[8:12]) != "WEBP" {
		fail(http.StatusBadRequest, "Нужна картинка в формате WebP").write(w)
		return
	}
	if err := os.MkdirAll(a.mediaDir(), 0o755); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	file := auth.RandomID(16)
	if err := os.WriteFile(filepath.Join(a.mediaDir(), file+".webp"), body, 0o644); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if err := a.store.AddHubEmoji(hubID, name, file, user.ID); err != nil {
		_ = os.Remove(filepath.Join(a.mediaDir(), file+".webp"))
		fail(http.StatusConflict, "Смайлик с таким именем уже есть").write(w)
		return
	}
	a.broadcastHub(hubID)
	if hub := a.hubOr404(w, hubID); hub != nil {
		writeJSON(w, http.StatusOK, a.hubJSON(hub))
	}
}

func (a *server) patchRoomGroup(w http.ResponseWriter, r *http.Request) {
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
	var request struct {
		GroupID json.RawMessage `json:"groupId"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	var groupID *int64
	if len(request.GroupID) > 0 && string(request.GroupID) != "null" {
		var value int64
		if err := json.Unmarshal(request.GroupID, &value); err != nil {
			fail(http.StatusBadRequest, "Неверная группа").write(w)
			return
		}
		groupID = &value
	}
	if err := a.store.SetRoomGroup(roomID, groupID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.notifyRoom(roomID)
	if room.HubID != nil {
		a.broadcastHub(*room.HubID)
	}
	updated, _ := a.store.RoomByID(roomID)
	writeJSON(w, http.StatusOK, a.roomJSON(updated))
}

var _ = strconv.Itoa
