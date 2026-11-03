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
	if err := store.Migrate(); err != nil {
		t.Fatalf("повторная миграция: %v", err)
	}
	applied, err := store.Applied()
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != 3 {
		t.Fatalf("применено %d миграций, ждали 3: %v", len(applied), applied)
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
