from typing import TypedDict

class AgentState(TypedDict):
    user_query: str
    s3_uri: str
    conversation_history: str  # Injected by Go gateway — prior turns as plain text
    data_schema: str
    generated_python_code: str
    analysis_output: str
    final_recommendation: str
    has_error: bool
    retry_count: int