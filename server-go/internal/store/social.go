package store

import (
	"database/sql"
	"time"
)

type ContactRow struct {
	User      *User
	CreatedAt int64
	ChatTheme string
	Wallpaper string
}

type RequestRow struct {
	User *User
	At   int64
}

type BlockRow struct {
	User *User
	At   int64
}

func (s *Store) ContactsOf(userID int64) ([]ContactRow, error) {
	rows, err := s.db.Query(`
		SELECT `+prefixed("u.", userColumns)+`, c.created_at, COALESCE(c.chat_theme, ''), COALESCE(c.wallpaper, '')
		FROM contacts c JOIN users u ON u.id = c.contact_id
		WHERE c.user_id = ? ORDER BY c.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []ContactRow
	for rows.Next() {
		var item ContactRow
		var chatTheme, wallpaper string
		user, err := scanUserWith(rows, &item.CreatedAt, &chatTheme, &wallpaper)
		if err != nil {
			return nil, err
		}
		item.User = user
		item.ChatTheme = chatTheme
		item.Wallpaper = wallpaper
		list = append(list, item)
	}
	return list, rows.Err()
}

// prefixed добавляет префикс к каждому столбцу списка: "id, name" → "u.id, u.name"
func prefixed(prefix, columns string) string {
	out := ""
	depth := 0
	start := 0
	for i, r := range columns {
		switch r {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				out += prefix + columns[start:i] + ", "
				start = i + 1
			}
		}
	}
	return out + prefix + columns[start:]
}

func scanUserWith(row interface{ Scan(...any) error }, extra ...any) (*User, error) {
	var user User
	if err := scanUserInto(row, &user, extra...); err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *Store) AreFriends(a, b int64) (bool, error) {
	var exists int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM contacts WHERE user_id = ? AND contact_id = ?`, a, b).Scan(&exists)
	return exists > 0, err
}

func (s *Store) AreBlocked(a, b int64) (bool, error) {
	var exists int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM blocks WHERE user_id = ? AND blocked_id = ?`, a, b).Scan(&exists)
	return exists > 0, err
}

func (s *Store) AddContactPair(a, b int64) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?), (?, ?, ?)`, a, b, now, b, a, now)
	return err
}

func (s *Store) SendFriendRequest(from, to int64) error {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT OR REPLACE INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)`, from, to, now)
	return err
}

func (s *Store) FriendRequestFrom(from, to int64) (bool, error) {
	var exists int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM friend_requests WHERE from_id = ? AND to_id = ?`, from, to).Scan(&exists)
	return exists > 0, err
}

func (s *Store) IncomingRequests(userID int64) ([]RequestRow, error) {
	rows, err := s.db.Query(`
		SELECT `+prefixed("u.", userColumns)+`, r.created_at
		FROM friend_requests r JOIN users u ON u.id = r.from_id
		WHERE r.to_id = ? ORDER BY r.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectRequests(rows)
}

func (s *Store) OutgoingRequests(userID int64) ([]RequestRow, error) {
	rows, err := s.db.Query(`
		SELECT `+prefixed("u.", userColumns)+`, r.created_at
		FROM friend_requests r JOIN users u ON u.id = r.to_id
		WHERE r.from_id = ? ORDER BY r.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectRequests(rows)
}

func collectRequests(rows *sql.Rows) ([]RequestRow, error) {
	var list []RequestRow
	for rows.Next() {
		var item RequestRow
		var at int64
		user, err := scanUserWith(rows, &at)
		if err != nil {
			return nil, err
		}
		item.User = user
		item.At = at
		list = append(list, item)
	}
	return list, rows.Err()
}

// AcceptFriendRequest: заявка исчезает, дружба появляется у обоих.
func (s *Store) AcceptFriendRequest(from, to int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?`, from, to); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	if _, err := tx.Exec(`INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?), (?, ?, ?)`, from, to, now, to, from, now); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeclineFriendRequest(from, to int64) error {
	_, err := s.db.Exec(`DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?`, from, to)
	return err
}

func (s *Store) RemoveContact(a, b int64) error {
	_, err := s.db.Exec(`DELETE FROM contacts WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)`, a, b, b, a)
	return err
}

func (s *Store) BlocksOf(userID int64) ([]BlockRow, error) {
	rows, err := s.db.Query(`
		SELECT `+prefixed("u.", userColumns)+`, b.created_at
		FROM blocks b JOIN users u ON u.id = b.blocked_id
		WHERE b.user_id = ? ORDER BY b.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []BlockRow
	for rows.Next() {
		var item BlockRow
		var at int64
		user, err := scanUserWith(rows, &at)
		if err != nil {
			return nil, err
		}
		item.User = user
		item.At = at
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) Block(userID, blockedID int64) error {
	_, err := s.db.Exec(`INSERT OR REPLACE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)`, userID, blockedID, time.Now().UnixMilli())
	return err
}

func (s *Store) Unblock(userID, blockedID int64) error {
	_, err := s.db.Exec(`DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?`, userID, blockedID)
	return err
}
// RelatedUserIDs — кому рассказывать о статусе: друзья и соседи по каналам.
func (s *Store) RelatedUserIDs(userID int64) ([]int64, error) {
	rows, err := s.db.Query(`
		SELECT contact_id FROM contacts WHERE user_id = ?
		UNION
		SELECT m2.user_id FROM hub_members m1 JOIN hub_members m2 ON m2.hub_id = m1.hub_id
		WHERE m1.user_id = ? AND m2.user_id <> ?`, userID, userID, userID)
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

func (s *Store) UpdateUserStatus(userID int64, status string) error {
	_, err := s.db.Exec(`UPDATE users SET status = ? WHERE id = ?`, status, userID)
	return err
}

// SetChatTheme — тема личной переписки «у обоих»: обновляем обе стороны.
func (s *Store) SetChatTheme(a, b int64, theme *string) error {
	if _, err := s.db.Exec(`UPDATE contacts SET chat_theme = ? WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)`, theme, a, b, b, a); err != nil {
		return err
	}
	return nil
}

// ChatThemeOf — тема переписки, как её видит userID.
func (s *Store) ChatThemeOf(userID, peerID int64) (string, error) {
	var theme sql.NullString
	err := s.db.QueryRow(`SELECT chat_theme FROM contacts WHERE user_id = ? AND contact_id = ?`, userID, peerID).Scan(&theme)
	return theme.String, err
}
