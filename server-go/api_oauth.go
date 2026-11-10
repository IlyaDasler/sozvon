package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/oauth"
	"sozvon/server/internal/store"
)

// Вход через Яндекс ID: приложение и браузер, привязка профиля, регистрация по приглашению.

const (
	webFlowTTL  = 10 * time.Minute
	webCodeTTL  = time.Minute
	ticketTTL   = 15 * time.Minute
	stateCookie = "sozvon_oauth"
)

type oauthTicket struct {
	Provider   string `json:"provider"`
	ProviderID string `json:"providerId"`
	Email      string `json:"email"`
	Login      string `json:"login"`
	Name       string `json:"name"`
	Expires    int64  `json:"exp"`
}

type webFlow struct {
	provider string
	verifier string
	returnTo string
	expires  time.Time
}

type webCode struct {
	token   string
	ticket  string
	expires time.Time
}

var oauthState = struct {
	mu    sync.Mutex
	flows map[string]webFlow
	codes map[string]webCode
}{flows: map[string]webFlow{}, codes: map[string]webCode{}}

func (a *server) signTicket(ticket oauthTicket) string {
	raw, _ := json.Marshal(ticket)
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *server) readTicket(value string) (*oauthTicket, bool) {
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return nil, false
	}
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte(parts[0]))
	given, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(mac.Sum(nil), given) {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, false
	}
	var ticket oauthTicket
	if err := json.Unmarshal(raw, &ticket); err != nil {
		return nil, false
	}
	if ticket.Expires < time.Now().UnixMilli() {
		return nil, false
	}
	return &ticket, true
}

func providerName(id string) string {
	if id == "yandex" {
		return "Яндекс"
	}
	return id
}

func (a *server) oauthProviders(w http.ResponseWriter, _ *http.Request) {
	list := []map[string]any{}
	if a.oauth.Enabled() {
		list = append(list, map[string]any{"id": "yandex", "name": providerName("yandex")})
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *server) oauthURL(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	if provider != "yandex" || !a.oauth.Enabled() {
		fail(http.StatusNotFound, "Этот способ входа не настроен на сервере").write(w)
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	challenge := strings.TrimSpace(r.URL.Query().Get("challenge"))
	if len(state) < 8 || len(challenge) < 16 {
		fail(http.StatusBadRequest, "Неверные параметры входа").write(w)
		return
	}
	redirect := strings.TrimSpace(r.URL.Query().Get("redirectUri"))
	url, err := a.oauth.BuildURL(state, challenge, redirect)
	if err != nil {
		fail(http.StatusBadGateway, err.Error()).write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": url})
}

// oauthAuth — вход/регистрация/привязка после кода из приложения.
func (a *server) oauthAuth(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	if provider != "yandex" || !a.oauth.Enabled() {
		fail(http.StatusNotFound, "Этот способ входа не настроен на сервере").write(w)
		return
	}
	var request struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"codeVerifier"`
		Mode         string `json:"mode"`
		InviteCode   string `json:"inviteCode"`
	}
	if err := decode(r, &request); err != nil || request.Code == "" || len(request.CodeVerifier) < 16 {
		fail(http.StatusBadRequest, "Неверные параметры входа").write(w)
		return
	}

	var linking *store.User
	if request.Mode == "link" {
		header := strings.TrimPrefix(strings.TrimSpace(r.Header.Get("Authorization")), "Bearer ")
		token, err := auth.ReadToken(a.secret, header)
		if err != nil || token.SID == "" {
			fail(http.StatusUnauthorized, "Нужно войти заново").write(w)
			return
		}
		session, err := a.store.SessionByID(token.SID)
		if err != nil || session.UserID != token.UID {
			fail(http.StatusUnauthorized, "Нужно войти заново").write(w)
			return
		}
		linking, _ = a.store.UserByID(session.UserID)
	}

	profile, err := a.oauth.FetchProfile(request.Code, request.CodeVerifier)
	if err != nil {
		fail(http.StatusBadGateway, err.Error()).write(w)
		return
	}

	if linking != nil {
		existingID, _, exists, err := a.store.FindIdentity(provider, profile.ProviderID)
		if err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		if exists && existingID != linking.ID {
			fail(http.StatusConflict, "Этот аккаунт уже привязан к другому профилю").write(w)
			return
		}
		if err := a.store.AddIdentity(provider, profile.ProviderID, linking.ID, profile.Email); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		a.respondSelf(w, linking.ID)
		return
	}

	if userID, _, exists, err := a.store.FindIdentity(provider, profile.ProviderID); err == nil && exists {
		user, err := a.store.UserByID(userID)
		if err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		a.enterUser(w, r, user, false)
		return
	}

	// Профиль новый: без кода приглашения выдаём подписанный пропуск
	if a.cfg.InviteCode != "" && strings.TrimSpace(request.InviteCode) != a.cfg.InviteCode {
		ticket := a.signTicket(oauthTicket{
			Provider: provider, ProviderID: profile.ProviderID,
			Email: profile.Email, Login: profile.Login, Name: profile.Name,
			Expires: time.Now().Add(ticketTTL).UnixMilli(),
		})
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error":      "Аккаунт подтверждён. Введите код приглашения, чтобы создать профиль",
			"needInvite": true,
			"ticket":     ticket,
		})
		return
	}
	user, err := a.createOAuthUser(provider, profile)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.enterUser(w, r, user, true)
}

func (a *server) createOAuthUser(provider string, profile *oauth.Profile) (*store.User, error) {
	source := profile.Email
	if source == "" {
		source = profile.Login
	}
	username := a.makeUsername(source)
	display := strings.TrimSpace(profile.Name)
	if display == "" {
		display = username
	}
	if len([]rune(display)) > 32 {
		display = string([]rune(display)[:32])
	}
	user, err := a.store.CreateUser(username, "", display, colors[time.Now().UnixNano()%int64(len(colors))])
	if err != nil {
		return nil, err
	}
	if err := a.store.AddIdentity(provider, profile.ProviderID, user.ID, profile.Email); err != nil {
		return nil, err
	}
	return user, nil
}

func (a *server) enterUser(w http.ResponseWriter, r *http.Request, user *store.User, created bool) {
	// OAuth-вход не заменяет второй фактор: иначе включённый TOTP
	// обходится одним паролем/аккаунтом сервиса.
	if user.TotpSecret != "" {
		fail(http.StatusForbidden, "У аккаунта включён второй фактор — войдите по логину и паролю").write(w)
		return
	}
	token, err := a.openSession(user, r.UserAgent())
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	self, err := a.self(user)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := map[string]any{"token": token, "user": self}
	if created {
		body["created"] = true
	}
	writeJSON(w, http.StatusOK, body)
}

// signupComplete — профиль по пропуску из OAuth и коду приглашения.
func (a *server) signupComplete(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Ticket     string `json:"ticket"`
		InviteCode string `json:"inviteCode"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if a.cfg.InviteCode != "" && strings.TrimSpace(request.InviteCode) != a.cfg.InviteCode {
		fail(http.StatusForbidden, "Неверный код приглашения. Спросите его у владельца сервера").write(w)
		return
	}
	ticket, ok := a.readTicket(request.Ticket)
	if !ok {
		fail(http.StatusBadRequest, "Время на регистрацию истекло. Войдите через сервис ещё раз").write(w)
		return
	}
	if userID, _, exists, _ := a.store.FindIdentity(ticket.Provider, ticket.ProviderID); exists {
		if user, err := a.store.UserByID(userID); err == nil {
			a.enterUser(w, r, user, false)
			return
		}
	}
	user, err := a.createOAuthUser(ticket.Provider, &oauth.Profile{ProviderID: ticket.ProviderID, Email: ticket.Email, Login: ticket.Login, Name: ticket.Name})
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.enterUser(w, r, user, true)
}

func (a *server) publicBase(r *http.Request) string {
	if a.cfg.PublicURL != "" {
		return strings.TrimRight(a.cfg.PublicURL, "/")
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// oauthWebStart — вход из браузера: state и verifier живут на сервере, в куки уходит только state.
func (a *server) oauthWebStart(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	if provider != "yandex" || !a.oauth.Enabled() {
		http.Error(w, "Этот способ входа не настроен на сервере", http.StatusNotFound)
		return
	}
	state := auth.RandomID(16)
	verifier := auth.RandomID(48)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	redirect := a.publicBase(r) + "/api/oauth/" + provider + "/callback"
	returnTo := strings.TrimSpace(r.URL.Query().Get("returnTo"))
	if returnTo != "https://localhost" && returnTo != "capacitor://localhost" && returnTo != "sozvon://oauth" {
		returnTo = ""
	}
	url, err := a.oauth.BuildURL(state, challenge, redirect)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	oauthState.mu.Lock()
	now := time.Now()
	for key, flow := range oauthState.flows {
		if flow.expires.Before(now) {
			delete(oauthState.flows, key)
		}
	}
	oauthState.flows[state] = webFlow{provider: provider, verifier: verifier, returnTo: returnTo, expires: now.Add(webFlowTTL)}
	oauthState.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name: stateCookie, Value: state, Path: "/api/oauth",
		MaxAge: 600, HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
	})
	http.Redirect(w, r, url, http.StatusFound)
}

// oauthWebCallback — сервис вернул код: меняем на профиль и отдаём браузеру одноразовый код.
func (a *server) oauthWebCallback(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	if provider != "yandex" {
		http.NotFound(w, r)
		return
	}
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	oauthState.mu.Lock()
	flow, ok := oauthState.flows[state]
	// state уже одноразовый и связан с серверным verifier; cookie в WebView
	// может не отправляться при cross-site redirect Яндекса, поэтому не требуем её.
	if ok && (flow.provider != provider || flow.expires.Before(time.Now())) {
		ok = false
	}
	if ok {
		delete(oauthState.flows, state)
	}
	oauthState.mu.Unlock()
	returnTo := ""
	if ok {
		returnTo = flow.returnTo
	}
	redirectWith := func(query string) string {
		if returnTo == "" {
			return "/?" + query
		}
		return returnTo + "?" + query
	}
	if !ok || code == "" {
		http.Redirect(w, r, redirectWith("oauth_error="+urlQueryEscape("Ответ сервиса не прошёл проверку, попробуйте ещё раз")), http.StatusFound)
		return
	}
	profile, err := a.oauth.FetchProfile(code, flow.verifier)
	if err != nil {
		http.Redirect(w, r, redirectWith("oauth_error="+urlQueryEscape(err.Error())), http.StatusFound)
		return
	}
	webCodeValue := auth.RandomID(24)
	entry := webCode{expires: time.Now().Add(webCodeTTL)}
	if userID, _, exists, _ := a.store.FindIdentity(provider, profile.ProviderID); exists {
		if user, err := a.store.UserByID(userID); err == nil {
			if user.TotpSecret != "" {
				http.Redirect(w, r, redirectWith("oauth_error="+urlQueryEscape("У аккаунта включён второй фактор — войдите по логину и паролю")), http.StatusFound)
				return
			}
			entry.token, _ = a.openSession(user, r.UserAgent())
		}
	} else if a.cfg.InviteCode != "" {
		entry.ticket = a.signTicket(oauthTicket{
			Provider: provider, ProviderID: profile.ProviderID,
			Email: profile.Email, Login: profile.Login, Name: profile.Name,
			Expires: time.Now().Add(ticketTTL).UnixMilli(),
		})
	} else {
		if user, err := a.createOAuthUser(provider, profile); err == nil {
			entry.token, _ = a.openSession(user, r.UserAgent())
		}
	}
	oauthState.mu.Lock()
	oauthState.codes[webCodeValue] = entry
	oauthState.mu.Unlock()
	http.Redirect(w, r, redirectWith("oauth_code="+webCodeValue), http.StatusFound)
}

func urlQueryEscape(value string) string {
	return strings.NewReplacer(" ", "%20", "&", "%26", "#", "%23", "?", "%3F").Replace(value)
}

// oauthWebExchange — браузер меняет одноразовый код на вход или пропуск регистрации.
func (a *server) oauthWebExchange(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Code string `json:"code"`
	}
	if err := decode(r, &request); err != nil || request.Code == "" {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	oauthState.mu.Lock()
	entry, ok := oauthState.codes[request.Code]
	if ok && entry.expires.After(time.Now()) {
		delete(oauthState.codes, request.Code)
	} else {
		ok = false
	}
	oauthState.mu.Unlock()
	if !ok {
		fail(http.StatusBadRequest, "Код входа устарел — начните заново").write(w)
		return
	}
	if entry.ticket != "" {
		writeJSON(w, http.StatusOK, map[string]any{"ticket": entry.ticket})
		return
	}
	if entry.token == "" {
		fail(http.StatusBadGateway, "Не удалось войти через сервис").write(w)
		return
	}
	token, err := auth.ReadToken(a.secret, entry.token)
	if err != nil {
		fail(http.StatusBadGateway, "Не удалось войти через сервис").write(w)
		return
	}
	user, err := a.store.UserByID(token.UID)
	if err != nil {
		fail(http.StatusBadGateway, "Не удалось войти через сервис").write(w)
		return
	}
	self, err := a.self(user)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": entry.token, "user": self})
}

// unlinkIdentity — отвязать сервис; пароль должен остаться, иначе войти будет нечем.
func (a *server) unlinkIdentity(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	provider := chi.URLParam(r, "provider")
	if user.PasswordHash == "" {
		fail(http.StatusBadRequest, "Сначала задайте пароль, иначе вы не сможете войти в профиль").write(w)
		return
	}
	if err := a.store.DeleteIdentity(user.ID, provider); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	a.respondSelf(w, user.ID)
}

var _ = errors.New
