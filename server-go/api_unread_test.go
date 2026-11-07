package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"sozvon/server/internal/realtime"
	"sozvon/server/internal/store"
)

// POST /read для комнаты должен отмечать и ответы в тредах: иначе после перезапуска
// клиента счётчик непрочитанного возвращается (баг из QA 3.4.6).
func TestReadConvCoversThreadReplies(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	owner, err := st.CreateUser("owner", "hash", "Владелец", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	hub, err := st.CreateHub(owner.ID, "Канал", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateUser("other", "hash", "Другой", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AddHubMember(hub.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.AddMemberToHubRooms(hub.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	rooms, err := st.RoomsOf(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	var roomID int64
	for _, room := range rooms {
		if room.Kind == "text" {
			roomID = room.ID
		}
	}
	if roomID == 0 {
		t.Fatal("нет текстовой комнаты")
	}
	root, err := st.CreateRoomMessage(roomID, other.ID, "корень", false, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	reply, err := st.CreateRoomMessage(roomID, other.ID, "ответ в треде", false, &root.ID, nil)
	if err != nil {
		t.Fatal(err)
	}

	app := &server{store: st, hub: realtime.NewHub()}
	request := httptest.NewRequest(http.MethodPost, "/api/read", strings.NewReader(fmt.Sprintf(`{"conv":"room:%d"}`, roomID)))
	request = request.WithContext(context.WithValue(request.Context(), userKey, owner))
	recorder := httptest.NewRecorder()
	app.readConv(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("код %d: %s", recorder.Code, recorder.Body.String())
	}

	unread, err := st.UnreadRooms(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 0 {
		t.Fatalf("после прочтения осталось: %v", unread)
	}
	newest, err := st.RoomNewestMessageID(roomID)
	if err != nil {
		t.Fatal(err)
	}
	if newest != reply.ID {
		t.Fatalf("самый новый id %d, ждали ответ %d", newest, reply.ID)
	}
}
