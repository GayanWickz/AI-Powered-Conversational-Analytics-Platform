package ratelimit

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// entry wraps a limiter with a last-seen timestamp for cleanup.
type entry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// Limiter holds a per-user map of token-bucket limiters.
type Limiter struct {
	mu      sync.Mutex
	users   map[string]*entry
	rps     rate.Limit
	burst   int
	cleanup time.Duration
}

func New(rps float64, burst int) *Limiter {
	l := &Limiter{
		users:   make(map[string]*entry),
		rps:     rate.Limit(rps),
		burst:   burst,
		cleanup: 10 * time.Minute,
	}
	go l.gcLoop()
	return l
}

// Allow returns true if the user is under their rate limit.
func (l *Limiter) Allow(userID string) bool {
	l.mu.Lock()
	e, ok := l.users[userID]
	if !ok {
		e = &entry{limiter: rate.NewLimiter(l.rps, l.burst)}
		l.users[userID] = e
	}
	e.lastSeen = time.Now()
	l.mu.Unlock()
	return e.limiter.Allow()
}

// gcLoop periodically removes entries that haven't been seen recently.
func (l *Limiter) gcLoop() {
	ticker := time.NewTicker(l.cleanup)
	defer ticker.Stop()
	for range ticker.C {
		l.mu.Lock()
		cutoff := time.Now().Add(-l.cleanup)
		for id, e := range l.users {
			if e.lastSeen.Before(cutoff) {
				delete(l.users, id)
			}
		}
		l.mu.Unlock()
	}
}
