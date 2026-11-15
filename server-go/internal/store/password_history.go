package store

import "time"

func (s *Store) PasswordHistory(userID int64, limit int) ([]string, error) {
	if limit <= 0 || limit > 10 {
		limit = 5
	}
	rows, err := s.db.Query(
		`SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var hashes []string
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			return nil, err
		}
		hashes = append(hashes, hash)
	}
	return hashes, rows.Err()
}

// rememberPasswordHash сохраняет прежний хеш перед сменой: резервная копия
// ключа могла быть запечатана старым паролем.
func (s *Store) rememberPasswordHash(userID int64, hash string) error {
	if hash == "" {
		return nil
	}
	if _, err := s.db.Exec(
		`INSERT INTO password_history (user_id, password_hash, changed_at) VALUES (?, ?, ?)`,
		userID, hash, time.Now().Unix(),
	); err != nil {
		return err
	}
	_, err := s.db.Exec(
		`DELETE FROM password_history WHERE user_id = ? AND id NOT IN (
			SELECT id FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT 5
		)`, userID, userID,
	)
	return err
}
