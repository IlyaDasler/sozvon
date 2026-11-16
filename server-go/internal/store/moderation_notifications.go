package store

import (
	"database/sql"
	"time"
)

type ModerationNotification struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"userId"`
	ReportID  int64  `json:"reportId"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	CreatedAt int64  `json:"createdAt"`
	ReadAt    int64  `json:"readAt"`
}

func (s *Store) ModerationReportByID(id int64) (*ModerationReport, error) {
	var item ModerationReport
	err := s.db.QueryRow(`SELECT id, COALESCE(reporter_id, 0), target_type, target_id, category, reason, status, created_at,
		COALESCE(resolved_by, 0), COALESCE(resolved_at, 0), resolution FROM moderation_reports WHERE id = ?`, id).
		Scan(&item.ID, &item.ReporterID, &item.TargetType, &item.TargetID, &item.Category, &item.Reason, &item.Status, &item.CreatedAt, &item.ResolvedBy, &item.ResolvedAt, &item.Resolution)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *Store) CreateReportNotifications(report ModerationReport) ([]ModerationNotification, error) {
	now := time.Now().UnixMilli()
	title := "Новая жалоба"
	body := "Поступила жалоба: " + report.Category
	rows, err := s.db.Query(`SELECT user_id FROM admin_role_grants
		WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
		AND (role = 'super_admin' OR (permissions & ?) != 0)
		GROUP BY user_id`, now, AdminPermReports)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var recipients []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		recipients = append(recipients, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	created := make([]ModerationNotification, 0, len(recipients))
	for _, userID := range recipients {
		res, err := tx.Exec(`INSERT OR IGNORE INTO moderation_notifications (user_id, report_id, kind, title, body, created_at)
			VALUES (?, ?, 'report_new', ?, ?, ?)`, userID, report.ID, title, body, now)
		if err != nil {
			return nil, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		id, err := res.LastInsertId()
		if err != nil {
			return nil, err
		}
		created = append(created, ModerationNotification{ID: id, UserID: userID, ReportID: report.ID, Kind: "report_new", Title: title, Body: body, CreatedAt: now})
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created, nil
}

func (s *Store) CreateReportDecisionNotification(report ModerationReport) (*ModerationNotification, error) {
	if report.ReporterID <= 0 {
		return nil, nil
	}
	resolution := report.Resolution
	if resolution == "" {
		if report.Status == "resolved" {
			resolution = "Приняты меры по результатам рассмотрения."
		} else {
			resolution = "Нарушение не подтвердилось."
		}
	}
	title := "Жалоба рассмотрена"
	body := "Решение: " + resolution
	now := time.Now().UnixMilli()
	res, err := s.db.Exec(`INSERT OR IGNORE INTO moderation_notifications (user_id, report_id, kind, title, body, created_at)
		VALUES (?, ?, 'report_decision', ?, ?, ?)`, report.ReporterID, report.ID, title, body, now)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, nil
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return &ModerationNotification{ID: id, UserID: report.ReporterID, ReportID: report.ID, Kind: "report_decision", Title: title, Body: body, CreatedAt: now}, nil
}

func (s *Store) ModerationNotifications(userID int64, limit int) ([]ModerationNotification, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id, report_id, kind, title, body, created_at, read_at FROM moderation_notifications
		WHERE user_id = ? ORDER BY id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []ModerationNotification
	for rows.Next() {
		var item ModerationNotification
		if err := rows.Scan(&item.ID, &item.ReportID, &item.Kind, &item.Title, &item.Body, &item.CreatedAt, &item.ReadAt); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) MarkModerationNotificationsRead(userID int64, ids []int64) error {
	if len(ids) == 0 {
		_, err := s.db.Exec(`UPDATE moderation_notifications SET read_at = ? WHERE user_id = ? AND read_at = 0`, time.Now().UnixMilli(), userID)
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, id := range ids {
		if _, err := tx.Exec(`UPDATE moderation_notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at = 0`, time.Now().UnixMilli(), id, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
