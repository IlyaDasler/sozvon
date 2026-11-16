package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/config"
	"sozvon/server/internal/store"
)

func mustJar(t *testing.T) *cookiejar.Jar {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return jar
}

type adminTestClient struct {
	t      *testing.T
	server *httptest.Server
	client *http.Client
	csrf   string
	store  *store.Store
	owner  *store.User
}

func newAdminTestClient(t *testing.T) *adminTestClient {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	hash, err := auth.HashPassword("password123")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := st.CreateUser("admin", hash, "Админ", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	moderator, err := st.CreateUser("moder", hash, "Модератор", "#12a594")
	if err != nil {
		t.Fatal(err)
	}
	target, err := st.CreateUser("target", hash, "Цель", "#e5484d")
	if err != nil {
		t.Fatal(err)
	}
	_ = moderator.ID
	_ = target.ID
	app := &server{
		cfg:    config.Config{SuperAdminIDs: []int64{owner.ID}, DataDir: t.TempDir()},
		store:  st,
		secret: []byte("test-secret-0123456789"),
		limits: newLimiter(),
	}
	app.dummyHash, _ = auth.HashPassword("dummy-password")
	app.ensureSuperAdmins()
	server := httptest.NewServer(app.routes())
	t.Cleanup(server.Close)
	jar, _ := cookiejar.New(nil)
	return &adminTestClient{t: t, server: server, client: &http.Client{Jar: jar}, store: st, owner: owner}
}

func (c *adminTestClient) do(method, path string, body any, csrf bool) (*http.Response, map[string]any) {
	c.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, c.server.URL+path, reader)
	req.Header.Set("Content-Type", "application/json")
	if csrf {
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	data := map[string]any{}
	raw, _ := io.ReadAll(resp.Body)
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &data)
	}
	return resp, data
}

func (c *adminTestClient) login(username string) {
	c.t.Helper()
	resp, body := c.do(http.MethodPost, "/api/admin/login", map[string]any{"username": username, "password": "password123"}, false)
	if resp.StatusCode != http.StatusOK {
		c.t.Fatalf("login %s: %d %v", username, resp.StatusCode, body)
	}
	c.csrf, _ = body["csrfToken"].(string)
	if c.csrf == "" {
		c.t.Fatal("csrf token missing")
	}
}

func TestAdminPanelIsServedAndProtected(t *testing.T) {
	c := newAdminTestClient(t)
	resp, err := c.client.Get(c.server.URL + "/admin")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(resp.Header.Get("Content-Security-Policy"), "frame-ancestors") {
		t.Fatalf("admin page: %d %q", resp.StatusCode, resp.Header.Get("Content-Security-Policy"))
	}
	resp, _ = c.do(http.MethodGet, "/api/admin/users", nil, false)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous admin api: %d", resp.StatusCode)
	}
}

func TestModeratorCanRequestBanAndOnlySuperApproves(t *testing.T) {
	c := newAdminTestClient(t)
	c.login("admin")
	resp, body := c.do(http.MethodGet, "/api/admin/me", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("me: %d %v", resp.StatusCode, body)
	}
	if token, _ := body["csrfToken"].(string); token != "" {
		c.csrf = token
	}
	resp, body = c.do(http.MethodGet, "/api/admin/users", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("users: %d %v", resp.StatusCode, body)
	}
	users, _ := body["users"].([]any)
	if len(users) < 3 {
		t.Fatalf("users: %v", body)
	}
	var moderatorID, targetID int64
	for _, raw := range users {
		user, _ := raw.(map[string]any)
		if user["Username"] == "moder" {
			moderatorID = int64(user["ID"].(float64))
		}
		if user["Username"] == "target" {
			targetID = int64(user["ID"].(float64))
		}
	}
	resp, body = c.do(http.MethodPost, "/api/admin/roles", map[string]any{"userId": moderatorID, "role": "moderator", "reason": "test"}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("grant: %d %v", resp.StatusCode, body)
	}

	moderator := &adminTestClient{t: t, server: c.server, client: &http.Client{Jar: mustJar(t)}}
	moderator.login("moder")
	resp, body = moderator.do(http.MethodPost, "/api/admin/users/"+strconv.FormatInt(targetID, 10)+"/ban", map[string]any{"reason": "нарушение правил"}, true)
	if resp.StatusCode != http.StatusAccepted || body["pending"] != true {
		t.Fatalf("moderator ban request: %d %v", resp.StatusCode, body)
	}
	approvalID := int64(body["approvalId"].(float64))

	// Модератор не может выдать роль.
	resp, _ = moderator.do(http.MethodPost, "/api/admin/roles", map[string]any{"userId": targetID, "role": "moderator"}, true)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("moderator grant role: %d", resp.StatusCode)
	}

	resp, body = c.do(http.MethodPost, "/api/admin/approvals/"+strconv.FormatInt(approvalID, 10)+"/approve", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("approve: %d %v", resp.StatusCode, body)
	}
	resp, body = c.do(http.MethodGet, "/api/admin/users?q=target", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("users after ban: %d", resp.StatusCode)
	}
	list, _ := body["users"].([]any)
	if len(list) == 0 {
		t.Fatal("target disappeared")
	}
	user := list[0].(map[string]any)
	if user["BannedAt"].(float64) == 0 {
		t.Fatalf("target not banned: %v", user)
	}
}

func TestAdminChannelPrivacyAndLastLogin(t *testing.T) {
	c := newAdminTestClient(t)
	c.login("admin")
	hub, err := c.store.CreateHub(c.owner.ID, "Приватный", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	resp, body := c.do(http.MethodPatch, "/api/admin/channels/hub/"+strconv.FormatInt(hub.ID, 10)+"/privacy", map[string]any{"privacy": "hidden", "reason": "тест"}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("privacy: %d %v", resp.StatusCode, body)
	}
	resp, body = c.do(http.MethodGet, "/api/admin/channels?kind=hub", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("channels: %d", resp.StatusCode)
	}
	found := false
	for _, raw := range body["channels"].([]any) {
		item := raw.(map[string]any)
		if int64(item["ID"].(float64)) == hub.ID {
			found = true
			if item["Privacy"] != "hidden" {
				t.Fatalf("privacy: %v", item["Privacy"])
			}
		}
	}
	if !found {
		t.Fatal("hub not listed")
	}
}

func TestSuperAdminBanAndRestoreEmptyAccount(t *testing.T) {
	c := newAdminTestClient(t)
	c.login("admin")
	resp, body := c.do(http.MethodGet, "/api/admin/users?q=target", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("users: %d", resp.StatusCode)
	}
	list := body["users"].([]any)
	if len(list) != 1 {
		t.Fatalf("target: %v", body)
	}
	targetID := int64(list[0].(map[string]any)["ID"].(float64))
	resp, body = c.do(http.MethodPost, "/api/admin/users/"+strconv.FormatInt(targetID, 10)+"/ban", map[string]any{"reason": "тест"}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("ban: %d %v", resp.StatusCode, body)
	}
	user, err := c.store.UserByID(targetID)
	if err != nil || user.BannedAt == 0 || user.PasswordHash != "!" {
		t.Fatalf("banned: %+v %v", user, err)
	}
	resp, body = c.do(http.MethodPost, "/api/admin/users/"+strconv.FormatInt(targetID, 10)+"/unban", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unban: %d %v", resp.StatusCode, body)
	}
	if body["temporaryPassword"] == "" {
		t.Fatal("temporary password missing")
	}
	user, err = c.store.UserByID(targetID)
	if err != nil || user.BannedAt != 0 || user.PasswordHash == "!" {
		t.Fatalf("restored: %+v %v", user, err)
	}
	if user.PublicKey != "" {
		t.Fatalf("public key restored: %q", user.PublicKey)
	}
}

func TestModeratorChannelDeleteNeedsSuperApproval(t *testing.T) {
	c := newAdminTestClient(t)
	c.login("admin")
	hub, err := c.store.CreateHub(c.owner.ID, "На удаление", "#0090ff")
	if err != nil {
		t.Fatal(err)
	}
	resp, body := c.do(http.MethodGet, "/api/admin/users?q=moder", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("users: %d", resp.StatusCode)
	}
	moderID := int64(body["users"].([]any)[0].(map[string]any)["ID"].(float64))
	c.do(http.MethodPost, "/api/admin/roles", map[string]any{"userId": moderID, "role": "moderator", "reason": "test"}, true)
	moderator := &adminTestClient{t: t, server: c.server, client: &http.Client{Jar: mustJar(t)}}
	moderator.login("moder")
	resp, body = moderator.do(http.MethodDelete, "/api/admin/channels/hub/"+strconv.FormatInt(hub.ID, 10), map[string]any{"reason": "нарушение"}, true)
	if resp.StatusCode != http.StatusAccepted || body["pending"] != true {
		t.Fatalf("delete request: %d %v", resp.StatusCode, body)
	}
	approvalID := int64(body["approvalId"].(float64))
	resp, body = c.do(http.MethodPost, "/api/admin/approvals/"+strconv.FormatInt(approvalID, 10)+"/approve", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("approve: %d %v", resp.StatusCode, body)
	}
	if _, err := c.store.HubByID(hub.ID); err == nil {
		t.Fatal("hub still exists")
	}
}

func TestModerationApiUsesAppSession(t *testing.T) {
	c := newAdminTestClient(t)
	c.login("admin")
	// Выдаём модератора.
	resp, body := c.do(http.MethodGet, "/api/admin/users?q=moder", nil, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("users: %d", resp.StatusCode)
	}
	moderID := int64(body["users"].([]any)[0].(map[string]any)["ID"].(float64))
	c.do(http.MethodPost, "/api/admin/roles", map[string]any{"userId": moderID, "role": "moderator", "reason": "test"}, true)

	login := func(username string) string {
		req, _ := http.NewRequest(http.MethodPost, c.server.URL+"/api/login", bytes.NewReader([]byte(`{"username":"`+username+`","password":"password123"}`)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Client-Version", "3.8.3")
		res, err := c.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var payload map[string]any
		_ = json.NewDecoder(res.Body).Decode(&payload)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("app login %s: %d %v", username, res.StatusCode, payload)
		}
		return payload["token"].(string)
	}
	modToken := login("moder")
	req, _ := http.NewRequest(http.MethodGet, c.server.URL+"/api/moderation/me", nil)
	req.Header.Set("Authorization", "Bearer "+modToken)
	req.Header.Set("X-Client-Version", "3.8.3")
	res, err := c.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var me map[string]any
	_ = json.NewDecoder(res.Body).Decode(&me)
	if res.StatusCode != http.StatusOK || me["isSuper"] != false {
		t.Fatalf("moderation me: %d %v", res.StatusCode, me)
	}
}
