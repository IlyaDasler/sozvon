package store

import "time"

type SecurityEvent struct {
	ID        int64     `json:"id"`
	Kind      string    `json:"kind"`
	Detail    string    `json:"detail"`
	IP        string    `json:"ip"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *Store) AddSecurityEvent(userID int64, kind, detail, ip string) error {
	_, err := s.db.Exec(
		`INSERT INTO security_events (user_id, kind, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)`,
		userID, kind, detail, ip, time.Now().Unix(),
	)
	return err
}

func (s *Store) SecurityEvents(userID int64) ([]SecurityEvent, error) {
	rows, err := s.db.Query(
		`SELECT id, kind, detail, ip, created_at FROM security_events WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []SecurityEvent
	for rows.Next() {
		var item SecurityEvent
		var at int64
		if err := rows.Scan(&item.ID, &item.Kind, &item.Detail, &item.IP, &at); err != nil {
			return nil, err
		}
		item.CreatedAt = time.Unix(at, 0)
		list = append(list, item)
	}
	return list, rows.Err()
}
