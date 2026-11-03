package store

import (
	"database/sql"
	"errors"
	"time"
)

// ---------- участники канала ----------

func (s *Store) HubIsManager(hubID, userID int64) (bool, error) {
	var owner int64
	if err := s.db.QueryRow(`SELECT owner_id FROM hubs WHERE id = ?`, hubID).Scan(&owner); err != nil {
		return false, err
	}
	if owner == userID {
		return true, nil
	}
	var manager int
	err := s.db.QueryRow(`SELECT manager FROM hub_members WHERE hub_id = ? AND user_id = ?`, hubID, userID).Scan(&manager)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return manager != 0, err
}

func (s *Store) AddHubMember(hubID, userID int64) error {
	_, err := s.db.Exec(`INSERT OR IGNORE INTO hub_members (hub_id, user_id, manager, created_at) VALUES (?, ?, 0, ?)`, hubID, userID, time.Now().UnixMilli())
	return err
}

// RemoveHubMember — убирает из канала и из всех его комнат.
func (s *Store) RemoveHubMember(hubID, userID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM hub_members WHERE hub_id = ? AND user_id = ?`, hubID, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM room_members WHERE user_id = ? AND room_id IN (SELECT id FROM rooms WHERE hub_id = ?)`, userID, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM hub_nicknames WHERE hub_id = ? AND user_id = ?`, hubID, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SetHubManager(hubID, userID int64, manager bool) error {
	value := 0
	if manager {
		value = 1
	}
	_, err := s.db.Exec(`UPDATE hub_members SET manager = ? WHERE hub_id = ? AND user_id = ?`, value, hubID, userID)
	return err
}

func (s *Store) AssignHubRole(hubID, userID, roleID int64) error {
	var value any
	if roleID != 0 {
		value = roleID
	}
	_, err := s.db.Exec(`UPDATE hub_members SET role_id = ? WHERE hub_id = ? AND user_id = ?`, value, hubID, userID)
	return err
}

func (s *Store) SetHubNickname(hubID, userID int64, name string) error {
	if name == "" {
		_, err := s.db.Exec(`DELETE FROM hub_nicknames WHERE hub_id = ? AND user_id = ?`, hubID, userID)
		return err
	}
	_, err := s.db.Exec(`
		INSERT INTO hub_nicknames (hub_id, user_id, name) VALUES (?, ?, ?)
		ON CONFLICT (hub_id, user_id) DO UPDATE SET name = excluded.name`, hubID, userID, name)
	return err
}

// ---------- приглашения и баны канала ----------

func (s *Store) InviteToHub(hubID int64, byID int64, userIDs []int64) error {
	now := time.Now().UnixMilli()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, userID := range userIDs {
		var member int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM hub_members WHERE hub_id = ? AND user_id = ?`, hubID, userID).Scan(&member); err != nil {
			return err
		}
		if member > 0 {
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO hub_invites (hub_id, user_id, by_id, created_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (hub_id, user_id) DO UPDATE SET by_id = excluded.by_id, created_at = excluded.created_at`,
			hubID, userID, byID, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) AcceptHubInvite(hubID, userID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM hub_invites WHERE hub_id = ? AND user_id = ?`, hubID, userID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(`DELETE FROM hub_invites WHERE hub_id = ? AND user_id = ?`, hubID, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT OR IGNORE INTO hub_members (hub_id, user_id, manager, created_at) VALUES (?, ?, 0, ?)`, hubID, userID, time.Now().UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeclineHubInvite(hubID, userID int64) error {
	_, err := s.db.Exec(`DELETE FROM hub_invites WHERE hub_id = ? AND user_id = ?`, hubID, userID)
	return err
}

func (s *Store) BanFromHub(hubID, userID, byID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`
		INSERT INTO hub_bans (hub_id, user_id, by_id, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (hub_id, user_id) DO NOTHING`, hubID, userID, byID, time.Now().UnixMilli()); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM hub_members WHERE hub_id = ? AND user_id = ?`, hubID, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM room_members WHERE user_id = ? AND room_id IN (SELECT id FROM rooms WHERE hub_id = ?)`, userID, hubID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UnbanFromHub(hubID, userID int64) error {
	_, err := s.db.Exec(`DELETE FROM hub_bans WHERE hub_id = ? AND user_id = ?`, hubID, userID)
	return err
}

// ---------- роли канала ----------

func (s *Store) CreateHubRole(hubID int64, name, color string, perms int64) (int64, error) {
	result, err := s.db.Exec(`INSERT INTO hub_roles (hub_id, name, color, perms, created_at) VALUES (?, ?, ?, ?, ?)`, hubID, name, color, perms, time.Now().UnixMilli())
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) UpdateHubRole(hubID, roleID int64, name, color *string, perms *int64) error {
	if name != nil {
		if _, err := s.db.Exec(`UPDATE hub_roles SET name = ? WHERE id = ? AND hub_id = ?`, *name, roleID, hubID); err != nil {
			return err
		}
	}
	if color != nil {
		if _, err := s.db.Exec(`UPDATE hub_roles SET color = ? WHERE id = ? AND hub_id = ?`, *color, roleID, hubID); err != nil {
			return err
		}
	}
	if perms != nil {
		if _, err := s.db.Exec(`UPDATE hub_roles SET perms = ? WHERE id = ? AND hub_id = ?`, *perms, roleID, hubID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteHubRole(hubID, roleID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE hub_members SET role_id = NULL WHERE hub_id = ? AND role_id = ?`, hubID, roleID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM hub_roles WHERE id = ? AND hub_id = ?`, roleID, hubID); err != nil {
		return err
	}
	return tx.Commit()
}

// ---------- комнаты ----------

func (s *Store) DeleteRoom(roomID int64) error {
	_, err := s.db.Exec(`DELETE FROM rooms WHERE id = ?`, roomID)
	return err
}

func (s *Store) BanFromRoom(roomID, userID, byID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`
		INSERT INTO room_bans (room_id, user_id, by_id, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (room_id, user_id) DO NOTHING`, roomID, userID, byID, time.Now().UnixMilli()); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`, roomID, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UnbanFromRoom(roomID, userID int64) error {
	_, err := s.db.Exec(`DELETE FROM room_bans WHERE room_id = ? AND user_id = ?`, roomID, userID)
	return err
}

func (s *Store) RemoveRoomMember(roomID, userID int64) error {
	_, err := s.db.Exec(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`, roomID, userID)
	return err
}

func (s *Store) AssignRoomRole(roomID, userID, roleID int64) error {
	var value any
	if roleID != 0 {
		value = roleID
	}
	_, err := s.db.Exec(`UPDATE room_members SET role_id = ? WHERE room_id = ? AND user_id = ?`, value, roomID, userID)
	return err
}

func (s *Store) EnsureRoomMember(roomID, userID int64) error {
	_, err := s.db.Exec(`INSERT OR IGNORE INTO room_members (room_id, user_id, created_at) VALUES (?, ?, ?)`, roomID, userID, time.Now().UnixMilli())
	return err
}

func (s *Store) CreateRoomRole(roomID int64, name, color string, perms int64) (int64, error) {
	result, err := s.db.Exec(`INSERT INTO room_roles (room_id, name, color, perms, created_at) VALUES (?, ?, ?, ?, ?)`, roomID, name, color, perms, time.Now().UnixMilli())
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) DeleteRoomRole(roomID, roleID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE room_members SET role_id = NULL WHERE room_id = ? AND role_id = ?`, roomID, roleID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM room_roles WHERE id = ? AND room_id = ?`, roleID, roomID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UpdateRoomRole(roomID, roleID int64, name, color *string, perms *int64) error {
	if name != nil {
		if _, err := s.db.Exec(`UPDATE room_roles SET name = ? WHERE id = ? AND room_id = ?`, *name, roleID, roomID); err != nil {
			return err
		}
	}
	if color != nil {
		if _, err := s.db.Exec(`UPDATE room_roles SET color = ? WHERE id = ? AND room_id = ?`, *color, roleID, roomID); err != nil {
			return err
		}
	}
	if perms != nil {
		if _, err := s.db.Exec(`UPDATE room_roles SET perms = ? WHERE id = ? AND room_id = ?`, *perms, roleID, roomID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) RoomOwner(roomID int64) (int64, error) {
	var owner int64
	err := s.db.QueryRow(`SELECT owner_id FROM rooms WHERE id = ?`, roomID).Scan(&owner)
	return owner, err
}
