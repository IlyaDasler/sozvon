package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"sozvon/server/internal/realtime"
	"sozvon/server/internal/store"
)

func TestRevokeOtherSessionsRejectsFreshDeviceButAllowsAfter24Hours(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	user, err := st.CreateUser("session_age", "", "Session Age", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	app := &server{store: st, hub: realtime.NewHub()}
	if err := st.CreateSession("current-session", user.ID, "Созвон 1.0.367 · Android"); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateSession("older-session", user.ID, "Созвон 3.6.13 · Windows"); err != nil {
		t.Fatal(err)
	}

	call := func(createdAt int64) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/sessions/revoke-others", nil)
		ctx := context.WithValue(request.Context(), userKey, user)
		ctx = context.WithValue(ctx, sessionKey, &store.Session{ID: "current-session", UserID: user.ID, CreatedAt: createdAt})
		request = request.WithContext(ctx)
		response := httptest.NewRecorder()
		app.revokeOtherSessions(response, request)
		return response
	}

	fresh := call(time.Now().UnixMilli())
	if fresh.Code != http.StatusForbidden {
		t.Fatalf("fresh session revoke status = %d, want 403; body=%s", fresh.Code, fresh.Body.String())
	}
	if !strings.Contains(fresh.Body.String(), "24 часов") {
		t.Fatalf("fresh session error should explain the 24-hour wait: %s", fresh.Body.String())
	}
	if sessions, err := st.SessionsOf(user.ID); err != nil || len(sessions) != 2 {
		t.Fatalf("fresh session request revoked another device: sessions=%+v err=%v", sessions, err)
	}

	aged := call(time.Now().Add(-24*time.Hour - time.Minute).UnixMilli())
	if aged.Code != http.StatusOK {
		t.Fatalf("aged session revoke status = %d, want 200; body=%s", aged.Code, aged.Body.String())
	}
	sessions, err := st.SessionsOf(user.ID)
	if err != nil || len(sessions) != 1 || sessions[0].ID != "current-session" {
		t.Fatalf("aged session should revoke only other devices: sessions=%+v err=%v", sessions, err)
	}
}
