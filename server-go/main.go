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
	calls   *callManager
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

	app := &server{cfg: cfg, store: st, secret: secret, tickets: map[string]ticket{}, hub: realtime.NewHub(), calls: newCallManager()}

	router := chi.NewRouter()
	router.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, middleware.Timeout(30*time.Second))
	router.Get("/ws", app.websocket)

	router.Route("/api", func(r chi.Router) {
		r.Get("/health", app.health)
		r.Post("/register", app.register)
		r.Post("/login", app.login)

		r.Group(func(r chi.Router) {
			r.Use(app.requireAuth)
			r.Get("/me", app.me)
			r.Post("/ws-ticket", app.wsTicket)
			r.Get("/sessions", app.sessions)
			r.Delete("/sessions/{id}", app.deleteSession)

			r.Get("/contacts", app.contacts)
			r.Post("/contacts", app.addContact)
			r.Delete("/contacts/{id}", app.removeContact)
			r.Get("/friend-requests", app.friendRequests)
			r.Post("/friend-requests/{id}/accept", app.acceptFriendRequest)
			r.Delete("/friend-requests/{id}", app.declineFriendRequest)
			r.Get("/blocks", app.blocks)
			r.Post("/blocks/{id}", app.blockUser)
			r.Delete("/blocks/{id}", app.unblockUser)

			r.Get("/hubs", app.hubs)
			r.Post("/hubs", app.createHub)
			r.Patch("/hubs/{id}", app.patchHub)
			r.Get("/hub-invites", app.hubInvites)

			r.Get("/rooms", app.rooms)
			r.Post("/rooms", app.createRoom)
			r.Patch("/rooms/{id}", app.patchRoom)
			r.Get("/rooms/{id}/messages", app.roomMessages)
			r.Post("/rooms/{id}/messages", app.sendRoomMessage)
			r.Get("/rooms/{id}/messages/{messageId}/thread", app.threadMessages)
			r.Post("/rooms/{id}/read", app.markRoomRead)
			r.Get("/unread", app.unread)
		})
	})

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}
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

func decode(r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 16<<10))
	return decoder.Decode(target)
}

// ---------- форма пользователя как в Node (toSelf) ----------

type identityJSON struct {
	Provider string `json:"provider"`
	Email    string `json:"email"`
}

type selfJSON struct {
	ID           int64          `json:"id"`
	Username     string         `json:"username"`
	DisplayName  string         `json:"displayName"`
	AvatarColor  string         `json:"avatarColor"`
	AvatarURL    *string        `json:"avatarUrl"`
	Bio          string         `json:"bio"`
	BannerColor  *string        `json:"bannerColor"`
	BannerURL    *string        `json:"bannerUrl"`
	Game         *string        `json:"game"`
	NameColor    *string        `json:"nameColor"`
	MemberSince  int64          `json:"memberSince"`
	PublicKey    *string        `json:"publicKey"`
	Email        *string        `json:"email"`
	Status       string         `json:"status"`
	HasPassword  bool           `json:"hasPassword"`
	TwoFactor    bool           `json:"twoFactor"`
	Identities   []identityJSON `json:"identities"`
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
	}
	if user.Avatar != "" {
		url := "/api/avatars/" + user.Avatar + ".webp"
		body.AvatarURL = &url
	}
	if user.Banner != "" {
		url := "/api/banners/" + user.Banner
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
	})
}

func (a *server) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
		InviteCode  string `json:"inviteCode"`
		Email       string `json:"email"`
	}
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
		fail(http.StatusBadRequest, "Регистрация по почте появится в следующей фазе").write(w)
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
	if err != nil || !auth.VerifyPassword(body.Password, userPasswordHash(user)) {
		fail(http.StatusUnauthorized, "Неверная почта, логин или пароль").write(w)
		return
	}
	if user.TotpSecret != "" {
		// Полная проверка TOTP — следующая фаза; пока честно отвечаем, что нужен код
		if body.TotpCode == "" {
			writeJSON(w, http.StatusForbidden, map[string]any{
				"error":   "Введите код из приложения-аутентификатора",
				"needTotp": true,
			})
			return
		}
		fail(http.StatusUnauthorized, "Неверный код").write(w)
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
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

var _ = sql.ErrNoRows
