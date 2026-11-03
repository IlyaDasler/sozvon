// Каркас Go-сервера «Созвона»: фаза 1 плана docs/adr/0002-go-backend.md.
// Пока только здоровье, конфиг, SQLite и миграции — API переносится следующими фазами.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"sozvon/server/internal/config"
	"sozvon/server/internal/store"
)

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

	router := chi.NewRouter()
	router.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, middleware.Timeout(30*time.Second))

	router.Route("/api", func(r chi.Router) {
		// Ответ 1:1 как у Node-сервера (см. server/contract/api.json)
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":             true,
				"app":            "sozvon",
				"inviteRequired": cfg.InviteCode != "",
				"emailCodes":     cfg.EmailCodes(),
			})
		})
	})

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("сервер запущен", "addr", server.Addr, "data", cfg.DataDir)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("сервер остановился", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("не удалось остановить сервер", "error", err)
	}
	logger.Info("сервер остановлен")
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
