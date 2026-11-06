package livekit

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// Пропуска в медиасервер LiveKit: JWT HS256, тот же формат, что у Node.
// Без URL/ключа/секрета голос идёт напрямую между участниками (p2p).

type Options struct {
	URL        string
	APIURL     string
	Key        string
	Secret     string
	MinMembers int
}

func (o Options) Enabled() bool {
	return o.URL != "" && o.Key != "" && o.Secret != ""
}

func (o Options) Room(roomID int64) string {
	return "sozvon-room-" + itoa(roomID)
}

func (o Options) MediaFor(memberCount int) string {
	if o.Enabled() && memberCount >= o.MinMembers {
		return "sfu"
	}
	return "p2p"
}

type grant struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func b64(value []byte) string { return base64.RawURLEncoding.EncodeToString(value) }

func sign(secret string, claims map[string]any) string {
	header := map[string]any{"alg": "HS256", "typ": "JWT"}
	headerJSON, _ := json.Marshal(header)
	claimsJSON, _ := json.Marshal(claims)
	body := b64(headerJSON) + "." + b64(claimsJSON)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	return body + "." + b64(mac.Sum(nil))
}

// JoinGrant — пропуск в комнату: что можно публиковать, решают права участника.
func (o Options) JoinGrant(roomID int64, userID int64, name string, speak bool, video bool) map[string]any {
	if !o.Enabled() {
		return nil
	}
	sources := []string{}
	if speak {
		sources = append(sources, "microphone")
	}
	if video {
		sources = append(sources, "camera", "screen_share", "screen_share_audio")
	}
	now := time.Now().Unix()
	token := sign(o.Secret, map[string]any{
		"iss":  o.Key,
		"nbf":  now - 10,
		"exp":  now + 6*3600,
		"sub":  itoa(userID),
		"name": name,
		"video": map[string]any{
			"room":              o.Room(roomID),
			"roomJoin":          true,
			"canSubscribe":      true,
			"canPublish":        len(sources) > 0,
			"canPublishData":    false,
			"canPublishSources": sources,
		},
	})
	return map[string]any{"url": o.URL, "token": token}
}

// DecodeUnverified — для тестов: разобрать payload без проверки подписи.
func DecodeUnverified(token string) map[string]any {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	return payload
}

func itoa(value int64) string {
	if value == 0 {
		return "0"
	}
	digits := ""
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	return digits
}

// adminToken — пропуск администратора комнаты на минуту (как в Node).
func (o Options) adminToken(room string, ttl int64) string {
	now := time.Now().Unix()
	return sign(o.Secret, map[string]any{
		"iss": o.Key,
		"nbf": now - 10,
		"exp": now + ttl,
		"video": map[string]any{
			"roomAdmin": true,
			"roomList":  true,
			"room":      room,
		},
	})
}

func (o Options) twirp(method string, body map[string]any) error {
	if !o.Enabled() {
		return nil
	}
	payload, _ := json.Marshal(body)
	room, _ := body["room"].(string)
	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(o.APIURL, "/")+"/twirp/livekit.RoomService/"+method, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+o.adminToken(room, 60))
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		return errors.New("livekit: " + response.Status)
	}
	return nil
}

// RemoveParticipant — человека выгнали из голоса, убираем и с медиасервера.
func (o Options) RemoveParticipant(roomID, userID int64) error {
	return o.twirp("RemoveParticipant", map[string]any{"room": o.Room(roomID), "identity": itoa(userID)})
}

// DeleteRoom — комнату удалили, закрываем разговор в LiveKit.
func (o Options) DeleteRoom(roomID int64) error {
	return o.twirp("DeleteRoom", map[string]any{"room": o.Room(roomID)})
}

// ListRooms — проверка, что медиасервер принимает наш пропуск администратора.
func (o Options) ListRooms() (int, error) {
	if !o.Enabled() {
		return 0, errors.New("livekit не настроен")
	}
	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(o.APIURL, "/")+"/twirp/livekit.RoomService/ListRooms", bytes.NewReader([]byte("{}")))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+o.adminToken("", 60))
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	return response.StatusCode, nil
}
