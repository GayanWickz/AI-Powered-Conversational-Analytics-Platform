from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
from src.graph.workflow import app as agent_app
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Gen AI Analytics Platform",
    description="Agentic data analyst powered by Claude Sonnet 4.5 + LangGraph",
    version="2.0.0",
)


# ✅ Add CORS BEFORE any routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
class HistoryMessage(BaseModel):
    role: str      # "user" or "assistant"
    content: str


class Query(BaseModel):
    user_query: str
    s3_uri: str
    # Injected by the Go gateway — previous turns for this user
    conversation_history: Optional[List[HistoryMessage]] = []


@app.post("/analyze")
async def analyze_data(request: Query):
    # Build a plain-text memory block from history so the analyst
    # prompt can reference prior findings without schema changes.
    history_context = ""
    if request.conversation_history:
        lines = []
        for msg in request.conversation_history:
            prefix = "User" if msg.role == "user" else "Assistant"
            lines.append(f"{prefix}: {msg.content}")
        history_context = "\n".join(lines)

    initial_state = {
        "user_query": request.user_query,
        "s3_uri": request.s3_uri,
        "conversation_history": history_context,  # plain text, injected into analyst prompt
        "data_schema": "",
        "generated_python_code": "",
        "analysis_output": "",
        "final_recommendation": "",
        "has_error": False,
        "retry_count": 0,
    }
    result = await agent_app.ainvoke(initial_state)
    return {
        "final_recommendation": result["final_recommendation"],
        "analysis_output": result["analysis_output"],
        "generated_code": result["generated_python_code"],
        "retry_count": result["retry_count"],
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-analytics-python"}

