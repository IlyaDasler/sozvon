package store

import (
	"errors"
	"testing"
)

func TestKeyBackupUpsertAndRead(t *testing.T) {
	store := newStore(t)
	user, err := store.CreateUser("backup", "scrypt$x$y", "Ключ", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.KeyBackup(user.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("пустая копия: %v", err)
	}
	first := KeyBackup{Salt: "salt-1", IV: "iv-1", CT: "ct-1", Iterations: 310000}
	if err := store.PutKeyBackup(user.ID, first); err != nil {
		t.Fatal(err)
	}
	got, err := store.KeyBackup(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Salt != first.Salt || got.CT != first.CT || got.Iterations != 310000 || got.UpdatedAt == 0 {
		t.Fatalf("копия прочиталась неверно: %+v", got)
	}
	second := KeyBackup{Salt: "salt-2", IV: "iv-2", CT: "ct-2", Iterations: 600000}
	if err := store.PutKeyBackup(user.ID, second); err != nil {
		t.Fatal(err)
	}
	got, err = store.KeyBackup(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.CT != "ct-2" || got.Iterations != 600000 {
		t.Fatalf("копия не обновилась: %+v", got)
	}
}
