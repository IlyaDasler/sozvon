package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/store"
)

// Ключи сквозного шифрования: сервер хранит только запечатанные конверты.

func (a *server) convMembers(conv string, userID int64) ([]int64, bool) {
	if strings.HasPrefix(conv, "room:") {
		roomID, err := strconv.ParseInt(strings.TrimPrefix(conv, "room:"), 10, 64)
		if err != nil {
			return nil, false
		}
		member, err := a.store.IsRoomMember(roomID, userID)
		if err != nil || !member {
			return nil, false
		}
		ids, err := a.store.RoomMemberIDs(roomID)
		if err != nil {
			return nil, false
		}
		return ids, true
	}
	if strings.HasPrefix(conv, "dm:") {
		// Формат клиента: dm:<id>-<id>; на всякий случай принимаем и dm:<id>:<id>
		raw := strings.TrimPrefix(conv, "dm:")
		raw = strings.ReplaceAll(raw, ":", "-")
		parts := strings.Split(raw, "-")
		if len(parts) != 2 {
			return nil, false
		}
		first, err1 := strconv.ParseInt(parts[0], 10, 64)
		second, err2 := strconv.ParseInt(parts[1], 10, 64)
		if err1 != nil || err2 != nil || (userID != first && userID != second) {
			return nil, false
		}
		if friends, _ := a.store.AreFriends(first, second); !friends {
			return nil, false
		}
		return []int64{first, second}, true
	}
	return nil, false
}

func (a *server) convKeys(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	conv := chi.URLParam(r, "conv")
	members, ok := a.convMembers(conv, user.ID)
	if !ok {
		fail(http.StatusNotFound, "Переписка не найдена").write(w)
		return
	}
	epoch, _ := a.store.ConvEpoch(conv)
	if r.Method == http.MethodGet {
		mine, _ := a.store.ConvKeysMine(conv, user.ID)
		holders, _ := a.store.ConvKeyHolders(conv, epoch)
		missing := make([]int64, 0)
		for _, id := range members {
			holder := false
			for _, h := range holders {
				if h == id {
					holder = true
					break
				}
			}
			if !holder {
				if member, err := a.store.UserByID(id); err == nil && member.PublicKey != "" {
					missing = append(missing, id)
				}
			}
		}
		rotate := false
		for _, h := range holders {
			found := false
			for _, id := range members {
				if id == h {
					found = true
					break
				}
			}
			if !found {
				rotate = true
			}
		}
		body := map[string]any{"epoch": epoch, "mine": mine, "missing": missing, "rotate": rotate}
		writeJSON(w, http.StatusOK, body)
		return
	}
	var request struct {
		Epoch  int64                      `json:"epoch"`
		Sealed map[string]json.RawMessage `json:"sealed"`
	}
	if err := decode(r, &request); err != nil || request.Epoch < 1 || len(request.Sealed) == 0 {
		fail(http.StatusBadRequest, "Неверные ключи").write(w)
		return
	}
	current, _ := a.store.ConvEpoch(conv)
	if request.Epoch > current+1 {
		fail(http.StatusConflict, "Версия ключа устарела — обновите ключи").write(w)
		return
	}
	sealed := map[int64]string{}
	for key, value := range request.Sealed {
		id, err := strconv.ParseInt(key, 10, 64)
		if err != nil {
			fail(http.StatusBadRequest, "Неверные ключи").write(w)
			return
		}
		allowed := false
		for _, member := range members {
			if member == id {
				allowed = true
				break
			}
		}
		if !allowed {
			fail(http.StatusBadRequest, "Запечатать ключ можно только участникам переписки").write(w)
			return
		}
		envelope := string(value)
		var plain string
		if json.Unmarshal(value, &plain) == nil {
			envelope = plain
		}
		sealed[id] = envelope
	}
	if request.Epoch == current+1 {
		if _, ok := sealed[user.ID]; !ok {
			fail(http.StatusBadRequest, "Новую версию ключа запечатайте и для себя").write(w)
			return
		}
	} else {
		mine, _ := a.store.ConvKeyMine(conv, user.ID, request.Epoch)
		if mine == "" {
			fail(http.StatusForbidden, "Поделиться можно только ключом, который есть у вас").write(w)
			return
		}
	}
	if err := a.store.AddConvKeys(conv, request.Epoch, user.ID, sealed); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
