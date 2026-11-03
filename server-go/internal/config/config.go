package config

import (
	"os"
	"path/filepath"
)

// Config повторяет переменные окружения Node-сервера, чтобы переключение
// между реализациями не требовало менять деплой.
type Config struct {
	Port       string
	DataDir    string
	InviteCode string
	SMTPHost   string
	SMTPUser   string
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
	return Config{
		Port:       port,
		DataDir:    dataDir,
		InviteCode: os.Getenv("INVITE_CODE"),
		SMTPHost:   os.Getenv("SMTP_HOST"),
		SMTPUser:   os.Getenv("SMTP_USER"),
	}
}

// EmailCodes — тот же признак, что и mailEnabled в Node: настроен SMTP.
func (c Config) EmailCodes() bool {
	return c.SMTPHost != "" && c.SMTPUser != ""
}
