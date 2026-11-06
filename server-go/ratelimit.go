package main

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// Ограничители частоты: те же, что в Node-сервере.
// Попытки входа/регистрации считаются по адресу, действия вошедшего человека — по id.

type limitEntry struct {
	count int
	reset time.Time
}

type limiter struct {
	mu      sync.Mutex
	entries map[string]*limitEntry
}

func newLimiter() *limiter {
	return &limiter{entries: map[string]*limitEntry{}}
}

// allow — не чаще max раз за window. Ключ — действие и субъект (адрес или id).
func (l *limiter) allow(key string, max int, window time.Duration) bool {
	if max <= 0 {
		return true
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.entries[key]
	if entry == nil || entry.reset.Before(now) {
		l.entries[key] = &limitEntry{count: 1, reset: now.Add(window)}
		return true
	}
	entry.count++
	return entry.count <= max
}

// hit — отметить попытку и вернуть её номер (для блокировки входа после неудач).
func (l *limiter) hit(key string, window time.Duration) int {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.entries[key]
	if entry == nil || entry.reset.Before(now) {
		entry = &limitEntry{count: 0, reset: now.Add(window)}
		l.entries[key] = entry
	}
	entry.count++
	return entry.count
}

// peek — текущее число попыток (для блокировки входа после неудач).
func (l *limiter) peek(key string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.entries[key]
	if entry == nil || entry.reset.Before(time.Now()) {
		return 0
	}
	return entry.count
}

func (l *limiter) forget(key string) {
	l.mu.Lock()
	delete(l.entries, key)
	l.mu.Unlock()
}

// clientIP — адрес за Caddy: сначала X-Forwarded-For, затем RemoteAddr.
func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		for index := 0; index < len(forwarded); index++ {
			if forwarded[index] == ',' {
				return forwarded[:index]
			}
		}
		return forwarded
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// authLimit — попытки по адресу (вход, регистрация, коды).
func (a *server) authLimit(r *http.Request, action string) bool {
	return a.limits.allow(action+":"+clientIP(r), a.cfg.AuthRateLimit, time.Minute)
}

// userLimit — действия вошедшего человека (сообщения, загрузки).
func (a *server) userLimit(userID int64, action string, max int, window time.Duration) bool {
	return a.limits.allow(action+":"+itoa(userID), max, window)
}

// loginLocked — перебор пароля одного аккаунта с разных адресов.
func (a *server) loginLocked(username string) bool {
	return a.limits.peek("loginfail:"+username) >= maxLoginFails
}

func (a *server) loginFailed(username string) {
	a.limits.hit("loginfail:"+username, loginLockWindow)
}

func (a *server) loginSucceeded(username string) {
	a.limits.forget("loginfail:" + username)
}

const (
	maxLoginFails   = 10
	loginLockWindow = 15 * time.Minute
)
