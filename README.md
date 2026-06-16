# AI-Powered Conversational Analytics Platform

A production-style, multi-service AI analytics platform where users query CSV/Excel datasets in natural language and receive automated insights, executive summaries, and auto-generated charts — powered by a multi-agent LangGraph pipeline running on AWS Bedrock (Claude Sonnet 4.5).

## Architecture

```
React Frontend (Vite + Tailwind + Recharts)
        │
        ▼  :8080
  Go API Gateway
  ├── JWT authentication
  ├── Per-user rate limiting (token bucket)
  ├── Concurrency control (semaphore worker pool)
  └── Session manager
       ├── Redis     — hot session cache (TTL-based)
       └── PostgreSQL — persistent conversation history
        │
        ▼  :8000 (internal only)
  Python FastAPI
  └── LangGraph pipeline: Analyst → Executor → Critic (auto-retry on failure)
        │
        ▼
  AWS Bedrock (Claude Sonnet 4.5) + Amazon S3 (data source)
```

All client traffic is routed through the Go gateway. The Python AI service is never exposed externally — only the gateway can reach it.

## How It Works

1. The user adds an S3 data source (CSV/Excel) and asks a question in plain English.
2. The Go gateway authenticates the request, applies rate limiting, and loads the user's prior conversation turns from Redis/PostgreSQL.
3. The enriched request (query + conversation history) is forwarded to the Python service.
4. A LangGraph agent pipeline runs three roles in sequence:
   - **Analyst** — reads the dataset schema and writes Python/pandas code to answer the query.
   - **Executor** — runs the generated code in a sandboxed environment against the real data.
   - **Critic** — validates the output; if it failed or is incorrect, it loops back to the Analyst (up to 3 retries), otherwise it produces a plain-language executive summary.
5. The final recommendation, raw output, and generated code are returned to the frontend and rendered as a chat response, an auto-generated chart, and a code preview — and the turn is persisted for future follow-up questions.

## Tech Stack

**Frontend** — React, Vite, Tailwind CSS, Recharts, lucide-react

**Gateway (Go)** — `net/http`, JWT auth (`golang-jwt`), token-bucket rate limiting (`golang.org/x/time/rate`), `pgx` (PostgreSQL), `go-redis`, structured logging (`log/slog`)

**AI Service (Python)** — FastAPI, LangGraph, LangChain, `langchain-aws`, AWS Bedrock (Claude Sonnet 4.5), pandas, boto3

**Data Layer** — PostgreSQL (persistent history), Redis (hot cache), Amazon S3 (dataset storage)

**Infrastructure** — Docker, Docker Compose

## Key Features

- Multi-agent reasoning pipeline with automatic error recovery and retry logic
- Multi-turn conversational memory — follow-up questions resolve against prior results
- Sandboxed code execution — AI-generated Python runs with restricted builtins, no filesystem/network access
- JWT-secured API gateway with per-user rate limiting and concurrency backpressure
- Dual-layer session storage — Redis for low-latency reads, PostgreSQL as the durable source of truth
- Auto-generated charts from unstructured analysis output

## Running Locally

```bash
# 1. Copy your AWS credentials and S3 bucket info into a .env file (see .env.example)

# 2. Start the full stack
docker compose -f docker-compose-full.yml up --build

# 3. Get a JWT
curl -s -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice", "email": "alice@example.com"}' | jq .token

# 4. Run an analysis
TOKEN="<paste token here>"
curl -s -X POST http://localhost:8080/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user_query": "What are the top 5 products by revenue?",
    "s3_uri": "s3://your-bucket/your-file.csv"
  }' | jq .
```

The frontend runs separately via `npm run dev` inside the React project directory (default port `5173`).

## API Reference

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/health` | GET | No | Service health check |
| `/auth/token` | POST | No | Issues a JWT for a given user |
| `/analyze` | POST | Yes | Runs an analysis, returns insights + chart data |
| `/history` | GET | Yes | Returns the user's conversation history |
| `/history` | DELETE | Yes | Clears the user's conversation history |

## Project Structure

```
.
├── gateway/                 # Go API gateway
│   ├── cmd/                 # entrypoint
│   ├── config/              # env-based configuration
│   └── internal/
│       ├── auth/             # JWT issue + validation
│       ├── middleware/       # CORS, logging, auth, rate limit
│       ├── proxy/            # forwards requests to Python service
│       ├── ratelimit/        # per-user token bucket
│       └── session/          # Redis + PostgreSQL session store
├── ai-analytics-platform/   # Python FastAPI + LangGraph service
│   └── src/
│       ├── aws/               # Bedrock client, S3 data fetching
│       ├── graph/             # LangGraph state, workflow, agent nodes
│       ├── prompts/           # agent prompt templates
│       └── tools/             # schema extraction, sandboxed code execution
└── agent-platform/           # React frontend
```

