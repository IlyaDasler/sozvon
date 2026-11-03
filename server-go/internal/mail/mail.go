package mail

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/smtp"
	"os"
	"strings"
	"sync"
	"time"
)

// Письма с шестизначными кодами: подтверждение почты и сброс пароля.
// MAIL_TEST_FILE (в тестах) — вместо SMTP дописываем письмо строкой JSON.

const (
	codeTTL  = 15 * time.Minute
	resendIn = time.Minute
	maxTries = 5
)

type Options struct {
	Host     string
	Port     string
	User     string
	Pass     string
	From     string
	TestFile string
}

type Mailer struct {
	opts  Options
	mu    sync.Mutex
	codes map[string]entry
}

type entry struct {
	code    string
	expires time.Time
	sentAt  time.Time
	tries   int
}

func New(opts Options) *Mailer {
	if opts.Port == "" {
		opts.Port = "587"
	}
	if opts.From == "" {
		opts.From = opts.User
	}
	return &Mailer{opts: opts, codes: map[string]entry{}}
}

func (m *Mailer) Enabled() bool {
	return m.opts.TestFile != "" || (m.opts.Host != "" && m.opts.User != "" && m.opts.Pass != "")
}

var ErrResend = errors.New("код уже отправлен")

func (m *Mailer) Send(purpose, email string) error {
	if !m.Enabled() {
		return errors.New("почта не настроена")
	}
	key := purpose + ":" + email
	m.mu.Lock()
	if prev, ok := m.codes[key]; ok && time.Since(prev.sentAt) < resendIn {
		m.mu.Unlock()
		return ErrResend
	}
	m.mu.Unlock()

	value, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return err
	}
	code := fmt.Sprintf("%06d", value.Int64())
	subjects := map[string]string{
		"register": "Код для регистрации в Созвоне",
		"reset":    "Код для смены пароля в Созвоне",
	}
	subject := subjects[purpose]
	if subject == "" {
		subject = "Код в Созвоне"
	}
	body := fmt.Sprintf("%s: %s\n\nКод действует 15 минут. Если это были не вы, просто удалите письмо.", subject, code)

	if m.opts.TestFile != "" {
		line, _ := json.Marshal(map[string]any{"to": email, "purpose": purpose, "code": code})
		file, err := os.OpenFile(m.opts.TestFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			return err
		}
		defer file.Close()
		if _, err := file.Write(append(line, '\n')); err != nil {
			return err
		}
	} else if err := m.sendSMTP(email, subject, body); err != nil {
		return err
	}

	m.mu.Lock()
	m.codes[key] = entry{code: code, expires: time.Now().Add(codeTTL), sentAt: time.Now()}
	m.mu.Unlock()
	return nil
}

func (m *Mailer) sendSMTP(to, subject, body string) error {
	address := m.opts.Host + ":" + m.opts.Port
	auth := smtp.PlainAuth("", m.opts.User, m.opts.Pass, m.opts.Host)
	message := []byte("From: Созвон <" + m.opts.From + ">\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n" +
		"\r\n" + body)
	if m.opts.Port == "465" {
		// SMTPS: сначала шифрованный канал, потом уже SMTP
		conn, err := tls.Dial("tcp", address, &tls.Config{ServerName: m.opts.Host})
		if err != nil {
			return err
		}
		defer conn.Close()
		client, err := smtp.NewClient(conn, m.opts.Host)
		if err != nil {
			return err
		}
		defer client.Close()
		if err := client.Auth(auth); err != nil {
			return err
		}
		if err := client.Mail(m.opts.From); err != nil {
			return err
		}
		if err := client.Rcpt(to); err != nil {
			return err
		}
		writer, err := client.Data()
		if err != nil {
			return err
		}
		if _, err := writer.Write(message); err != nil {
			return err
		}
		if err := writer.Close(); err != nil {
			return err
		}
		return client.Quit()
	}
	return smtp.SendMail(address, auth, m.opts.From, []string{to}, message)
}

// Check — ok / wrong / expired; верный код одноразовый.
func (m *Mailer) Check(purpose, email, code string) string {
	key := purpose + ":" + email
	m.mu.Lock()
	defer m.mu.Unlock()
	current, ok := m.codes[key]
	if !ok || time.Now().After(current.expires) {
		return "expired"
	}
	current.tries++
	if current.tries > maxTries {
		delete(m.codes, key)
		return "expired"
	}
	m.codes[key] = current
	if strings.TrimSpace(code) != current.code {
		return "wrong"
	}
	delete(m.codes, key)
	return "ok"
}
