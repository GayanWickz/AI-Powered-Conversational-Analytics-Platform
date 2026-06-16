from langgraph.graph import StateGraph, END
from src.graph.state import AgentState
from src.graph.nodes.analyst import analyst_node
from src.graph.nodes.executor import executor_node
from src.graph.nodes.critic import critic_node

def should_retry(state: AgentState) -> str:
    """
    Conditional routing after the critic runs.
    - If critic flagged an error AND we haven't hit max retries → loop back to analyst.
    - Otherwise → end the graph and return the final recommendation.
    """
    if state.get("has_error", False):
        return "retry"
    return "done"


# ── Build the graph ───────────────────────────────────────────────────────────
workflow = StateGraph(AgentState)

workflow.add_node("analyst", analyst_node)
workflow.add_node("executor", executor_node)
workflow.add_node("critic", critic_node)

# Entry point
workflow.set_entry_point("analyst")

# Linear forward path
workflow.add_edge("analyst", "executor")
workflow.add_edge("executor", "critic")

# Conditional edge after critic:
#   "retry" → back to analyst to fix the code
#   "done"  → end the graph
workflow.add_conditional_edges(
    "critic",
    should_retry,
    {
        "retry": "analyst",
        "done": END,
    },
)

app = workflow.compile()