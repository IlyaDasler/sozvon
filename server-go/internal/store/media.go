package store

import "time"

func (s *Store) SetUserAvatar(userID int64, avatar string) error {
	_, err := s.db.Exec(`UPDATE users SET avatar = ? WHERE id = ?`, nullIfEmpty(avatar), userID)
	return err
}

func (s *Store) SetUserBanner(userID int64, banner string) error {
	_, err := s.db.Exec(`UPDATE users SET banner = ? WHERE id = ?`, nullIfEmpty(banner), userID)
	return err
}

func (s *Store) SetRoomBackground(roomID int64, background string) error {
	_, err := s.db.Exec(`UPDATE rooms SET background = ? WHERE id = ?`, nullIfEmpty(background), roomID)
	return err
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

var _ = time.Now
