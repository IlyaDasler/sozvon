package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config повторяет переменные окружения Node-сервера, чтобы переключение
// между реализациями не требовало менять деплой.
type Config struct {
	Port               string
	DataDir            string
	InviteCode         string
	SMTPHost           string
	SMTPPort           string
	SMTPUser           string
	SMTPPass           string
	SMTPFrom           string
	MailTestFile       string
	OAuthTestBase      string
	PublicURL          string
	YandexClientID     string
	YandexClientSecret string

	// Политика версий клиента. Старые клиенты получают 426 и ссылку на обновление.
	MinClientVersion    string
	LatestClientVersion string
	ClientUpdateURL     string

	LiveKitURL        string
	LiveKitAPIURL     string
	LiveKitKey        string
	LiveKitSecret     string
	LiveKitMinMembers int

	StunURLs      []string
	TurnURLs      []string
	TurnSecret    string
	TurnEmbedded  bool
	PublicIP      string
	TurnPort      string
	ReconnectWait time.Duration
}

func list(value string) []string {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func numberEnv(name string, fallback int) int {
	if value := os.Getenv(name); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return fallback
}

func Load() Config {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		// как в Node: по умолчанию <корень проекта>/data
		dataDir = "data"
	}
	absolute, err := filepath.Abs(dataDir)
	if err == nil {
		dataDir = absolute
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	publicIP := os.Getenv("PUBLIC_IP")
	embedded := os.Getenv("TURN_EMBEDDED") == "1"
	turnPort := os.Getenv("TURN_PORT")
	if turnPort == "" {
		turnPort = "3478"
	}

	stun := list(os.Getenv("STUN_URLS"))
	if stun == nil {
		if embedded && publicIP != "" {
			stun = []string{"stun:" + publicIP + ":" + turnPort}
		} else {
			stun = []string{"stun:stun.l.google.com:19302"}
		}
	}
	turn := list(os.Getenv("TURN_URLS"))
	if turn == nil && embedded && publicIP != "" {
		turn = []string{"turn:" + publicIP + ":" + turnPort + "?transport=udp"}
	}

	return Config{
		Port:               port,
		DataDir:            dataDir,
		InviteCode:         os.Getenv("INVITE_CODE"),
		SMTPHost:           os.Getenv("SMTP_HOST"),
		SMTPPort:           envOr("SMTP_PORT", "587"),
		SMTPUser:           os.Getenv("SMTP_USER"),
		SMTPPass:           os.Getenv("SMTP_PASS"),
		SMTPFrom:           os.Getenv("SMTP_FROM"),
		MailTestFile:       os.Getenv("MAIL_TEST_FILE"),
		OAuthTestBase:      os.Getenv("OAUTH_TEST_BASE"),
		PublicURL:          os.Getenv("PUBLIC_URL"),
		YandexClientID:     os.Getenv("YANDEX_CLIENT_ID"),
		YandexClientSecret: os.Getenv("YANDEX_CLIENT_SECRET"),

		MinClientVersion:    envOr("MIN_CLIENT_VERSION", "3.0.0-beta.1"),
		LatestClientVersion: envOr("LATEST_CLIENT_VERSION", "3.0.0"),
		ClientUpdateURL:     envOr("CLIENT_UPDATE_URL", "https://github.com/IlyaDasler/sozvon/releases/latest"),

		LiveKitURL:        os.Getenv("LIVEKIT_URL"),
		LiveKitAPIURL:     envOr("LIVEKIT_API_URL", "http://127.0.0.1:7880"),
		LiveKitKey:        os.Getenv("LIVEKIT_API_KEY"),
		LiveKitSecret:     os.Getenv("LIVEKIT_API_SECRET"),
		LiveKitMinMembers: numberEnv("LIVEKIT_MIN_MEMBERS", 5),

		StunURLs:      stun,
		TurnURLs:      turn,
		TurnSecret:    os.Getenv("TURN_SECRET"),
		TurnEmbedded:  embedded,
		PublicIP:      publicIP,
		TurnPort:      turnPort,
		ReconnectWait: time.Duration(numberEnv("CALL_RECONNECT_GRACE_MS", 20_000)) * time.Millisecond,
	}
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// EmailCodes — тот же признак, что и mailEnabled в Node: настроен SMTP.
func (c Config) EmailCodes() bool {
	return c.SMTPHost != "" && c.SMTPUser != ""
}
