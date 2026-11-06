package main

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// Политика версий — как в Node-сервере (client-version.js): блокируем только
// старые Electron-клиенты по User-Agent «Sozvon/1.x». Браузер, веб-версия и любые
// запросы без версии в UA проходят: иначе e2e-тесты, curl и OAuth-страницы
// получали бы 426 на пустом месте.
//
// Заголовок X-Client-Version новый клиент присылает для информации — им можно
// пользоваться в /api/version, но не как пропуском или запретом.

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

// minClientMajor — самая старая поддерживаемая мажорная версия, как MIN_MAJOR в Node.
const minClientMajor = 2

var sozvonUserAgent = regexp.MustCompile(`(?i)\bSozvon/(\d+)\.\d+\.\d+`)

// oldClientByUserAgent — «Sozvon/1.9.0» и старше; остальные запросы считаются новыми.
func oldClientByUserAgent(userAgent string) bool {
	match := sozvonUserAgent.FindStringSubmatch(userAgent)
	if match == nil {
		return false
	}
	major, err := strconv.Atoi(match[1])
	if err != nil {
		return false
	}
	return major < minClientMajor
}

func (a *server) clientVersionAllowed(r *http.Request) bool {
	return !oldClientByUserAgent(r.UserAgent())
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
