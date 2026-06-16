package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/yourorg/ai-analytics-gateway/internal/middleware"
	"github.com/yourorg/ai-analytics-gateway/internal/session"
)

// AnalyzeRequest is the payload the gateway sends to Python FastAPI.
type AnalyzeRequest struct {
	UserQuery           string       `json:"user_query"`
	S3URI               string       `json:"s3_uri"`
	ConversationHistory []HistoryMsg `json:"conversation_history,omitempty"`
}

// HistoryMsg is a single turn injected into the Python request.
type HistoryMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// AnalyzeResponse mirrors the FastAPI /analyze response.
type AnalyzeResponse struct {
	FinalRecommendation string `json:"final_recommendation"`
	AnalysisOutput      string `json:"analysis_output"`
	GeneratedCode       string `json:"generated_code"`
	RetryCount          int    `json:"retry_count"`
}

// ClientRequest is the raw payload the client sends to the gateway.
type ClientRequest struct {
	UserQuery string `json:"user_query"`
	S3URI     string `json:"s3_uri"`
}

// Handler forwards enriched requests to the Python service.
type Handler struct {
	pythonURL  string
	sessions   *session.Store
	httpClient *http.Client
	sem        chan struct{} // concurrency semaphore
}

func NewHandler(pythonURL string, sessions *session.Store, maxConcurrent int) *Handler {
	return &Handler{
		pythonURL: pythonURL,
		sessions:  sessions,
		httpClient: &http.Client{
			Timeout: 180 * time.Second, // LangGraph can be slow
		},
		sem: make(chan struct{}, maxConcurrent),
	}
}

// Analyze handles POST /analyze.
func (h *Handler) Analyze(w http.ResponseWriter, r *http.Request) {
	// Safe extraction using middleware's context key — avoids nil panic
	userID, ok := r.Context().Value(middleware.ContextKeyUserID).(string)
	if !ok || userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Parse client payload
	var clientReq ClientRequest
	if err := json.NewDecoder(r.Body).Decode(&clientReq); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if clientReq.UserQuery == "" || clientReq.S3URI == "" {
		writeError(w, http.StatusBadRequest, "user_query and s3_uri are required")
		return
	}

	// Acquire concurrency slot (backpressure)
	select {
	case h.sem <- struct{}{}:
		defer func() { <-h.sem }()
	case <-r.Context().Done():
		writeError(w, http.StatusServiceUnavailable, "server busy, try again")
		return
	}

	// Load this user's conversation history
	history, err := h.sessions.GetHistory(r.Context(), userID)
	if err != nil {
		// Non-fatal: proceed without history
		history = nil
	}

	// Build enriched request for Python
	pyReq := AnalyzeRequest{
		UserQuery: clientReq.UserQuery,
		S3URI:     clientReq.S3URI,
	}
	for _, t := range history {
		pyReq.ConversationHistory = append(pyReq.ConversationHistory, HistoryMsg{
			Role:    t.Role,
			Content: t.Content,
		})
	}

	// Call Python FastAPI
	result, err := h.callPython(r.Context(), pyReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("analysis service error: %v", err))
		return
	}

	// Persist both sides of this turn asynchronously
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = h.sessions.AppendTurn(ctx, userID, session.Turn{
			Role:    "user",
			Content: clientReq.UserQuery,
			S3URI:   clientReq.S3URI,
		})
		_ = h.sessions.AppendTurn(ctx, userID, session.Turn{
			Role:    "assistant",
			Content: result.FinalRecommendation,
		})
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// History handles GET /history — returns the caller's conversation history.
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middleware.ContextKeyUserID).(string)
	if !ok || userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	turns, err := h.sessions.GetHistory(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load history")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"history": turns})
}

// ClearHistory handles DELETE /history.
func (h *Handler) ClearHistory(w http.ResponseWriter, r *http.Request) {
	userID, ok := r.Context().Value(middleware.ContextKeyUserID).(string)
	if !ok || userID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if err := h.sessions.ClearHistory(r.Context(), userID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not clear history")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
}

// ─── internal ────────────────────────────────────────────────────────────────

func (h *Handler) callPython(ctx context.Context, req AnalyzeRequest) (*AnalyzeResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		h.pythonURL+"/analyze", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := h.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("python returned %d: %s", resp.StatusCode,
			strings.TrimSpace(string(respBody)))
	}

	var result AnalyzeResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("could not parse python response: %w", err)
	}
	return &result, nil
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}