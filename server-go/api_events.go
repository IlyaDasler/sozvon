package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/store"
)

// События канала: «собираемся играть в 21:00».
// Событие живёт в комнате канала, готовность участников («буду», «не смогу»,
// «готов в 21:30») приходит всем вместе с комнатой, как в Node-сервере.

var eventRepeats = map[string]bool{"none": true, "daily": true, "weekdays": true, "weekly": true}
var eventReminds = map[int64]bool{0: true, 5: true, 10: true, 15: true, 30: true, 60: true}

// nextStart — ближайший запуск события. Для разового — само время (если ещё не прошло),
// для повторяющегося считаем от «сейчас» в том же часе и минуте, что и исходное время.
func nextStart(startsAt int64, repeat string, now int64) *int64 {
	if repeat == "" || repeat == "none" {
		if startsAt > now {
			value := startsAt
			return &value
		}
		return nil
	}
	base := time.UnixMilli(startsAt).Local()
	day := time.UnixMilli(now).Local()
	day = time.Date(day.Year(), day.Month(), day.Day(), base.Hour(), base.Minute(), 0, 0, day.Location())
	if day.UnixMilli() <= now {
		day = day.AddDate(0, 0, 1)
	}
	if repeat == "weekdays" {
		for day.Weekday() == time.Saturday || day.Weekday() == time.Sunday {
			day = day.AddDate(0, 0, 1)
		}
	}
	if repeat == "weekly" {
		for day.Weekday() != base.Weekday() {
			day = day.AddDate(0, 0, 1)
		}
	}
	value := day.UnixMilli()
	return &value
}

// eventJSON — форма события как в Node (toEvent).
func (a *server) eventJSON(event *store.EventRow) map[string]any {
	repeat := event.Repeat
	if repeat == "" {
		repeat = "none"
	}
	responses := make([]map[string]any, 0)
	if list, err := a.store.EventResponses(event.ID); err == nil {
		for _, response := range list {
			responses = append(responses, map[string]any{
				"userId":  response.UserID,
				"status":  response.Status,
				"readyAt": response.ReadyAt,
			})
		}
	}
	now := time.Now().UnixMilli()
	var nextAt any
	if event.Active {
		if next := nextStart(event.StartsAt, repeat, now); next != nil {
			nextAt = *next
		}
	}
	// Завершённое вручную — сразу, разовое — через час после начала (как в Node)
	completed := !event.Active || (repeat == "none" && now > event.StartsAt+3_600_000)
	return map[string]any{
		"id":        event.ID,
		"roomId":    event.RoomID,
		"title":     event.Title,
		"startsAt":  event.StartsAt,
		"createdBy": event.CreatedBy,
		"createdAt": event.CreatedAt,
		"repeat":    repeat,
		"remind":    event.Remind,
		"active":    event.Active,
		"nextAt":    nextAt,
		"completed": completed,
		"responses": responses,
	}
}

// eventsJSON — то, что уходит в объекте комнаты.
func (a *server) eventsJSON(roomID int64) []map[string]any {
	list, err := a.store.EventsOfRoom(roomID)
	if err != nil {
		return []map[string]any{}
	}
	body := make([]map[string]any, 0, len(list))
	for _, event := range list {
		body = append(body, a.eventJSON(event))
	}
	return body
}

// eventManages — автор события, владелец/менеджер канала или роль с правами модерации.
func (a *server) eventManages(room *store.RoomRow, event *store.EventRow, userID int64) bool {
	if event.CreatedBy == userID {
		return true
	}
	if a.roomManager(room, userID) {
		return true
	}
	perms, err := a.store.RoomPerms(room.ID, userID)
	if err != nil {
		return false
	}
	// kick | ban | manage — как rankOf >= 2 в Node
	return perms&(32|64|128) != 0
}

// eventOr404 — событие и его комната; чужое событие неотличимо от несуществующего.
func (a *server) eventOr404(w http.ResponseWriter, r *http.Request, userID int64) (*store.EventRow, *store.RoomRow, bool) {
	eventID, err := parseInt64(chi.URLParam(r, "eventId"))
	if err != nil || eventID == 0 {
		fail(http.StatusNotFound, "Событие не найдено").write(w)
		return nil, nil, false
	}
	event, err := a.store.EventByID(eventID)
	if err != nil {
		fail(http.StatusNotFound, "Событие не найдено").write(w)
		return nil, nil, false
	}
	room, err := a.store.RoomByID(event.RoomID)
	if err != nil {
		fail(http.StatusNotFound, "Событие не найдено").write(w)
		return nil, nil, false
	}
	member, err := a.store.IsRoomMember(room.ID, userID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Событие не найдено").write(w)
		return nil, nil, false
	}
	return event, room, true
}

// eventInvite — уведомление в колокольчик приглашённому.
func (a *server) eventInvite(eventID, startsAt int64, title string, room *store.RoomRow, from *store.User) map[string]any {
	return map[string]any{
		"type":     "event:invite",
		"eventId":  eventID,
		"title":    title,
		"startsAt": startsAt,
		"roomId":   room.ID,
		"roomName": room.Name,
		"hubId":    room.HubID,
		"from":     a.publicUser(from),
	}
}

func (a *server) roomEventCreate(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	roomID, err := parseInt64(chi.URLParam(r, "id"))
	if err != nil || roomID == 0 {
		fail(http.StatusBadRequest, "Неверная комната").write(w)
		return
	}
	room, err := a.store.RoomByID(roomID)
	if err != nil {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	member, err := a.store.IsRoomMember(roomID, user.ID)
	if err != nil || !member {
		fail(http.StatusNotFound, "Комната не найдена").write(w)
		return
	}
	if room.HubID == nil {
		fail(http.StatusBadRequest, "События бывают только в каналах").write(w)
		return
	}
	perms, _ := a.store.RoomPerms(roomID, user.ID)
	if perms&8 == 0 {
		fail(http.StatusForbidden, "Вам нельзя писать в эту комнату").write(w)
		return
	}
	var request struct {
		Title    string  `json:"title"`
		StartsAt int64   `json:"startsAt"`
		Invitees []int64 `json:"invitees"`
		Repeat   string  `json:"repeat"`
		Remind   int64   `json:"remind"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	title := strings.TrimSpace(request.Title)
	if len([]rune(title)) < 1 || len([]rune(title)) > 80 {
		fail(http.StatusBadRequest, "Название события — от 1 до 80 символов").write(w)
		return
	}
	if request.StartsAt < time.Now().UnixMilli()-86_400_000 {
		fail(http.StatusBadRequest, "Укажите дату и время события").write(w)
		return
	}
	repeat := request.Repeat
	if !eventRepeats[repeat] {
		repeat = "none"
	}
	remind := request.Remind
	if !eventReminds[remind] {
		remind = 0
	}
	// Старое событие с таким же названием в этой комнате убираем — остаётся новое
	if old, err := a.store.EventsOfRoom(roomID); err == nil {
		for _, item := range old {
			if strings.EqualFold(strings.TrimSpace(item.Title), title) {
				_ = a.store.DeleteEvent(item.ID)
			}
		}
	}
	event, err := a.store.CreateEvent(roomID, *room.HubID, title, request.StartsAt, user.ID, repeat, remind)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Автор сразу «буду», приглашённые — «приглашён»
	_ = a.store.SetEventResponse(event.ID, user.ID, "yes", nil)
	for _, invitee := range request.Invitees {
		if invitee == user.ID || invitee == 0 {
			continue
		}
		isMember, err := a.store.IsRoomMember(roomID, invitee)
		if err != nil || !isMember {
			continue
		}
		_ = a.store.SetEventResponse(event.ID, invitee, "invited", nil)
		a.hub.Send(invitee, a.eventInvite(event.ID, event.StartsAt, title, room, user))
	}
	a.notifyRoom(roomID)
	body := a.roomJSON(room)
	body["createdEventId"] = event.ID
	writeJSON(w, http.StatusOK, body)
}

func (a *server) roomEventResponse(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	event, room, ok := a.eventOr404(w, r, user.ID)
	if !ok {
		return
	}
	var request struct {
		Status  string `json:"status"`
		ReadyAt *int64 `json:"readyAt"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	status := request.Status
	if status != "yes" && status != "no" && status != "maybe" {
		fail(http.StatusBadRequest, "Неизвестный ответ").write(w)
		return
	}
	var readyAt *int64
	if status == "maybe" {
		if request.ReadyAt == nil {
			fail(http.StatusBadRequest, "Укажите время, когда сможете").write(w)
			return
		}
		readyAt = request.ReadyAt
	}
	if err := a.store.SetEventResponse(event.ID, user.ID, status, readyAt); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.notifyRoom(room.ID)
	writeJSON(w, http.StatusOK, a.roomJSON(room))
}

func (a *server) roomEventPatch(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	event, room, ok := a.eventOr404(w, r, user.ID)
	if !ok {
		return
	}
	if !a.eventManages(room, event, user.ID) {
		fail(http.StatusForbidden, "Изменить событие может его автор или управляющий каналом").write(w)
		return
	}
	var request struct {
		Title    string  `json:"title"`
		StartsAt int64   `json:"startsAt"`
		Invitees []int64 `json:"invitees"`
		Repeat   string  `json:"repeat"`
		Remind   int64   `json:"remind"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	title := strings.TrimSpace(request.Title)
	if len([]rune(title)) < 1 || len([]rune(title)) > 80 {
		fail(http.StatusBadRequest, "Название события — от 1 до 80 символов").write(w)
		return
	}
	if request.StartsAt < time.Now().UnixMilli()-86_400_000 {
		fail(http.StatusBadRequest, "Укажите дату и время события").write(w)
		return
	}
	repeat := request.Repeat
	if !eventRepeats[repeat] {
		repeat = "none"
	}
	remind := request.Remind
	if !eventReminds[remind] {
		remind = 0
	}
	beforeTitle, beforeStartsAt := event.Title, event.StartsAt
	if err := a.store.UpdateEvent(event.ID, title, request.StartsAt, repeat, remind); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Кого добавили при правке — приглашаем
	responses, _ := a.store.EventResponses(event.ID)
	known := make(map[int64]bool, len(responses))
	for _, response := range responses {
		known[response.UserID] = true
	}
	for _, invitee := range request.Invitees {
		if invitee == user.ID || invitee == 0 || known[invitee] {
			continue
		}
		isMember, err := a.store.IsRoomMember(room.ID, invitee)
		if err != nil || !isMember {
			continue
		}
		_ = a.store.SetEventResponse(event.ID, invitee, "invited", nil)
		a.hub.Send(invitee, a.eventInvite(event.ID, request.StartsAt, title, room, user))
	}
	// Оповещаем всех, кто в событии: название, время или повтор изменились
	for _, response := range responses {
		if response.UserID == user.ID {
			continue
		}
		a.hub.Send(response.UserID, map[string]any{
			"type":           "event:changed",
			"eventId":        event.ID,
			"title":          title,
			"beforeTitle":    beforeTitle,
			"startsAt":       request.StartsAt,
			"beforeStartsAt": beforeStartsAt,
			"repeat":         repeat,
			"remind":         remind,
			"roomId":         room.ID,
			"roomName":       room.Name,
			"hubId":          room.HubID,
			"from":           a.publicUser(user),
		})
	}
	a.notifyRoom(room.ID)
	writeJSON(w, http.StatusOK, a.roomJSON(room))
}

func (a *server) roomEventDelete(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	event, room, ok := a.eventOr404(w, r, user.ID)
	if !ok {
		return
	}
	if !a.eventManages(room, event, user.ID) {
		fail(http.StatusForbidden, "Удалить событие может его автор или управляющий каналом").write(w)
		return
	}
	if err := a.store.DeleteEvent(event.ID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.notifyRoom(room.ID)
	writeJSON(w, http.StatusOK, a.roomJSON(room))
}

func (a *server) roomEventFinish(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	event, room, ok := a.eventOr404(w, r, user.ID)
	if !ok {
		return
	}
	if !a.eventManages(room, event, user.ID) {
		fail(http.StatusForbidden, "Завершить событие может его автор или управляющий каналом").write(w)
		return
	}
	if err := a.store.FinishEvent(event.ID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.notifyRoom(room.ID)
	writeJSON(w, http.StatusOK, a.roomJSON(room))
}

// checkEventReminders — раз в полминуты проверяем ближайшие запуски и напоминаем
// всем участникам комнаты, как в Node-сервере.
func (a *server) checkEventReminders() {
	now := time.Now().UnixMilli()
	events, err := a.store.AllEvents()
	if err != nil {
		return
	}
	for _, event := range events {
		if event.Remind == 0 || !event.Active {
			continue
		}
		next := nextStart(event.StartsAt, event.Repeat, now)
		if next == nil {
			continue
		}
		if now < *next-event.Remind*60_000 || now > *next {
			continue
		}
		if event.LastRemind != nil && *event.LastRemind == *next {
			continue
		}
		if err := a.store.MarkEventReminded(event.ID, *next); err != nil {
			continue
		}
		room, err := a.store.RoomByID(event.RoomID)
		if err != nil {
			continue
		}
		ids, err := a.store.RoomMemberIDs(room.ID)
		if err != nil {
			continue
		}
		message := map[string]any{
			"type":     "event:remind",
			"eventId":  event.ID,
			"title":    event.Title,
			"startsAt": *next,
			"minutes":  event.Remind,
			"roomId":   room.ID,
			"roomName": room.Name,
			"hubId":    room.HubID,
		}
		for _, id := range ids {
			a.hub.Send(id, message)
		}
	}
}

// eventRemindersLoop — планировщик напоминаний до остановки процесса.
func (a *server) eventRemindersLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		a.checkEventReminders()
	}
}
