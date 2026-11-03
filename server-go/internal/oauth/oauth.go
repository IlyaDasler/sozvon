package oauth

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Вход через Яндекс ID (OAuth 2.0 + PKCE). Секреты приложения остаются на сервере.

type Options struct {
	ClientID     string
	ClientSecret string
	TestBase     string
}

type Profile struct {
	ProviderID string
	Email      string
	Login      string
	Name       string
}

func (o Options) Enabled() bool { return o.ClientID != "" && o.ClientSecret != "" }

const (
	authURL     = "https://oauth.yandex.ru/authorize"
	tokenURL    = "https://oauth.yandex.ru/token"
	userURL     = "https://login.yandex.ru/info?format=json"
	defaultPort = "47615"
)

// endpoint заменяет адрес провайдера на тестовый: OAUTH_TEST_BASE/<провайдер>/<путь>
func (o Options) endpoint(raw string) string {
	if o.TestBase == "" {
		return raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return strings.TrimRight(o.TestBase, "/") + "/yandex" + parsed.Path + querySuffix(parsed.RawQuery)
}

func querySuffix(raw string) string {
	if raw == "" {
		return ""
	}
	return "?" + raw
}

// DefaultRedirect — приложение принимает код на localhost.
func DefaultRedirect() string {
	return "http://localhost:" + defaultPort + "/callback"
}

func (o Options) BuildURL(state, challenge, redirectURI string) (string, error) {
	if !o.Enabled() {
		return "", errors.New("этот способ входа не настроен на сервере")
	}
	target, err := url.Parse(o.endpoint(authURL))
	if err != nil {
		return "", err
	}
	if redirectURI == "" {
		redirectURI = DefaultRedirect()
	}
	query := target.Query()
	query.Set("response_type", "code")
	query.Set("client_id", o.ClientID)
	query.Set("redirect_uri", redirectURI)
	query.Set("state", state)
	query.Set("code_challenge", challenge)
	query.Set("code_challenge_method", "S256")
	query.Set("force_confirm", "yes")
	target.RawQuery = query.Encode()
	return target.String(), nil
}

func (o Options) request(rawURL string, request *http.Request, what string) (map[string]any, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("не удалось связаться с сервисом входа (%s)", what)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	var data map[string]any
	if err := json.Unmarshal(body, &data); err != nil {
		data = map[string]any{}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || data["error"] != nil {
		return nil, errors.New("сервис входа отклонил запрос. Попробуйте ещё раз")
	}
	_ = rawURL
	return data, nil
}

// FetchProfile меняет код на профиль: id, почта, логин, имя.
func (o Options) FetchProfile(code, verifier string) (*Profile, error) {
	if !o.Enabled() {
		return nil, errors.New("этот способ входа не настроен на сервере")
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("code_verifier", verifier)
	form.Set("client_id", o.ClientID)
	form.Set("client_secret", o.ClientSecret)
	tokenRequest, err := http.NewRequest(http.MethodPost, o.endpoint(tokenURL), strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	tokenRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	token, err := o.request(o.endpoint(tokenURL), tokenRequest, "yandex token")
	if err != nil {
		return nil, err
	}
	accessToken, _ := token["access_token"].(string)
	if accessToken == "" {
		return nil, errors.New("сервис входа не выдал доступ")
	}
	infoRequest, err := http.NewRequest(http.MethodGet, o.endpoint(userURL), nil)
	if err != nil {
		return nil, err
	}
	infoRequest.Header.Set("Authorization", "OAuth "+accessToken)
	info, err := o.request(o.endpoint(userURL), infoRequest, "yandex user")
	if err != nil {
		return nil, err
	}
	profile := &Profile{}
	if id, ok := info["id"]; ok {
		profile.ProviderID = fmt.Sprint(id)
	}
	profile.Email, _ = info["default_email"].(string)
	profile.Login, _ = info["login"].(string)
	if name, ok := info["display_name"].(string); ok && name != "" {
		profile.Name = name
	} else if name, ok := info["real_name"].(string); ok && name != "" {
		profile.Name = name
	} else {
		profile.Name = profile.Login
	}
	if profile.ProviderID == "" {
		return nil, errors.New("сервис входа вернул пустой профиль")
	}
	return profile, nil
}
