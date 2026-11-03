package store

import (
	"database/sql"
	"errors"
)

type Upload struct {
	ID      string
	OwnerID int64
	Name    string
	Mime    string
	Size    int64
	Kind    string
	Used    bool
}

func (s *Store) CreateUpload(id string, ownerID int64, name, mime string, size int64, kind string) (*Upload, error) {
	_, err := s.db.Exec(`
		INSERT INTO uploads (id, owner_id, name, mime, size, kind, used, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, unixepoch())`,
		id, ownerID, name, mime, size, kind)
	if err != nil {
		return nil, err
	}
	return s.UploadByID(id)
}

func (s *Store) UploadByID(id string) (*Upload, error) {
	var upload Upload
	var used int
	err := s.db.QueryRow(`SELECT id, owner_id, name, mime, size, kind, used FROM uploads WHERE id = ?`, id).
		Scan(&upload.ID, &upload.OwnerID, &upload.Name, &upload.Mime, &upload.Size, &upload.Kind, &used)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	upload.Used = used != 0
	return &upload, nil
}

func (s *Store) MarkUploadUsed(id string) error {
	_, err := s.db.Exec(`UPDATE uploads SET used = 1 WHERE id = ?`, id)
	return err
}
