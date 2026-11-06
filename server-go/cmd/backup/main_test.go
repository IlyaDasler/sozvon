package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"sozvon/server/internal/store"

	_ "modernc.org/sqlite"
)

func TestBackupCopiesDatabaseAndFiles(t *testing.T) {
	dataDir := t.TempDir()
	st, err := store.Open(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateUser("backup", "hash", "Копия", "#0090ff"); err != nil {
		t.Fatal(err)
	}
	st.Close()

	filesDir := filepath.Join(dataDir, "files")
	if err := os.MkdirAll(filesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filesDir, "abc123"), []byte("вложение"), 0o644); err != nil {
		t.Fatal(err)
	}
	avatarsDir := filepath.Join(dataDir, "avatars")
	if err := os.MkdirAll(avatarsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(avatarsDir, "avatar1.webp"), []byte("webp"), 0o644); err != nil {
		t.Fatal(err)
	}

	backupDir := t.TempDir()
	target, copied, err := runBackup(dataDir, backupDir, 14)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("файла копии нет: %v", err)
	}
	if copied != 2 {
		t.Fatalf("скопировано файлов: %d, ждали 2", copied)
	}

	copyDB, err := sql.Open("sqlite", "file:"+target+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	var users int64
	if err := copyDB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	copyDB.Close()
	if users != 1 {
		t.Fatalf("в копии пользователей: %d", users)
	}

	// Повторный прогон не копирует те же файлы заново
	if _, again, err := runBackup(dataDir, backupDir, 14); err != nil || again != 0 {
		t.Fatalf("повторная копия: файлов %d, ошибка %v", again, err)
	}

	// Старые копии за пределами срока хранения удаляются
	oldBackup := filepath.Join(backupDir, "sozvon-2020-01-01-00.db")
	if err := os.WriteFile(oldBackup, []byte("старое"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-30 * 24 * time.Hour)
	if err := os.Chtimes(oldBackup, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	// А этот файл на сервере ещё есть — его удалять нельзя
	kept := filepath.Join(backupDir, "files", "abc123")
	if err := os.Chtimes(kept, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	// Этот есть только в копии и старый — удаляем
	orphan := filepath.Join(backupDir, "files", "old-orphan")
	if err := os.WriteFile(orphan, []byte("старое"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(orphan, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	if err := dropOld(dataDir, backupDir, 14); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(oldBackup); !os.IsNotExist(err) {
		t.Fatal("старая копия базы не удалилась")
	}
	if _, err := os.Stat(kept); err != nil {
		t.Fatal("удалили файл, который ещё есть на сервере")
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatal("старый файл-сирота не удалился")
	}
}
