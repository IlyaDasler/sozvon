// Резервная копия «Созвона»: база целиком (на ходу, сервер останавливать не нужно),
// аватарки, баннеры и вложения. Повторяет src/backup.js из Node-сервера:
// BACKUP_DIR — куда класть, BACKUP_KEEP_DAYS — сколько дней хранить.
package main

import (
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Таблицы, по которым проверяем, что копия не «пустее» оригинала
var checkedTables = []string{"users", "messages", "room_messages", "uploads"}

func main() {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}
	backupDir := os.Getenv("BACKUP_DIR")
	if backupDir == "" {
		backupDir = filepath.Join(filepath.Dir(dataDir), "sozvon-backups")
	}
	keepDays := 14
	if value := os.Getenv("BACKUP_KEEP_DAYS"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			keepDays = parsed
		}
	}
	if keepDays < 1 {
		keepDays = 14
	}

	target, copied, err := runBackup(dataDir, backupDir, keepDays)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ОШИБКА:", err)
		os.Exit(1)
	}
	fmt.Printf("Резервная копия готова: %s (новых файлов: %d, хранение: %d дней)\n", target, copied, keepDays)
}

// runBackup делает копию и возвращает путь к файлу базы и число новых файлов.
func runBackup(dataDir, backupDir string, keepDays int) (string, int, error) {
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return "", 0, fmt.Errorf("каталог копий: %w", err)
	}
	target, err := copyDatabase(dataDir, backupDir)
	if err != nil {
		return "", 0, err
	}
	copied, err := copyNewFiles(dataDir, backupDir, "files")
	if err != nil {
		return target, copied, err
	}
	more, err := copyNewFiles(dataDir, backupDir, "avatars")
	if err != nil {
		return target, copied + more, err
	}
	copied += more
	if err := dropOld(dataDir, backupDir, keepDays); err != nil {
		return target, copied, err
	}
	return target, copied, nil
}

// copyDatabase — VACUUM INTO на живой базе, затем проверка целостности и числа строк.
func copyDatabase(dataDir, backupDir string) (string, error) {
	stamp := time.Now().Format("2006-01-02-15")
	target := filepath.Join(backupDir, "sozvon-"+stamp+".db")
	_ = os.Remove(target)

	source, err := sql.Open("sqlite", "file:"+filepath.Join(dataDir, "sozvon.db")+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return "", fmt.Errorf("открыть базу: %w", err)
	}
	live, err := countRows(source)
	if err != nil {
		source.Close()
		return "", fmt.Errorf("исходная база: %w", err)
	}
	if _, err := source.Exec(`VACUUM INTO '` + strings.ReplaceAll(target, "'", "''") + `'`); err != nil {
		source.Close()
		return "", fmt.Errorf("VACUUM INTO: %w", err)
	}
	source.Close()

	copyDB, err := sql.Open("sqlite", "file:"+target+"?mode=ro")
	if err != nil {
		return "", fmt.Errorf("открыть копию: %w", err)
	}
	defer copyDB.Close()
	var check string
	if err := copyDB.QueryRow(`PRAGMA integrity_check`).Scan(&check); err != nil {
		return "", fmt.Errorf("проверка копии: %w", err)
	}
	if check != "ok" {
		return "", fmt.Errorf("копия базы повреждена: %s", check)
	}
	saved, err := countRows(copyDB)
	if err != nil {
		return "", fmt.Errorf("строки копии: %w", err)
	}
	for _, table := range checkedTables {
		if saved[table] < live[table] {
			return "", fmt.Errorf("в копии меньше строк в %s: %d из %d", table, saved[table], live[table])
		}
	}
	return target, nil
}

// countRows — число записей в контрольных таблицах.
func countRows(db *sql.DB) (map[string]int64, error) {
	counts := make(map[string]int64, len(checkedTables))
	for _, table := range checkedTables {
		var count int64
		if err := db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
			return nil, fmt.Errorf("%s: %w", table, err)
		}
		counts[table] = count
	}
	return counts, nil
}

// copyNewFiles — файлы не меняются (имя — случайный id), поэтому копируем только новые.
func copyNewFiles(dataDir, backupDir, folder string) (int, error) {
	from := filepath.Join(dataDir, folder)
	to := filepath.Join(backupDir, folder)
	if err := os.MkdirAll(to, 0o755); err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(from)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	copied := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		target := filepath.Join(to, entry.Name())
		if _, err := os.Stat(target); err == nil {
			continue
		}
		if err := copyFile(filepath.Join(from, entry.Name()), target); err != nil {
			return copied, err
		}
		copied++
	}
	return copied, nil
}

func copyFile(from, to string) error {
	source, err := os.Open(from)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(target, source); err != nil {
		target.Close()
		return err
	}
	return target.Close()
}

// dropOld — старые копии базы и файлы, которых больше нет на сервере и которые вышли из срока.
func dropOld(dataDir, backupDir string, keepDays int) error {
	limit := time.Now().Add(-time.Duration(keepDays) * 24 * time.Hour)
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if strings.HasPrefix(name, "sozvon-") && strings.HasSuffix(name, ".db") && info.ModTime().Before(limit) {
			if err := os.Remove(filepath.Join(backupDir, name)); err != nil {
				return err
			}
		}
	}
	for _, folder := range []string{"files", "avatars"} {
		copies, err := os.ReadDir(filepath.Join(backupDir, folder))
		if err != nil {
			continue
		}
		for _, entry := range copies {
			if entry.IsDir() {
				continue
			}
			info, err := entry.Info()
			if err != nil || !info.ModTime().Before(limit) {
				continue
			}
			// Файл ещё есть в резервной копии, но на сервере его уже нет — можно удалять
			if _, err := os.Stat(filepath.Join(dataDir, folder, entry.Name())); os.IsNotExist(err) {
				_ = os.Remove(filepath.Join(backupDir, folder, entry.Name()))
			}
		}
	}
	return nil
}
