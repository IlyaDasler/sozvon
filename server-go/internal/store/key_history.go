package store

import "time"

type KeyHistoryEvent struct {
	PublicKey string    `json:"publicKey"`
	ChangedAt time.Time `json:"changedAt"`
}

func (s *Store) RecordKeyHistory(userID int64, publicKey string) error {
	_, err := s.db.Exec(
		`INSERT INTO user_key_history (user_id, public_key, changed_at) VALUES (?, ?, ?)`,
		userID, publicKey, time.Now().Unix(),
	)
	return err
}

func (s *Store) KeyHistory(userID int64) ([]KeyHistoryEvent, error) {
	rows, err := s.db.Query(
		`SELECT public_key, changed_at FROM user_key_history WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []KeyHistoryEvent
	for rows.Next() {
		var key string
		var at int64
		if err := rows.Scan(&key, &at); err != nil {
			return nil, err
		}
		items = append(items, KeyHistoryEvent{PublicKey: key, ChangedAt: time.Unix(at, 0)})
	}
	return items, rows.Err()
}
