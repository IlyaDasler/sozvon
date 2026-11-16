package store

import (
	"errors"
	"testing"
)

func TestAdminRolesAndUserMetadata(t *testing.T) {
	st := newStore(t)
	owner, err := st.CreateUser("owner", "scrypt$x$y", "Владелец", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	moderator, err := st.CreateUser("moderator", "scrypt$x$y", "Модератор", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.EnsureAdminRole(owner.ID, "super_admin", 0, 0, 0); err != nil {
		t.Fatal(err)
	}
	role, err := st.ActiveAdminRole(owner.ID)
	if err != nil || !role.IsSuper() {
		t.Fatalf("super admin: %+v, %v", role, err)
	}
	if err := st.EnsureAdminRole(moderator.ID, "moderator", AdminPermUsersView|AdminPermUsersBan, owner.ID, 0); err != nil {
		t.Fatal(err)
	}
	if role, _ := st.ActiveAdminRole(moderator.ID); role == nil || role.IsSuper() || !role.Can(AdminPermUsersBan) {
		t.Fatalf("moderator: %+v", role)
	}
	users, total, err := st.AdminUsers("", "", 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(users) != 2 {
		t.Fatalf("users total=%d len=%d", total, len(users))
	}
	if err := st.RevokeAdminRole(moderator.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ActiveAdminRole(moderator.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked role: %v", err)
	}
}

func TestPurgeUserKeepsMessagesInForeignChannels(t *testing.T) {
	st := newStore(t)
	alice, _ := st.CreateUser("alice", "scrypt$x$y", "Алиса", "#0090ff")
	bob, _ := st.CreateUser("bob", "scrypt$x$y", "Боб", "#12a594")
	mallory, _ := st.CreateUser("mallory", "scrypt$x$y", "Мэллори", "#e5484d")

	ownedHub, err := st.CreateHub(alice.ID, "Свой канал", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	ownedRooms, _ := st.RoomsOfHub(ownedHub.ID)
	if len(ownedRooms) == 0 {
		t.Fatal("нет комнат своего канала")
	}
	if _, err := st.CreateRoomMessage(ownedRooms[len(ownedRooms)-1].ID, alice.ID, "своё сообщение", false, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := st.InsertDM(alice.ID, bob.ID, "личное", "", "", "", nil); err != nil {
		t.Fatal(err)
	}

	foreignHub, err := st.CreateHub(bob.ID, "Чужой канал", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	foreignRooms, _ := st.RoomsOfHub(foreignHub.ID)
	foreignRoom := foreignRooms[len(foreignRooms)-1]
	if _, err := st.CreateRoomMessage(foreignRoom.ID, alice.ID, "сообщение в чужом канале", false, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := st.AddRoomMember(foreignRoom.ID, alice.ID); err != nil {
		t.Fatal(err)
	}

	ids, err := st.UserIdentifiers(alice.ID)
	if err != nil || ids.Username != "alice" {
		t.Fatalf("identifiers: %+v, %v", ids, err)
	}
	if err := st.AddBlacklist("username", "alice-hmac", alice.ID, "тест", mallory.ID); err != nil {
		t.Fatal(err)
	}
	if blocked, _ := st.IsBlacklisted("username", "alice-hmac"); !blocked {
		t.Fatal("blacklist не сработал")
	}
	if err := st.PurgeUser(alice.ID, mallory.ID, "нарушение правил"); err != nil {
		t.Fatal(err)
	}

	user, err := st.UserByID(alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if user.BannedAt == 0 || user.PasswordHash != "!" || user.PublicKey != "" || user.PhoneHMAC != "" {
		t.Fatalf("tombstone: %+v", user)
	}
	if _, err := st.HubByID(ownedHub.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("свой канал остался: %v", err)
	}
	if _, err := st.RoomByID(ownedRooms[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("своя комната осталась: %v", err)
	}
	if history, _ := st.DMHistory(alice.ID, bob.ID, 0, 50); len(history) != 0 {
		t.Fatalf("личная история осталась: %d", len(history))
	}
	if _, err := st.HubByID(foreignHub.ID); err != nil {
		t.Fatalf("чужой канал удалён: %v", err)
	}
	messages, err := st.RoomMessages(foreignRoom.ID, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, message := range messages {
		if message.Text == "сообщение в чужом канале" {
			found = true
		}
	}
	if !found {
		t.Fatal("сообщение в чужом канале исчезло")
	}
}

func TestAdminChannelListAndPrivacy(t *testing.T) {
	st := newStore(t)
	owner, _ := st.CreateUser("owner", "scrypt$x$y", "Владелец", "#0090ff")
	hub, err := st.CreateHub(owner.ID, "Публичный", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	list, total, err := st.AdminChannels("", "", 50, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total < 1 || len(list) == 0 {
		t.Fatalf("каналы: total=%d len=%d", total, len(list))
	}
	if err := st.SetChannelPrivacy("hub", hub.ID, "hidden"); err != nil {
		t.Fatal(err)
	}
	var privacy string
	if err := st.db.QueryRow(`SELECT privacy FROM hubs WHERE id = ?`, hub.ID).Scan(&privacy); err != nil {
		t.Fatal(err)
	}
	if privacy != "hidden" {
		t.Fatalf("privacy=%q", privacy)
	}
}
