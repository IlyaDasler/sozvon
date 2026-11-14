package store

// SoftDeleteUser оставляет аккаунт и всю историю на 30 дней.
func (s *Store) SoftDeleteUser(userID, at int64) error {
	res, err := s.db.Exec(`UPDATE users SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, at, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RestoreUser(userID int64) error {
	res, err := s.db.Exec(`UPDATE users SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeletedUserIDsBefore(cutoff int64) ([]int64, error) {
	rows, err := s.db.Query(`SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at <= ?`, cutoff)
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

// PurgeDeletedUsers окончательно удаляет аккаунты и всё, что на них ссылается.
// Внешние ключи в схеме — ON DELETE CASCADE, поэтому одна транзакция убирает
// профиль, сообщения, участие в каналах, комнаты владельца, ключи и сессии.
func (s *Store) PurgeDeletedUsers(cutoff int64) (int, error) {
	ids, err := s.DeletedUserIDsBefore(cutoff)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	removed := 0
	for _, id := range ids {
		res, err := tx.Exec(`DELETE FROM users WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at <= ?`, id, cutoff)
		if err != nil {
			return removed, err
		}
		n, _ := res.RowsAffected()
		removed += int(n)
	}
	if err := tx.Commit(); err != nil {
		return removed, err
	}
	return removed, nil
}

func (s *Store) UploadIDs() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT id FROM uploads`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[id] = true
	}
	return ids, rows.Err()
}

func (s *Store) MediaNames() (map[string]bool, error) {
	names := map[string]bool{}
	for _, query := range []string{
		`SELECT avatar FROM users WHERE COALESCE(avatar, '') <> ''`,
		`SELECT banner FROM users WHERE COALESCE(banner, '') <> ''`,
		`SELECT background FROM rooms WHERE COALESCE(background, '') <> ''`,
		`SELECT icon FROM hubs WHERE COALESCE(icon, '') <> ''`,
	} {
		rows, err := s.db.Query(query)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				return nil, err
			}
			names[name] = true
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return names, nil
}
