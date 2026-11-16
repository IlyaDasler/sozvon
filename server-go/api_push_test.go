package main

import (
	"strings"
	"testing"

	"sozvon/server/internal/store"
)

func TestModerationPushPayloadKeepsReportDetailsOutOfNotification(t *testing.T) {
	notice := store.ModerationNotification{
		ID:       12,
		ReportID: 34,
		Kind:     "report_decision",
		Title:    "Жалоба рассмотрена",
		Body:     "Решение: private moderation details",
	}
	title, body, data := moderationPushPayload(notice)
	if title != notice.Title {
		t.Fatalf("unexpected title: %q", title)
	}
	if strings.Contains(body, "private moderation details") || strings.Contains(body, notice.Body) {
		t.Fatalf("sensitive report content leaked in push body: %q", body)
	}
	if body != "Откройте Созвон, чтобы посмотреть уведомление." {
		t.Fatalf("unexpected generic push body: %q", body)
	}
	if data["type"] != "moderation" || data["kind"] != notice.Kind || data["noticeId"] != "12" || data["reportId"] != "34" {
		t.Fatalf("missing moderation routing data: %#v", data)
	}
}

func TestModerationPushPayloadUsesFallbackTitle(t *testing.T) {
	title, _, _ := moderationPushPayload(store.ModerationNotification{Title: "  "})
	if title != "Уведомление по жалобе" {
		t.Fatalf("unexpected fallback title: %q", title)
	}
}
