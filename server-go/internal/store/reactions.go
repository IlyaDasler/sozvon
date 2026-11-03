package store

import (
	"database/sql"
	"time"
)

type ReactionGroup struct {
	Emoji string
	Count int64
	Mine  bool
}

// ReactionsFor — реакции для набора сообщений: emoji, count, mine.
func (s *Store) ReactionsFor(kind string, messageIDs []int64, viewer int64) (map[int64][]map[string]any, error) {
	out := map[int64][]map[string]any{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(`SELECT message_id, emoji, user_id FROM message_reactions WHERE kind = ?`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	wanted := map[int64]bool{}
	for _, id := range messageIDs {
		wanted[id] = true
	}
	type group struct {
		emoji string
		count int64
		mine  bool
	}
	groups := map[int64]map[string]*group{}
	for rows.Next() {
		var messageID, userID int64
		var emoji string
		if err := rows.Scan(&messageID, &emoji, &userID); err != nil {
			return nil, err
		}
		if !wanted[messageID] {
			continue
		}
		if groups[messageID] == nil {
			groups[messageID] = map[string]*group{}
		}
		item := groups[messageID][emoji]
		if item == nil {
			item = &group{emoji: emoji}
			groups[messageID][emoji] = item
		}
		item.count++
		if userID == viewer {
			item.mine = true
		}
	}
	for messageID, byEmoji := range groups {
		list := make([]map[string]any, 0, len(byEmoji))
		for _, item := range byEmoji {
			list = append(list, map[string]any{"emoji": item.emoji, "count": item.count, "mine": item.mine})
		}
		out[messageID] = list
	}
	return out, nil
}

// ToggleReaction — поставить или снять смайлик, возвращает новое состояние.
func (s *Store) ToggleReaction(kind string, messageID, userID int64, emoji string) ([]map[string]any, error) {
	var exists int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM message_reactions WHERE kind = ? AND message_id = ? AND user_id = ? AND emoji = ?`,
		kind, messageID, userID, emoji).Scan(&exists); err != nil {
		return nil, err
	}
	if exists > 0 {
		if _, err := s.db.Exec(`DELETE FROM message_reactions WHERE kind = ? AND message_id = ? AND user_id = ? AND emoji = ?`,
			kind, messageID, userID, emoji); err != nil {
			return nil, err
		}
	} else {
		if _, err := s.db.Exec(`INSERT INTO message_reactions (kind, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)`,
			kind, messageID, userID, emoji, time.Now().UnixMilli()); err != nil {
			return nil, err
		}
	}
	reactions, err := s.ReactionsFor(kind, []int64{messageID}, userID)
	if err != nil {
		return nil, err
	}
	if list, ok := reactions[messageID]; ok {
		return list, nil
	}
	return []map[string]any{}, nil
}

// ReactionUsers — кто поставил какие реакции (только для тех, кому видно).
func (s *Store) ReactionUsers(kind string, messageID int64) ([]map[string]any, error) {
	rows, err := s.db.Query(`SELECT emoji, user_id FROM message_reactions WHERE kind = ? AND message_id = ? ORDER BY created_at`, kind, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byEmoji := map[string][]int64{}
	order := []string{}
	for rows.Next() {
		var emoji string
		var userID int64
		if err := rows.Scan(&emoji, &userID); err != nil {
			return nil, err
		}
		if byEmoji[emoji] == nil {
			order = append(order, emoji)
		}
		byEmoji[emoji] = append(byEmoji[emoji], userID)
	}
	list := make([]map[string]any, 0, len(order))
	for _, emoji := range order {
		list = append(list, map[string]any{"emoji": emoji, "userIds": byEmoji[emoji]})
	}
	return list, nil
}

// ---------- пины ----------

func (s *Store) PinnedIDs(kind string, chatID int64) ([]int64, error) {
	rows, err := s.db.Query(`SELECT message_id FROM message_pins WHERE kind = ? AND chat_id = ? ORDER BY created_at`, kind, chatID)
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
	return ids, nil
}

func (s *Store) PinnedSet(kind string, chatID int64) (map[int64]bool, error) {
	ids, err := s.PinnedIDs(kind, chatID)
	if err != nil {
		return nil, err
	}
	set := make(map[int64]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	return set, nil
}

func (s *Store) AddPin(kind string, chatID, messageID, byID int64) error {
	_, err := s.db.Exec(`
		INSERT INTO message_pins (kind, chat_id, message_id, by_id, created_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (kind, message_id) DO NOTHING`, kind, chatID, messageID, byID, time.Now().UnixMilli())
	return err
}

func (s *Store) RemovePin(kind string, messageID int64) error {
	_, err := s.db.Exec(`DELETE FROM message_pins WHERE kind = ? AND message_id = ?`, kind, messageID)
	return err
}

// ---------- правка и удаление ----------

func (s *Store) SetMessageEnc(messageID int64, enc string) (*Message, error) {
	if _, err := s.db.Exec(`UPDATE room_messages SET enc = ?, edited_at = ? WHERE id = ?`, enc, time.Now().UnixMilli(), messageID); err != nil {
		return nil, err
	}
	return s.RoomMessageByID(messageID)
}

func (s *Store) DeleteMessage(messageID int64) error {
	result, err := s.db.Exec(`DELETE FROM room_messages WHERE id = ?`, messageID)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return sql.ErrNoRows
	}
	_, _ = s.db.Exec(`DELETE FROM message_reactions WHERE kind = 'room' AND message_id = ?`, messageID)
	_, _ = s.db.Exec(`DELETE FROM message_pins WHERE kind = 'room' AND message_id = ?`, messageID)
	return nil
}

func (s *Store) MessageRoom(messageID int64) (int64, int64, error) {
	var roomID, fromID int64
	err := s.db.QueryRow(`SELECT room_id, from_id FROM room_messages WHERE id = ?`, messageID).Scan(&roomID, &fromID)
	return roomID, fromID, err
}
