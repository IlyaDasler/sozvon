package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"sozvon/server/internal/store"
)

func prekeyMessage(identityPublic, signedPrekeyPublic string, createdAt int64) string {
	return fmt.Sprintf("sozvon-x3dh-bundle-v1|%s|%s|%d", identityPublic, signedPrekeyPublic, createdAt)
}

func (a *server) signPrekey(identityPublic, signedPrekeyPublic string, createdAt int64) string {
	if len(a.keySigningKey) == 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString(ed25519.Sign(a.keySigningKey, []byte(prekeyMessage(identityPublic, signedPrekeyPublic, createdAt))))
}

func (a *server) putPrekey(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	if user.PublicKey == "" {
		fail(http.StatusConflict, "Сначала опубликуйте ключ E2EE").write(w)
		return
	}
	if len(a.keySigningKey) == 0 {
		fail(http.StatusServiceUnavailable, "Подпись prekey недоступна").write(w)
		return
	}
	var body struct {
		SignedPrekeyPublic string `json:"signedPrekeyPublic"`
	}
	if err := decode(r, &body); err != nil || len(body.SignedPrekeyPublic) < 16 || len(body.SignedPrekeyPublic) > 4096 {
		fail(http.StatusBadRequest, "Неверный prekey").write(w)
		return
	}
	createdAt := time.Now().Unix()
	signature := a.signPrekey(user.PublicKey, body.SignedPrekeyPublic, createdAt)
	if err := a.store.PutPrekeyBundle(user.ID, body.SignedPrekeyPublic, signature, createdAt); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "createdAt": createdAt})
}

func (a *server) getPrekey(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		fail(http.StatusBadRequest, "Неверный пользователь").write(w)
		return
	}
	user, err := a.store.UserByID(id)
	if err != nil || user.PublicKey == "" {
		fail(http.StatusNotFound, "Ключ не найден").write(w)
		return
	}
	bundle, err := a.store.PrekeyBundle(id)
	if err == store.ErrNotFound {
		fail(http.StatusNotFound, "Prekey не найден").write(w)
		return
	}
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"identityPublic":     user.PublicKey,
		"signedPrekeyPublic": bundle.SignedPrekeyPublic,
		"signature":          bundle.Signature,
		"createdAt":          bundle.CreatedAt,
	})
}
