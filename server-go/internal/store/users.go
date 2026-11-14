package store

import (
	"database/sql"
	"errors"
	"time"
)

type User struct {
	ID             int64
	Username       string
	PasswordHash   string
	DisplayName    string
	AvatarColor    string
	CreatedAt      int64
	Avatar         string
	Email          string
	EmailShown     string
	Bio            string
	BannerColor    string
	Banner         string
	Game           string
	NameColor      string
	Status         string
	PublicKey      string
	TotpSecret     string
	PrivacyTyping  bool
	PrivacyRead    bool
	PrivacyGame    bool
	FriendRequests bool
	InvitePolicy   string
	DeletedAt      int64
	PhoneHMAC      string
}

type Session struct {
	ID        string
	UserID    int64
	Device    string
	CreatedAt int64
	LastSeen  int64
}

type Identity struct {
	Provider string
	Email    string
}

var ErrNotFound = errors.New("not found")

// Только настоящие столбцы: строку подставляем и в одиночный SELECT, и в JOIN с префиксом
const userColumns = `id, username, password_hash, display_name, avatar_color, created_at,
	avatar, email, email_shown, bio, banner_color, banner, game, name_color, status, public_key, totp_secret,
	privacy_typing, privacy_read, privacy_game, friend_requests, invite_policy, deleted_at, phone_hmac`

// scanUserInto читает строку users с учётом NULL и добавляет поля из JOIN.
func scanUserInto(row interface{ Scan(...any) error }, user *User, extra ...any) error {
	var avatar, email, emailShown, bio, bannerColor, banner, game, nameColor, status, publicKey, totp sql.NullString
	var invitePolicy sql.NullString
	var privacyTyping, privacyRead, privacyGame, friendRequests sql.NullInt64
	var deletedAt sql.NullInt64
	var phoneHMAC sql.NullString
	args := []any{
		&user.ID, &user.Username, &user.PasswordHash, &user.DisplayName, &user.AvatarColor, &user.CreatedAt,
		&avatar, &email, &emailShown, &bio, &bannerColor, &banner, &game, &nameColor, &status, &publicKey, &totp,
		&privacyTyping, &privacyRead, &privacyGame, &friendRequests, &invitePolicy, &deletedAt, &phoneHMAC,
	}
	args = append(args, extra...)
	if err := row.Scan(args...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	user.Avatar = avatar.String
	user.Email = email.String
	user.EmailShown = emailShown.String
	user.Bio = bio.String
	user.BannerColor = bannerColor.String
	user.Banner = banner.String
	user.Game = game.String
	user.NameColor = nameColor.String
	user.Status = status.String
	if user.Status == "" {
		user.Status = "online"
	}
	user.PublicKey = publicKey.String
	user.TotpSecret = totp.String
	// До миграции 007 значения NULL — ведём себя как раньше, то есть всё включено
	user.PrivacyTyping = !privacyTyping.Valid || privacyTyping.Int64 != 0
	user.PrivacyRead = !privacyRead.Valid || privacyRead.Int64 != 0
	user.PrivacyGame = !privacyGame.Valid || privacyGame.Int64 != 0
	user.FriendRequests = !friendRequests.Valid || friendRequests.Int64 != 0
	user.InvitePolicy = invitePolicy.String
	user.DeletedAt = deletedAt.Int64
	user.PhoneHMAC = phoneHMAC.String
	if user.InvitePolicy != "friends" {
		user.InvitePolicy = "all"
	}
	return nil
}

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var user User
	if err := scanUserInto(row, &user); err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Store) CreateUser(username, passwordHash, displayName, avatarColor string) (*User, error) {
	result, err := s.db.Exec(
		`INSERT INTO users (username, password_hash, display_name, avatar_color, created_at) VALUES (?, ?, ?, ?, ?)`,
		username, passwordHash, displayName, avatarColor, time.Now().UnixMilli(),
	)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.UserByID(id)
}

func (s *Store) UserByID(id int64) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE id = ?`, id))
}

func (s *Store) UserByUsername(username string) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE username = ?`, username))
}

func (s *Store) UserByEmail(email string) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE email = ?`, email))
}

func (s *Store) IdentitiesOf(userID int64) ([]Identity, error) {
	rows, err := s.db.Query(`SELECT provider, COALESCE(email, '') FROM identities WHERE user_id = ? ORDER BY provider`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Identity
	for rows.Next() {
		var item Identity
		if err := rows.Scan(&item.Provider, &item.Email); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) CreateSession(id string, userID int64, device string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(
		`INSERT INTO sessions (id, user_id, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)`,
		id, userID, device, now, now,
	)
	return err
}

func (s *Store) SessionByID(id string) (*Session, error) {
	var session Session
	err := s.db.QueryRow(
		`SELECT id, user_id, device, created_at, last_seen FROM sessions WHERE id = ?`, id,
	).Scan(&session.ID, &session.UserID, &session.Device, &session.CreatedAt, &session.LastSeen)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &session, nil
}

func (s *Store) TouchSession(id string) error {
	_, err := s.db.Exec(`UPDATE sessions SET last_seen = ? WHERE id = ?`, time.Now().UnixMilli(), id)
	return err
}

// SetSessionDevice обновляет подпись устройства, если человек вошёл с новой
// версией приложения, но переиспользует старую сессию.
func (s *Store) SetSessionDevice(id, device string) error {
	_, err := s.db.Exec(`UPDATE sessions SET device = ? WHERE id = ?`, device, id)
	return err
}

func (s *Store) DeleteSession(id string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

func (s *Store) SessionsOf(userID int64) ([]Session, error) {
	rows, err := s.db.Query(
		`SELECT id, user_id, device, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Session
	for rows.Next() {
		var session Session
		if err := rows.Scan(&session.ID, &session.UserID, &session.Device, &session.CreatedAt, &session.LastSeen); err != nil {
			return nil, err
		}
		list = append(list, session)
	}
	return list, rows.Err()
}

func (s *Store) SetTotpPending(userID int64, secret string) error {
	_, err := s.db.Exec(`UPDATE users SET totp_pending = ? WHERE id = ?`, secret, userID)
	return err
}

func (s *Store) TotpPending(userID int64) (string, error) {
	var value sql.NullString
	err := s.db.QueryRow(`SELECT totp_pending FROM users WHERE id = ?`, userID).Scan(&value)
	return value.String, err
}

func (s *Store) EnableTotp(userID int64, secret, recovery string) error {
	_, err := s.db.Exec(`UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_recovery = ? WHERE id = ?`, secret, recovery, userID)
	return err
}

func (s *Store) DisableTotp(userID int64) error {
	_, err := s.db.Exec(`UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_recovery = NULL WHERE id = ?`, userID)
	return err
}

func (s *Store) TotpRecovery(userID int64) (string, error) {
	var value sql.NullString
	err := s.db.QueryRow(`SELECT totp_recovery FROM users WHERE id = ?`, userID).Scan(&value)
	return value.String, err
}

func (s *Store) SetTotpRecovery(userID int64, recovery string) error {
	_, err := s.db.Exec(`UPDATE users SET totp_recovery = ? WHERE id = ?`, recovery, userID)
	return err
}

// UseTotpStep фиксирует успешный TOTP-шаг. Повторный код в том же окне
// уже не пройдёт — это защита от replay.
func (s *Store) UseTotpStep(userID, step int64) (bool, error) {
	result, err := s.db.Exec(`UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`, step, userID, step)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return changed > 0, nil
}

func (s *Store) UpdateProfile(userID int64, displayName, avatarColor, bio *string, bannerColor, nameColor *string) error {
	if displayName != nil {
		if _, err := s.db.Exec(`UPDATE users SET display_name = ? WHERE id = ?`, *displayName, userID); err != nil {
			return err
		}
	}
	if avatarColor != nil {
		if _, err := s.db.Exec(`UPDATE users SET avatar_color = ? WHERE id = ?`, *avatarColor, userID); err != nil {
			return err
		}
	}
	if bio != nil {
		if _, err := s.db.Exec(`UPDATE users SET bio = ? WHERE id = ?`, *bio, userID); err != nil {
			return err
		}
	}
	if bannerColor != nil {
		if _, err := s.db.Exec(`UPDATE users SET banner_color = ? WHERE id = ?`, *bannerColor, userID); err != nil {
			return err
		}
	}
	if nameColor != nil {
		if _, err := s.db.Exec(`UPDATE users SET name_color = ? WHERE id = ?`, *nameColor, userID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) SetPublicKey(userID int64, key string) error {
	_, err := s.db.Exec(`UPDATE users SET public_key = ? WHERE id = ?`, nullIfEmpty(key), userID)
	return err
}

// SetGame — запущенная игра из детекта процессов клиента; nil очищает.
func (s *Store) SetGame(userID int64, game *string) error {
	if game == nil {
		_, err := s.db.Exec(`UPDATE users SET game = NULL WHERE id = ?`, userID)
		return err
	}
	_, err := s.db.Exec(`UPDATE users SET game = ? WHERE id = ?`, *game, userID)
	return err
}

// CreateUserWithEmail — регистрация по почте: логин придуман, почта подтверждена кодом.
func (s *Store) CreateUserWithEmail(username, passwordHash, displayName, avatarColor, email, emailShown string) (*User, error) {
	now := time.Now().UnixMilli()
	result, err := s.db.Exec(`
		INSERT INTO users (username, password_hash, display_name, avatar_color, created_at, email, email_shown)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		username, passwordHash, displayName, avatarColor, now, nullIfEmpty(email), nullIfEmpty(emailShown))
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.UserByID(id)
}

func (s *Store) SetEmail(userID int64, email, shown string) error {
	_, err := s.db.Exec(`UPDATE users SET email = ?, email_shown = ? WHERE id = ?`, nullIfEmpty(email), nullIfEmpty(shown), userID)
	return err
}

func (s *Store) UpdatePassword(userID int64, hash string) error {
	_, err := s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, hash, userID)
	return err
}

// AddIdentity — привязать аккаунт сервиса; у профиля один аккаунт на сервис.
func (s *Store) AddIdentity(provider, providerUserID string, userID int64, email string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM identities WHERE user_id = ? AND provider = ?`, userID, provider); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO identities (provider, provider_user_id, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (provider, provider_user_id) DO UPDATE SET user_id = excluded.user_id, email = excluded.email`,
		provider, providerUserID, userID, email, time.Now().UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) FindIdentity(provider, providerUserID string) (int64, string, bool, error) {
	var userID int64
	var email string
	err := s.db.QueryRow(`SELECT user_id, COALESCE(email, '') FROM identities WHERE provider = ? AND provider_user_id = ?`, provider, providerUserID).
		Scan(&userID, &email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, "", false, nil
		}
		return 0, "", false, err
	}
	return userID, email, true, nil
}

func (s *Store) DeleteIdentity(userID int64, provider string) error {
	_, err := s.db.Exec(`DELETE FROM identities WHERE user_id = ? AND provider = ?`, userID, provider)
	return err
}

// SetPrivacy — настройки конфиденциальности, которые проверяет сервер, а не только клиент.
func (s *Store) SetPrivacy(userID int64, typing, read, game, requests bool, invitePolicy string) error {
	flag := func(value bool) int {
		if value {
			return 1
		}
		return 0
	}
	if invitePolicy != "friends" {
		invitePolicy = "all"
	}
	_, err := s.db.Exec(`
		UPDATE users SET privacy_typing = ?, privacy_read = ?, privacy_game = ?,
			friend_requests = ?, invite_policy = ? WHERE id = ?`,
		flag(typing), flag(read), flag(game), flag(requests), invitePolicy, userID)
	return err
}
