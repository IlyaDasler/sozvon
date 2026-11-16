package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// AdminRole — активная глобальная роль. Пока поддерживаются super_admin и moderator.
type AdminRole struct {
	ID          int64
	UserID      int64
	Role        string
	Permissions int64
	GrantedBy   int64
	GrantedAt   int64
	ExpiresAt   int64
}

func (r AdminRole) IsSuper() bool { return r.Role == "super_admin" }

// Can проверяет конкретное право. super_admin проходит всё.
func (r AdminRole) Can(permission int64) bool {
	return r.IsSuper() || r.Permissions&permission != 0
}

const (
	AdminPermUsersView    int64 = 1 << 0
	AdminPermUsersBan     int64 = 1 << 1
	AdminPermUsersDelete  int64 = 1 << 2
	AdminPermChannelsView int64 = 1 << 3
	AdminPermChannelsEdit int64 = 1 << 4
	AdminPermReports      int64 = 1 << 5
	AdminPermAuditOwn     int64 = 1 << 6
	AdminPermAllModerator       = AdminPermUsersView | AdminPermUsersBan | AdminPermUsersDelete |
		AdminPermChannelsView | AdminPermChannelsEdit | AdminPermReports | AdminPermAuditOwn
)

type AdminSession struct {
	TokenHash string
	UserID    int64
	CreatedAt int64
	ExpiresAt int64
	LastSeen  int64
	IPHash    string
	CSRFHash  string
}

type AdminAudit struct {
	ID         int64
	ActorID    int64
	Action     string
	TargetType string
	TargetID   int64
	Reason     string
	Details    string
	IPHash     string
	CreatedAt  int64
	PrevHash   string
	Hash       string
}

type AdminBlacklist struct {
	ID         int64
	Kind       string
	ValueHMAC  string
	UserID     int64
	Reason     string
	CreatedBy  int64
	CreatedAt  int64
	RestoredAt int64
	RestoredBy int64
}

type AdminUser struct {
	ID            int64
	Username      string
	DisplayName   string
	CreatedAt     int64
	LastLoginAt   int64
	LastSeenAt    int64
	Email         string
	EmailSet      bool
	PhoneSet      bool
	DeletedAt     int64
	BannedAt      int64
	BannedBy      int64
	BanReason     string
	BannedByName  string
	SuspendedAt   int64
	SuspendedBy   int64
	Sessions      int
	Reports       int
	Role          string
	RoleExpiresAt int64
	Permissions   int64
}

type AdminChannel struct {
	ID           int64
	Kind         string // hub | room
	Name         string
	OwnerID      int64
	OwnerName    string
	Privacy      string
	Members      int
	CreatedAt    int64
	LastActivity int64
}

type AdminApproval struct {
	ID          int64
	Action      string
	TargetType  string
	TargetID    int64
	Payload     string
	Reason      string
	RequestedBy int64
	RequestedAt int64
	Status      string
	ApprovedBy  int64
	ApprovedAt  int64
	Resolution  string
}

type ModerationReport struct {
	ID         int64
	ReporterID int64
	TargetType string
	TargetID   int64
	Category   string
	Reason     string
	Status     string
	CreatedAt  int64
	ResolvedBy int64
	ResolvedAt int64
	Resolution string
}

// EnsureAdminRole создаёт активную роль. Повторная выдача обновляет прежнюю.
func (s *Store) EnsureAdminRole(userID int64, role string, permissions int64, grantedBy int64, expiresAt int64) error {
	if role != "super_admin" && role != "moderator" {
		return fmt.Errorf("unknown admin role %q", role)
	}
	if role == "super_admin" {
		permissions = AdminPermAllModerator
	}
	now := time.Now().UnixMilli()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE admin_role_grants SET revoked_at = ?, revoked_by = ? WHERE user_id = ? AND revoked_at IS NULL`, now, grantedBy, userID); err != nil {
		return err
	}
	var expiry any
	if expiresAt > 0 {
		expiry = expiresAt
	}
	if _, err := tx.Exec(`INSERT INTO admin_role_grants (user_id, role, permissions, granted_by, granted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`, userID, role, permissions, grantedBy, now, expiry); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ActiveAdminRole(userID int64) (*AdminRole, error) {
	now := time.Now().UnixMilli()
	row := s.db.QueryRow(`SELECT id, user_id, role, permissions, granted_by, granted_at, COALESCE(expires_at, 0)
		FROM admin_role_grants
		WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
		ORDER BY id DESC LIMIT 1`, userID, now)
	var role AdminRole
	if err := row.Scan(&role.ID, &role.UserID, &role.Role, &role.Permissions, &role.GrantedBy, &role.GrantedAt, &role.ExpiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &role, nil
}

func (s *Store) RevokeAdminRole(userID, by int64) error {
	res, err := s.db.Exec(`UPDATE admin_role_grants SET revoked_at = ?, revoked_by = ? WHERE user_id = ? AND revoked_at IS NULL`, time.Now().UnixMilli(), by, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AdminRoles() ([]AdminRole, error) {
	now := time.Now().UnixMilli()
	rows, err := s.db.Query(`SELECT id, user_id, role, permissions, granted_by, granted_at, COALESCE(expires_at, 0)
		FROM admin_role_grants WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
		ORDER BY role DESC, user_id`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []AdminRole
	for rows.Next() {
		var role AdminRole
		if err := rows.Scan(&role.ID, &role.UserID, &role.Role, &role.Permissions, &role.GrantedBy, &role.GrantedAt, &role.ExpiresAt); err != nil {
			return nil, err
		}
		list = append(list, role)
	}
	return list, rows.Err()
}

func (s *Store) CreateAdminSession(tokenHash string, userID int64, expiresAt int64, ipHash, csrfHash string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at, last_seen, ip_hash, csrf_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, tokenHash, userID, now, expiresAt, now, ipHash, csrfHash)
	return err
}

func (s *Store) AdminSessionByToken(tokenHash string) (*AdminSession, error) {
	var session AdminSession
	err := s.db.QueryRow(`SELECT token_hash, user_id, created_at, expires_at, last_seen, ip_hash, csrf_hash
		FROM admin_sessions WHERE token_hash = ?`, tokenHash).Scan(&session.TokenHash, &session.UserID, &session.CreatedAt, &session.ExpiresAt, &session.LastSeen, &session.IPHash, &session.CSRFHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Store) TouchAdminSession(tokenHash string, at int64) error {
	_, err := s.db.Exec(`UPDATE admin_sessions SET last_seen = ? WHERE token_hash = ?`, at, tokenHash)
	return err
}

func (s *Store) DeleteAdminSession(tokenHash string) error {
	_, err := s.db.Exec(`DELETE FROM admin_sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (s *Store) DeleteAdminSessionsForUser(userID int64) error {
	_, err := s.db.Exec(`DELETE FROM admin_sessions WHERE user_id = ?`, userID)
	return err
}

func (s *Store) LastAdminAuditHash() (string, error) {
	var hash string
	err := s.db.QueryRow(`SELECT hash FROM admin_audit ORDER BY id DESC LIMIT 1`).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return hash, err
}

func (s *Store) AppendAdminAudit(actorID int64, action, targetType string, targetID int64, reason, details, ipHash, prevHash, hash string) (int64, error) {
	now := time.Now().UnixMilli()
	res, err := s.db.Exec(`INSERT INTO admin_audit (actor_id, action, target_type, target_id, reason, details, ip_hash, created_at, prev_hash, hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, actorID, action, targetType, targetID, reason, details, ipHash, now, prevHash, hash)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) AdminAudit(actorID int64, limit int) ([]AdminAudit, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query := `SELECT id, actor_id, action, target_type, target_id, reason, details, ip_hash, created_at, prev_hash, hash FROM admin_audit`
	args := []any{}
	if actorID > 0 {
		query += ` WHERE actor_id = ?`
		args = append(args, actorID)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []AdminAudit
	for rows.Next() {
		var item AdminAudit
		if err := rows.Scan(&item.ID, &item.ActorID, &item.Action, &item.TargetType, &item.TargetID, &item.Reason, &item.Details, &item.IPHash, &item.CreatedAt, &item.PrevHash, &item.Hash); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) AddBlacklist(kind, valueHMAC string, userID int64, reason string, createdBy int64) error {
	now := time.Now().UnixMilli()
	var user any
	if userID > 0 {
		user = userID
	}
	_, err := s.db.Exec(`INSERT INTO admin_blacklist (kind, value_hmac, user_id, reason, created_by, created_at)
		SELECT ?, ?, ?, ?, ?, ?
		WHERE NOT EXISTS (SELECT 1 FROM admin_blacklist WHERE kind = ? AND value_hmac = ? AND restored_at IS NULL)`,
		kind, valueHMAC, user, reason, createdBy, now, kind, valueHMAC)
	return err
}

func (s *Store) IsBlacklisted(kind, valueHMAC string) (bool, error) {
	var exists int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM admin_blacklist WHERE kind = ? AND value_hmac = ? AND restored_at IS NULL`, kind, valueHMAC).Scan(&exists)
	return exists > 0, err
}

func (s *Store) ClearBlacklistForUser(userID int64, restoredBy int64) error {
	_, err := s.db.Exec(`UPDATE admin_blacklist SET restored_at = ?, restored_by = ? WHERE user_id = ? AND restored_at IS NULL`, time.Now().UnixMilli(), restoredBy, userID)
	return err
}

func (s *Store) AdminBlacklist(limit int) ([]AdminBlacklist, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(`SELECT id, kind, value_hmac, COALESCE(user_id, 0), reason, created_by, created_at, COALESCE(restored_at, 0), COALESCE(restored_by, 0)
		FROM admin_blacklist WHERE restored_at IS NULL ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []AdminBlacklist
	for rows.Next() {
		var item AdminBlacklist
		if err := rows.Scan(&item.ID, &item.Kind, &item.ValueHMAC, &item.UserID, &item.Reason, &item.CreatedBy, &item.CreatedAt, &item.RestoredAt, &item.RestoredBy); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) AdminUsers(query, status string, limit, offset int) ([]AdminUser, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	where := []string{"1=1"}
	args := []any{}
	query = strings.TrimSpace(query)
	if query != "" {
		where = append(where, "(u.username LIKE ? OR u.display_name LIKE ? OR CAST(u.id AS TEXT) = ?)")
		args = append(args, "%"+query+"%", "%"+query+"%", query)
	}
	switch status {
	case "banned":
		where = append(where, "u.banned_at IS NOT NULL")
	case "suspended":
		where = append(where, "u.suspended_at IS NOT NULL AND u.banned_at IS NULL")
	case "deleted":
		where = append(where, "u.deleted_at IS NOT NULL AND u.banned_at IS NULL")
	case "active":
		where = append(where, "u.banned_at IS NULL AND u.suspended_at IS NULL AND u.deleted_at IS NULL")
	}
	base := ` FROM users u
		LEFT JOIN admin_role_grants r ON r.user_id = u.id AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at > ?)
		WHERE ` + strings.Join(where, " AND ")
	countArgs := append([]any{time.Now().UnixMilli()}, args...)
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*)`+base, countArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append([]any{time.Now().UnixMilli()}, args...)
	args = append(args, limit, offset)
	rows, err := s.db.Query(`SELECT u.id, u.username, u.display_name, u.created_at, u.last_login_at,
		COALESCE((SELECT MAX(last_seen) FROM sessions s WHERE s.user_id = u.id), 0),
		COALESCE(u.email, ''), COALESCE(u.phone_hmac, '') <> '', COALESCE(u.deleted_at, 0),
		COALESCE(u.banned_at, 0), COALESCE(u.banned_by, 0), u.ban_reason,
		COALESCE((SELECT display_name FROM users b WHERE b.id = u.banned_by), ''),
		COALESCE(u.suspended_at, 0), COALESCE(u.suspended_by, 0),
		(SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id),
		(SELECT COUNT(*) FROM moderation_reports mr WHERE mr.target_type = 'user' AND mr.target_id = u.id),
		COALESCE(r.role, ''), COALESCE(r.expires_at, 0), COALESCE(r.permissions, 0)`+base+` ORDER BY u.id DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var list []AdminUser
	for rows.Next() {
		var item AdminUser
		if err := rows.Scan(&item.ID, &item.Username, &item.DisplayName, &item.CreatedAt, &item.LastLoginAt, &item.LastSeenAt,
			&item.Email, &item.PhoneSet, &item.DeletedAt, &item.BannedAt, &item.BannedBy, &item.BanReason, &item.BannedByName,
			&item.SuspendedAt, &item.SuspendedBy, &item.Sessions, &item.Reports, &item.Role, &item.RoleExpiresAt, &item.Permissions); err != nil {
			return nil, 0, err
		}
		item.EmailSet = item.Email != ""
		list = append(list, item)
	}
	return list, total, rows.Err()
}

func maskEmail(value string) string {
	at := strings.LastIndex(value, "@")
	if at <= 0 {
		return ""
	}
	name := value[:at]
	if len(name) <= 2 {
		return "***" + value[at:]
	}
	return name[:1] + "***" + value[at:]
}

func (s *Store) AdminChannels(query, kind string, limit, offset int) ([]AdminChannel, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query = strings.TrimSpace(query)
	var list []AdminChannel
	total := 0
	add := func(sqlQuery string, args ...any) error {
		rows, err := s.db.Query(sqlQuery, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item AdminChannel
			if err := rows.Scan(&item.ID, &item.Kind, &item.Name, &item.OwnerID, &item.OwnerName, &item.Privacy, &item.Members, &item.CreatedAt, &item.LastActivity); err != nil {
				return err
			}
			list = append(list, item)
		}
		return rows.Err()
	}
	like := "%" + query + "%"
	if kind == "" || kind == "hub" {
		where := " WHERE 1=1"
		args := []any{}
		if query != "" {
			where += " AND (h.name LIKE ? OR CAST(h.id AS TEXT) = ?)"
			args = append(args, like, query)
		}
		args = append(args, limit, offset)
		if err := add(`SELECT h.id, 'hub', h.name, h.owner_id, COALESCE(u.display_name, ''), h.privacy,
			(SELECT COUNT(*) FROM hub_members hm WHERE hm.hub_id = h.id), h.created_at,
			COALESCE((SELECT MAX(m.created_at) FROM room_messages m JOIN rooms r ON r.id = m.room_id WHERE r.hub_id = h.id), h.created_at)
			FROM hubs h LEFT JOIN users u ON u.id = h.owner_id`+where+` ORDER BY h.id DESC LIMIT ? OFFSET ?`, args...); err != nil {
			return nil, 0, err
		}
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM hubs h`+strings.Replace(where, "h.name", "h.name", 1), args[:len(args)-2]...).Scan(&count); err == nil {
			total += count
		}
	}
	if kind == "" || kind == "room" {
		where := " WHERE 1=1"
		args := []any{}
		if query != "" {
			where += " AND (r.name LIKE ? OR CAST(r.id AS TEXT) = ?)"
			args = append(args, like, query)
		}
		args = append(args, limit, offset)
		if err := add(`SELECT r.id, 'room', r.name, r.owner_id, COALESCE(u.display_name, ''), r.privacy,
			(SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id), r.created_at,
			COALESCE((SELECT MAX(m.created_at) FROM room_messages m WHERE m.room_id = r.id), r.created_at)
			FROM rooms r LEFT JOIN users u ON u.id = r.owner_id`+where+` ORDER BY r.id DESC LIMIT ? OFFSET ?`, args...); err != nil {
			return nil, 0, err
		}
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM rooms r`+strings.Replace(where, "r.name", "r.name", 1), args[:len(args)-2]...).Scan(&count); err == nil {
			total += count
		}
	}
	return list, total, nil
}

func (s *Store) SetChannelPrivacy(kind string, id int64, privacy string) error {
	if privacy != "public" && privacy != "hidden" {
		return fmt.Errorf("invalid privacy")
	}
	var res sql.Result
	var err error
	switch kind {
	case "hub":
		res, err = s.db.Exec(`UPDATE hubs SET privacy = ? WHERE id = ?`, privacy, id)
	case "room":
		res, err = s.db.Exec(`UPDATE rooms SET privacy = ? WHERE id = ?`, privacy, id)
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

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func (s *Store) SetUserSuspended(userID, by int64, until int64, reason string) error {
	_ = until
	res, err := s.db.Exec(`UPDATE users SET suspended_at = unixepoch() * 1000, suspended_by = ?, suspended_reason = ? WHERE id = ? AND banned_at IS NULL`, by, reason, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ClearUserSuspension(userID int64) error {
	_, err := s.db.Exec(`UPDATE users SET suspended_at = NULL, suspended_by = NULL, suspended_reason = '' WHERE id = ?`, userID)
	return err
}

func (s *Store) MarkLogin(userID int64) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`UPDATE users SET last_login_at = ? WHERE id = ?`, now, userID)
	return err
}

func (s *Store) AdminUserByID(id int64) (*AdminUser, error) {
	rows, total, err := s.AdminUsers(fmt.Sprintf("%d", id), "", 1, 0)
	if err != nil {
		return nil, err
	}
	if total == 0 || len(rows) == 0 {
		return nil, ErrNotFound
	}
	return &rows[0], nil
}

func (s *Store) UpdateAdminSessionCSRF(tokenHash, csrfHash string) error {
	_, err := s.db.Exec(`UPDATE admin_sessions SET csrf_hash = ? WHERE token_hash = ?`, csrfHash, tokenHash)
	return err
}
