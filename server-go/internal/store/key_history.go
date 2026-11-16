package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

type KeyHistoryEvent struct {
	PublicKey string    `json:"publicKey"`
	PrevHash  string    `json:"prevHash"`
	EntryHash string    `json:"entryHash"`
	Signature string    `json:"signature"`
	ChangedAt time.Time `json:"changedAt"`
}

func keyHistoryHash(prev string, userID int64, publicKey string, at int64) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%s|%d", prev, userID, publicKey, at)))
	return hex.EncodeToString(sum[:])
}

func (s *Store) RecordKeyHistory(userID int64, publicKey string, sign func(entryHash string) string) error {
	var prev string
	_ = s.db.QueryRow(`SELECT entry_hash FROM user_key_history WHERE user_id = ? ORDER BY id DESC LIMIT 1`, userID).Scan(&prev)
	at := time.Now().Unix()
	hash := keyHistoryHash(prev, userID, publicKey, at)
	signature := ""
	if sign != nil {
		signature = sign(hash)
	}
	_, err := s.db.Exec(
		`INSERT INTO user_key_history (user_id, public_key, prev_hash, entry_hash, signature, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
		userID, publicKey, prev, hash, signature, at,
	)
	return err
}

func (s *Store) KeyHistory(userID int64) ([]KeyHistoryEvent, error) {
	rows, err := s.db.Query(
		`SELECT public_key, prev_hash, entry_hash, signature, changed_at FROM user_key_history WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []KeyHistoryEvent
	for rows.Next() {
		var key, prevHash, entryHash, signature string
		var at int64
		if err := rows.Scan(&key, &prevHash, &entryHash, &signature, &at); err != nil {
			return nil, err
		}
		items = append(items, KeyHistoryEvent{PublicKey: key, PrevHash: prevHash, EntryHash: entryHash, Signature: signature, ChangedAt: time.Unix(at, 0)})
	}
	return items, rows.Err()
}

type KeyHistoryExportRow struct {
	UserID    int64
	PublicKey string
	PrevHash  string
	EntryHash string
	Signature string
	ChangedAt int64
}

func (s *Store) AllKeyHistory() ([]KeyHistoryExportRow, error) {
	rows, err := s.db.Query(`SELECT user_id, public_key, prev_hash, entry_hash, signature, changed_at FROM user_key_history ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []KeyHistoryExportRow
	for rows.Next() {
		var item KeyHistoryExportRow
		if err := rows.Scan(&item.UserID, &item.PublicKey, &item.PrevHash, &item.EntryHash, &item.Signature, &item.ChangedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

type UserKeyHead struct {
	ID        int64
	PublicKey string
}

func (s *Store) UsersMissingKeyHistory() ([]UserKeyHead, error) {
	rows, err := s.db.Query(`
		SELECT u.id, u.public_key FROM users u
		WHERE u.public_key <> '' AND NOT EXISTS (
			SELECT 1 FROM user_key_history h WHERE h.user_id = u.id
		)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserKeyHead
	for rows.Next() {
		var item UserKeyHead
		if err := rows.Scan(&item.ID, &item.PublicKey); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
