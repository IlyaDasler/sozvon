package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"sozvon/server/internal/config"
)

// Политика версий должна совпадать с Node: блокируем только старые клиенты
// по User-Agent «Sozvon/1.x», а запросы без версии (браузер, e2e, curl) проходят.
func TestClientVersionPolicy(t *testing.T) {
	app := &server{cfg: config.Config{MinClientVersion: "3.0.0-beta.1", LatestClientVersion: "3.0.0"}}
	allowed := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	handler := app.requireClientVersion(allowed)

	cases := []struct {
		name   string
		ua     string
		header string
		path   string
		want   int
	}{
		{"браузер без версии", "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140", "", "/api/me", http.StatusOK},
		{"electron без заголовка", "Mozilla/5.0 Electron/45.0.0 Chrome/140", "", "/api/me", http.StatusOK},
		{"curl без версии", "curl/8.5.0", "", "/api/me", http.StatusOK},
		{"старый клиент 1.9", "Sozvon/1.9.0 (Windows)", "", "/api/me", http.StatusUpgradeRequired},
		{"клиент 2.0", "Sozvon/2.0.0 (Windows)", "", "/api/me", http.StatusOK},
		{"клиент 3.0", "Sozvon/3.0.0 (Windows)", "", "/api/me", http.StatusOK},
		{"заголовок не блокирует как в Node", "Sozvon/2.5.0", "2.5.0", "/api/me", http.StatusOK},
		{"health открыт даже старому", "Sozvon/1.0.0", "", "/api/health", http.StatusOK},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			request.Header.Set("User-Agent", test.ua)
			if test.header != "" {
				request.Header.Set("X-Client-Version", test.header)
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("код %d, ждали %d", recorder.Code, test.want)
			}
		})
	}
}
