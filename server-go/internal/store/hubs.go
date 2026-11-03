package store

import (
	"database/sql"
	"errors"
	"time"
)

type RoleRow struct {
	ID        int64
	Name      string
	Color     string
	Perms     int64
	CreatedAt int64
}

type HubMember struct {
	User     *User
	Manager  bool
	RoleID   *int64
	Nickname *string
	JoinedAt int64
}

type GroupRow struct {
	ID   int64
	Name string
}

type EmojiRow struct {
	ID   int64
	Name string
	File string
}

type HubRow struct {
	ID              int64
	Name            string
	OwnerID         int64
	IconColor       string
	Icon            string
	CreatedAt       int64
	DefaultPerms    int64
	ReactionsVisible bool
	Roles           []RoleRow
	Members         []HubMember
	Groups          []GroupRow
	Emojis          []EmojiRow
	Invited         []*User
	Bans            []*User
}

type RoomMember struct {
	User         *User
	RoleID       *int64
	Nickname     *string
	TimeoutUntil *int64
}

type RoomRow struct {
	ID           int64
	Name         string
	Kind         string
	HubID        *int64
	GroupID      *int64
	Private      bool
	Position     int64
	OwnerID      int64
	CreatedAt    int64
	DefaultPerms int64
	Background   string
	Roles        []RoleRow
	Members      []RoomMember
	Bans         []*User
}

const adminRoleName = "Администратор"
const adminRoleColor = "#e5484d"
const adminRolePerms = 256

func (s *Store) CreateHub(ownerID int64, name, iconColor string) (*HubRow, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := time.Now().UnixMilli()
	result, err := tx.Exec(
		`INSERT INTO hubs (name, owner_id, icon_color, created_at) VALUES (?, ?, ?, ?)`,
		name, ownerID, iconColor, now,
	)
	if err != nil {
		return nil, err
	}
	hubID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(
		`INSERT INTO hub_roles (hub_id, name, color, perms, created_at) VALUES (?, ?, ?, ?, ?)`,
		hubID, adminRoleName, adminRoleColor, adminRolePerms, now,
	); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(
		`INSERT INTO hub_members (hub_id, user_id, manager, created_at) VALUES (?, ?, 0, ?)`,
		hubID, ownerID, now,
	); err != nil {
		return nil, err
	}
	// Как в Node: при создании канала сразу появляются голосовая и общий чат
	if _, err := createRoomTx(tx, hubID, ownerID, "Голосовая", "voice", false); err != nil {
		return nil, err
	}
	if _, err := createRoomTx(tx, hubID, ownerID, "Общий чат", "text", false); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.HubByID(hubID)
}

func (s *Store) CreateRoom(hubID, ownerID int64, name, kind string, private bool) (*RoomRow, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	id, err := createRoomTx(tx, hubID, ownerID, name, kind, private)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.RoomByID(id)
}

func createRoomTx(tx *sql.Tx, hubID, ownerID int64, name, kind string, private bool) (int64, error) {
	now := time.Now().UnixMilli()
	var position int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(position), 0) + 1 FROM rooms WHERE hub_id = ?`, hubID).Scan(&position); err != nil {
		return 0, err
	}
	privateValue := 0
	if private {
		privateValue = 1
	}
	result, err := tx.Exec(
		`INSERT INTO rooms (name, kind, owner_id, created_at, hub_id, position, private) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		name, kind, ownerID, now, hubID, position, privateValue,
	)
	if err != nil {
		return 0, err
	}
	roomID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(
		`INSERT INTO room_roles (room_id, name, color, perms, created_at) VALUES (?, ?, ?, ?, ?)`,
		roomID, adminRoleName, adminRoleColor, adminRolePerms, now,
	); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(
		`INSERT INTO room_members (room_id, user_id, created_at) VALUES (?, ?, ?)`,
		roomID, ownerID, now,
	); err != nil {
		return 0, err
	}
	return roomID, nil
}

func (s *Store) HubByID(id int64) (*HubRow, error) {
	var hub HubRow
	var icon sql.NullString
	err := s.db.QueryRow(
		`SELECT id, name, owner_id, icon_color, icon, created_at, default_perms, reactions_visible FROM hubs WHERE id = ?`, id,
	).Scan(&hub.ID, &hub.Name, &hub.OwnerID, &hub.IconColor, &icon, &hub.CreatedAt, &hub.DefaultPerms, &hub.ReactionsVisible)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	hub.Icon = icon.String
	if err := s.fillHub(&hub); err != nil {
		return nil, err
	}
	return &hub, nil
}

func (s *Store) HubsOf(userID int64) ([]*HubRow, error) {
	rows, err := s.db.Query(`
		SELECT h.id FROM hubs h JOIN hub_members m ON m.hub_id = h.id
		WHERE m.user_id = ? ORDER BY h.created_at, h.id`, userID)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	list := make([]*HubRow, 0, len(ids))
	for _, id := range ids {
		hub, err := s.HubByID(id)
		if err != nil {
			return nil, err
		}
		list = append(list, hub)
	}
	return list, nil
}

func (s *Store) fillHub(hub *HubRow) error {
	// роли
	rows, err := s.db.Query(`SELECT id, name, color, perms, created_at FROM hub_roles WHERE hub_id = ? ORDER BY id`, hub.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var role RoleRow
		if err := rows.Scan(&role.ID, &role.Name, &role.Color, &role.Perms, &role.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		hub.Roles = append(hub.Roles, role)
	}
	rows.Close()

	// участники + ник внутри канала
	rows, err = s.db.Query(`
		SELECT `+prefixed("u.", userColumns)+`, m.manager, m.role_id, n.name, m.created_at
		FROM hub_members m
		JOIN users u ON u.id = m.user_id
		LEFT JOIN hub_nicknames n ON n.hub_id = m.hub_id AND n.user_id = m.user_id
		WHERE m.hub_id = ? ORDER BY m.created_at`, hub.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var member HubMember
		var manager int
		var roleID sql.NullInt64
		var nickname sql.NullString
		var joined int64
		user, err := scanUserWith(rows, &manager, &roleID, &nickname, &joined)
		if err != nil {
			rows.Close()
			return err
		}
		member.User = user
		member.Manager = manager != 0
		if roleID.Valid {
			value := roleID.Int64
			member.RoleID = &value
		}
		if nickname.Valid {
			value := nickname.String
			member.Nickname = &value
		}
		member.JoinedAt = joined
		hub.Members = append(hub.Members, member)
	}
	rows.Close()

	// группы
	rows, err = s.db.Query(`SELECT id, name FROM room_groups WHERE hub_id = ? ORDER BY id`, hub.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var group GroupRow
		if err := rows.Scan(&group.ID, &group.Name); err != nil {
			rows.Close()
			return err
		}
		hub.Groups = append(hub.Groups, group)
	}
	rows.Close()

	// эмодзи
	rows, err = s.db.Query(`SELECT id, name, file FROM hub_emojis WHERE hub_id = ? ORDER BY id`, hub.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var emoji EmojiRow
		if err := rows.Scan(&emoji.ID, &emoji.Name, &emoji.File); err != nil {
			rows.Close()
			return err
		}
		hub.Emojis = append(hub.Emojis, emoji)
	}
	rows.Close()

	hub.Invited = s.hubUsers(`SELECT u.id FROM hub_invites i JOIN users u ON u.id = i.user_id WHERE i.hub_id = ?`, hub.ID)
	hub.Bans = s.hubUsers(`SELECT u.id FROM hub_bans b JOIN users u ON u.id = b.user_id WHERE b.hub_id = ?`, hub.ID)
	return nil
}

func (s *Store) hubUsers(query string, hubID int64) []*User {
	rows, err := s.db.Query(query, hubID)
	if err != nil {
		return nil
	}
	// Сначала собираем id и закрываем rows: при одном соединении вложенный
	// запрос внутри цикла ждёт освобождения соединения и вешает обработчик
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			break
		}
		ids = append(ids, id)
	}
	rows.Close()
	list := make([]*User, 0, len(ids))
	for _, id := range ids {
		if user, err := s.UserByID(id); err == nil {
			list = append(list, user)
		}
	}
	return list
}

func (s *Store) RoomsOf(userID int64) ([]*RoomRow, error) {
	rows, err := s.db.Query(`
		SELECT r.id FROM rooms r
		JOIN hub_members m ON m.hub_id = r.hub_id
		WHERE m.user_id = ?
		ORDER BY r.position, r.id`, userID)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	list := make([]*RoomRow, 0, len(ids))
	for _, id := range ids {
		room, err := s.RoomByID(id)
		if err != nil {
			return nil, err
		}
		list = append(list, room)
	}
	return list, nil
}

func (s *Store) RoomByID(id int64) (*RoomRow, error) {
	var room RoomRow
	var hubID, groupID sql.NullInt64
	var background sql.NullString
	err := s.db.QueryRow(`
		SELECT id, name, kind, hub_id, group_id, private, COALESCE(position, 0), owner_id, created_at, default_perms, background
		FROM rooms WHERE id = ?`, id,
	).Scan(&room.ID, &room.Name, &room.Kind, &hubID, &groupID, &room.Private, &room.Position, &room.OwnerID, &room.CreatedAt, &room.DefaultPerms, &background)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if hubID.Valid {
		value := hubID.Int64
		room.HubID = &value
	}
	if groupID.Valid {
		value := groupID.Int64
		room.GroupID = &value
	}
	room.Background = background.String

	rows, err := s.db.Query(`SELECT id, name, color, perms, created_at FROM room_roles WHERE room_id = ? ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var role RoleRow
		if err := rows.Scan(&role.ID, &role.Name, &role.Color, &role.Perms, &role.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		room.Roles = append(room.Roles, role)
	}
	rows.Close()

	// В канале участники комнаты — все участники канала, а роль в комнате — из room_members
	if room.HubID != nil {
		rows, err = s.db.Query(`
			SELECT `+prefixed("u.", userColumns)+`, rm.role_id, rm.timeout_until, n.name
			FROM hub_members hm
			JOIN users u ON u.id = hm.user_id
			LEFT JOIN room_members rm ON rm.room_id = ? AND rm.user_id = hm.user_id
			LEFT JOIN hub_nicknames n ON n.hub_id = hm.hub_id AND n.user_id = hm.user_id
			WHERE hm.hub_id = ? ORDER BY hm.created_at`, id, *room.HubID)
	} else {
		rows, err = s.db.Query(`
			SELECT `+prefixed("u.", userColumns)+`, rm.role_id, rm.timeout_until, n.name
			FROM room_members rm
			JOIN users u ON u.id = rm.user_id
			LEFT JOIN rooms r ON r.id = rm.room_id
			LEFT JOIN hub_nicknames n ON n.hub_id = r.hub_id AND n.user_id = rm.user_id
			WHERE rm.room_id = ? ORDER BY rm.created_at`, id)
	}
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var member RoomMember
		var roleID, timeout sql.NullInt64
		var nickname sql.NullString
		user, err := scanUserWith(rows, &roleID, &timeout, &nickname)
		if err != nil {
			rows.Close()
			return nil, err
		}
		member.User = user
		if roleID.Valid {
			value := roleID.Int64
			member.RoleID = &value
		}
		if timeout.Valid {
			value := timeout.Int64
			member.TimeoutUntil = &value
		}
		if nickname.Valid {
			value := nickname.String
			member.Nickname = &value
		}
		room.Members = append(room.Members, member)
	}
	rows.Close()

	room.Bans = s.hubUsers(`SELECT u.id FROM room_bans b JOIN users u ON u.id = b.user_id WHERE b.room_id = ?`, id)
	return &room, nil
}

func (s *Store) UpdateRoomName(id int64, name string) error {
	_, err := s.db.Exec(`UPDATE rooms SET name = ? WHERE id = ?`, name, id)
	return err
}

func (s *Store) IsHubMember(hubID, userID int64) (bool, error) {
	var exists int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM hub_members WHERE hub_id = ? AND user_id = ?`, hubID, userID).Scan(&exists)
	return exists > 0, err
}
type HubInvite struct {
	HubID       int64
	HubName     string
	IconColor   string
	MemberCount int64
	From        *User
	CreatedAt   int64
}

func (s *Store) RenameHub(id int64, name string) error {
	_, err := s.db.Exec(`UPDATE hubs SET name = ? WHERE id = ?`, name, id)
	return err
}

func (s *Store) HubInvitesOf(userID int64) ([]HubInvite, error) {
	rows, err := s.db.Query(`
		SELECT i.hub_id, h.name, h.icon_color, i.created_at, i.by_id,
		       (SELECT COUNT(*) FROM hub_members m WHERE m.hub_id = i.hub_id)
		FROM hub_invites i JOIN hubs h ON h.id = i.hub_id
		WHERE i.user_id = ? ORDER BY i.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	var list []HubInvite
	var byIDs []int64
	for rows.Next() {
		var invite HubInvite
		var byID int64
		if err := rows.Scan(&invite.HubID, &invite.HubName, &invite.IconColor, &invite.CreatedAt, &byID, &invite.MemberCount); err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, invite)
		byIDs = append(byIDs, byID)
	}
	rows.Close()
	// Пользователей догружаем после закрытия rows: одно соединение SQLite
	for index, byID := range byIDs {
		if from, err := s.UserByID(byID); err == nil {
			list[index].From = from
		}
	}
	return list, nil
}
// RoomMemberIDs — кто получает события комнаты.
func (s *Store) RoomMemberIDs(roomID int64) ([]int64, error) {
	rows, err := s.db.Query(`
		SELECT user_id FROM room_members WHERE room_id = ?
		UNION
		SELECT m.user_id FROM rooms r JOIN hub_members m ON m.hub_id = r.hub_id WHERE r.id = ?`,
		roomID, roomID)
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

// RoomsOfHub — все комнаты канала (для рассылки room:updated при вступлении).
func (s *Store) RoomsOfHub(hubID int64) ([]*RoomRow, error) {
	rows, err := s.db.Query(`SELECT id FROM rooms WHERE hub_id = ? ORDER BY position, id`, hubID)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	list := make([]*RoomRow, 0, len(ids))
	for _, id := range ids {
		if room, err := s.RoomByID(id); err == nil {
			list = append(list, room)
		}
	}
	return list, nil
}

// DeleteHub — канал со всем содержимым (создатель удаляет насовсем).
func (s *Store) DeleteHub(hubID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM room_messages WHERE room_id IN (SELECT id FROM rooms WHERE hub_id = ?)`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM room_members WHERE room_id IN (SELECT id FROM rooms WHERE hub_id = ?)`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM room_roles WHERE room_id IN (SELECT id FROM rooms WHERE hub_id = ?)`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM room_bans WHERE room_id IN (SELECT id FROM rooms WHERE hub_id = ?)`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM rooms WHERE hub_id = ?`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM hub_members WHERE hub_id = ?`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM hub_invites WHERE hub_id = ?`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM hub_bans WHERE hub_id = ?`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM hub_roles WHERE hub_id = ?`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM hub_nicknames WHERE hub_id = ?`, hubID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM hubs WHERE id = ?`, hubID); err != nil {
		return err
	}
	return tx.Commit()
}
