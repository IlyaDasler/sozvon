package main

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestLimiterAllowsWithinLimit(t *testing.T) {
	l := newLimiter()
	for index := 0; index < 3; index++ {
		if !l.allow("message:1", 3, time.Minute) {
			t.Fatalf("отказ на попытке %d из 3", index+1)
		}
	}
	if l.allow("message:1", 3, time.Minute) {
		t.Fatal("четвёртая попытка должна быть отклонена")
	}
}

func TestLimiterKeepsKeysSeparate(t *testing.T) {
	l := newLimiter()
	if !l.allow("a:1", 1, time.Minute) || !l.allow("b:1", 1, time.Minute) {
		t.Fatal("разные ключи мешают друг другу")
	}
	if l.allow("a:1", 1, time.Minute) {
		t.Fatal("второй раз по ключу a:1 должен быть отказ")
	}
}

func TestLimiterHitCountsAndForgets(t *testing.T) {
	l := newLimiter()
	for index := 0; index < 10; index++ {
		l.hit("loginfail:user", time.Minute)
	}
	if got := l.peek("loginfail:user"); got != 10 {
		t.Fatalf("попыток входа: %d, ждали 10", got)
	}
	l.forget("loginfail:user")
	if got := l.peek("loginfail:user"); got != 0 {
		t.Fatalf("после успешного входа осталось %d попыток", got)
	}
}

func TestLimiterIgnoresZeroLimit(t *testing.T) {
	l := newLimiter()
	for index := 0; index < 5; index++ {
		if !l.allow("unlimited", 0, time.Minute) {
			t.Fatal("нулевой лимит должен отключать ограничение")
		}
	}
}

func TestClientIPIgnoresForwardedForFromPublicClient(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/login", nil)
	req.RemoteAddr = "203.0.113.9:4321"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	if got := clientIP(req); got != "203.0.113.9" {
		t.Fatalf("подделанный X-Forwarded-For принят от публичного клиента: %s", got)
	}
}

func TestClientIPTrustsForwardedForFromProxy(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/login", nil)
	req.RemoteAddr = "127.0.0.1:4321"
	req.Header.Set("X-Forwarded-For", "8.8.8.8")
	if got := clientIP(req); got != "8.8.8.8" {
		t.Fatalf("за прокси должен остаться адрес клиента, получили %s", got)
	}
}
