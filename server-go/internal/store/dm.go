package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"time"
)

// Личные сообщения между двумя людьми.

type DMMessage struct {
	ID          int64
	FromID      int64
	ToID        int64
	Text        string
	CreatedAt   int64
	Attachments string
	Preview     string
	Enc         string
	ReplyTo     *int64
	EditedAt    *int64
	ThreadRoot  *int64
	MentionAll  bool
}

func scanDM(row interface{ Scan(...any) error }) (*DMMessage, error) {
	var message DMMessage
	var replyTo, editedAt, threadRoot sql.NullInt64
	var attachments, preview, enc sql.NullString
	var mentionAll int
	err := row.Scan(&message.ID, &message.FromID, &message.ToID, &message.Text, &message.CreatedAt,
		&attachments, &preview, &enc, &replyTo, &editedAt, &threadRoot)
	if err != nil {
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
	message.MentionAll = mentionAll != 0
	return &message, nil
}

const dmColumns = `id, from_id, to_id, text, created_at, attachments, preview, enc, reply_to, edited_at, thread_root`

func (s *Store) InsertDM(fromID, toID int64, text, attachments, preview, enc string, replyTo *int64) (*DMMessage, error) {
	result, err := s.db.Exec(`
		INSERT INTO messages (from_id, to_id, text, created_at, attachments, preview, enc, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		fromID, toID, text, time.Now().UnixMilli(), attachments, preview, enc, replyTo)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.DMByID(id)
}

func (s *Store) DMByID(id int64) (*DMMessage, error) {
	row := s.db.QueryRow(`SELECT `+dmColumns+` FROM messages WHERE id = ?`, id)
	message, err := scanDM(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return message, nil
}

func (s *Store) DMHistory(a, b int64, beforeID int64, limit int) ([]*DMMessage, error) {
	if beforeID == 0 {
		beforeID = 1 << 62
	}
	rows, err := s.db.Query(`
		SELECT `+dmColumns+` FROM messages
		WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id < ?
		ORDER BY id DESC LIMIT ?`, a, b, b, a, beforeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []*DMMessage
	for rows.Next() {
		message, err := scanDM(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, message)
	}
	// Как в Node: отдаём по возрастанию
	for left, right := 0, len(list)-1; left < right; left, right = left+1, right-1 {
		list[left], list[right] = list[right], list[left]
	}
	return list, rows.Err()
}

func (s *Store) SetDMEnc(id int64, enc string) (*DMMessage, error) {
	if _, err := s.db.Exec(`UPDATE messages SET enc = ?, text = '', edited_at = ? WHERE id = ?`, enc, time.Now().UnixMilli(), id); err != nil {
		return nil, err
	}
	return s.DMByID(id)
}

func (s *Store) DeleteDM(id int64) error {
	_, err := s.db.Exec(`DELETE FROM messages WHERE id = ?`, id)
	return err
}

func dmAttachmentJSON(raw string) []map[string]any {
	if raw == "" {
		return []map[string]any{}
	}
	var list []map[string]any
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		return []map[string]any{}
	}
	return list
}

// DMPinnedIDs — закреплённые сообщения переписки.
func (s *Store) DMPinnedIDs(a, b int64) ([]int64, error) {
	rows, err := s.db.Query(`
		SELECT p.message_id FROM message_pins p
		JOIN messages m ON m.id = p.message_id
		WHERE p.kind = 'dm' AND ((m.from_id = ? AND m.to_id = ?) OR (m.from_id = ? AND m.to_id = ?))
		ORDER BY p.created_at`, a, b, b, a)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// UnreadDM — непрочитанные личные переписки: [{peerId,count,lastId}]
func (s *Store) UnreadDM(userID int64) ([]map[string]any, error) {
	rows, err := s.db.Query(`
		SELECT peer, MAX(id) AS last_id,
		       (SELECT COALESCE(last_id, 0) FROM read_state WHERE user_id = ? AND conv = 'dm:' || peer) AS read_id
		FROM (
			SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS peer, id
			FROM messages WHERE from_id = ? OR to_id = ?
		)
		GROUP BY peer`, userID, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []map[string]any{}
	for rows.Next() {
		var peer, lastID, readID int64
		if err := rows.Scan(&peer, &lastID, &readID); err != nil {
			return nil, err
		}
		if lastID <= readID {
			continue
		}
		var count int64
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM messages WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id > ?`,
			peer, userID, userID, peer, readID).Scan(&count); err != nil {
			return nil, err
		}
		list = append(list, map[string]any{"peerId": peer, "count": count, "lastId": lastID})
	}
	return list, rows.Err()
}

func (s *Store) MarkDMRead(userID, peerID int64) error {
	var lastID int64
	if err := s.db.QueryRow(`SELECT COALESCE(MAX(id), 0) FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)`,
		userID, peerID, peerID, userID).Scan(&lastID); err != nil {
		return err
	}
	_, err := s.db.Exec(`
		INSERT INTO read_state (user_id, conv, last_id) VALUES (?, ?, ?)
		ON CONFLICT (user_id, conv) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`,
		userID, "dm:"+strconv.FormatInt(peerID, 10), lastID)
	return err
}
