package store

import (
	"database/sql"
	"errors"
)

type PrekeyBundle struct {
	UserID             int64
	SignedPrekeyPublic string
	Signature          string
	OwnerDeviceHash    string
	CreatedAt          int64
}

func (s *Store) PutPrekeyBundle(userID int64, signedPrekeyPublic, signature, ownerDeviceHash string, createdAt int64) error {
	_, err := s.db.Exec(`
		INSERT INTO prekey_bundles (user_id, signed_prekey_public, signature, owner_device_hash, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			signed_prekey_public = excluded.signed_prekey_public,
			signature = excluded.signature,
			owner_device_hash = excluded.owner_device_hash,
			created_at = excluded.created_at`,
		userID, signedPrekeyPublic, signature, ownerDeviceHash, createdAt)
	return err
}

func (s *Store) PrekeyBundle(userID int64) (*PrekeyBundle, error) {
	var b PrekeyBundle
	b.UserID = userID
	err := s.db.QueryRow(
		`SELECT signed_prekey_public, signature, owner_device_hash, created_at FROM prekey_bundles WHERE user_id = ?`,
		userID,
	).Scan(&b.SignedPrekeyPublic, &b.Signature, &b.OwnerDeviceHash, &b.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}
