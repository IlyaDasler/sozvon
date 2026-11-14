package store

import (
	"errors"
	"testing"
	"time"
)

func TestAccountSoftDeleteRestoreAndPurge(t *testing.T) {
	store := newStore(t)
	user, err := store.CreateUser("deleteme", "scrypt$x$y", "Удалить", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	if err := store.SoftDeleteUser(user.ID, now); err != nil {
		t.Fatal(err)
	}
	got, err := store.UserByID(user.ID)
	if err != nil || got.DeletedAt != now {
		t.Fatalf("soft delete: %+v %v", got, err)
	}
	if err := store.RestoreUser(user.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = store.UserByID(user.ID)
	if got.DeletedAt != 0 {
		t.Fatal("restore не сбросил deleted_at")
	}
	if err := store.SoftDeleteUser(user.ID, now-31*86400); err != nil {
		t.Fatal(err)
	}
	n, err := store.PurgeDeletedUsers(now - 30*86400)
	if err != nil || n != 1 {
		t.Fatalf("purge n=%d err=%v", n, err)
	}
	if _, err := store.UserByID(user.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("аккаунт не удалён: %v", err)
	}
}
