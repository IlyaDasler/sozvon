package store

import (
	"testing"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestMigrationsAreIdempotent(t *testing.T) {
	store := newStore(t)
	first, err := store.Applied()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) == 0 {
		t.Fatal("ни одна миграция не применилась")
	}
	if err := store.Migrate(); err != nil {
		t.Fatalf("повторная миграция: %v", err)
	}
	second, err := store.Applied()
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != len(first) {
		t.Fatalf("после повтора %d миграций вместо %d: %v", len(second), len(first), second)
	}
}

func TestHubSeedsAdminRoleAndRooms(t *testing.T) {
	store := newStore(t)
	owner, err := store.CreateUser("owner", "scrypt$x$y", "Владелец", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	hub, err := store.CreateHub(owner.ID, "Канал", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	if len(hub.Roles) != 1 || hub.Roles[0].Name != adminRoleName || hub.Roles[0].Perms != adminRolePerms {
		t.Fatalf("роли канала: %+v", hub.Roles)
	}
	if len(hub.Members) != 1 || hub.Members[0].User.ID != owner.ID {
		t.Fatalf("участники канала: %+v", hub.Members)
	}
	rooms, err := store.RoomsOf(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rooms) != 2 {
		t.Fatalf("комнат %d, ждали голосовую и общий чат", len(rooms))
	}
	names := []string{rooms[0].Name + ":" + rooms[0].Kind, rooms[1].Name + ":" + rooms[1].Kind}
	if names[0] != "Голосовая:voice" || names[1] != "Общий чат:text" {
		t.Fatalf("комнаты: %v", names)
	}
	if rooms[0].Position != 1 || rooms[1].Position != 2 {
		t.Fatalf("позиции: %d, %d", rooms[0].Position, rooms[1].Position)
	}
	if len(rooms[0].Roles) != 1 || len(rooms[0].Members) != 1 {
		t.Fatalf("роль/участник комнаты: %+v %+v", rooms[0].Roles, rooms[0].Members)
	}
}

func TestFriendshipFlow(t *testing.T) {
	store := newStore(t)
	a, _ := store.CreateUser("alice", "hash", "Алиса", "#0090ff")
	b, _ := store.CreateUser("bob", "hash", "Боб", "#30a46c")
	if err := store.SendFriendRequest(a.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	incoming, err := store.IncomingRequests(b.ID)
	if err != nil || len(incoming) != 1 || incoming[0].User.ID != a.ID {
		t.Fatalf("входящие: %+v, %v", incoming, err)
	}
	if err := store.AcceptFriendRequest(a.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	friends, err := store.ContactsOf(b.ID)
	if err != nil || len(friends) != 1 || friends[0].User.ID != a.ID {
		t.Fatalf("контакты: %+v, %v", friends, err)
	}
	if ok, _ := store.AreFriends(a.ID, b.ID); !ok {
		t.Fatal("дружба не записалась в обе стороны")
	}
}
func TestMessagesAndThread(t *testing.T) {
	store := newStore(t)
	owner, err := store.CreateUser("writer", "hash", "Автор", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateHub(owner.ID, "Чат", "#12a594"); err != nil {
		t.Fatal(err)
	}
	rooms, err := store.RoomsOf(owner.ID)
	if err != nil || len(rooms) < 2 {
		t.Fatalf("комнаты: %v, %v", rooms, err)
	}
	room := rooms[1]

	root, err := store.CreateRoomMessage(room.ID, owner.ID, "привет", true, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !root.MentionAll || root.Replies != 0 || root.ThreadRoot != nil {
		t.Fatalf("корневое сообщение: %+v", root)
	}
	reply, err := store.CreateRoomMessage(room.ID, owner.ID, "ответ", false, &root.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if reply.ThreadRoot == nil || *reply.ThreadRoot != root.ID || reply.Replies != 1 {
		t.Fatalf("ответ: %+v", reply)
	}
	if reply.RootFrom == nil || *reply.RootFrom != owner.ID {
		t.Fatalf("автор корня: %+v", reply.RootFrom)
	}

	feed, err := store.RoomMessages(room.ID, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(feed) != 1 || feed[0].Replies != 1 {
		t.Fatalf("лента: %+v", feed)
	}
	thread, err := store.ThreadMessages(room.ID, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(thread) != 2 || thread[0].ID != root.ID || thread[1].ID != reply.ID {
		t.Fatalf("тред: %+v", thread)
	}
	if store.RoomLastActivity(room.ID) == 0 {
		t.Fatal("активность комнаты не обновилась")
	}
}
