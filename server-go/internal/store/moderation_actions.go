package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// UserIdentifiers — только то, что нужно для blacklist. Наружу не отдаётся.
type UserIdentifiers struct {
	Username  string
	Email     string
	PhoneHMAC string
	OAuthIDs  []string
	Devices   []string
	IPHashes  []string
}

func (s *Store) UserIdentifiers(userID int64) (*UserIdentifiers, error) {
	var out UserIdentifiers
	err := s.db.QueryRow(`SELECT username, COALESCE(email, ''), COALESCE(phone_hmac, '') FROM users WHERE id = ?`, userID).
		Scan(&out.Username, &out.Email, &out.PhoneHMAC)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT provider_user_id FROM identities WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			rows.Close()
			return nil, err
		}
		out.OAuthIDs = append(out.OAuthIDs, value)
	}
	rows.Close()
	rows, err = s.db.Query(`SELECT COALESCE(device_key_hash, '') FROM sessions WHERE user_id = ? AND COALESCE(device_key_hash, '') <> ''`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			rows.Close()
			return nil, err
		}
		out.Devices = append(out.Devices, value)
	}
	rows.Close()
	// IP-хеши уже хранятся в сессиях только как хеши; сырых IP в базе нет.
	rows, err = s.db.Query(`SELECT DISTINCT COALESCE(ip_hash, '') FROM sessions WHERE user_id = ? AND COALESCE(ip_hash, '') <> ''`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			rows.Close()
			return nil, err
		}
		out.IPHashes = append(out.IPHashes, value)
	}
	rows.Close()
	return &out, rows.Err()
}

// PurgeUser удаляет серверную историю и ключи, оставляя tombstone для аудита.
// Сообщения пользователя в чужих каналах сохраняются: удаляются только его
// личные переписки, принадлежащие ему каналы и служебные записи.
func (s *Store) PurgeUser(userID, by int64, reason string) error {
	now := time.Now().UnixMilli()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Личные переписки пользователя на сервере.
	if _, err := tx.Exec(`DELETE FROM messages WHERE from_id = ? OR to_id = ?`, userID, userID); err != nil {
		return err
	}
	// Принадлежащие пользователю каналы и их комнаты.
	roomIDs, err := userRoomIDs(tx, userID)
	if err != nil {
		return err
	}
	for _, roomID := range roomIDs {
		if _, err := tx.Exec(`DELETE FROM rooms WHERE id = ?`, roomID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM hubs WHERE owner_id = ?`, userID); err != nil {
		return err
	}
	// Сообщения в чужих каналах остаются. Убираем только реакции/пины самого пользователя.
	for _, query := range []string{
		`DELETE FROM message_reactions WHERE user_id = ?`,
		`DELETE FROM message_pins WHERE by_id = ?`,
		`DELETE FROM contacts WHERE user_id = ? OR contact_id = ?`,
		`DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?`,
		`DELETE FROM blocks WHERE user_id = ? OR blocked_id = ?`,
		`DELETE FROM read_state WHERE user_id = ?`,
		`DELETE FROM key_backups WHERE user_id = ?`,
		`DELETE FROM prekey_bundles WHERE user_id = ?`,
		`DELETE FROM device_prekeys WHERE user_id = ?`,
		`DELETE FROM user_key_history WHERE user_id = ?`,
		`DELETE FROM identities WHERE user_id = ?`,
		`DELETE FROM sessions WHERE user_id = ?`,
		`DELETE FROM uploads WHERE owner_id = ?`,
		`DELETE FROM admin_sessions WHERE user_id = ?`,
	} {
		if _, err := tx.Exec(query, userID, userID); err != nil {
			// У части таблиц только один плейсхолдер — повторяем с одним аргументом.
			if _, retryErr := tx.Exec(query, userID); retryErr != nil {
				return fmt.Errorf("purge: %w", retryErr)
			}
		}
	}
	_, err = tx.Exec(`UPDATE users SET
		password_hash = '!', email = NULL, phone_hmac = NULL, public_key = NULL,
		totp_secret = NULL, totp_pending = NULL, totp_recovery = NULL, totp_last_step = 0,
		bio = '', avatar = NULL, banner = NULL, game = '', status = 'offline',
		banned_at = ?, banned_by = ?, ban_reason = ?, suspended_at = NULL, suspended_by = NULL,
		suspended_reason = '', deleted_at = NULL
		WHERE id = ?`, now, by, reason, userID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func userRoomIDs(tx *sql.Tx, userID int64) ([]int64, error) {
	rows, err := tx.Query(`SELECT id FROM rooms WHERE owner_id = ?`, userID)
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

// RestoreBannedUser снимает бан и возвращает пустой аккаунт. История и ключи не восстанавливаются.
func (s *Store) RestoreBannedUser(userID int64, passwordHash string) error {
	res, err := s.db.Exec(`UPDATE users SET banned_at = NULL, banned_by = NULL, ban_reason = '',
		restored_at = unixepoch() * 1000, password_hash = ?, deleted_at = NULL,
		public_key = NULL, email = NULL, phone_hmac = NULL,
		totp_secret = NULL, totp_pending = NULL, totp_recovery = NULL, totp_last_step = 0,
		avatar = NULL, banner = NULL, bio = '', game = '', status = 'offline'
		WHERE id = ? AND banned_at IS NOT NULL`, passwordHash, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteChannel(kind string, id int64) error {
	var res sql.Result
	var err error
	switch kind {
	case "hub":
		res, err = s.db.Exec(`DELETE FROM hubs WHERE id = ?`, id)
	case "room":
		res, err = s.db.Exec(`DELETE FROM rooms WHERE id = ?`, id)
	default:
		return fmt.Errorf("invalid channel kind")
	}
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CreateApproval(action, targetType string, targetID int64, payload, reason string, requestedBy int64) (int64, error) {
	now := time.Now().UnixMilli()
	res, err := s.db.Exec(`INSERT INTO admin_approvals (action, target_type, target_id, payload, reason, requested_by, requested_at, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`, action, targetType, targetID, payload, reason, requestedBy, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) AdminApprovals(status string, limit int) ([]AdminApproval, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := `SELECT id, action, target_type, target_id, payload, reason, requested_by, requested_at, status,
		COALESCE(approved_by, 0), COALESCE(approved_at, 0), resolution FROM admin_approvals`
	args := []any{}
	if status != "" {
		query += ` WHERE status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []AdminApproval
	for rows.Next() {
		var item AdminApproval
		if err := rows.Scan(&item.ID, &item.Action, &item.TargetType, &item.TargetID, &item.Payload, &item.Reason, &item.RequestedBy, &item.RequestedAt, &item.Status, &item.ApprovedBy, &item.ApprovedAt, &item.Resolution); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) AdminApprovalByID(id int64) (*AdminApproval, error) {
	var item AdminApproval
	err := s.db.QueryRow(`SELECT id, action, target_type, target_id, payload, reason, requested_by, requested_at, status,
		COALESCE(approved_by, 0), COALESCE(approved_at, 0), resolution FROM admin_approvals WHERE id = ?`, id).
		Scan(&item.ID, &item.Action, &item.TargetType, &item.TargetID, &item.Payload, &item.Reason, &item.RequestedBy, &item.RequestedAt, &item.Status, &item.ApprovedBy, &item.ApprovedAt, &item.Resolution)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *Store) ResolveApproval(id int64, approved bool, by int64, resolution string) error {
	status := "rejected"
	if approved {
		status = "approved"
	}
	res, err := s.db.Exec(`UPDATE admin_approvals SET status = ?, approved_by = ?, approved_at = ?, resolution = ?
		WHERE id = ? AND status = 'pending'`, status, by, time.Now().UnixMilli(), resolution, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CancelApproval(id, by int64) error {
	res, err := s.db.Exec(`UPDATE admin_approvals SET status = 'cancelled', approved_by = ?, approved_at = ?, resolution = 'cancelled'
		WHERE id = ? AND status = 'pending' AND requested_by = ?`, by, time.Now().UnixMilli(), id, by)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CreateReport(reporterID int64, targetType string, targetID int64, category, reason string) (int64, error) {
	now := time.Now().UnixMilli()
	res, err := s.db.Exec(`INSERT INTO moderation_reports (reporter_id, target_type, target_id, category, reason, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`, reporterID, targetType, targetID, category, reason, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) ModerationReports(status string, limit int) ([]ModerationReport, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := `SELECT id, COALESCE(reporter_id, 0), target_type, target_id, category, reason, status, created_at,
		COALESCE(resolved_by, 0), COALESCE(resolved_at, 0), resolution FROM moderation_reports`
	args := []any{}
	if status != "" {
		query += ` WHERE status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []ModerationReport
	for rows.Next() {
		var item ModerationReport
		if err := rows.Scan(&item.ID, &item.ReporterID, &item.TargetType, &item.TargetID, &item.Category, &item.Reason, &item.Status, &item.CreatedAt, &item.ResolvedBy, &item.ResolvedAt, &item.Resolution); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) ResolveReport(id int64, by int64, status, resolution string) error {
	if status != "resolved" && status != "rejected" {
		return fmt.Errorf("invalid report status")
	}
	res, err := s.db.Exec(`UPDATE moderation_reports SET status = ?, resolved_by = ?, resolved_at = ?, resolution = ?
		WHERE id = ? AND status = 'open'`, status, by, time.Now().UnixMilli(), resolution, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CreateAppeal(username, contact, reason string) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO moderation_appeals (username, contact, reason, created_at) VALUES (?, ?, ?, ?)`, username, contact, reason, time.Now().UnixMilli())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) Appeals(status string, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := `SELECT id, username, contact, reason, status, created_at, COALESCE(resolved_by,0), COALESCE(resolved_at,0), resolution FROM moderation_appeals`
	args := []any{}
	if status != "" {
		query += ` WHERE status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, created, resolvedBy, resolvedAt int64
		var username, contact, reason, statusValue, resolution string
		if err := rows.Scan(&id, &username, &contact, &reason, &statusValue, &created, &resolvedBy, &resolvedAt, &resolution); err != nil {
			return nil, err
		}
		list = append(list, map[string]any{"id": id, "username": username, "contact": contact, "reason": reason, "status": statusValue, "createdAt": created, "resolvedBy": resolvedBy, "resolvedAt": resolvedAt, "resolution": resolution})
	}
	return list, rows.Err()
}

func (s *Store) ResolveAppeal(id, by int64, status, resolution string) error {
	if status != "accepted" && status != "rejected" {
		return fmt.Errorf("invalid appeal status")
	}
	res, err := s.db.Exec(`UPDATE moderation_appeals SET status = ?, resolved_by = ?, resolved_at = ?, resolution = ? WHERE id = ? AND status = 'open'`, status, by, time.Now().UnixMilli(), resolution, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func jsonPayload(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}
