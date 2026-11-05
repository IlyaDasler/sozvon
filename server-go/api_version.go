package main

import (
	"net/http"
	"strings"

	"sozvon/server/internal/version"
)

// Политика версий: клиенты ниже MIN_CLIENT_VERSION получают 426 и ссылку
// на обновление. Браузерная версия (без Electron в UA) не блокируется, чтобы
// веб-клиент и OAuth-страницы продолжали работать.
//
// Заголовок X-Client-Version присылает Electron-клиент начиная с 3.0.
// Старые Electron-клиенты его не умеют — для них это и есть признак старой версии.

type versionPolicyBody struct {
	Latest         string `json:"latest"`
	MinClient      string `json:"minClient"`
	UpdateURL      string `json:"updateUrl"`
	UpdateRequired bool   `json:"updateRequired"`
}

func (a *server) versionPolicy() versionPolicyBody {
	return versionPolicyBody{
		Latest:    a.cfg.LatestClientVersion,
		MinClient: a.cfg.MinClientVersion,
		UpdateURL: a.cfg.ClientUpdateURL,
	}
}

func isElectronRequest(r *http.Request) bool {
	return strings.Contains(strings.ToLower(r.UserAgent()), "electron")
}

func (a *server) clientVersionAllowed(r *http.Request) bool {
	raw := strings.TrimSpace(r.Header.Get("X-Client-Version"))
	if raw != "" {
		return version.AtLeast(raw, a.cfg.MinClientVersion)
	}
	// Без заголовка: обычный браузер — можно, Electron — старая версия.
	return !isElectronRequest(r)
}

func (a *server) versionInfo(w http.ResponseWriter, r *http.Request) {
	body := a.versionPolicy()
	body.UpdateRequired = !a.clientVersionAllowed(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"latest":         body.Latest,
		"minClient":      body.MinClient,
		"updateUrl":      body.UpdateURL,
		"updateRequired": body.UpdateRequired,
		"current":        strings.TrimSpace(r.Header.Get("X-Client-Version")),
	})
}

// requireClientVersion ставится на /api целиком. Health и version остаются
// открытыми: по ним клиент и мониторинг узнают, что произошло.
func (a *server) requireClientVersion(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimSuffix(r.URL.Path, "/")
		if path == "/api/health" || path == "/api/version" {
			next.ServeHTTP(w, r)
			return
		}
		if a.clientVersionAllowed(r) {
			next.ServeHTTP(w, r)
			return
		}
		policy := a.versionPolicy()
		writeJSON(w, http.StatusUpgradeRequired, map[string]any{
			"error":          "Поддержка этой версии Созвона прекращена. Обновитесь до " + policy.Latest + ".",
			"updateRequired": true,
			"latest":         policy.Latest,
			"minClient":      policy.MinClient,
			"updateUrl":      policy.UpdateURL,
		})
	})
}
