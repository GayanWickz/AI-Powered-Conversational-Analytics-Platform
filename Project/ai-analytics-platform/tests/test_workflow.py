import pytest
from unittest.mock import patch, MagicMock
from src.graph.workflow import app, should_retry
from src.graph.state import AgentState


# ── Graph compilation ─────────────────────────────────────────────────────────
def test_graph_compiles():
    """The LangGraph workflow should compile without errors."""
    assert app is not None


# ── Routing logic ─────────────────────────────────────────────────────────────
def test_should_retry_when_error():
    state = AgentState(
        user_query="test", s3_uri="s3://bucket/file.csv",
        data_schema="", generated_python_code="",
        analysis_output="EXECUTION ERROR: KeyError: 'column'",
        final_recommendation="", has_error=True, retry_count=1,
    )
    assert should_retry(state) == "retry"


def test_should_not_retry_when_clean():
    state = AgentState(
        user_query="test", s3_uri="s3://bucket/file.csv",
        data_schema="", generated_python_code="",
        analysis_output="22% spike in missed calls between 10–12 PM",
        final_recommendation="Add 2 agents.", has_error=False, retry_count=0,
    )
    assert should_retry(state) == "done"


# ── State keys ────────────────────────────────────────────────────────────────
def test_agent_state_has_required_keys():
    keys = AgentState.__annotations__.keys()
    for key in ["user_query", "s3_uri", "data_schema", "generated_python_code",
                "analysis_output", "final_recommendation", "has_error", "retry_count"]:
        assert key in keys, f"Missing key in AgentState: {key}"