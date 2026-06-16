package session

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Turn represents one user↔assistant exchange.
type Turn struct {
	Role      string    `json:"role"`       // "user" or "assistant"
	Content   string    `json:"content"`
	S3URI     string    `json:"s3_uri,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// Store manages per-user conversation history across Redis and Postgres.
type Store struct {
	rdb        *redis.Client
	pg         *pgxpool.Pool
	ttl        time.Duration
	maxHistory int
}

func NewStore(rdb *redis.Client, pg *pgxpool.Pool, ttl time.Duration, maxHistory int) *Store {
	return &Store{rdb: rdb, pg: pg, ttl: ttl, maxHistory: maxHistory}
}

// redisKey returns the Redis key for a user's recent history.
func redisKey(userID string) string {
	return fmt.Sprintf("session:%s:history", userID)
}

// GetHistory returns the most recent N turns for a user.
// Tries Redis first; falls back to Postgres on cache miss.
func (s *Store) GetHistory(ctx context.Context, userID string) ([]Turn, error) {
	key := redisKey(userID)

	// 1. Try Redis (fast path)
	data, err := s.rdb.Get(ctx, key).Bytes()
	if err == nil {
		var turns []Turn
		if jsonErr := json.Unmarshal(data, &turns); jsonErr == nil {
			return turns, nil
		}
	}

	// 2. Fall back to Postgres
	turns, err := s.loadFromPostgres(ctx, userID)
	if err != nil {
		return nil, err
	}

	// 3. Warm the cache
	if len(turns) > 0 {
		_ = s.writeToRedis(ctx, userID, turns)
	}
	return turns, nil
}

// AppendTurn adds a new turn to the user's history in both stores.
func (s *Store) AppendTurn(ctx context.Context, userID string, turn Turn) error {
	turn.CreatedAt = time.Now()

	// Write to Postgres first (source of truth)
	if err := s.writeToPostgres(ctx, userID, turn); err != nil {
		return fmt.Errorf("session: postgres write: %w", err)
	}

	// Reload from Postgres and refresh Redis (keeps the cap enforced)
	turns, err := s.loadFromPostgres(ctx, userID)
	if err != nil {
		return err
	}
	return s.writeToRedis(ctx, userID, turns)
}

// ClearHistory removes all history for a user (both stores).
func (s *Store) ClearHistory(ctx context.Context, userID string) error {
	_, err := s.pg.Exec(ctx, `DELETE FROM conversation_turns WHERE user_id = $1`, userID)
	if err != nil {
		return err
	}
	s.rdb.Del(ctx, redisKey(userID))
	return nil
}

// ─── internal helpers ────────────────────────────────────────────────────────

func (s *Store) loadFromPostgres(ctx context.Context, userID string) ([]Turn, error) {
	rows, err := s.pg.Query(ctx, `
		SELECT role, content, s3_uri, created_at
		FROM conversation_turns
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, s.maxHistory)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var turns []Turn
	for rows.Next() {
		var t Turn
		if err := rows.Scan(&t.Role, &t.Content, &t.S3URI, &t.CreatedAt); err != nil {
			return nil, err
		}
		turns = append(turns, t)
	}

	// Reverse to chronological order (oldest first)
	for i, j := 0, len(turns)-1; i < j; i, j = i+1, j-1 {
		turns[i], turns[j] = turns[j], turns[i]
	}
	return turns, rows.Err()
}

func (s *Store) writeToPostgres(ctx context.Context, userID string, turn Turn) error {
	_, err := s.pg.Exec(ctx, `
		INSERT INTO conversation_turns (user_id, role, content, s3_uri, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`, userID, turn.Role, turn.Content, turn.S3URI, turn.CreatedAt)
	return err
}

func (s *Store) writeToRedis(ctx context.Context, userID string, turns []Turn) error {
	data, err := json.Marshal(turns)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, redisKey(userID), data, s.ttl).Err()
}

// ─── Schema migration (run once at startup) ──────────────────────────────────

// Migrate ensures the required Postgres tables exist.
func Migrate(ctx context.Context, pg *pgxpool.Pool) error {
	_, err := pg.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS conversation_turns (
			id         BIGSERIAL PRIMARY KEY,
			user_id    TEXT        NOT NULL,
			role       TEXT        NOT NULL CHECK (role IN ('user','assistant')),
			content    TEXT        NOT NULL,
			s3_uri     TEXT        NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
		CREATE INDEX IF NOT EXISTS idx_turns_user_created
			ON conversation_turns (user_id, created_at DESC);
	`)
	return err
}
