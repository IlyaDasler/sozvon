package store

import (
	"testing"
	"time"
)

func TestEventsLifecycle(t *testing.T) {
	store := newStore(t)
	owner, err := store.CreateUser("eventer", "hash", "Организатор", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	hub, err := store.CreateHub(owner.ID, "Сборы", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	rooms, err := store.RoomsOf(owner.ID)
	if err != nil || len(rooms) < 2 {
		t.Fatalf("комнаты: %v, %v", rooms, err)
	}
	room := rooms[1]

	startsAt := time.Now().Add(2 * time.Hour).UnixMilli()
	event, err := store.CreateEvent(room.ID, hub.ID, "Играем", startsAt, owner.ID, "weekly", 15)
	if err != nil {
		t.Fatal(err)
	}
	if !event.Active || event.Repeat != "weekly" || event.Remind != 15 {
		t.Fatalf("созданное событие: %+v", event)
	}

	// Автор «буду», приглашённый — «приглашён», потом передумал
	if err := store.SetEventResponse(event.ID, owner.ID, "yes", nil); err != nil {
		t.Fatal(err)
	}
	readyAt := time.Now().Add(3 * time.Hour).UnixMilli()
	if err := store.SetEventResponse(event.ID, owner.ID, "maybe", &readyAt); err != nil {
		t.Fatal(err)
	}
	responses, err := store.EventResponses(event.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(responses) != 1 || responses[0].Status != "maybe" || responses[0].ReadyAt == nil || *responses[0].ReadyAt != readyAt {
		t.Fatalf("готовность участников: %+v", responses)
	}

	// Список комнаты и глобальный список для планировщика
	list, err := store.EventsOfRoom(room.ID)
	if err != nil || len(list) != 1 || list[0].ID != event.ID {
		t.Fatalf("события комнаты: %+v, %v", list, err)
	}
	all, err := store.AllEvents()
	if err != nil || len(all) != 1 {
		t.Fatalf("все события: %+v, %v", all, err)
	}

	// Правка сбрасывает last_remind, чтобы напоминание сработало по новому времени
	if err := store.MarkEventReminded(event.ID, startsAt); err != nil {
		t.Fatal(err)
	}
	newStart := startsAt + 60*60*1000
	if err := store.UpdateEvent(event.ID, "Играем позже", newStart, "daily", 30); err != nil {
		t.Fatal(err)
	}
	updated, err := store.EventByID(event.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "Играем позже" || updated.StartsAt != newStart || updated.Repeat != "daily" || updated.Remind != 30 {
		t.Fatalf("после правки: %+v", updated)
	}
	if updated.LastRemind != nil {
		t.Fatalf("last_remind не сбросился: %v", *updated.LastRemind)
	}

	// Завершение: событие остаётся в комнате, но неактивно
	if err := store.FinishEvent(event.ID); err != nil {
		t.Fatal(err)
	}
	finished, err := store.EventByID(event.ID)
	if err != nil {
		t.Fatal(err)
	}
	if finished.Active {
		t.Fatal("событие осталось активным после finish")
	}

	// Удаление убирает и событие, и готовность (каскад)
	if err := store.DeleteEvent(event.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EventByID(event.ID); err == nil {
		t.Fatal("событие не удалилось")
	}
	responses, err = store.EventResponses(event.ID)
	if err != nil || len(responses) != 0 {
		t.Fatalf("готовность не удалилась: %+v, %v", responses, err)
	}
}

func TestReorderRooms(t *testing.T) {
	store := newStore(t)
	owner, err := store.CreateUser("sorter", "hash", "Порядок", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	hub, err := store.CreateHub(owner.ID, "Канал", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	rooms, err := store.RoomsOf(owner.ID)
	if err != nil || len(rooms) != 2 {
		t.Fatalf("комнаты: %v, %v", rooms, err)
	}
	text := rooms[1]
	extra, err := store.CreateRoom(hub.ID, owner.ID, "Вторая текстовая", text.Kind, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ReorderRooms([]int64{extra.ID, text.ID}); err != nil {
		t.Fatal(err)
	}
	fresh, err := store.RoomsOfHub(hub.ID)
	if err != nil {
		t.Fatal(err)
	}
	positions := map[int64]int64{}
	for _, room := range fresh {
		positions[room.ID] = room.Position
	}
	if positions[extra.ID] != 1 || positions[text.ID] != 2 {
		t.Fatalf("позиции после перестановки: %+v", positions)
	}
}
