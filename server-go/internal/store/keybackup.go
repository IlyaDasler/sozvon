package store

import (
	"database/sql"
	"errors"
)

// KeyBackup — ключ шифрования пользователя, запечатанный паролем на клиенте.
// Сервер не знает пароль и не может открыть этот blob.
type KeyBackup struct {
	Salt       string
	IV         string
	CT         string
	Iterations int
	UpdatedAt  int64
}

func (s *Store) KeyBackup(userID int64) (*KeyBackup, error) {
	var b KeyBackup
	err := s.db.QueryRow(
		`SELECT salt, iv, ct, iterations, updated_at FROM key_backups WHERE user_id = ?`,
		userID,
	).Scan(&b.Salt, &b.IV, &b.CT, &b.Iterations, &b.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func (s *Store) PutKeyBackup(userID int64, b KeyBackup) error {
	_, err := s.db.Exec(`
		INSERT INTO key_backups (user_id, salt, iv, ct, iterations, updated_at)
		VALUES (?, ?, ?, ?, ?, unixepoch())
		ON CONFLICT(user_id) DO UPDATE SET
			salt = excluded.salt,
			iv = excluded.iv,
			ct = excluded.ct,
			iterations = excluded.iterations,
			updated_at = unixepoch()`,
		userID, b.Salt, b.IV, b.CT, b.Iterations)
	return err
}
