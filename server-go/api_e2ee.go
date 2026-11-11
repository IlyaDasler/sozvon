package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"sozvon/server/internal/store"
)

// Резервная копия ключа шифрования аккаунта.
//
// Ключ создаётся на устройстве, но его зашифрованная копия лежит на сервере:
// после входа на новом устройстве она подключается сама, без ручного переноса
// кодом. На диске копия запечатана AES-GCM ключом, выведенным из секрета сервера
// и ID пользователя, поэтому в открытом виде в базе не лежит.

const keyBackupMax = 12 << 10

type keyBackupRequest struct {
	Identity json.RawMessage `json:"identity"`
}

func (a *server) keyBackupKey(userID int64) []byte {
	sum := sha256.New()
	sum.Write(a.secret)
	sum.Write([]byte("sozvon-e2ee-backup-v1"))
	sum.Write([]byte(strconv.FormatInt(userID, 10)))
	return sum.Sum(nil)
}

func (a *server) sealKeyBackup(userID int64, plain []byte) (string, error) {
	block, err := aes.NewCipher(a.keyBackupKey(userID))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, plain, nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (a *server) openKeyBackup(userID int64, blob string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(blob)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(a.keyBackupKey(userID))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(raw) < gcm.NonceSize() {
		return nil, errInvalidBackup
	}
	return gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
}

var errInvalidBackup = errors.New("invalid key backup")

// setMyKeyBackup сохраняет копию ключа, присланную клиентом.
func (a *server) setMyKeyBackup(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request keyBackupRequest
	if err := decode(r, &request); err != nil || len(request.Identity) < 16 || len(request.Identity) > keyBackupMax {
		fail(http.StatusBadRequest, "Неверный ключ").write(w)
		return
	}
	var identity struct {
		PublicKey  string          `json:"publicKey"`
		PrivateJwk json.RawMessage `json:"privateJwk"`
	}
	if err := json.Unmarshal(request.Identity, &identity); err != nil || identity.PublicKey == "" || len(identity.PrivateJwk) < 16 {
		fail(http.StatusBadRequest, "Неверный ключ").write(w)
		return
	}
	if user.PublicKey != "" && user.PublicKey != identity.PublicKey {
		fail(http.StatusConflict, "Ключ не совпадает с публичным ключом аккаунта").write(w)
		return
	}
	blob, err := a.sealKeyBackup(user.ID, request.Identity)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if err := a.store.SetKeyBackup(user.ID, blob); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// getMyKeyBackup отдаёт копию ключа любому активному входу этого аккаунта.
func (a *server) getMyKeyBackup(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	blob, err := a.store.KeyBackup(user.ID)
	if err != nil && err != store.ErrNotFound {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if blob == "" {
		writeJSON(w, http.StatusOK, map[string]any{"identity": nil})
		return
	}
	plain, err := a.openKeyBackup(user.ID, blob)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось прочитать резервную копию ключа").write(w)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(append(append([]byte(`{"identity":`), plain...), '}'))
}
