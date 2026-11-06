package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sozvon/server/internal/config"
)

// Веб-версия клиента: Node раздавал WEB_DIR, Go должен делать то же самое.
func TestStaticWebDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html><title>Созвон</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.js"), []byte("console.log('app')"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := &server{cfg: config.Config{WebDir: dir}, limits: newLimiter()}
	handler := app.routes()

	index := httptest.NewRecorder()
	handler.ServeHTTP(index, httptest.NewRequest(http.MethodGet, "/", nil))
	if index.Code != http.StatusOK {
		t.Fatalf("index: код %d", index.Code)
	}
	body, _ := io.ReadAll(index.Body)
	if !strings.Contains(string(body), "Созвон") {
		t.Fatalf("index.html не отдался: %q", string(body))
	}
	if contentType := index.Header().Get("Content-Type"); !strings.Contains(contentType, "text/html") {
		t.Fatalf("index: content-type %q", contentType)
	}

	script := httptest.NewRecorder()
	handler.ServeHTTP(script, httptest.NewRequest(http.MethodGet, "/app.js", nil))
	if script.Code != http.StatusOK {
		t.Fatalf("app.js: код %d", script.Code)
	}
	if contentType := script.Header().Get("Content-Type"); !strings.Contains(contentType, "javascript") {
		t.Fatalf("app.js: content-type %q", contentType)
	}

	// Неизвестный API — JSON 404, а не файл клиента
	api := httptest.NewRecorder()
	handler.ServeHTTP(api, httptest.NewRequest(http.MethodGet, "/api/нет-такого", nil))
	if api.Code != http.StatusNotFound {
		t.Fatalf("api 404: код %d", api.Code)
	}
	if contentType := api.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
		t.Fatalf("api 404: content-type %q", contentType)
	}
}

// Без WEB_DIR статики нет, но API продолжает работать.
func TestStaticDisabledWithoutWebDir(t *testing.T) {
	app := &server{cfg: config.Config{}, limits: newLimiter()}
	handler := app.routes()

	root := httptest.NewRecorder()
	handler.ServeHTTP(root, httptest.NewRequest(http.MethodGet, "/", nil))
	if root.Code != http.StatusNotFound {
		t.Fatalf("без WEB_DIR корень должен быть 404, а не %d", root.Code)
	}
}
