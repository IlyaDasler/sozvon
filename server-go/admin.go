package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"sozvon/server/internal/auth"
	"sozvon/server/internal/store"
)

// Глобальная админка отделена от клиентских сессий: свой cookie, свой CSRF,
// короткий срок жизни и обязательная проверка роли на каждом запросе.

const adminCookieName = "sozvon_admin"

type adminContextKey string

const adminInfoKey adminContextKey = "admin_info"

func hashAdminToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomToken(bytes int) string {
	raw := make([]byte, bytes)
	if _, err := rand.Read(raw); err != nil {
		return auth.RandomID(bytes)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func (a *server) adminValueHMAC(kind, value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte("admin:" + kind + ":"))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

func (a *server) adminIPHash(r *http.Request) string {
	return a.adminValueHMAC("ip", clientIP(r))
}

func (a *server) setAdminCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int) {
	cookie := &http.Cookie{
		Name:     adminCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
		MaxAge:   maxAge,
	}
	http.SetCookie(w, cookie)
}

func (a *server) clearAdminCookie(w http.ResponseWriter, r *http.Request) {
	cookie := &http.Cookie{Name: adminCookieName, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"), MaxAge: -1}
	http.SetCookie(w, cookie)
}

func (a *server) adminLogin(w http.ResponseWriter, r *http.Request) {
	if !a.authLimit(r, "admin-login") {
		fail(http.StatusTooManyRequests, "Слишком много попыток входа").write(w)
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
	login := auth.NormalizeUsername(body.Username)
	var user *store.User
	var err error
	if phone, ok := normalizePhone(body.Username); ok && strings.HasPrefix(strings.TrimSpace(body.Username), "+") {
		user, err = a.store.UserByPhoneHMAC(a.phoneDigest(phone))
	} else if strings.Contains(login, "@") {
		user, err = a.store.UserByEmail(login)
	} else {
		user, err = a.store.UserByUsername(login)
	}
	if err != nil || !auth.VerifyPassword(body.Password, userPasswordHash(user)) {
		_ = auth.VerifyPassword(body.Password, a.dummyHash)
		a.loginFailed(login)
		fail(http.StatusUnauthorized, "Неверный логин или пароль").write(w)
		return
	}
	role, err := a.store.ActiveAdminRole(user.ID)
	if err != nil {
		fail(http.StatusForbidden, "Нет доступа к админке").write(w)
		return
	}
	if user.BannedAt != 0 || user.SuspendedAt != 0 {
		fail(http.StatusForbidden, "Аккаунт заблокирован").write(w)
		return
	}
	if user.TotpSecret != "" && !a.secondFactorOK(user, body.TotpCode) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "Введите код из приложения-аутентификатора", "needTotp": true})
		return
	}
	a.loginSucceeded(login)
	token := randomToken(32)
	csrf := randomToken(24)
	expires := time.Now().Add(12 * time.Hour).UnixMilli()
	if err := a.store.CreateAdminSession(hashAdminToken(token), user.ID, expires, a.adminIPHash(r), hashAdminToken(csrf)); err != nil {
		fail(http.StatusInternalServerError, "Внутренняя ошибка сервера").write(w)
		return
	}
	if err := a.store.MarkLogin(user.ID); err != nil {
		slogWarn("admin mark login", err)
	}
	a.setAdminCookie(w, r, token, 12*60*60)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":      publicAdminUser(user),
		"role":      role,
		"csrfToken": csrf,
		"needsTotp": user.TotpSecret == "",
		"expiresAt": expires,
	})
}

func (a *server) adminLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(adminCookieName); err == nil {
		_ = a.store.DeleteAdminSession(hashAdminToken(cookie.Value))
	}
	a.clearAdminCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type adminSessionInfo struct {
	Session *store.AdminSession
	Role    *store.AdminRole
	User    *store.User
	CSRF    string
}

// adminAuth — middleware для /api/admin. GET/HEAD не требуют CSRF, изменения — требуют.
func (a *server) adminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(adminCookieName)
		if err != nil || cookie.Value == "" {
			fail(http.StatusUnauthorized, "Требуется вход в админку").write(w)
			return
		}
		session, err := a.store.AdminSessionByToken(hashAdminToken(cookie.Value))
		if err != nil || session.ExpiresAt < time.Now().UnixMilli() {
			a.clearAdminCookie(w, r)
			fail(http.StatusUnauthorized, "Сессия админки истекла").write(w)
			return
		}
		role, err := a.store.ActiveAdminRole(session.UserID)
		if err != nil {
			fail(http.StatusForbidden, "Роль отозвана").write(w)
			return
		}
		user, err := a.store.UserByID(session.UserID)
		if err != nil || user.BannedAt != 0 || user.SuspendedAt != 0 {
			fail(http.StatusForbidden, "Аккаунт заблокирован").write(w)
			return
		}
		token := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if token == "" || !hmac.Equal([]byte(hashAdminToken(token)), []byte(session.CSRFHash)) {
				fail(http.StatusForbidden, "Неверный CSRF-токен").write(w)
				return
			}
		}
		if time.Now().UnixMilli()-session.LastSeen > 60_000 {
			_ = a.store.TouchAdminSession(session.TokenHash, time.Now().UnixMilli())
		}
		ctx := contextWithAdmin(r, &adminSessionInfo{Session: session, Role: role, User: user, CSRF: token})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func contextWithAdmin(r *http.Request, info *adminSessionInfo) context.Context {
	return context.WithValue(r.Context(), adminInfoKey, info)
}

func adminInfo(r *http.Request) *adminSessionInfo {
	if info, ok := r.Context().Value(adminInfoKey).(*adminSessionInfo); ok {
		return info
	}
	return nil
}

func (a *server) adminMe(w http.ResponseWriter, r *http.Request) {
	info := adminInfo(r)
	if info == nil {
		fail(http.StatusUnauthorized, "Требуется вход").write(w)
		return
	}
	// После перезагрузки страницы raw CSRF-токен неизвестен: ротируем его.
	csrf := randomToken(24)
	if err := a.store.UpdateAdminSessionCSRF(info.Session.TokenHash, hashAdminToken(csrf)); err != nil {
		fail(http.StatusInternalServerError, "Не удалось обновить сессию").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":      publicAdminUser(info.User),
		"role":      info.Role,
		"csrfToken": csrf,
		"needsTotp": info.User.TotpSecret == "",
	})
}

func (a *server) requireAdminPermission(r *http.Request, permission int64) bool {
	info := adminInfo(r)
	return info != nil && info.Role != nil && info.Role.Can(permission)
}

func (a *server) requireSuperAdmin(r *http.Request) bool {
	info := adminInfo(r)
	return info != nil && info.Role != nil && info.Role.IsSuper()
}

func publicAdminUser(user *store.User) map[string]any {
	return map[string]any{
		"id":          user.ID,
		"username":    user.Username,
		"displayName": user.DisplayName,
		"totpEnabled": user.TotpSecret != "",
	}
}

func slogWarn(message string, err error) {
	// Отдельная обёртка, чтобы не тянуть slog в каждый вызов админки.
	if err != nil {
		// slog уже используется в main; для админки достаточно stderr.
		println("admin warning:", message, err.Error())
	}
}

func (a *server) adminUsers(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermUsersView) {
		fail(http.StatusForbidden, "Нет права просмотра пользователей").write(w)
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	list, total, err := a.store.AdminUsers(r.URL.Query().Get("q"), r.URL.Query().Get("status"), limit, (page-1)*limit)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось получить пользователей").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": list, "total": total, "page": page, "limit": limit})
}

func (a *server) adminChannels(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermChannelsView) {
		fail(http.StatusForbidden, "Нет права просмотра каналов").write(w)
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	list, total, err := a.store.AdminChannels(r.URL.Query().Get("q"), r.URL.Query().Get("kind"), limit, (page-1)*limit)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось получить каналы").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": list, "total": total, "page": page, "limit": limit})
}

func (a *server) adminRolesList(w http.ResponseWriter, r *http.Request) {
	if !a.requireSuperAdmin(r) {
		fail(http.StatusForbidden, "Только super admin").write(w)
		return
	}
	roles, err := a.store.AdminRoles()
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось получить роли").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"roles": roles})
}

func (a *server) adminGrantRole(w http.ResponseWriter, r *http.Request) {
	if !a.requireSuperAdmin(r) {
		fail(http.StatusForbidden, "Только super admin").write(w)
		return
	}
	var body struct {
		UserID      int64  `json:"userId"`
		Role        string `json:"role"`
		Permissions int64  `json:"permissions"`
		ExpiresAt   int64  `json:"expiresAt"`
		Reason      string `json:"reason"`
	}
	if err := decode(r, &body); err != nil || body.UserID <= 0 || (body.Role != "moderator" && body.Role != "super_admin") {
		fail(http.StatusBadRequest, "Неверные данные роли").write(w)
		return
	}
	if target, err := a.store.UserByID(body.UserID); err != nil || target.BannedAt != 0 || target.SuspendedAt != 0 {
		fail(http.StatusBadRequest, "Пользователь заблокирован").write(w)
		return
	}
	if body.Role == "super_admin" {
		body.Permissions = store.AdminPermAllModerator
	}
	if body.Permissions == 0 {
		body.Permissions = store.AdminPermAllModerator
	}
	target, err := a.store.UserByID(body.UserID)
	if err != nil {
		fail(http.StatusNotFound, "Пользователь не найден").write(w)
		return
	}
	if err := a.store.EnsureAdminRole(target.ID, body.Role, body.Permissions, adminInfo(r).User.ID, body.ExpiresAt); err != nil {
		fail(http.StatusInternalServerError, "Не удалось выдать роль").write(w)
		return
	}
	_ = a.store.DeleteAdminSessionsForUser(target.ID)
	a.audit(r, "admin.role.grant", "user", target.ID, body.Reason, map[string]any{"role": body.Role, "permissions": body.Permissions, "expiresAt": body.ExpiresAt})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) adminRevokeRole(w http.ResponseWriter, r *http.Request) {
	if !a.requireSuperAdmin(r) {
		fail(http.StatusForbidden, "Только super admin").write(w)
		return
	}
	userID, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	if userID <= 0 {
		fail(http.StatusBadRequest, "Неверный пользователь").write(w)
		return
	}
	if userID == adminInfo(r).User.ID {
		fail(http.StatusBadRequest, "Нельзя отозвать роль у самого себя").write(w)
		return
	}
	if err := a.store.RevokeAdminRole(userID, adminInfo(r).User.ID); err != nil {
		fail(http.StatusNotFound, "Активная роль не найдена").write(w)
		return
	}
	_ = a.store.DeleteAdminSessionsForUser(userID)
	a.audit(r, "admin.role.revoke", "user", userID, "", nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) adminSetPrivacy(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermChannelsEdit) {
		fail(http.StatusForbidden, "Нет права изменять каналы").write(w)
		return
	}
	kind := chiURLParam(r, "kind")
	id, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	var body struct {
		Privacy string `json:"privacy"`
		Reason  string `json:"reason"`
	}
	if err := decode(r, &body); err != nil || id <= 0 || (body.Privacy != "public" && body.Privacy != "hidden") {
		fail(http.StatusBadRequest, "Неверная приватность").write(w)
		return
	}
	if err := a.store.SetChannelPrivacy(kind, id, body.Privacy); err != nil {
		fail(http.StatusNotFound, "Канал не найден").write(w)
		return
	}
	a.audit(r, "channel.privacy", kind, id, body.Reason, map[string]any{"privacy": body.Privacy})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) adminSuspend(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermUsersBan) {
		fail(http.StatusForbidden, "Нет права блокировать").write(w)
		return
	}
	userID, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	var body struct {
		Reason string `json:"reason"`
	}
	_ = decode(r, &body)
	if userID <= 0 || strings.TrimSpace(body.Reason) == "" {
		fail(http.StatusBadRequest, "Нужна причина").write(w)
		return
	}
	if userID == adminInfo(r).User.ID {
		fail(http.StatusBadRequest, "Нельзя заморозить себя").write(w)
		return
	}
	if targetRole, _ := a.store.ActiveAdminRole(userID); targetRole != nil && !adminInfo(r).Role.IsSuper() {
		fail(http.StatusForbidden, "Заморозить администратора может только super admin").write(w)
		return
	}
	if err := a.store.SetUserSuspended(userID, adminInfo(r).User.ID, 0, body.Reason); err != nil {
		fail(http.StatusNotFound, "Пользователь не найден").write(w)
		return
	}
	_ = a.store.DeleteSessionsForUser(userID)
	_ = a.store.DeleteAdminSessionsForUser(userID)
	a.audit(r, "user.suspend", "user", userID, body.Reason, nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) adminUnsuspend(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermUsersBan) {
		fail(http.StatusForbidden, "Нет права разблокировать").write(w)
		return
	}
	userID, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	if err := a.store.ClearUserSuspension(userID); err != nil {
		fail(http.StatusInternalServerError, "Не удалось снять заморозку").write(w)
		return
	}
	a.audit(r, "user.unsuspend", "user", userID, "", nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) adminApprovals(w http.ResponseWriter, r *http.Request) {
	if !a.requireSuperAdmin(r) {
		fail(http.StatusForbidden, "Только super admin").write(w)
		return
	}
	status := r.URL.Query().Get("status")
	list, err := a.store.AdminApprovals(status, 100)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось получить заявки").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"approvals": list})
}

func (a *server) adminAudit(w http.ResponseWriter, r *http.Request) {
	info := adminInfo(r)
	if info == nil {
		fail(http.StatusUnauthorized, "Требуется вход").write(w)
		return
	}
	actor := int64(0)
	if !info.Role.IsSuper() {
		actor = info.User.ID
	}
	list, err := a.store.AdminAudit(actor, 200)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось получить аудит").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"audit": list})
}

func (a *server) adminReports(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermReports) {
		fail(http.StatusForbidden, "Нет права просмотра жалоб").write(w)
		return
	}
	list, err := a.store.ModerationReports(r.URL.Query().Get("status"), 100)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось получить жалобы").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reports": list})
}

func (a *server) adminResolveReport(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermReports) {
		fail(http.StatusForbidden, "Нет права решать жалобы").write(w)
		return
	}
	id, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	var body struct {
		Status     string `json:"status"`
		Resolution string `json:"resolution"`
	}
	if err := decode(r, &body); err != nil || (body.Status != "resolved" && body.Status != "rejected") {
		fail(http.StatusBadRequest, "Неверный статус").write(w)
		return
	}
	if err := a.store.ResolveReport(id, adminInfo(r).User.ID, body.Status, body.Resolution); err != nil {
		fail(http.StatusNotFound, "Жалоба не найдена").write(w)
		return
	}
	if report, err := a.store.ModerationReportByID(id); err == nil {
		if notice, err := a.store.CreateReportDecisionNotification(*report); err == nil && notice != nil {
			a.hub.Send(notice.UserID, map[string]any{"type": "moderation:notification", "notification": notice})
			a.pushModerationNotification(*notice)
		} else if err != nil {
			slogWarn("create report decision notification", err)
		}
	} else {
		slogWarn("read resolved report", err)
	}
	a.audit(r, "report.resolve", "report", id, body.Resolution, map[string]any{"status": body.Status})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) moderationNotifications(w http.ResponseWriter, r *http.Request) {
	user, ok := r.Context().Value(userKey).(*store.User)
	if !ok || user == nil {
		fail(http.StatusUnauthorized, "Требуется вход").write(w)
		return
	}
	items, err := a.store.ModerationNotifications(user.ID, 50)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось загрузить уведомления").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notifications": items})
}

func (a *server) markModerationNotificationsRead(w http.ResponseWriter, r *http.Request) {
	user, ok := r.Context().Value(userKey).(*store.User)
	if !ok || user == nil {
		fail(http.StatusUnauthorized, "Требуется вход").write(w)
		return
	}
	var body struct {
		IDs []int64 `json:"ids"`
	}
	if err := decode(r, &body); err != nil || len(body.IDs) > 100 {
		fail(http.StatusBadRequest, "Неверный список уведомлений").write(w)
		return
	}
	if err := a.store.MarkModerationNotificationsRead(user.ID, body.IDs); err != nil {
		fail(http.StatusInternalServerError, "Не удалось отметить уведомления").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) audit(r *http.Request, action, targetType string, targetID int64, reason string, details any) {
	info := adminInfo(r)
	if info == nil {
		return
	}
	prev, _ := a.store.LastAdminAuditHash()
	raw, _ := json.Marshal(details)
	payload := strings.Join([]string{prev, strconv.FormatInt(info.User.ID, 10), action, targetType, strconv.FormatInt(targetID, 10), reason, string(raw), a.adminIPHash(r)}, "|")
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte(payload))
	hash := hex.EncodeToString(mac.Sum(nil))
	_, _ = a.store.AppendAdminAudit(info.User.ID, action, targetType, targetID, reason, string(raw), a.adminIPHash(r), prev, hash)
}

func chiURLParam(r *http.Request, name string) string {
	return chi.URLParam(r, name)
}

func (a *server) ensureSuperAdmins() {
	for _, id := range a.cfg.SuperAdminIDs {
		role, err := a.store.ActiveAdminRole(id)
		if err == nil && role.IsSuper() {
			continue
		}
		if err := a.store.EnsureAdminRole(id, "super_admin", store.AdminPermAllModerator, 0, 0); err != nil {
			slogWarn("bootstrap super admin", err)
		}
	}
}

func (a *server) adminBan(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermUsersBan) {
		fail(http.StatusForbidden, "Нет права банить").write(w)
		return
	}
	targetID, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	var body struct {
		Reason string `json:"reason"`
	}
	if err := decode(r, &body); err != nil || targetID <= 0 || strings.TrimSpace(body.Reason) == "" {
		fail(http.StatusBadRequest, "Нужна причина бана").write(w)
		return
	}
	if targetID == adminInfo(r).User.ID {
		fail(http.StatusBadRequest, "Нельзя забанить себя").write(w)
		return
	}
	target, err := a.store.UserByID(targetID)
	if err != nil {
		fail(http.StatusNotFound, "Пользователь не найден").write(w)
		return
	}
	role, _ := a.store.ActiveAdminRole(targetID)
	info := adminInfo(r)
	if role != nil && (role.IsSuper() || !info.Role.IsSuper()) {
		fail(http.StatusForbidden, "Забанить администратора может только super admin").write(w)
		return
	}
	if info.Role.IsSuper() {
		if err := a.executeBan(target, info.User.ID, body.Reason); err != nil {
			fail(http.StatusInternalServerError, "Не удалось забанить").write(w)
			return
		}
		a.audit(r, "user.ban", "user", targetID, body.Reason, nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "executed": true})
		return
	}
	approval, err := a.store.CreateApproval("ban_user", "user", targetID, "", body.Reason, info.User.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось создать заявку").write(w)
		return
	}
	a.audit(r, "user.ban.request", "user", targetID, body.Reason, map[string]any{"approvalId": approval})
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "approvalId": approval, "pending": true})
}

func (a *server) executeBan(target *store.User, by int64, reason string) error {
	ids, err := a.store.UserIdentifiers(target.ID)
	if err != nil {
		return err
	}
	add := func(kind, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		_ = a.store.AddBlacklist(kind, a.adminValueHMAC(kind, value), target.ID, reason, by)
	}
	add("username", ids.Username)
	add("email", ids.Email)
	add("phone", ids.PhoneHMAC)
	for _, value := range ids.OAuthIDs {
		add("oauth", value)
	}
	for _, value := range ids.Devices {
		add("device", value)
	}
	for _, value := range ids.IPHashes {
		add("ip", value)
	}
	if err := a.store.PurgeUser(target.ID, by, reason); err != nil {
		return err
	}
	_ = a.store.DeleteAdminSessionsForUser(target.ID)
	return nil
}

func (a *server) adminUnban(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermUsersBan) {
		fail(http.StatusForbidden, "Нет права разбанить").write(w)
		return
	}
	targetID, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	target, err := a.store.UserByID(targetID)
	if err != nil || target.BannedAt == 0 {
		fail(http.StatusNotFound, "Забаненный пользователь не найден").write(w)
		return
	}
	info := adminInfo(r)
	if !info.Role.IsSuper() && target.BannedBy != info.User.ID {
		fail(http.StatusForbidden, "Разбанить может только забанивший или super admin").write(w)
		return
	}
	password := randomToken(18)
	hash, err := auth.HashPassword(password)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось создать пароль").write(w)
		return
	}
	if err := a.store.RestoreBannedUser(targetID, hash); err != nil {
		fail(http.StatusNotFound, "Пользователь не найден").write(w)
		return
	}
	_ = a.store.ClearBlacklistForUser(targetID, info.User.ID)
	a.audit(r, "user.unban", "user", targetID, "", nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "temporaryPassword": password, "historyRestored": false})
}

func (a *server) adminDeleteChannel(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermChannelsEdit) {
		fail(http.StatusForbidden, "Нет права удалять каналы").write(w)
		return
	}
	kind := chiURLParam(r, "kind")
	id, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	var body struct {
		Reason string `json:"reason"`
	}
	if err := decode(r, &body); err != nil || id <= 0 || strings.TrimSpace(body.Reason) == "" {
		fail(http.StatusBadRequest, "Нужна причина удаления").write(w)
		return
	}
	if kind != "hub" && kind != "room" {
		fail(http.StatusBadRequest, "Неверный тип канала").write(w)
		return
	}
	info := adminInfo(r)
	if info.Role.IsSuper() {
		if err := a.store.DeleteChannel(kind, id); err != nil {
			fail(http.StatusNotFound, "Канал не найден").write(w)
			return
		}
		a.audit(r, "channel.delete", kind, id, body.Reason, nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "executed": true})
		return
	}
	approval, err := a.store.CreateApproval("delete_channel", kind, id, "", body.Reason, info.User.ID)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось создать заявку").write(w)
		return
	}
	a.audit(r, "channel.delete.request", kind, id, body.Reason, map[string]any{"approvalId": approval})
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "approvalId": approval, "pending": true})
}

func (a *server) adminApprove(w http.ResponseWriter, r *http.Request) {
	if !a.requireSuperAdmin(r) {
		fail(http.StatusForbidden, "Только super admin").write(w)
		return
	}
	id, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	approval, err := a.store.AdminApprovalByID(id)
	if err != nil || approval.Status != "pending" {
		fail(http.StatusNotFound, "Заявка не найдена или уже решена").write(w)
		return
	}
	info := adminInfo(r)
	if approval.RequestedBy == info.User.ID {
		fail(http.StatusBadRequest, "Нельзя подтвердить собственную заявку").write(w)
		return
	}
	switch approval.Action {
	case "ban_user":
		target, err := a.store.UserByID(approval.TargetID)
		if err != nil {
			fail(http.StatusNotFound, "Пользователь не найден").write(w)
			return
		}
		if err := a.executeBan(target, approval.RequestedBy, approval.Reason); err != nil {
			fail(http.StatusInternalServerError, "Не удалось забанить").write(w)
			return
		}
	case "delete_channel":
		if err := a.store.DeleteChannel(approval.TargetType, approval.TargetID); err != nil {
			fail(http.StatusNotFound, "Канал не найден").write(w)
			return
		}
	default:
		fail(http.StatusBadRequest, "Неизвестное действие").write(w)
		return
	}
	if err := a.store.ResolveApproval(id, true, info.User.ID, "approved"); err != nil {
		fail(http.StatusInternalServerError, "Не удалось подтвердить заявку").write(w)
		return
	}
	a.audit(r, "approval.approve", approval.TargetType, approval.TargetID, approval.Reason, map[string]any{"approvalId": id, "action": approval.Action})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) adminReject(w http.ResponseWriter, r *http.Request) {
	if !a.requireSuperAdmin(r) {
		fail(http.StatusForbidden, "Только super admin").write(w)
		return
	}
	id, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	var body struct {
		Resolution string `json:"resolution"`
	}
	_ = decode(r, &body)
	if err := a.store.ResolveApproval(id, false, adminInfo(r).User.ID, body.Resolution); err != nil {
		fail(http.StatusNotFound, "Заявка не найдена").write(w)
		return
	}
	a.audit(r, "approval.reject", "approval", id, body.Resolution, nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) adminAppeals(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermReports) {
		fail(http.StatusForbidden, "Нет права просмотра апелляций").write(w)
		return
	}
	list, err := a.store.Appeals(r.URL.Query().Get("status"), 100)
	if err != nil {
		fail(http.StatusInternalServerError, "Не удалось получить апелляции").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"appeals": list})
}

func (a *server) adminResolveAppeal(w http.ResponseWriter, r *http.Request) {
	if !a.requireAdminPermission(r, store.AdminPermReports) {
		fail(http.StatusForbidden, "Нет права решать апелляции").write(w)
		return
	}
	id, _ := strconv.ParseInt(chiURLParam(r, "id"), 10, 64)
	var body struct {
		Status     string `json:"status"`
		Resolution string `json:"resolution"`
	}
	if err := decode(r, &body); err != nil || (body.Status != "accepted" && body.Status != "rejected") {
		fail(http.StatusBadRequest, "Неверный статус").write(w)
		return
	}
	if err := a.store.ResolveAppeal(id, adminInfo(r).User.ID, body.Status, body.Resolution); err != nil {
		fail(http.StatusNotFound, "Апелляция не найдена").write(w)
		return
	}
	a.audit(r, "appeal.resolve", "appeal", id, body.Resolution, map[string]any{"status": body.Status})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *server) blacklistBlocked(r *http.Request, username, email, phone string) bool {
	check := func(kind, value string) bool {
		if strings.TrimSpace(value) == "" {
			return false
		}
		blocked, err := a.store.IsBlacklisted(kind, a.adminValueHMAC(kind, value))
		return err == nil && blocked
	}
	if check("username", auth.NormalizeUsername(username)) || check("email", strings.ToLower(strings.TrimSpace(email))) || check("phone", phone) {
		return true
	}
	if device := strings.TrimSpace(r.Header.Get("X-Device-Key")); device != "" && check("device", auth.HashDeviceKey(device)) {
		return true
	}
	return check("ip", a.adminIPHash(r))
}

func (a *server) banActive(user *store.User) bool {
	return user != nil && (user.BannedAt != 0 || user.SuspendedAt != 0)
}

func (a *server) phoneBlacklisted(phoneHMAC string) bool {
	if strings.TrimSpace(phoneHMAC) == "" {
		return false
	}
	blocked, err := a.store.IsBlacklisted("phone", a.adminValueHMAC("phone", phoneHMAC))
	return err == nil && blocked
}

func (a *server) oauthBlacklisted(providerID string) bool {
	if strings.TrimSpace(providerID) == "" {
		return false
	}
	blocked, err := a.store.IsBlacklisted("oauth", a.adminValueHMAC("oauth", providerID))
	return err == nil && blocked
}

// moderationAuth — вход в клиентскую админку по обычной сессии приложения.
// Отдельный cookie/логин не нужен: роль проверяется на каждом запросе.
func (a *server) moderationAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := r.Context().Value(userKey).(*store.User)
		if !ok || user == nil {
			fail(http.StatusUnauthorized, "Требуется вход").write(w)
			return
		}
		role, err := a.store.ActiveAdminRole(user.ID)
		if err != nil {
			fail(http.StatusForbidden, "Нет доступа к модерации").write(w)
			return
		}
		info := &adminSessionInfo{User: user, Role: role}
		next.ServeHTTP(w, r.WithContext(contextWithAdmin(r, info)))
	})
}

func (a *server) moderationMe(w http.ResponseWriter, r *http.Request) {
	info := adminInfo(r)
	if info == nil {
		fail(http.StatusForbidden, "Нет доступа к модерации").write(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":        publicAdminUser(info.User),
		"role":        info.Role,
		"isSuper":     info.Role.IsSuper(),
		"permissions": info.Role.Permissions,
	})
}
