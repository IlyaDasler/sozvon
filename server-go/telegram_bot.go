package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"sozvon/server/internal/store"
)

// Telegram Contact Share: единственный бесплатный способ подтвердить телефон,
// не отправляя SMS. Бот работает через long polling, поэтому публичный webhook
// и HTTPS-домен не нужны.

type telegramUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
}

type telegramChat struct {
	ID int64 `json:"id"`
}

type telegramContact struct {
	PhoneNumber string `json:"phone_number"`
	FirstName   string `json:"first_name"`
	UserID      int64  `json:"user_id"`
}

type telegramMessage struct {
	MessageID int64            `json:"message_id"`
	From      *telegramUser    `json:"from"`
	Chat      *telegramChat    `json:"chat"`
	Text      string           `json:"text"`
	Contact   *telegramContact `json:"contact"`
}

type telegramUpdate struct {
	UpdateID int64            `json:"update_id"`
	Message  *telegramMessage `json:"message"`
}

type telegramResponse struct {
	OK          bool            `json:"ok"`
	Description string          `json:"description"`
	Result      json.RawMessage `json:"result"`
}

func (a *server) telegramHTTP(method string, payload any) (json.RawMessage, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(encoded)
	}
	endpoint := strings.TrimRight(a.telegramAPIBase, "/") + "/bot" + a.telegramToken + "/" + method
	req, err := http.NewRequest(http.MethodPost, endpoint, body)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 40 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("telegram %s: network error", method)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	var answer telegramResponse
	if err := json.Unmarshal(data, &answer); err != nil {
		return nil, fmt.Errorf("telegram %s: HTTP %d", method, res.StatusCode)
	}
	if !answer.OK {
		return nil, fmt.Errorf("telegram %s: %s", method, answer.Description)
	}
	return answer.Result, nil
}

func (a *server) telegramSend(chatID int64, text string, withContactButton bool) error {
	payload := map[string]any{"chat_id": chatID, "text": text, "disable_web_page_preview": true}
	if withContactButton {
		payload["reply_markup"] = map[string]any{
			"keyboard":          [][]map[string]any{{{"text": "Отправить номер", "request_contact": true}}},
			"resize_keyboard":   true,
			"one_time_keyboard": true,
		}
	}
	_, err := a.telegramHTTP("sendMessage", payload)
	return err
}

func (a *server) telegramBotLoop(ctx context.Context) {
	me, err := a.telegramHTTP("getMe", nil)
	if err != nil {
		slog.Error("Telegram: не удалось получить бота", "error", err)
		return
	}
	var bot telegramUser
	if err := json.Unmarshal(me, &bot); err != nil || bot.Username == "" {
		slog.Error("Telegram: пустой ответ getMe")
		return
	}
	a.telegramBotUsername = bot.Username
	slog.Info("Telegram-бот готов", "username", bot.Username)

	var offset int64
	for ctx.Err() == nil {
		result, err := a.telegramHTTP("getUpdates", map[string]any{
			"offset": offset, "timeout": 25, "allowed_updates": []string{"message"},
		})
		if err != nil {
			slog.Warn("Telegram: getUpdates", "error", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
			continue
		}
		var updates []telegramUpdate
		if err := json.Unmarshal(result, &updates); err != nil {
			slog.Warn("Telegram: разбор updates", "error", err)
			continue
		}
		for _, update := range updates {
			if update.UpdateID >= offset {
				offset = update.UpdateID + 1
			}
			a.handleTelegramUpdate(update)
		}
	}
}

func (a *server) handleTelegramUpdate(update telegramUpdate) {
	msg := update.Message
	if msg == nil || msg.From == nil || msg.Chat == nil || msg.From.IsBot {
		return
	}
	chatID := msg.Chat.ID

	if msg.Contact != nil {
		a.handleTelegramContact(msg, chatID)
		return
	}
	if !strings.HasPrefix(msg.Text, "/start") {
		return
	}
	parts := strings.Fields(msg.Text)
	if len(parts) < 2 {
		_ = a.telegramSend(chatID, "Начните регистрацию на сайте Созвона — бот подтвердит номер.", false)
		return
	}
	token := strings.TrimSpace(parts[1])
	signup, err := a.store.PhoneSignupByTokenHash(tokenHash(token))
	if err != nil || signup.ExpiresAt <= time.Now().Unix() || signup.UsedAt != 0 {
		_ = a.telegramSend(chatID, "Ссылка устарела. Начните регистрацию на сайте заново.", false)
		return
	}
	if signup.VerifiedAt != 0 {
		_ = a.telegramSend(chatID, "Этот номер уже подтверждён. Вернитесь в приложение Созвон.", false)
		return
	}
	if err := a.store.BindPhoneSignupChat(signup.ID, chatID); err != nil {
		_ = a.telegramSend(chatID, "Не удалось открыть регистрацию. Попробуйте ещё раз.", false)
		return
	}
	_ = a.telegramSend(chatID, "Нажмите «Отправить номер», чтобы подтвердить телефон для Созвона. Номер увидит только сервер для проверки и сохранит его хеш.", true)
}

func (a *server) handleTelegramContact(msg *telegramMessage, chatID int64) {
	contact := msg.Contact
	if contact == nil || contact.UserID == 0 || contact.UserID != msg.From.ID {
		_ = a.telegramSend(chatID, "Поделитесь, пожалуйста, своим номером кнопкой ниже — чужой контакт не подходит.", true)
		return
	}
	phone, ok := normalizePhone(contact.PhoneNumber)
	if !ok {
		_ = a.telegramSend(chatID, "Telegram прислал номер в неизвестном формате. Попробуйте ещё раз.", true)
		return
	}
	signup, err := a.store.PhoneSignupForChat(chatID)
	if errors.Is(err, store.ErrPhoneSignupNotFound) {
		_ = a.telegramSend(chatID, "Сначала начните регистрацию на сайте Созвона.", false)
		return
	}
	if err != nil {
		_ = a.telegramSend(chatID, "Ошибка регистрации. Попробуйте позже.", false)
		return
	}
	if signup.ExpiresAt <= time.Now().Unix() || signup.UsedAt != 0 {
		_ = a.telegramSend(chatID, "Срок регистрации истёк. Начните заново на сайте.", false)
		return
	}
	if a.phoneDigest(phone) != signup.PhoneHMAC {
		_ = a.telegramSend(chatID, "Номер не совпадает с тем, который вы указали на сайте. Введите тот же номер или начните заново.", true)
		return
	}
	if err := a.store.MarkPhoneSignupVerified(signup.ID, chatID); err != nil {
		_ = a.telegramSend(chatID, "Не удалось подтвердить номер. Попробуйте ещё раз.", true)
		return
	}
	_ = a.telegramSend(chatID, "Готово! Вернитесь в приложение Созвон — регистрация завершится автоматически.", false)
}
