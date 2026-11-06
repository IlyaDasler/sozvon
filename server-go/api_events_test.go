package main

import (
	"testing"
	"time"

	"sozvon/server/internal/realtime"
	"sozvon/server/internal/store"
)

// Ближайший запуск события: разовое — само время, повторяющееся — от «сейчас».
func TestNextStartRepeats(t *testing.T) {
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.Local).UnixMilli() // пятница
	base := time.Date(2026, 11, 6, 21, 30, 0, 0, time.Local).UnixMilli()

	if next := nextStart(base, "none", now); next == nil || *next != base {
		t.Fatalf("разовое событие сегодня: %v", next)
	}
	if next := nextStart(base, "none", base+1000); next != nil {
		t.Fatalf("прошедшее разовое событие: %v", *next)
	}

	if next := nextStart(base, "daily", now); next == nil || *next != base {
		t.Fatalf("ежедневное событие сегодня: %v", next)
	}
	// В субботу ежедневное — завтра в то же время
	saturday := time.Date(2026, 11, 7, 9, 0, 0, 0, time.Local).UnixMilli()
	next := nextStart(base, "daily", saturday)
	if next == nil || *next != base+24*60*60*1000 {
		t.Fatalf("ежедневное в субботу: %v", next)
	}

	// Будни: с субботы переносится на понедельник
	weekday := nextStart(base, "weekdays", saturday)
	if weekday == nil {
		t.Fatal("будни: не нашли следующий запуск")
	}
	if got := time.UnixMilli(*weekday).Weekday(); got == time.Saturday || got == time.Sunday {
		t.Fatalf("будни: попали в выходной (%v)", got)
	}

	// Недельное: со следующей недели — снова в пятницу
	monday := time.Date(2026, 11, 9, 9, 0, 0, 0, time.Local).UnixMilli()
	weekly := nextStart(base, "weekly", monday)
	if weekly == nil {
		t.Fatal("недельное: не нашли следующий запуск")
	}
	if got := time.UnixMilli(*weekly).Weekday(); got != time.Friday {
		t.Fatalf("недельное: ждали пятницу, получили %v", got)
	}
}

// Напоминание: планировщик отмечает событие и не повторяет напоминание в то же время.
func TestEventReminderMarksEvent(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	user, err := st.CreateUser("reminder", "hash", "Напоминатор", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	hub, err := st.CreateHub(user.ID, "Сборы", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	rooms, err := st.RoomsOf(user.ID)
	if err != nil || len(rooms) < 2 {
		t.Fatalf("комнаты: %v, %v", rooms, err)
	}
	// Начало через 3 минуты, напоминание за 5 — окно подходящее
	startsAt := time.Now().Add(3 * time.Minute).UnixMilli()
	event, err := st.CreateEvent(rooms[1].ID, hub.ID, "Скоро собираемся", startsAt, user.ID, "none", 5)
	if err != nil {
		t.Fatal(err)
	}

	app := &server{store: st, hub: realtime.NewHub()}
	app.checkEventReminders()

	fresh, err := st.EventByID(event.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.LastRemind == nil || *fresh.LastRemind != startsAt {
		t.Fatalf("напоминание не отмечено: %+v", fresh.LastRemind)
	}
	// Повторный проход не должен менять отметку
	app.checkEventReminders()
	again, err := st.EventByID(event.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.LastRemind == nil || *again.LastRemind != startsAt {
		t.Fatalf("отметка напоминания изменилась: %+v", again.LastRemind)
	}
}
