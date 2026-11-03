package store

import (
	"database/sql"
	"time"
)

// ---------- ключи переписки ----------

func (s *Store) ConvEpoch(conv string) (int64, error) {
	var epoch sql.NullInt64
	err := s.db.QueryRow(`SELECT MAX(epoch) FROM conv_keys WHERE conv = ?`, conv).Scan(&epoch)
	return epoch.Int64, err
}

func (s *Store) ConvKeyMine(conv string, userID, epoch int64) (string, error) {
	var sealed string
	err := s.db.QueryRow(`SELECT sealed FROM conv_keys WHERE conv = ? AND epoch = ? AND user_id = ?`, conv, epoch, userID).Scan(&sealed)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return sealed, err
}

func (s *Store) ConvKeyHolders(conv string, epoch int64) ([]int64, error) {
	rows, err := s.db.Query(`SELECT user_id FROM conv_keys WHERE conv = ? AND epoch = ?`, conv, epoch)
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

func (s *Store) AddConvKeys(conv string, epoch int64, byID int64, sealed map[int64]string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UnixMilli()
	for userID, envelope := range sealed {
		if _, err := tx.Exec(`
			INSERT INTO conv_keys (conv, epoch, user_id, sealed, by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (conv, epoch, user_id) DO UPDATE SET sealed = excluded.sealed`,
			conv, epoch, userID, envelope, byID, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ConvKeysMine — все версии ключа, запечатанные для этого человека: {epoch: sealed}
func (s *Store) ConvKeysMine(conv string, userID int64) (map[string]string, error) {
	rows, err := s.db.Query(`SELECT epoch, sealed FROM conv_keys WHERE conv = ? AND user_id = ?`, conv, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var epoch int64
		var sealed string
		if err := rows.Scan(&epoch, &sealed); err != nil {
			return nil, err
		}
		key := ""
		for value := epoch; value > 0; value /= 10 {
			key = string(rune('0'+value%10)) + key
		}
		if key == "" {
			key = "0"
		}
		out[key] = sealed
	}
	return out, rows.Err()
}
