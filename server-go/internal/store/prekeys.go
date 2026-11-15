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

func (s *Store) PutDevicePrekey(userID int64, deviceHash, signedPrekeyPublic, signature string, createdAt int64) error {
	_, err := s.db.Exec(`
		INSERT INTO device_prekeys (user_id, device_hash, signed_prekey_public, signature, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id, device_hash) DO UPDATE SET
			signed_prekey_public = excluded.signed_prekey_public,
			signature = excluded.signature,
			created_at = excluded.created_at`,
		userID, deviceHash, signedPrekeyPublic, signature, createdAt)
	return err
}

type DevicePrekey struct {
	DeviceHash         string
	SignedPrekeyPublic string
	Signature          string
	CreatedAt          int64
}

func (s *Store) DevicePrekeys(userID int64) ([]DevicePrekey, error) {
	rows, err := s.db.Query(`SELECT device_hash, signed_prekey_public, signature, created_at FROM device_prekeys WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DevicePrekey
	for rows.Next() {
		var item DevicePrekey
		if err := rows.Scan(&item.DeviceHash, &item.SignedPrekeyPublic, &item.Signature, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
