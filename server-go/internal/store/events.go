package store

import (
	"database/sql"
	"errors"
	"time"
)

// События канала: публикуются в комнату, готовность участников хранится здесь же.
// Схема повторяет Node-сервер (db.js), чтобы база оставалась общей.

type EventRow struct {
	ID         int64
	RoomID     int64
	HubID      int64
	Title      string
	StartsAt   int64
	CreatedBy  int64
	CreatedAt  int64
	Repeat     string
	Remind     int64
	LastRemind *int64
	Active     bool
}

type EventResponse struct {
	EventID   int64
	UserID    int64
	Status    string
	ReadyAt   *int64
	UpdatedAt int64
}

func (s *Store) scanEvent(row interface{ Scan(...any) error }) (*EventRow, error) {
	var event EventRow
	var repeat sql.NullString
	var lastRemind sql.NullInt64
	err := row.Scan(&event.ID, &event.RoomID, &event.HubID, &event.Title, &event.StartsAt,
		&event.CreatedBy, &event.CreatedAt, &repeat, &event.Remind, &lastRemind, &event.Active)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	event.Repeat = repeat.String
	if lastRemind.Valid {
		value := lastRemind.Int64
		event.LastRemind = &value
	}
	return &event, nil
}

const eventColumns = `id, room_id, hub_id, title, starts_at, created_by, created_at, COALESCE(repeat, 'none'), COALESCE(remind, 0), last_remind, COALESCE(active, 1)`

// EventByID — одно событие.
func (s *Store) EventByID(id int64) (*EventRow, error) {
	return s.scanEvent(s.db.QueryRow(`SELECT `+eventColumns+` FROM events WHERE id = ?`, id))
}

// EventsOfRoom — события комнаты по времени начала (как в Node: starts_at, id).
func (s *Store) EventsOfRoom(roomID int64) ([]*EventRow, error) {
	rows, err := s.db.Query(`SELECT `+eventColumns+` FROM events WHERE room_id = ? ORDER BY starts_at, id`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]*EventRow, 0)
	for rows.Next() {
		event, err := s.scanEvent(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, event)
	}
	return list, rows.Err()
}

// AllEvents — для планировщика напоминаний.
func (s *Store) AllEvents() ([]*EventRow, error) {
	rows, err := s.db.Query(`SELECT ` + eventColumns + ` FROM events`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]*EventRow, 0)
	for rows.Next() {
		event, err := s.scanEvent(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, event)
	}
	return list, rows.Err()
}

func (s *Store) CreateEvent(roomID, hubID int64, title string, startsAt, createdBy int64, repeat string, remind int64) (*EventRow, error) {
	if repeat == "" {
		repeat = "none"
	}
	result, err := s.db.Exec(`
		INSERT INTO events (room_id, hub_id, title, starts_at, created_by, created_at, repeat, remind)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		roomID, hubID, title, startsAt, createdBy, time.Now().UnixMilli(), repeat, remind)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.EventByID(id)
}

func (s *Store) DeleteEvent(id int64) error {
	_, err := s.db.Exec(`DELETE FROM events WHERE id = ?`, id)
	return err
}

func (s *Store) UpdateEvent(id int64, title string, startsAt int64, repeat string, remind int64) error {
	if repeat == "" {
		repeat = "none"
	}
	_, err := s.db.Exec(`
		UPDATE events SET title = ?, starts_at = ?, repeat = ?, remind = ?, last_remind = NULL
		WHERE id = ?`, title, startsAt, repeat, remind, id)
	return err
}

// FinishEvent — событие завершено вручную: больше не напоминает о себе.
func (s *Store) FinishEvent(id int64) error {
	_, err := s.db.Exec(`UPDATE events SET active = 0 WHERE id = ?`, id)
	return err
}

func (s *Store) MarkEventReminded(id, at int64) error {
	_, err := s.db.Exec(`UPDATE events SET last_remind = ? WHERE id = ?`, at, id)
	return err
}

// EventResponses — готовность участников: yes / no / maybe / invited.
func (s *Store) EventResponses(eventID int64) ([]EventResponse, error) {
	rows, err := s.db.Query(`
		SELECT event_id, user_id, status, ready_at, updated_at
		FROM event_responses WHERE event_id = ? ORDER BY updated_at, user_id`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]EventResponse, 0)
	for rows.Next() {
		var response EventResponse
		var readyAt sql.NullInt64
		if err := rows.Scan(&response.EventID, &response.UserID, &response.Status, &readyAt, &response.UpdatedAt); err != nil {
			return nil, err
		}
		if readyAt.Valid {
			value := readyAt.Int64
			response.ReadyAt = &value
		}
		list = append(list, response)
	}
	return list, rows.Err()
}

func (s *Store) SetEventResponse(eventID, userID int64, status string, readyAt *int64) error {
	var ready any
	if readyAt != nil {
		ready = *readyAt
	}
	_, err := s.db.Exec(`
		INSERT INTO event_responses (event_id, user_id, status, ready_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (event_id, user_id) DO UPDATE SET
			status = excluded.status,
			ready_at = excluded.ready_at,
			updated_at = excluded.updated_at`,
		eventID, userID, status, ready, time.Now().UnixMilli())
	return err
}

// ClearEventResponse — убрать готовность (пока не используется API, но нужно для симметрии).
func (s *Store) ClearEventResponse(eventID, userID int64) error {
	_, err := s.db.Exec(`DELETE FROM event_responses WHERE event_id = ? AND user_id = ?`, eventID, userID)
	return err
}

// ReorderRooms — порядок комнат в списке канала (перетаскивание).
func (s *Store) ReorderRooms(ids []int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	for index, id := range ids {
		if _, err := tx.Exec(`UPDATE rooms SET position = ? WHERE id = ?`, index+1, id); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}
