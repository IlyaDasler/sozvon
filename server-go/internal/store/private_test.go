package store

import "testing"

func TestPrivateRoomHiddenFromHubMembers(t *testing.T) {
	store := newStore(t)
	owner, err := store.CreateUser("privowner", "hash", "Владелец", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	guest, err := store.CreateUser("privguest", "hash", "Гость", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	hub, err := store.CreateHub(owner.ID, "Канал", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AddHubMember(hub.ID, guest.ID); err != nil {
		t.Fatal(err)
	}
	private, err := store.CreateRoom(hub.ID, owner.ID, "Секретная", "text", true)
	if err != nil {
		t.Fatal(err)
	}
	member, err := store.IsRoomMember(private.ID, guest.ID)
	if err != nil || member {
		t.Fatalf("посторонний попал в приватную комнату: member=%v err=%v", member, err)
	}
	guestRooms, err := store.RoomsOf(guest.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, room := range guestRooms {
		if room.ID == private.ID {
			t.Fatal("приватная комната видна постороннему")
		}
	}
	ownerRooms, err := store.RoomsOf(owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, room := range ownerRooms {
		if room.ID == private.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("владелец не видит свою приватную комнату")
	}
}

func TestTotpStepCannotBeReplayed(t *testing.T) {
	store := newStore(t)
	user, err := store.CreateUser("totpstep", "hash", "Код", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	const step = int64(777)
	if used, err := store.UseTotpStep(user.ID, step); err != nil || !used {
		t.Fatalf("первый шаг не принят: used=%v err=%v", used, err)
	}
	if used, err := store.UseTotpStep(user.ID, step); err != nil || used {
		t.Fatalf("повторный шаг принят: used=%v err=%v", used, err)
	}
	if used, err := store.UseTotpStep(user.ID, step+1); err != nil || !used {
		t.Fatalf("следующий шаг не принят: used=%v err=%v", used, err)
	}
}
