package main

import (
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestFileURLSignature(t *testing.T) {
	app := &server{secret: []byte("test-secret")}
	const id = "0123456789abcdef0123456789abcdef"
	link := app.fileURL(id, "документ.pdf")

	req := httptest.NewRequest("GET", link, nil)
	if !app.fileURLOK(id, req) {
		t.Fatal("подписанная ссылка не прошла проверку")
	}
	if app.fileURLOK("ffffffffffffffffffffffffffffffff", req) {
		t.Fatal("подпись подошла к чужому файлу")
	}

	expired := "/api/files/" + id + "/x?expires=1&sig=" + url.QueryEscape(app.fileSignature(id, 1))
	req = httptest.NewRequest("GET", expired, nil)
	if app.fileURLOK(id, req) {
		t.Fatal("просроченная ссылка прошла проверку")
	}

	unsigned := "/api/files/" + id + "/x"
	req = httptest.NewRequest("GET", unsigned, nil)
	if app.fileURLOK(id, req) {
		t.Fatal("ссылка без подписи прошла проверку")
	}
}
