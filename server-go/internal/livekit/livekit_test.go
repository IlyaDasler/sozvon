package livekit

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
)

func TestMediaTier(t *testing.T) {
	off := Options{}
	if off.Enabled() {
		t.Fatal("без настроек LiveKit должен быть выключен")
	}
	if off.MediaFor(10) != "p2p" {
		t.Fatal("без LiveKit всегда p2p")
	}
	on := Options{URL: "wss://lk", Key: "key", Secret: "secret", MinMembers: 3}
	if !on.Enabled() {
		t.Fatal("с настройками LiveKit должен быть включён")
	}
	if on.MediaFor(2) != "p2p" || on.MediaFor(3) != "sfu" {
		t.Fatalf("порог не сработал: %s, %s", on.MediaFor(2), on.MediaFor(3))
	}
}

func TestJoinGrant(t *testing.T) {
	opts := Options{URL: "wss://lk", Key: "key", Secret: "secret", MinMembers: 3}
	grant := opts.JoinGrant(7, 42, "Аня", true, true)
	if grant == nil || grant["url"] != "wss://lk" {
		t.Fatalf("пропуск: %+v", grant)
	}
	token, _ := grant["token"].(string)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("не JWT: %s", token)
	}
	payload := DecodeUnverified(token)
	if payload["iss"] != "key" || payload["sub"] != "42" || payload["name"] != "Аня" {
		t.Fatalf("payload: %+v", payload)
	}
	video, _ := payload["video"].(map[string]any)
	if video["room"] != "sozvon-room-7" || video["roomJoin"] != true || video["canPublish"] != true {
		t.Fatalf("video: %+v", video)
	}
	sources, _ := video["canPublishSources"].([]any)
	if len(sources) < 3 {
		t.Fatalf("источники: %+v", sources)
	}
	// Подпись должна сходиться с секретом
	mac := hmac.New(sha256.New, []byte("secret"))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if base64.RawURLEncoding.EncodeToString(mac.Sum(nil)) != parts[2] {
		t.Fatal("подпись не совпала")
	}
}
