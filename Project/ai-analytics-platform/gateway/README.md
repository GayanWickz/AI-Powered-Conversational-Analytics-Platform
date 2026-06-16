# AI Analytics Platform — Go Gateway Layer

## Architecture

```
Client (React / curl)
        │
        ▼  :8080
  Go API Gateway
  ├── JWT auth middleware
  ├── Per-user rate limiter  (token bucket)
  ├── Goroutine worker pool  (semaphore, configurable max concurrency)
  └── Session manager
       ├── Redis  — hot cache, TTL-based eviction
       └── Postgres — long-term per-user history
        │
        ▼  :8000 (internal only)
  Python FastAPI (LangGraph)
  └── Analyst → Executor → Critic graph
        │
        ▼
  AWS Bedrock (Claude Sonnet 4.5)
```

All client traffic goes through the Go gateway. The Python service is never exposed externally.

---

## Quick start

```bash
# 1. Copy your existing .env to the project root (AWS keys, S3 bucket, etc.)

# 2. Start the full stack
docker compose -f docker-compose-full.yml up --build

# 3. Get a JWT for your user
curl -s -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice", "email": "alice@example.com"}' | jq .token

# 4. Run an analysis (the gateway injects your conversation history automatically)
TOKEN="<paste token here>"
curl -s -X POST http://localhost:8080/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_query": "What are the top 5 products by revenue?",
    "s3_uri": "s3://your-bucket/your-file.xlsx"
  }' | jq .

# 5. Ask a follow-up (history is injected automatically)
curl -s -X POST http://localhost:8080/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_query": "Now break those top 5 down by region.",
    "s3_uri": "s3://your-bucket/your-file.xlsx"
  }' | jq .

# 6. View your conversation history
curl -s http://localhost:8080/history \
  -H "Authorization: Bearer $TOKEN" | jq .

# 7. Clear your history
curl -s -X DELETE http://localhost:8080/history \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## Environment variables (Go gateway)

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_PORT` | `8080` | Port the gateway listens on |
| `PYTHON_BASE_URL` | `http://localhost:8000` | Python FastAPI base URL |
| `JWT_SECRET` | `change-me-in-production` | HMAC secret for JWTs — **change this** |
| `JWT_EXPIRY` | `24h` | Token lifetime |
| `RATE_LIMIT_RPS` | `5` | Requests per second per user |
| `RATE_LIMIT_BURST` | `10` | Burst allowance |
| `MAX_CONCURRENT` | `20` | Max simultaneous Python calls |
| `REDIS_ADDR` | `localhost:6379` | Redis address |
| `SESSION_TTL` | `24h` | Redis cache TTL per user |
| `POSTGRES_DSN` | see config | Postgres connection string |
| `MAX_HISTORY_TURNS` | `10` | Prior turns injected into each request |

---

## Python changes required

Replace these files in your existing Python project:

| Gateway file | Replaces |
|---|---|
| `main_updated.py` | `main.py` |
| `state_updated.py` | `src/graph/state.py` |
| `agent_prompts_updated.py` | `src/prompts/agent_prompts.py` |
| `analyst_updated.py` | `src/graph/nodes/analyst.py` |

The only changes are:
1. `main.py` — accepts optional `conversation_history` list from Go
2. `state.py` — adds `conversation_history: str` field
3. `agent_prompts.py` — analyst prompt includes a `{history_block}` section
4. `analyst.py` — formats and injects history into the prompt

---

## API reference

### `POST /auth/token` (public)
Issues a JWT. In production, replace with your identity provider.

**Body:** `{"user_id": "alice", "email": "alice@example.com"}`
**Response:** `{"token": "eyJ..."}`

### `POST /analyze` (authenticated)
Runs an analysis and persists the Q&A to the user's history.

**Headers:** `Authorization: Bearer <token>`
**Body:** `{"user_query": "...", "s3_uri": "s3://bucket/file.xlsx"}`
**Response:** `{"final_recommendation": "...", "analysis_output": "...", "generated_code": "...", "retry_count": 0}`

### `GET /history` (authenticated)
Returns the authenticated user's conversation history.

**Response:** `{"history": [{"role": "user", "content": "...", "created_at": "..."}, ...]}`

### `DELETE /history` (authenticated)
Clears the authenticated user's conversation history from both Redis and Postgres.

**Response:** `{"status": "cleared"}`

### `GET /health` (public)
**Response:** `{"status": "ok", "service": "ai-analytics-gateway"}`
