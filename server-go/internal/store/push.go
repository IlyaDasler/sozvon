package store

import (
	"strings"
	"time"
)

// SavePushToken привязывает FCM-токен к пользователю. Токен может переехать
// на другой аккаунт после переустановки — тогда владелец обновляется.
func (s *Store) SavePushToken(userID int64, token, platform string) error {
	_, err := s.db.Exec(`
INSERT INTO push_tokens (token, user_id, platform, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id,
  platform = excluded.platform, updated_at = excluded.updated_at`,
		token, userID, platform, time.Now().UnixMilli())
	return err
}

func (s *Store) DeletePushToken(userID int64, token string) error {
	_, err := s.db.Exec(`DELETE FROM push_tokens WHERE user_id = ? AND token = ?`, userID, token)
	return err
}

// PushTokensForUsers возвращает токены для списка получателей.
func (s *Store) PushTokensForUsers(userIDs []int64) ([]string, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	query := `SELECT token FROM push_tokens WHERE user_id IN (?` +
		strings.Repeat(", ?", len(userIDs)-1) + `)`
	args := make([]any, len(userIDs))
	for i, id := range userIDs {
		args[i] = id
	}
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tokens []string
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}
