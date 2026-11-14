package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrPhoneSignupNotFound = errors.New("phone signup not found")
	ErrPhoneSignupPending  = errors.New("phone signup pending")
	ErrPhoneSignupExpired  = errors.New("phone signup expired")
	ErrPhoneSignupUsed     = errors.New("phone signup used")
	ErrPhoneSignupMismatch = errors.New("phone signup secret mismatch")
	ErrPhoneTaken          = errors.New("phone already taken")
	ErrUsernameTaken       = errors.New("username already taken")
)

type PhoneSignup struct {
	ID           string
	PhoneHMAC    string
	PasswordHash string
	Username     string
	DisplayName  string
	AvatarColor  string
	UserID       int64
	TokenHash    string
	PollHash     string
	ChatID       int64
	VerifiedAt   int64
	UsedAt       int64
	CreatedAt    int64
	ExpiresAt    int64
}

func (s *Store) CreatePhoneSignup(p PhoneSignup) error {
	_, err := s.db.Exec(`
		INSERT INTO phone_signups
			(id, phone_hmac, password_hash, username, display_name, avatar_color,
			 token_hash, poll_hash, user_id, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, 0), ?, ?)`,
		p.ID, p.PhoneHMAC, p.PasswordHash, p.Username, p.DisplayName, p.AvatarColor,
		p.TokenHash, p.PollHash, p.UserID, p.CreatedAt, p.ExpiresAt)
	return err
}

func (s *Store) PhoneSignupByID(id string) (*PhoneSignup, error) {
	return scanPhoneSignup(s.db.QueryRow(`
		SELECT id, phone_hmac, password_hash, username, display_name, avatar_color,
		       token_hash, poll_hash, COALESCE(user_id, 0), COALESCE(telegram_chat_id, 0), COALESCE(verified_at, 0),
		       COALESCE(used_at, 0), created_at, expires_at
		FROM phone_signups WHERE id = ?`, id))
}

func (s *Store) PhoneSignupByUsername(username string) (*PhoneSignup, error) {
	return scanPhoneSignup(s.db.QueryRow(`
		SELECT id, phone_hmac, password_hash, username, display_name, avatar_color,
		       token_hash, poll_hash, COALESCE(user_id, 0), COALESCE(telegram_chat_id, 0), COALESCE(verified_at, 0),
		       COALESCE(used_at, 0), created_at, expires_at
		FROM phone_signups WHERE username = ?`, username))
}

func (s *Store) PhoneSignupByTokenHash(hash string) (*PhoneSignup, error) {
	return scanPhoneSignup(s.db.QueryRow(`
		SELECT id, phone_hmac, password_hash, username, display_name, avatar_color,
		       token_hash, poll_hash, COALESCE(user_id, 0), COALESCE(telegram_chat_id, 0), COALESCE(verified_at, 0),
		       COALESCE(used_at, 0), created_at, expires_at
		FROM phone_signups WHERE token_hash = ?`, hash))
}

// PhoneSignupForChat — последняя незавершённая заявка, к которой привязан чат.
func (s *Store) PhoneSignupForChat(chatID int64) (*PhoneSignup, error) {
	return scanPhoneSignup(s.db.QueryRow(`
		SELECT id, phone_hmac, password_hash, username, display_name, avatar_color,
		       token_hash, poll_hash, COALESCE(user_id, 0), COALESCE(telegram_chat_id, 0), COALESCE(verified_at, 0),
		       COALESCE(used_at, 0), created_at, expires_at
		FROM phone_signups
		WHERE telegram_chat_id = ? AND used_at IS NULL AND verified_at IS NULL
		ORDER BY created_at DESC LIMIT 1`, chatID))
}

func scanPhoneSignup(row interface{ Scan(...any) error }) (*PhoneSignup, error) {
	var p PhoneSignup
	err := row.Scan(&p.ID, &p.PhoneHMAC, &p.PasswordHash, &p.Username, &p.DisplayName,
		&p.AvatarColor, &p.TokenHash, &p.PollHash, &p.UserID, &p.ChatID, &p.VerifiedAt,
		&p.UsedAt, &p.CreatedAt, &p.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPhoneSignupNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) BindPhoneSignupChat(id string, chatID int64) error {
	res, err := s.db.Exec(`UPDATE phone_signups SET telegram_chat_id = ? WHERE id = ? AND used_at IS NULL`, chatID, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrPhoneSignupNotFound
	}
	return nil
}

func (s *Store) MarkPhoneSignupVerified(id string, chatID int64) error {
	res, err := s.db.Exec(`
		UPDATE phone_signups SET verified_at = unixepoch()
		WHERE id = ? AND telegram_chat_id = ? AND used_at IS NULL AND verified_at IS NULL`,
		id, chatID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrPhoneSignupNotFound
	}
	return nil
}

func (s *Store) UserByPhoneHMAC(hmac string) (*User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userColumns+` FROM users WHERE phone_hmac = ?`, hmac))
}

// CompletePhoneSignup создаёт пользователя и помечает заявку использованной одной транзакцией.
func (s *Store) CompletePhoneSignup(id, pollHash string) (*User, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var p PhoneSignup
	err = tx.QueryRow(`
		SELECT id, phone_hmac, password_hash, username, display_name, avatar_color,
		       token_hash, poll_hash, COALESCE(user_id, 0), COALESCE(telegram_chat_id, 0), COALESCE(verified_at, 0),
		       COALESCE(used_at, 0), created_at, expires_at
		FROM phone_signups WHERE id = ?`, id).
		Scan(&p.ID, &p.PhoneHMAC, &p.PasswordHash, &p.Username, &p.DisplayName,
			&p.AvatarColor, &p.TokenHash, &p.PollHash, &p.UserID, &p.ChatID, &p.VerifiedAt,
			&p.UsedAt, &p.CreatedAt, &p.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPhoneSignupNotFound
	}
	if err != nil {
		return nil, err
	}
	if p.PollHash != pollHash {
		return nil, ErrPhoneSignupMismatch
	}
	if p.UsedAt != 0 {
		return nil, ErrPhoneSignupUsed
	}
	if p.ExpiresAt <= time.Now().Unix() {
		return nil, ErrPhoneSignupExpired
	}
	if p.VerifiedAt == 0 {
		return nil, ErrPhoneSignupPending
	}
	res, err := tx.Exec(`
		INSERT INTO users (username, password_hash, display_name, avatar_color, created_at, phone_hmac)
		VALUES (?, ?, ?, ?, ?, ?)`,
		p.Username, p.PasswordHash, p.DisplayName, p.AvatarColor, time.Now().UnixMilli(), p.PhoneHMAC)
	if err != nil {
		if isUniqueError(err) {
			return nil, ErrUsernameTaken
		}
		return nil, err
	}
	uid, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`UPDATE phone_signups SET used_at = unixepoch(), telegram_chat_id = NULL WHERE id = ?`, id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.UserByID(uid)
}

func isUniqueError(err error) bool {
	return err != nil && (strings.Contains(strings.ToLower(err.Error()), "unique") ||
		strings.Contains(strings.ToLower(err.Error()), "constraint"))
}

func (s *Store) DeleteExpiredPhoneSignups(now int64) error {
	_, err := s.db.Exec(`DELETE FROM phone_signups WHERE expires_at < ? OR used_at IS NOT NULL AND used_at < ?`, now, now-86400)
	return err
}

func (s *Store) DeletePhoneSignup(id, pollHash string) error {
	res, err := s.db.Exec(`DELETE FROM phone_signups WHERE id = ? AND poll_hash = ? AND used_at IS NULL`, id, pollHash)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrPhoneSignupNotFound
	}
	return nil
}

func (s *Store) SetUserPhone(userID int64, phoneHMAC string) error {
	_, err := s.db.Exec(`UPDATE users SET phone_hmac = ? WHERE id = ?`, phoneHMAC, userID)
	return err
}
