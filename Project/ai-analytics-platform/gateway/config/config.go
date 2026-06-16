package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all runtime configuration for the gateway.
type Config struct {
	// Server
	GatewayPort    string
	PythonBaseURL  string
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration
	IdleTimeout    time.Duration

	// Auth
	JWTSecret      string
	JWTExpiry      time.Duration

	// Rate limiting  (per user, per second)
	RateLimitRPS   float64
	RateLimitBurst int

	// Worker pool
	MaxConcurrent  int

	// Redis
	RedisAddr      string
	RedisPassword  string
	RedisDB        int
	SessionTTL     time.Duration

	// Postgres
	PostgresDSN    string

	// History
	MaxHistoryTurns int // how many past turns to inject into each request
}

func Load() *Config {
	return &Config{
		GatewayPort:     getEnv("GATEWAY_PORT", "8080"),
		PythonBaseURL:   getEnv("PYTHON_BASE_URL", "http://localhost:8000"),
		ReadTimeout:     getDuration("READ_TIMEOUT", 120*time.Second),
		WriteTimeout:    getDuration("WRITE_TIMEOUT", 120*time.Second),
		IdleTimeout:     getDuration("IDLE_TIMEOUT", 60*time.Second),

		JWTSecret:       getEnv("JWT_SECRET", "change-me-in-production"),
		JWTExpiry:       getDuration("JWT_EXPIRY", 24*time.Hour),

		RateLimitRPS:    getFloat("RATE_LIMIT_RPS", 5),
		RateLimitBurst:  getInt("RATE_LIMIT_BURST", 10),

		MaxConcurrent:   getInt("MAX_CONCURRENT", 20),

		RedisAddr:       getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:   getEnv("REDIS_PASSWORD", ""),
		RedisDB:         getInt("REDIS_DB", 0),
		SessionTTL:      getDuration("SESSION_TTL", 24*time.Hour),

		PostgresDSN:     getEnv("POSTGRES_DSN", "postgres://postgres:postgres@localhost:5432/analytics?sslmode=disable"),

		MaxHistoryTurns: getInt("MAX_HISTORY_TURNS", 10),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func getFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}

func getDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
