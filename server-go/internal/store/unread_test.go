package store

import "testing"

func textRoomOf(t *testing.T, store *Store, userID int64) *RoomRow {
	t.Helper()
	rooms, err := store.RoomsOf(userID)
	if err != nil {
		t.Fatal(err)
	}
	for _, room := range rooms {
		if room.Kind == "text" {
			return room
		}
	}
	t.Fatal("нет текстовой комнаты")
	return nil
}

// Отметка прочтения комнаты должна закрывать и ответы в тредах: иначе тред
// навсегда остаётся непрочитанным и после перезапуска клиента снова горит счётчик.
func TestReadMarkCoversThreadReplies(t *testing.T) {
	store := newStore(t)
	owner, err := store.CreateUser("owner", "hash", "Владелец", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	hub, err := store.CreateHub(owner.ID, "Канал", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.CreateUser("other", "hash", "Другой", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddHubMember(hub.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.AddMemberToHubRooms(hub.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	room := textRoomOf(t, store, owner.ID)

	root, err := store.CreateRoomMessage(room.ID, other.ID, "корень", false, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	reply, err := store.CreateRoomMessage(room.ID, other.ID, "ответ в треде", false, &root.ID, nil)
	if err != nil {
		t.Fatal(err)
	}

	unread, err := store.UnreadRooms(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 1 || unread[0]["roomId"] != room.ID {
		t.Fatalf("до прочтения: %v", unread)
	}

	newest, err := store.RoomNewestMessageID(room.ID)
	if err != nil {
		t.Fatal(err)
	}
	if newest != reply.ID {
		t.Fatalf("самый новый id комнаты %d, ждали ответ в треде %d", newest, reply.ID)
	}
	if err := store.MarkRoomRead(owner.ID, room.ID, newest); err != nil {
		t.Fatal(err)
	}
	if unread, err = store.UnreadRooms(owner.ID); err != nil {
		t.Fatal(err)
	}
	if len(unread) != 0 {
		t.Fatalf("после прочтения осталось непрочитанное: %v", unread)
	}
}

// База, переехавшая с Node: у человека нет read_state, но старые сообщения уже были —
// они не должны разом стать непрочитанными. Новые сообщения после baseline — считаются.
func TestUnreadRoomsRespectsBaseline(t *testing.T) {
	store := newStore(t)
	owner, err := store.CreateUser("owner", "hash", "Владелец", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	hub, err := store.CreateHub(owner.ID, "Канал", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.CreateUser("other", "hash", "Другой", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddHubMember(hub.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.AddMemberToHubRooms(hub.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	room := textRoomOf(t, store, owner.ID)
	if _, err := store.CreateRoomMessage(room.ID, other.ID, "старое", false, nil, nil); err != nil {
		t.Fatal(err)
	}

	// Имитируем миграцию: запоминаем текущие максимумы как «прочитанное по умолчанию»
	dm, roomMax := store.ReadBaseline() // на свежей базе нули
	if dm != 0 || roomMax != 0 {
		t.Fatalf("baseline на свежей базе: %d/%d", dm, roomMax)
	}
	newest, err := store.RoomNewestMessageID(room.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`UPDATE read_baseline SET room = ?`, newest); err != nil {
		t.Fatal(err)
	}

	if unread, err := store.UnreadRooms(owner.ID); err != nil {
		t.Fatal(err)
	} else if len(unread) != 0 {
		t.Fatalf("старые сообщения стали непрочитанными: %v", unread)
	}

	if _, err := store.CreateRoomMessage(room.ID, other.ID, "новое", false, nil, nil); err != nil {
		t.Fatal(err)
	}
	unread, err := store.UnreadRooms(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 1 || unread[0]["count"] != int64(1) {
		t.Fatalf("после baseline: %v", unread)
	}
}

// В личных переписках непрочитанными считаются только входящие: свои сообщения — нет.
func TestUnreadDMCountsOnlyIncoming(t *testing.T) {
	store := newStore(t)
	me, err := store.CreateUser("me", "hash", "Я", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	peer, err := store.CreateUser("peer", "hash", "Друг", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.InsertDM(peer.ID, me.ID, "привет", "", "", "", nil); err != nil {
		t.Fatal(err)
	}
	unread, err := store.UnreadDM(me.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(unread) != 1 || unread[0]["peerId"] != peer.ID || unread[0]["count"] != int64(1) {
		t.Fatalf("после входящего: %v", unread)
	}
	if err := store.MarkDMRead(me.ID, peer.ID); err != nil {
		t.Fatal(err)
	}
	// Свой ответ не делает переписку непрочитанной
	if _, err := store.InsertDM(me.ID, peer.ID, "ответ", "", "", "", nil); err != nil {
		t.Fatal(err)
	}
	if unread, err = store.UnreadDM(me.ID); err != nil {
		t.Fatal(err)
	} else if len(unread) != 0 {
		t.Fatalf("своё сообщение посчитали непрочитанным: %v", unread)
	}
	// А новое входящее — делает
	if _, err := store.InsertDM(peer.ID, me.ID, "ещё", "", "", "", nil); err != nil {
		t.Fatal(err)
	}
	if unread, err = store.UnreadDM(me.ID); err != nil {
		t.Fatal(err)
	} else if len(unread) != 1 || unread[0]["count"] != int64(1) {
		t.Fatalf("после нового входящего: %v", unread)
	}
}
