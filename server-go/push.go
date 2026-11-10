package main

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// pushService — минимальный FCM HTTP v1 отправитель без внешних SDK.
// Service account читается только сервером и никогда не попадает в APK.
type pushService struct {
	projectID   string
	clientEmail string
	privateKey  *rsa.PrivateKey
	http        *http.Client

	mu          sync.Mutex
	accessToken string
	tokenUntil  time.Time
}

type serviceAccountFile struct {
	Type        string `json:"type"`
	ProjectID   string `json:"project_id"`
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
}

func newPushService(path string) (*pushService, error) {
	if path == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var creds serviceAccountFile
	if err := json.Unmarshal(raw, &creds); err != nil {
		return nil, err
	}
	if creds.Type != "service_account" || creds.ProjectID == "" || creds.ClientEmail == "" || creds.PrivateKey == "" {
		return nil, fmt.Errorf("некорректный Firebase service account")
	}
	block, _ := pem.Decode([]byte(creds.PrivateKey))
	if block == nil {
		return nil, fmt.Errorf("в service account нет private_key")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private_key не RSA")
	}
	return &pushService{
		projectID:   creds.ProjectID,
		clientEmail: creds.ClientEmail,
		privateKey:  rsaKey,
		http:        &http.Client{Timeout: 12 * time.Second},
	}, nil
}

func b64url(raw []byte) string { return base64.RawURLEncoding.EncodeToString(raw) }

func (p *pushService) token() (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.accessToken != "" && time.Now().Before(p.tokenUntil.Add(-time.Minute)) {
		return p.accessToken, nil
	}
	now := time.Now()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	claims, _ := json.Marshal(map[string]any{
		"iss":   p.clientEmail,
		"scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud":   "https://oauth2.googleapis.com/token",
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	})
	unsigned := b64url(header) + "." + b64url(claims)
	hash := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(rand.Reader, p.privateKey, crypto.SHA256, hash[:])
	if err != nil {
		return "", err
	}
	assertion := unsigned + "." + b64url(sig)
	form := "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + assertion
	res, err := p.http.Post("https://oauth2.googleapis.com/token", "application/x-www-form-urlencoded", strings.NewReader(form))
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", err
	}
	if res.StatusCode != http.StatusOK || body.AccessToken == "" {
		return "", fmt.Errorf("FCM OAuth: %s", body.Error)
	}
	p.accessToken = body.AccessToken
	p.tokenUntil = now.Add(time.Duration(body.ExpiresIn) * time.Second)
	return p.accessToken, nil
}

func (p *pushService) send(tokens []string, title, body string, data map[string]string) {
	if p == nil || len(tokens) == 0 {
		return
	}
	token, err := p.token()
	if err != nil {
		slogPush("FCM token", err)
		return
	}
	url := "https://fcm.googleapis.com/v1/projects/" + p.projectID + "/messages:send"
	for _, device := range tokens {
		payload, _ := json.Marshal(map[string]any{
			"message": map[string]any{
				"token":        device,
				"notification": map[string]string{"title": title, "body": body},
				"data":         data,
				"android":      map[string]any{"priority": "high"},
			},
		})
		req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		res, err := p.http.Do(req)
		if err != nil {
			slogPush("FCM send", err)
			continue
		}
		if res.StatusCode >= 300 {
			slogPush("FCM send", fmt.Errorf("HTTP %d", res.StatusCode))
		}
		res.Body.Close()
	}
}

func slogPush(where string, err error) {
	// Не логируем токены и текст сообщений — только факт ошибки.
	fmt.Fprintf(os.Stderr, "push %s: %v\n", where, err)
}

// pushRoomMessage отправляет push всем участникам комнаты, кроме автора.
func (a *server) pushRoomMessage(roomID, senderID int64, text string) {
	if a.push == nil {
		return
	}
	room, err := a.store.RoomByID(roomID)
	if err != nil || room == nil {
		return
	}
	members, err := a.store.RoomMemberIDs(roomID)
	if err != nil {
		return
	}
	recipients := make([]int64, 0, len(members))
	for _, id := range members {
		if id != senderID {
			recipients = append(recipients, id)
		}
	}
	tokens, err := a.store.PushTokensForUsers(recipients)
	if err != nil || len(tokens) == 0 {
		return
	}
	body := strings.TrimSpace(text)
	if body == "" {
		body = "Новое сообщение"
	}
	if len([]rune(body)) > 120 {
		body = string([]rune(body)[:120]) + "…"
	}
	go a.push.send(tokens, room.Name, body, map[string]string{"type": "room", "roomId": fmt.Sprint(roomID)})
}

func (a *server) pushDM(senderID, peerID int64, text string) {
	if a.push == nil {
		return
	}
	tokens, err := a.store.PushTokensForUsers([]int64{peerID})
	if err != nil || len(tokens) == 0 {
		return
	}
	body := strings.TrimSpace(text)
	if body == "" {
		body = "Новое сообщение"
	}
	if len([]rune(body)) > 120 {
		body = string([]rune(body)[:120]) + "…"
	}
	go a.push.send(tokens, "Созвон", body, map[string]string{"type": "dm", "contactId": fmt.Sprint(senderID)})
}
