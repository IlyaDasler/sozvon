// Сервер «Созвона» на Go. Фаза 2: аккаунты, сессии, /me, билет WebSocket.
// Совместимость: тот же формат токенов и паролей, та же схема базы, те же ответы.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/config"
	"sozvon/server/internal/linkpreview"
	"sozvon/server/internal/livekit"
	"sozvon/server/internal/mail"
	"sozvon/server/internal/oauth"
	"sozvon/server/internal/realtime"
	"sozvon/server/internal/store"
)

var colors = []string{"#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f"}

type server struct {
	cfg     config.Config
	store   *store.Store
	secret  []byte
	mu      sync.Mutex
	tickets map[string]ticket
	hub     *realtime.Hub
	mail    *mail.Mailer
	preview *linkpreview.Fetcher
	oauth   oauth.Options
	calls   *callManager
	voice   *voiceManager
	livekit livekit.Options
	limits  *limiter
	push    *pushService
	// Фиктивный хеш для выравнивания времени входа: не даёт отличить
	// несуществующий логин от неверного пароля по скорости ответа.
	dummyHash string
}

func authRandomID() string { return auth.RandomID(16) }

type ticket struct {
	userID  int64
	sid     string
	expires time.Time
}

func main() {
	cfg := config.Load()
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	st, err := store.Open(cfg.DataDir)
	if err != nil {
		logger.Error("не удалось открыть базу", "error", err)
		os.Exit(1)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		logger.Error("не удалось применить миграции", "error", err)
		os.Exit(1)
	}
	applied, _ := st.Applied()
	logger.Info("миграции применены", "versions", applied)

	secret, err := auth.Secret(cfg.DataDir)
	if err != nil {
		logger.Error("не удалось получить секрет", "error", err)
		os.Exit(1)
	}

	app := &server{cfg: cfg, store: st, secret: secret, tickets: map[string]ticket{}, hub: realtime.NewHub(), calls: newCallManager(), voice: newVoiceManager(), oauth: oauth.Options{ClientID: cfg.YandexClientID, ClientSecret: cfg.YandexClientSecret, TestBase: cfg.OAuthTestBase}, preview: linkpreview.New(os.Getenv("LINK_PREVIEW_ALLOW_PRIVATE") == "1"), mail: mail.New(mail.Options{Host: cfg.SMTPHost, Port: cfg.SMTPPort, User: cfg.SMTPUser, Pass: cfg.SMTPPass, From: cfg.SMTPFrom, TestFile: cfg.MailTestFile}), livekit: livekit.Options{URL: cfg.LiveKitURL, APIURL: cfg.LiveKitAPIURL, Key: cfg.LiveKitKey, Secret: cfg.LiveKitSecret, MinMembers: cfg.LiveKitMinMembers}, limits: newLimiter()}
	if push, err := newPushService(os.Getenv("FIREBASE_SERVICE_ACCOUNT")); err != nil {
		logger.Warn("FCM выключен", "error", err)
	} else if push != nil {
		app.push = push
		logger.Info("FCM включён", "project", push.projectID)
	}

	// Хеш для «пустой» проверки пароля (см. login): та же стоимость scrypt.
	app.dummyHash, _ = auth.HashPassword(auth.RandomID(32))

	router := app.routes()

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
	// Напоминания о событиях: раз в полминуты, как в серверной логике
	go app.eventRemindersLoop()
	go func() {
		logger.Info("сервер запущен", "addr", httpServer.Addr, "data", cfg.DataDir)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("сервер остановился", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		logger.Error("не удалось остановить сервер", "error", err)
	}
	logger.Info("сервер остановлен")
}

// routes — все маршруты сервера. Вынесено из main, чтобы проверять статику и API в тестах.
// Capacitor WebView работает с origin https://localhost; разрешаем только его.
func (a *server) mobileCORS(next http.Handler) http.Handler {
	allowed := map[string]bool{
		"https://localhost":     true,
		"capacitor://localhost": true,
		"http://localhost":      true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Client-Version")
			w.Header().Set("Access-Control-Max-Age", "600")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (a *server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=()")
		h.Set("Strict-Transport-Security", "max-age=15552000")
		next.ServeHTTP(w, r)
	})
}

// logRequests — свой логгер вместо chi.Logger: не пишет query-строку,
// иначе одноразовые WS-билеты и токены оседают в журналах.
func (a *server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(wrapped, r)
		slog.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.Status(),
			"ms", time.Since(start).Milliseconds(),
			"ip", clientIP(r),
		)
	})
}

func (a *server) routes() http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestID, middleware.Recoverer, middleware.Timeout(30*time.Second), a.mobileCORS, a.securityHeaders, a.logRequests)
	router.Get("/api/files/{id}/{name}", a.serveFile)
	router.Get("/api/avatars/{name}", a.serveMedia)
	router.Get("/api/banners/{name}", a.serveBanner)
	router.Get("/api/wallpapers/{name}", a.serveWallpaper)
	router.Get("/api/hubs/{id}/icon", a.serveHubIcon)
	router.Get("/ws", a.websocket)

	router.Route("/api", func(r chi.Router) {
		r.Use(a.requireClientVersion)
		r.Get("/health", a.health)
		r.Get("/version", a.versionInfo)
		r.Get("/time", func(w http.ResponseWriter, r *http.Request) {
			// Часы сервера, а не компьютера: по ним клиент выбирает рассвет/день/закат/ночь
			writeJSON(w, http.StatusOK, map[string]any{"now": time.Now().UnixMilli()})
		})
		r.Post("/register/code", a.registerCode)
		r.Post("/register", a.register)
		r.Post("/login", a.login)
		r.Post("/password/code", a.passwordCode)
		r.Post("/password/reset", a.passwordReset)
		r.Get("/oauth/providers", a.oauthProviders)
		r.Get("/oauth/{provider}/url", a.oauthURL)
		r.Post("/oauth/{provider}", a.oauthAuth)
		r.Post("/signup/complete", a.signupComplete)
		r.Get("/oauth/{provider}/web", a.oauthWebStart)
		r.Get("/oauth/{provider}/callback", a.oauthWebCallback)
		r.Post("/oauth/web/exchange", a.oauthWebExchange)

		r.Group(func(r chi.Router) {
			r.Use(a.requireAuth)
			r.Get("/link-preview", a.linkPreview)
			r.Get("/me", a.me)
			r.Post("/push/register", a.registerPushToken)
			r.Delete("/push/token", a.deletePushToken)
			r.Patch("/me/privacy", a.updatePrivacy)
			r.Patch("/me", a.patchMe)
			r.Put("/me/status", a.setMyStatus)
			r.Put("/me/key", a.setMyKey)
			r.Get("/me/key/backup", a.getMyKeyBackup)
			r.Put("/me/key/backup", a.setMyKeyBackup)
			r.Post("/key-transfer", a.keyTransferPut)
			r.Get("/key-transfer/{id}", a.keyTransferGet)
			r.Post("/me/email/code", a.emailCode)
			r.Put("/me/email", a.updateEmail)
			r.Delete("/me/identities/{provider}", a.unlinkIdentity)
			r.Delete("/me/email", a.updateEmail)
			r.Get("/messages/{peerId}", a.dmMessages)
			r.Get("/messages/{peerId}/pins", a.dmPins)
			r.Post("/messages/{peerId}", a.sendDM)
			r.Patch("/messages/{peerId}/{id}", a.editDM)
			r.Delete("/messages/{peerId}/{id}", a.deleteDM)
			r.Get("/messages/{peerId}/{id}/reactions", a.dmReactions)
			r.Post("/messages/{peerId}/{id}/reactions", a.dmReactions)
			r.Put("/messages/{peerId}/{id}/pin", a.dmPin)
			r.Delete("/messages/{peerId}/{id}/pin", a.dmPin)
			r.Put("/me/game", a.setMyGame)
			r.Put("/me/avatar", a.uploadAvatar)
			r.Delete("/me/avatar", a.uploadAvatar)
			r.Put("/me/banner", a.uploadBanner)
			r.Delete("/me/banner", a.uploadBanner)
			r.Post("/ws-ticket", a.wsTicket)
			r.Get("/sessions", a.sessions)
			r.Delete("/sessions/{id}", a.deleteSession)
			r.Post("/sessions/revoke-others", a.revokeOtherSessions)

			r.Get("/contacts", a.contacts)
			r.Post("/contacts", a.addContact)
			r.Put("/contacts/{id}/theme", a.contactTheme)
			r.Put("/contacts/{id}/wallpaper", a.contactWallpaper)
			r.Delete("/contacts/{id}/wallpaper", a.contactWallpaper)
			r.Delete("/contacts/{id}", a.removeContact)
			r.Get("/friend-requests", a.friendRequests)
			r.Post("/friend-requests/{id}/accept", a.acceptFriendRequest)
			r.Delete("/friend-requests/{id}", a.declineFriendRequest)
			r.Get("/blocks", a.blocks)
			r.Post("/blocks", a.blockUser)
			r.Post("/blocks/{id}", a.blockUser)
			r.Delete("/blocks/{id}", a.unblockUser)

			r.Get("/hubs", a.hubs)
			r.Post("/hubs", a.createHub)
			r.Patch("/hubs/{id}", a.patchHub)
			r.Put("/hubs/{id}/icon", a.hubIcon)
			r.Delete("/hubs/{id}/icon", a.hubIcon)
			r.Delete("/hubs/{id}", a.deleteHub)
			r.Get("/hub-invites", a.hubInvites)

			r.Get("/keys/{conv}", a.convKeys)
			r.Put("/keys/{conv}", a.convKeys)
			r.Post("/keys/{conv}", a.convKeys)
			r.Get("/rooms", a.rooms)
			r.Post("/rooms", a.createRoom)
			r.Put("/hubs/{id}/rooms/order", a.hubRoomsOrder)
			r.Patch("/rooms/{id}", a.patchRoom)
			r.Put("/rooms/{id}/background", a.roomBackground)
			r.Delete("/rooms/{id}/background", a.roomBackground)
			r.Get("/rooms/{id}/messages", a.roomMessages)
			r.Post("/rooms/{id}/messages", a.sendRoomMessage)
			r.Get("/rooms/{id}/messages/{messageId}/thread", a.threadMessages)
			r.Get("/rooms/{id}/pins", a.roomPinsList)
			r.Post("/rooms/{id}/events", a.roomEventCreate)
			r.Put("/events/{eventId}/response", a.roomEventResponse)
			r.Patch("/events/{eventId}", a.roomEventPatch)
			r.Delete("/events/{eventId}", a.roomEventDelete)
			r.Post("/events/{eventId}/finish", a.roomEventFinish)
			r.Post("/rooms/{id}/timeouts", a.roomTimeouts)
			r.Delete("/rooms/{id}/timeouts/{userId}", a.roomTimeouts)
			r.Post("/rooms/{id}/disconnect", a.disconnectMember)
			r.Delete("/rooms/{id}/voice/{userId}", a.voiceKick)
			r.Put("/rooms/{id}/messages/{messageId}/pin", a.roomPin)
			r.Delete("/rooms/{id}/messages/{messageId}/pin", a.roomPin)
			r.Patch("/rooms/{id}/messages/{messageId}", a.roomEditMessage)
			r.Delete("/rooms/{id}/messages/{messageId}", a.roomDeleteMessage)
			r.Get("/rooms/{id}/messages/{messageId}/reactions", a.roomMessageReactions)
			r.Post("/rooms/{id}/messages/{messageId}/reactions", a.roomMessageReactions)
			r.Post("/hubs/{id}/members", a.hubAddMembers)
			r.Post("/hubs/{id}/groups", a.hubGroups)
			r.Patch("/hubs/{id}/groups/{groupId}", a.hubGroup)
			r.Delete("/hubs/{id}/groups/{groupId}", a.hubGroup)
			r.Put("/hubs/{id}/emojis/{name}", a.hubEmoji)
			r.Delete("/hubs/{id}/emojis/{name}", a.hubEmoji)
			r.Post("/hubs/{id}/invites", a.hubInvite)
			r.Post("/hub-invites/{id}/accept", a.acceptHubInvite)
			r.Delete("/hub-invites/{id}", a.declineHubInvite)
			r.Delete("/hubs/{id}/members/{userId}", a.hubMember)
			r.Put("/hubs/{id}/members/{userId}/manager", a.hubMemberManager)
			r.Put("/hubs/{id}/members/{userId}/nickname", a.hubMemberNickname)
			r.Delete("/hubs/{id}/members/{userId}/nickname", a.hubMemberNickname)
			r.Put("/hubs/{id}/members/{userId}/role", a.hubMemberRole)
			r.Post("/hubs/{id}/bans", a.hubBan)
			r.Delete("/hubs/{id}/bans/{userId}", a.hubBan)
			r.Post("/hubs/{id}/roles", a.hubRole)
			r.Patch("/hubs/{id}/roles/{roleId}", a.hubRole)
			r.Delete("/hubs/{id}/roles/{roleId}", a.hubRole)
			r.Delete("/rooms/{id}", a.roomDelete)
			r.Post("/rooms/{id}/bans", a.roomBans)
			r.Delete("/rooms/{id}/bans/{userId}", a.roomBans)
			r.Post("/rooms/{id}/members", a.addRoomMember)
			r.Delete("/rooms/{id}/members/{userId}", a.roomMembers)
			r.Put("/rooms/{id}/members/{userId}/role", a.roomRole)
			r.Post("/rooms/{id}/roles", a.roomRoles)
			r.Patch("/rooms/{id}/roles/{roleId}", a.roomRoles)
			r.Delete("/rooms/{id}/roles/{roleId}", a.roomRoles)
			r.Post("/read", a.readConv)
			r.Post("/rooms/{id}/read", a.markRoomRead)
			r.Get("/unread", a.unread)
			r.Get("/ice", a.ice)
			r.Post("/me/2fa/setup", a.totpSetup)
			r.Post("/me/2fa/enable", a.totpEnable)
			r.Post("/me/2fa/disable", a.totpDisable)
			r.Post("/uploads", a.upload)
		})
	})
	// Веб-версия клиента: Веб-версия клиента раздаётся из WEB_DIR.
	fileServer := a.staticHandler()
	router.NotFound(func(w http.ResponseWriter, r *http.Request) {
		// Неизвестный API — JSON-ошибка, как в Node; остальное — файлы клиента
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			fail(http.StatusNotFound, "Не найдено").write(w)
			return
		}
		if fileServer != nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})
	return router
}

// staticHandler — раздача веб-клиента из WEB_DIR (если каталог задан и существует).
func (a *server) staticHandler() http.Handler {
	dir := a.cfg.WebDir
	if dir == "" {
		return nil
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return nil
	}
	return http.FileServer(http.Dir(dir))
}

// ---------- ответы ----------

type apiError struct {
	status int
	body   map[string]any
}

func fail(status int, message string) *apiError {
	return &apiError{status: status, body: map[string]any{"error": message}}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (e *apiError) write(w http.ResponseWriter) { writeJSON(w, e.status, e.body) }
func (e *apiError) Error() string {
	if message, ok := e.body["error"].(string); ok {
		return message
	}
	return "api error"
}

func decode(r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 16<<10))
	return decoder.Decode(target)
}

// ---------- форма пользователя как в Node (toSelf) ----------

type identityJSON struct {
	Provider string `json:"provider"`
	Email    string `json:"email"`
}

type privacyJSON struct {
	Typing         bool   `json:"typing"`
	ReadReceipts   bool   `json:"readReceipts"`
	GameActivity   bool   `json:"gameActivity"`
	FriendRequests bool   `json:"friendRequests"`
	InvitePolicy   string `json:"invitePolicy"`
}

type selfJSON struct {
	ID          int64          `json:"id"`
	Username    string         `json:"username"`
	DisplayName string         `json:"displayName"`
	AvatarColor string         `json:"avatarColor"`
	AvatarURL   *string        `json:"avatarUrl"`
	Bio         string         `json:"bio"`
	BannerColor *string        `json:"bannerColor"`
	BannerURL   *string        `json:"bannerUrl"`
	Game        *string        `json:"game"`
	NameColor   *string        `json:"nameColor"`
	MemberSince int64          `json:"memberSince"`
	PublicKey   *string        `json:"publicKey"`
	Email       *string        `json:"email"`
	Status      string         `json:"status"`
	HasPassword bool           `json:"hasPassword"`
	TwoFactor   bool           `json:"twoFactor"`
	Identities  []identityJSON `json:"identities"`
	Privacy     privacyJSON    `json:"privacy"`
}

func optional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func (a *server) self(user *store.User) (selfJSON, error) {
	// email показываем так же, как Node: показной адрес важнее настоящего
	email := user.EmailShown
	if email == "" {
		email = user.Email
	}
	body := selfJSON{
		ID:          user.ID,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		AvatarColor: user.AvatarColor,
		Bio:         user.Bio,
		MemberSince: user.CreatedAt,
		Status:      user.Status,
		HasPassword: user.PasswordHash != "",
		TwoFactor:   user.TotpSecret != "",
		Email:       optional(email),
		PublicKey:   optional(user.PublicKey),
		NameColor:   optional(user.NameColor),
		Game:        optional(user.Game),
		Privacy: privacyJSON{
			Typing:         user.PrivacyTyping,
			ReadReceipts:   user.PrivacyRead,
			GameActivity:   user.PrivacyGame,
			FriendRequests: user.FriendRequests,
			InvitePolicy:   user.InvitePolicy,
		},
	}
	if user.Avatar != "" {
		url := "/api/avatars/" + user.Avatar + ".webp"
		body.AvatarURL = &url
	}
	if user.Banner != "" {
		url := "/api/avatars/" + user.Banner + ".webp"
		body.BannerURL = &url
	}
	if user.BannerColor != "" {
		color := user.BannerColor
		body.BannerColor = &color
	}
	identities, err := a.store.IdentitiesOf(user.ID)
	if err != nil {
		return body, err
	}
	body.Identities = make([]identityJSON, 0, len(identities))
	for _, item := range identities {
		body.Identities = append(body.Identities, identityJSON{Provider: item.Provider, Email: item.Email})
	}
	return body, nil
}

// ---------- вход и регистрация ----------

func (a *server) openSession(user *store.User, userAgent string) (string, error) {
	sid := auth.RandomID(16)
	if err := a.store.CreateSession(sid, user.ID, auth.DeviceName(userAgent)); err != nil {
		return "", err
	}
	return auth.SignToken(a.secret, user.ID, sid), nil
}

func (a *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"app":            "sozvon",
		"inviteRequired": a.cfg.InviteCode != "",
		"emailCodes":     a.cfg.EmailCodes(),
		"latestVersion":  a.cfg.LatestClientVersion,
		"minClient":      a.cfg.MinClientVersion,
		"updateUrl":      a.cfg.ClientUpdateURL,
	})
}

func (a *server) register(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "register") {
		fail(http.StatusTooManyRequests, "Слишком много попыток, подождите минуту").write(w)
		return
	}
	var body registerBody
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	// Приглашение проверяем тем же правилом, что Node
	if a.cfg.InviteCode != "" && strings.TrimSpace(body.InviteCode) != a.cfg.InviteCode {
		fail(http.StatusForbidden, "Неверный код приглашения. Спросите его у владельца сервера").write(w)
		return
	}
	if body.Email != "" {
		a.registerByEmail(w, r, body)
		return
	}
	username := strings.ToLower(strings.TrimSpace(body.Username))
	displayName := strings.TrimSpace(body.DisplayName)
	if displayName == "" {
		displayName = username
	}
	if !auth.ValidUsername(username) {
		fail(http.StatusBadRequest, "Логин: 3–24 символа, латинские буквы, цифры, точка или _").write(w)
		return
	}
	if !auth.ValidPassword(body.Password) {
		fail(http.StatusBadRequest, "Пароль должен быть от 8 до 128 символов").write(w)
		return
	}
	if !auth.ValidDisplayName(displayName) {
		fail(http.StatusBadRequest, "Имя должно быть от 1 до 32 символов").write(w)
		return
	}
	if _, err := a.store.UserByUsername(username); err == nil {
		fail(http.StatusConflict, "Этот логин уже занят").write(w)
		return
	} else if !errors.Is(err, store.ErrNotFound) {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	user, err := a.store.CreateUser(username, hash, displayName, colors[time.Now().UnixNano()%int64(len(colors))])
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
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
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": self})
}

func (a *server) login(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "login") {
		fail(http.StatusTooManyRequests, "Слишком много попыток, подождите минуту").write(w)
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		TotpCode string `json:"totpCode"`
	}
	if err := decode(r, &body); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	login := strings.ToLower(strings.TrimSpace(body.Username))
	var user *store.User
	var err error
	if strings.Contains(login, "@") {
		user, err = a.store.UserByEmail(login)
	} else {
		user, err = a.store.UserByUsername(login)
	}
	if err == nil && a.loginLocked(login) {
		fail(http.StatusTooManyRequests, "Слишком много неудачных попыток. Попробуйте через 15 минут или восстановите пароль").write(w)
		return
	}
	if err != nil {
		// Тратим столько же времени, сколько на реальную проверку пароля:
		// иначе по скорости ответа можно перебирать существующие логины.
		_ = auth.VerifyPassword(body.Password, a.dummyHash)
		a.loginFailed(login)
		fail(http.StatusUnauthorized, "Неверная почта, логин или пароль").write(w)
		return
	}
	if !auth.VerifyPassword(body.Password, userPasswordHash(user)) {
		a.loginFailed(login)
		fail(http.StatusUnauthorized, "Неверная почта, логин или пароль").write(w)
		return
	}
	if user.TotpSecret != "" && body.TotpCode == "" {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error":    "Введите код из приложения-аутентификатора",
			"needTotp": true,
		})
		return
	}
	if !a.secondFactorOK(user, body.TotpCode) {
		// Неверный второй фактор — тоже неудачная попытка входа:
		// иначе TOTP можно перебирать, а счётчик обнуляется до проверки кода.
		a.loginFailed(login)
		fail(http.StatusUnauthorized, "Неверный код").write(w)
		return
	}
	a.loginSucceeded(login)
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
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": self})
}

func userPasswordHash(user *store.User) string {
	if user == nil {
		return ""
	}
	return user.PasswordHash
}

// ---------- защищённые маршруты ----------

type contextKey string

const userKey contextKey = "user"
const sessionKey contextKey = "session"

func (a *server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		payload, err := auth.ReadToken(a.secret, token)
		if err != nil || payload.SID == "" {
			fail(http.StatusUnauthorized, "Требуется вход").write(w)
			return
		}
		session, err := a.store.SessionByID(payload.SID)
		if err != nil || session.UserID != payload.UID {
			fail(http.StatusUnauthorized, "Сессия недействительна").write(w)
			return
		}
		user, err := a.store.UserByID(session.UserID)
		if err != nil {
			fail(http.StatusUnauthorized, "Требуется вход").write(w)
			return
		}
		if time.Now().UnixMilli()-session.LastSeen > 5*60*1000 {
			_ = a.store.TouchSession(session.ID)
		}
		// Старая сессия должна показывать текущую версию приложения, а не ту,
		// с которой когда-то выполнялся вход.
		device := auth.DeviceNameWithVersion(r.UserAgent(), r.Header.Get("X-Client-Version"))
		if device != "" && device != session.Device {
			if err := a.store.SetSessionDevice(session.ID, device); err == nil {
				session.Device = device
			}
		}
		ctx := context.WithValue(r.Context(), userKey, user)
		ctx = context.WithValue(ctx, sessionKey, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (a *server) me(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	self, err := a.self(user)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, self)
}

func (a *server) patchMe(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	var request struct {
		DisplayName     *string `json:"displayName"`
		AvatarColor     *string `json:"avatarColor"`
		Bio             *string `json:"bio"`
		BannerColor     *string `json:"bannerColor"`
		NameColor       *string `json:"nameColor"`
		NewPassword     string  `json:"newPassword"`
		CurrentPassword string  `json:"currentPassword"`
	}
	if err := decode(r, &request); err != nil {
		fail(http.StatusBadRequest, "Неверный формат запроса").write(w)
		return
	}
	if request.NewPassword != "" {
		if user.PasswordHash != "" && !auth.VerifyPassword(request.CurrentPassword, user.PasswordHash) {
			fail(http.StatusBadRequest, "Текущий пароль указан неверно").write(w)
			return
		}
		if !auth.ValidPassword(request.NewPassword) {
			fail(http.StatusBadRequest, "Пароль должен быть от 8 до 128 символов").write(w)
			return
		}
		hash, err := auth.HashPassword(request.NewPassword)
		if err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		if err := a.store.UpdatePassword(user.ID, hash); err != nil {
			fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
			return
		}
		// Пароль сменили — остальные устройства выходят, текущее остаётся
		current := ""
		if session, ok := r.Context().Value(sessionKey).(*store.Session); ok && session != nil {
			current = session.ID
		}
		if sessions, err := a.store.SessionsOf(user.ID); err == nil {
			for _, session := range sessions {
				if session.ID != current {
					_ = a.store.DeleteSession(session.ID)
				}
			}
		}
		a.hub.CloseOtherSessions(user.ID, current)
	}
	if request.DisplayName != nil {
		name := strings.TrimSpace(*request.DisplayName)
		if len([]rune(name)) < 1 || len([]rune(name)) > 32 {
			fail(http.StatusBadRequest, "Имя — от 1 до 32 символов").write(w)
			return
		}
		request.DisplayName = &name
	}
	if err := a.store.UpdateProfile(user.ID, request.DisplayName, request.AvatarColor, request.Bio, request.BannerColor, request.NameColor); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	fresh, err := a.store.UserByID(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Как notifyProfile в Node: новый профиль уходит друзьям, соседям по каналам и себе
	event := map[string]any{"type": "user:updated", "user": a.publicUser(fresh)}
	if ids, err := a.store.RelatedUserIDs(fresh.ID); err == nil {
		for _, id := range ids {
			a.hub.Send(id, event)
		}
	}
	a.hub.Send(fresh.ID, event)
	self, err := a.self(fresh)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	writeJSON(w, http.StatusOK, self)
}

func (a *server) wsTicket(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	session := r.Context().Value(sessionKey).(*store.Session)
	value := auth.RandomID(24)
	now := time.Now()
	a.mu.Lock()
	for key, item := range a.tickets {
		if item.expires.Before(now) {
			delete(a.tickets, key)
		}
	}
	a.tickets[value] = ticket{userID: user.ID, sid: session.ID, expires: now.Add(30 * time.Second)}
	a.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"ticket": value})
}

func (a *server) sessions(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	session := r.Context().Value(sessionKey).(*store.Session)
	list, err := a.store.SessionsOf(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	body := make([]map[string]any, 0, len(list))
	for _, item := range list {
		body = append(body, map[string]any{
			"id":        item.ID,
			"device":    item.Device,
			"createdAt": item.CreatedAt,
			"lastSeen":  item.LastSeen,
			"current":   item.ID == session.ID,
		})
	}
	writeJSON(w, http.StatusOK, body)
}

func (a *server) deleteSession(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	id := chi.URLParam(r, "id")
	session, err := a.store.SessionByID(id)
	if err != nil || session.UserID != user.ID {
		fail(http.StatusNotFound, "Устройство не найдено").write(w)
		return
	}
	if err := a.store.DeleteSession(id); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	// Живое соединение устройства закрываем сразу
	a.hub.CloseSession(user.ID, id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) revokeOtherSessions(w http.ResponseWriter, r *http.Request) {
	user := r.Context().Value(userKey).(*store.User)
	current := ""
	if session, ok := r.Context().Value(sessionKey).(*store.Session); ok && session != nil {
		current = session.ID
	}
	list, err := a.store.SessionsOf(user.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	for _, session := range list {
		if session.ID == current {
			continue
		}
		_ = a.store.DeleteSession(session.ID)
	}
	a.hub.CloseOtherSessions(user.ID, current)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

var _ = sql.ErrNoRows
