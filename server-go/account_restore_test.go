package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sozvon/server/internal/store"
)

func TestAccountRestoreRejectsExpiredDeletion(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	user, err := st.CreateUser("expired_restore", "scrypt$x$y", "Expired", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	deletedAt := time.Now().Add(-31 * 24 * time.Hour).Unix()
	if err := st.SoftDeleteUser(user.ID, deletedAt); err != nil {
		t.Fatal(err)
	}
	deleted, err := st.UserByID(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	app := &server{store: st, secret: []byte("account-restore-secret")}
	request := httptest.NewRequest(http.MethodPost, "/api/account/restore", nil)
	request = request.WithContext(context.WithValue(request.Context(), userKey, deleted))
	response := httptest.NewRecorder()
	app.accountRestore(response, request)
	if response.Code != http.StatusGone {
		t.Fatalf("expired restore status = %d, want %d; body=%s", response.Code, http.StatusGone, response.Body.String())
	}
	stillDeleted, err := st.UserByID(user.ID)
	if err != nil || stillDeleted.DeletedAt != deletedAt {
		t.Fatalf("expired account was restored: user=%+v err=%v", stillDeleted, err)
	}
}
