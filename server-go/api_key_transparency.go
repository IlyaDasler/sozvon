package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"time"
)

// Публичный экспорт только хешей и подписей: внешний GitHub-журнал не должен
// получать открытые ключи и идентификаторы пользователей.
func (a *server) keyTransparencyExport(w http.ResponseWriter, r *http.Request) {
	rows, err := a.store.AllKeyHistory()
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	byUser := map[string][]map[string]any{}
	for _, row := range rows {
		mac := hmac.New(sha256.New, a.secret)
		mac.Write([]byte(strconv.FormatInt(row.UserID, 10)))
		userHash := hex.EncodeToString(mac.Sum(nil))
		byUser[userHash] = append(byUser[userHash], map[string]any{
			"prevHash":  row.PrevHash,
			"entryHash": row.EntryHash,
			"signature": row.Signature,
			"changedAt": row.ChangedAt,
		})
	}
	users := make([]map[string]any, 0, len(byUser))
	for id, entries := range byUser {
		users = append(users, map[string]any{"userHash": id, "entries": entries})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"updatedAt": time.Now().Unix(),
		"users":     users,
	})
}
