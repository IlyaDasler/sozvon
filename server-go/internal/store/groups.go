package store

import "time"

// Группы комнат и смайлики канала.

func (s *Store) CreateRoomGroup(hubID int64, name string, roomIDs []int64) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO room_groups (hub_id, name) VALUES (?, ?)`, hubID, name)
	if err != nil {
		return 0, err
	}
	groupID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	for _, roomID := range roomIDs {
		if _, err := tx.Exec(`UPDATE rooms SET group_id = ? WHERE id = ? AND hub_id = ?`, groupID, roomID, hubID); err != nil {
			return 0, err
		}
	}
	return groupID, tx.Commit()
}

func (s *Store) RenameRoomGroup(groupID int64, name string) error {
	_, err := s.db.Exec(`UPDATE room_groups SET name = ? WHERE id = ?`, name, groupID)
	return err
}

func (s *Store) DeleteRoomGroup(hubID, groupID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE rooms SET group_id = NULL WHERE hub_id = ? AND group_id = ?`, hubID, groupID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM room_groups WHERE id = ? AND hub_id = ?`, groupID, hubID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SetRoomGroup(roomID int64, groupID *int64) error {
	var value any
	if groupID != nil {
		value = *groupID
	}
	_, err := s.db.Exec(`UPDATE rooms SET group_id = ? WHERE id = ?`, value, roomID)
	return err
}

// DeleteRoomGroupIfEmpty удаляет группу, если в ней не осталось комнат.
func (s *Store) DeleteRoomGroupIfEmpty(hubID, groupID int64) error {
	_, err := s.db.Exec(`DELETE FROM room_groups WHERE id = ? AND hub_id = ? AND NOT EXISTS (SELECT 1 FROM rooms WHERE group_id = ?)`, groupID, hubID, groupID)
	return err
}

func (s *Store) AddHubEmoji(hubID int64, name, file string, byID int64) error {
	_, err := s.db.Exec(`INSERT INTO hub_emojis (hub_id, name, file, created_by) VALUES (?, ?, ?, ?)`, hubID, name, file, byID)
	return err
}

func (s *Store) DeleteHubEmoji(hubID int64, name string) (string, error) {
	var file string
	err := s.db.QueryRow(`SELECT file FROM hub_emojis WHERE hub_id = ? AND name = ?`, hubID, name).Scan(&file)
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(`DELETE FROM hub_emojis WHERE hub_id = ? AND name = ?`, hubID, name)
	return file, err
}

var _ = time.Now

func (s *Store) DeleteHubEmojiByID(hubID, emojiID int64) (string, error) {
	var file string
	err := s.db.QueryRow(`SELECT file FROM hub_emojis WHERE hub_id = ? AND id = ?`, hubID, emojiID).Scan(&file)
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(`DELETE FROM hub_emojis WHERE hub_id = ? AND id = ?`, hubID, emojiID)
	return file, err
}
