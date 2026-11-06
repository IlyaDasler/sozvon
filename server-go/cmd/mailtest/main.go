package main

import (
	"fmt"
	"os"

	"sozvon/server/internal/config"
	"sozvon/server/internal/mail"
)

// Проверка почтовых настроек тем же кодом, что у сервера: одно пробное письмо.
func main() {
	cfg := config.Load()
	if cfg.SMTPUser == "" {
		fmt.Fprintln(os.Stderr, "SMTP_USER не задан")
		os.Exit(1)
	}
	m := mail.New(mail.Options{
		Host:     cfg.SMTPHost,
		Port:     cfg.SMTPPort,
		User:     cfg.SMTPUser,
		Pass:     cfg.SMTPPass,
		From:     cfg.SMTPFrom,
		TestFile: cfg.MailTestFile,
	})
	if !m.Enabled() {
		fmt.Fprintln(os.Stderr, "почта не включилась: проверьте SMTP_HOST/SMTP_USER/SMTP_PASS")
		os.Exit(1)
	}
	if err := m.Send("register", cfg.SMTPUser); err != nil {
		fmt.Fprintf(os.Stderr, "Письмо не отправлено: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Письмо отправлено")
}
