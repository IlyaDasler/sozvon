package store

import (
	"database/sql"
	"errors"
	"strconv"
	"time"
)

type Message struct {
	ID          int64
	RoomID      int64
	FromID      int64
	Text        string
	Attachments string
	Preview     string
	Enc         string
	ReplyTo     *int64
	MentionAll  bool
	ThreadRoot  *int64
	EditedAt    *int64
	CreatedAt   int64
	Replies     int64
	RootFrom    *int64
}

const messageColumns = `id, room_id, from_id, text, created_at, attachments, preview, enc, reply_to, edited_at, thread_root, mention_all`

// countReplies: для корня считаем ответы по thread_root = id, для ответа — по его корню
const repliesExpr = `(SELECT COUNT(*) FROM room_messages r2
	WHERE r2.thread_root = COALESCE(room_messages.thread_root, room_messages.id))`

const rootFromExpr = `(SELECT r3.from_id FROM room_messages r3 WHERE r3.id = room_messages.thread_root)`

func scanMessage(row interface{ Scan(...any) error }) (*Message, error) {
	var message Message
	var attachments, preview, enc sql.NullString
	var replyTo, editedAt, threadRoot sql.NullInt64
	var mentionAll int
	var replies int64
	var rootFrom sql.NullInt64
	err := row.Scan(
		&message.ID, &message.RoomID, &message.FromID, &message.Text, &message.CreatedAt,
		&attachments, &preview, &enc, &replyTo, &editedAt, &threadRoot, &mentionAll,
		&replies, &rootFrom,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	message.Attachments = attachments.String
	message.Preview = preview.String
	message.Enc = enc.String
	if replyTo.Valid {
		value := replyTo.Int64
		message.ReplyTo = &value
	}
	if editedAt.Valid {
		value := editedAt.Int64
		message.EditedAt = &value
	}
	if threadRoot.Valid {
		value := threadRoot.Int64
		message.ThreadRoot = &value
	}
	if rootFrom.Valid {
		value := rootFrom.Int64
		message.RootFrom = &value
	}
	message.MentionAll = mentionAll != 0
	message.Replies = replies
	return &message, nil
}

func (s *Store) CreateRoomMessage(roomID, fromID int64, text string, mentionAll bool, threadRoot, replyTo *int64) (*Message, error) {
	mention := 0
	if mentionAll {
		mention = 1
	}
	result, err := s.db.Exec(
		`INSERT INTO room_messages (room_id, from_id, text, created_at, thread_root, reply_to, mention_all) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		roomID, fromID, text, time.Now().UnixMilli(), threadRoot, replyTo, mention,
	)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.RoomMessageByID(id)
}

func (s *Store) RoomMessageByID(id int64) (*Message, error) {
	row := s.db.QueryRow(`SELECT `+messageColumns+`, `+repliesExpr+`, `+rootFromExpr+` FROM room_messages WHERE id = ?`, id)
	return scanMessage(row)
}

// RoomMessages — лента комнаты: только корневые сообщения, от старых к новым.
func (s *Store) RoomMessages(roomID int64, limit int, before *int64) ([]*Message, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := `SELECT ` + messageColumns + `, ` + repliesExpr + `, ` + rootFromExpr + `
		FROM room_messages WHERE room_id = ? AND thread_root IS NULL`
	args := []any{roomID}
	if before != nil {
		query += ` AND id < ?`
		args = append(args, *before)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list, err := collectMessages(rows)
	if err != nil {
		return nil, err
	}
	// Переворачиваем: клиенту нужен хронологический порядок
	for left, right := 0, len(list)-1; left < right; left, right = left+1, right-1 {
		list[left], list[right] = list[right], list[left]
	}
	return list, nil
}

func (s *Store) ThreadMessages(roomID, rootID int64) ([]*Message, error) {
	rows, err := s.db.Query(
		`SELECT `+messageColumns+`, `+repliesExpr+`, `+rootFromExpr+`
		 FROM room_messages WHERE room_id = ? AND (id = ? OR thread_root = ?) ORDER BY id`,
		roomID, rootID, rootID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectMessages(rows)
}

func collectMessages(rows *sql.Rows) ([]*Message, error) {
	var list []*Message
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, message)
	}
	return list, rows.Err()
}

func (s *Store) RoomLastActivity(roomID int64) int64 {
	var last sql.NullInt64
	_ = s.db.QueryRow(`SELECT MAX(created_at) FROM room_messages WHERE room_id = ?`, roomID).Scan(&last)
	return last.Int64
}

func (s *Store) IsRoomMember(roomID, userID int64) (bool, error) {
	var exists int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM room_members WHERE room_id = ? AND user_id = ?`, roomID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	if exists > 0 {
		return true, nil
	}
	// участник канала тоже имеет доступ к комнате канала
	err = s.db.QueryRow(`
		SELECT COUNT(*) FROM rooms r JOIN hub_members m ON m.hub_id = r.hub_id
		WHERE r.id = ? AND m.user_id = ?`, roomID, userID).Scan(&exists)
	return exists > 0, err
}

// UnreadRooms — комнаты с сообщениями после отметки прочтения.
func (s *Store) UnreadRooms(userID int64) ([]map[string]any, error) {
	rows, err := s.db.Query(`
		SELECT r.id, MAX(m.id) AS last_id, COALESCE(rs.last_id, 0) AS read_id
		FROM rooms r
		JOIN room_messages m ON m.room_id = r.id
		JOIN hub_members hm ON hm.hub_id = r.hub_id AND hm.user_id = ?
		LEFT JOIN read_state rs ON rs.user_id = ? AND rs.conv = 'room:' || r.id
		GROUP BY r.id
		HAVING last_id > read_id
		ORDER BY last_id DESC`, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []map[string]any{}
	for rows.Next() {
		var roomID, lastID, readID int64
		if err := rows.Scan(&roomID, &lastID, &readID); err != nil {
			return nil, err
		}
		list = append(list, map[string]any{"roomId": roomID, "lastId": lastID, "count": lastID - readID})
	}
	return list, rows.Err()
}

func (s *Store) MarkRoomRead(userID, roomID, lastID int64) error {
	_, err := s.db.Exec(`
		INSERT INTO read_state (user_id, conv, last_id) VALUES (?, ?, ?)
		ON CONFLICT (user_id, conv) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`,
		userID, "room:"+strconv.FormatInt(roomID, 10), lastID)
	return err
}

func (s *Store) SetMessageAttachments(messageID int64, attachments string) (*Message, error) {
	if _, err := s.db.Exec(`UPDATE room_messages SET attachments = ? WHERE id = ?`, attachments, messageID); err != nil {
		return nil, err
	}
	return s.RoomMessageByID(messageID)
}
