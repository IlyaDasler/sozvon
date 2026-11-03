package store

import "time"

// Кик на время: до какого момента участник только читает комнату.

func (s *Store) SetRoomTimeout(roomID, userID int64, seconds int64) error {
	until := time.Now().UnixMilli() + seconds*1000
	_, err := s.db.Exec(`UPDATE room_members SET timeout_until = ? WHERE room_id = ? AND user_id = ?`, until, roomID, userID)
	return err
}

func (s *Store) ClearRoomTimeout(roomID, userID int64) error {
	_, err := s.db.Exec(`UPDATE room_members SET timeout_until = NULL WHERE room_id = ? AND user_id = ?`, roomID, userID)
	return err
}

func (s *Store) RoomTimeout(roomID, userID int64) (int64, error) {
	var until *int64
	err := s.db.QueryRow(`SELECT timeout_until FROM room_members WHERE room_id = ? AND user_id = ?`, roomID, userID).Scan(&until)
	if err != nil || until == nil {
		return 0, err
	}
	return *until, nil
}
