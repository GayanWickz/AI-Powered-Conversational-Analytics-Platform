package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/yourorg/ai-analytics-gateway/config"
	"github.com/yourorg/ai-analytics-gateway/internal/auth"
	"github.com/yourorg/ai-analytics-gateway/internal/middleware"
	"github.com/yourorg/ai-analytics-gateway/internal/proxy"
	"github.com/yourorg/ai-analytics-gateway/internal/ratelimit"
	"github.com/yourorg/ai-analytics-gateway/internal/session"
)

func main() {
	// ── Structured logger ────────────────────────────────────────────────────
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	// ── Configuration ────────────────────────────────────────────────────────
	cfg := config.Load()

	// ── Dependency setup ─────────────────────────────────────────────────────
	ctx := context.Background()

	// Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Error("redis connection failed", "err", err)
		os.Exit(1)
	}
	slog.Info("redis connected", "addr", cfg.RedisAddr)

	// Postgres
	pg, err := pgxpool.New(ctx, cfg.PostgresDSN)
	if err != nil {
		slog.Error("postgres connection failed", "err", err)
		os.Exit(1)
	}
	if err := pg.Ping(ctx); err != nil {
		slog.Error("postgres ping failed", "err", err)
		os.Exit(1)
	}
	slog.Info("postgres connected")

	// Run migrations
	if err := session.Migrate(ctx, pg); err != nil {
		slog.Error("migration failed", "err", err)
		os.Exit(1)
	}
	slog.Info("database migrations applied")

	// Services
	authSvc  := auth.NewService(cfg.JWTSecret, cfg.JWTExpiry)
	rl       := ratelimit.New(cfg.RateLimitRPS, cfg.RateLimitBurst)
	sessions := session.NewStore(rdb, pg, cfg.SessionTTL, cfg.MaxHistoryTurns)
	proxyH   := proxy.NewHandler(cfg.PythonBaseURL, sessions, cfg.MaxConcurrent)

	// ── Routes ───────────────────────────────────────────────────────────────
	mux := http.NewServeMux()

	// Public routes
	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("POST /auth/token", issueTokenHandler(authSvc))

	// Protected routes (auth + rate limit)
	protected := http.NewServeMux()
	protected.HandleFunc("POST /analyze", proxyH.Analyze)
	protected.HandleFunc("GET /history", proxyH.History)
	protected.HandleFunc("DELETE /history", proxyH.ClearHistory)

	// Stack middleware on protected routes
	protectedHandler := middleware.Authenticate(authSvc)(
		middleware.RateLimit(rl)(protected),
	)
	mux.Handle("/analyze", protectedHandler)
	mux.Handle("/history", protectedHandler)
    mux.Handle("DELETE /history", protectedHandler)
	
	// Apply global middleware
	handler := middleware.RequestID(
		middleware.Logger(
			middleware.CORS(mux),
		),
	)

	// ── Server ───────────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         ":" + cfg.GatewayPort,
		Handler:      handler,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		slog.Info("gateway starting", "port", cfg.GatewayPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-stop
	slog.Info("shutdown signal received")

	shutCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("shutdown error", "err", err)
	}
	pg.Close()
	rdb.Close()
	slog.Info("gateway stopped cleanly")
}

// ─── Public handlers ─────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": "ai-analytics-gateway",
	})
}

// issueTokenHandler is a convenience endpoint for development.
// In production, replace with your real identity provider.
func issueTokenHandler(authSvc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			UserID string `json:"user_id"`
			Email  string `json:"email"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprintln(w, `{"error":"user_id is required"}`)
			return
		}
		token, err := authSvc.IssueToken(req.UserID, req.Email)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprintln(w, `{"error":"could not issue token"}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	}
}
