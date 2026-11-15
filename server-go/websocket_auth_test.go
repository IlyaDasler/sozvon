package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

func TestWebSocketRejectsSessionJWTInQuery(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	user, err := st.CreateUser("wsquery", "test-hash", "WS Query", "#123456")
	if err != nil {
		t.Fatal(err)
	}
	sessionID := "valid-session-for-query-test"
	if err := st.CreateSession(sessionID, user.ID, "test"); err != nil {
		t.Fatal(err)
	}
	secret := []byte("websocket-query-auth-test-secret")
	token := auth.SignToken(secret, user.ID, sessionID)
	app := &server{store: st, secret: secret, tickets: map[string]ticket{}}
	request := httptest.NewRequest(http.MethodGet, "/ws?token="+url.QueryEscape(token), nil)
	response := httptest.NewRecorder()

	app.websocket(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("session JWT in query returned %d, want %d (no WebSocket upgrade should be attempted)", response.Code, http.StatusUnauthorized)
	}
}

func TestWebSocketTicketIsSingleUse(t *testing.T) {
	app := &server{tickets: map[string]ticket{
		"one-use": {userID: 42, sid: "session-42", expires: time.Now().Add(time.Minute)},
	}}
	userID, sid, ok := app.redeemTicket("one-use")
	if !ok || userID != 42 || sid != "session-42" {
		t.Fatalf("first ticket redemption = (%d, %q, %v), want (42, session-42, true)", userID, sid, ok)
	}
	if _, _, ok := app.redeemTicket("one-use"); ok {
		t.Fatal("ticket was accepted more than once")
	}
}
