package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

// Второй фактор: TOTP (6 цифр, шаг 30 с, окно ±1) и одноразовые резервные коды.

func totpCode(secret string, counter uint64) (string, error) {
	raw, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.ReplaceAll(secret, " ", "")))
	if err != nil {
		return "", err
	}
	var buffer [8]byte
	binary.BigEndian.PutUint64(buffer[:], counter)
	mac := hmac.New(sha1.New, raw)
	mac.Write(buffer[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1_000_000), nil
}

func totpCheck(secret, value string, now time.Time) bool {
	value = strings.TrimSpace(value)
	if len(value) != 6 {
		return false
	}
	counter := uint64(now.Unix() / 30)
	for _, step := range []int64{-1, 0, 1} {
		expected, err := totpCode(secret, uint64(int64(counter)+step))
		if err == nil && subtle.ConstantTimeCompare([]byte(expected), []byte(value)) == 1 {
			return true
		}
	}
	return false
}

func totpSecret() (string, error) {
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw), nil
}

func totpURI(secret, account string) string {
	query := url.Values{}
	query.Set("secret", secret)
	query.Set("issuer", "Созвон")
	query.Set("algorithm", "SHA1")
	query.Set("digits", "6")
	query.Set("period", "30")
	return "otpauth://totp/" + url.PathEscape("Созвон:"+account) + "?" + query.Encode()
}

func recoveryCodes(count int) ([]string, error) {
	list := make([]string, 0, count)
	for i := 0; i < count; i++ {
		raw := make([]byte, 5)
		if _, err := rand.Read(raw); err != nil {
			return nil, err
		}
		value := strings.ToUpper(hex.EncodeToString(raw))
		list = append(list, value[:5]+"-"+value[5:])
	}
	return list, nil
}

type recoveryState struct {
	Code string `json:"code"`
	Used bool   `json:"used"`
}

func spendRecovery(stored, code string) (string, bool) {
	var list []recoveryState
	if err := json.Unmarshal([]byte(stored), &list); err != nil {
		return stored, false
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	for index, item := range list {
		if !item.Used && strings.EqualFold(item.Code, code) {
			list[index].Used = true
			raw, _ := json.Marshal(list)
			return string(raw), true
		}
	}
	return stored, false
}

// secondFactorOK — пропускает по коду приложения или резервному коду (резервный сгорает).
func (a *server) secondFactorOK(user *store.User, code string) bool {
	if user.TotpSecret == "" {
		return true
	}
	if totpCheck(user.TotpSecret, code, time.Now()) {
		return true
	}
	recovery, _ := a.store.TotpRecovery(user.ID)
	if recovery == "" {
		return false
	}
	if updated, ok := spendRecovery(recovery, code); ok {
		_ = a.store.SetTotpRecovery(user.ID, updated)
		return true
	}
	return false
}

func (a *server) totpSetup(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Password string `json:"password"`
	}
	if err := decode(r, &request); err != nil || !auth.VerifyPassword(request.Password, user.PasswordHash) {
		fail(http.StatusUnauthorized, "Неверный пароль").write(w)
		return
	}
	secret, err := totpSecret()
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if err := a.store.SetTotpPending(user.ID, secret); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"secret": secret, "uri": totpURI(secret, user.Username)})
}

func (a *server) totpEnable(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	pending, err := a.store.TotpPending(user.ID)
	if err != nil || pending == "" {
		fail(http.StatusBadRequest, "Сначала настройте второй фактор").write(w)
		return
	}
	var request struct {
		Code string `json:"code"`
	}
	if err := decode(r, &request); err != nil || !totpCheck(pending, request.Code, time.Now()) {
		fail(http.StatusBadRequest, "Неверный код").write(w)
		return
	}
	codes, err := recoveryCodes(10)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	list := make([]recoveryState, 0, len(codes))
	for _, code := range codes {
		list = append(list, recoveryState{Code: code})
	}
	raw, _ := json.Marshal(list)
	if err := a.store.EnableTotp(user.ID, pending, string(raw)); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	fresh, _ := a.store.UserByID(user.ID)
	self, _ := a.self(fresh)
	writeJSON(w, http.StatusOK, map[string]any{"recoveryCodes": codes, "user": self})
}

func (a *server) totpDisable(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		Code string `json:"code"`
	}
	if err := decode(r, &request); err != nil || !a.secondFactorOK(user, request.Code) {
		fail(http.StatusUnauthorized, "Неверный код").write(w)
		return
	}
	if err := a.store.DisableTotp(user.ID); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	fresh, _ := a.store.UserByID(user.ID)
	self, _ := a.self(fresh)
	writeJSON(w, http.StatusOK, self)
}
