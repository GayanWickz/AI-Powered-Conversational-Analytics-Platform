from src.aws.bedrock import get_bedrock_client
from src.tools.excel_tools import get_rich_schema
from src.prompts.agent_prompts import (
    ANALYST_PROMPT,
    ANALYST_RETRY_PROMPT,
    build_history_block,
)

llm = get_bedrock_client()


def analyst_node(state: dict) -> dict:
    """
    Plans the analysis by writing Python code to answer the user's query.
    On retries, uses ANALYST_RETRY_PROMPT so the model knows what went wrong.
    Always injects the conversation history so follow-up questions resolve correctly.
    """
    schema = get_rich_schema(state["s3_uri"])
    history_block = build_history_block(state.get("conversation_history", ""))

    is_retry = state.get("has_error", False) and state.get("retry_count", 0) > 0

    if is_retry:
        prompt = ANALYST_RETRY_PROMPT.format(
            schema=schema,
            history_block=history_block,
            query=state["user_query"],
            previous_code=state.get("generated_python_code", ""),
            error_message=state.get("analysis_output", "Unknown error"),
        )
    else:
        prompt = ANALYST_PROMPT.format(
            schema=schema,
            history_block=history_block,
            query=state["user_query"],
        )

    response = llm.invoke(prompt)

    code = response.content.strip()
    if code.startswith("```"):
        code = code.split("\n", 1)[-1]
    if code.endswith("```"):
        code = code.rsplit("```", 1)[0]

    return {
        "data_schema": schema,
        "generated_python_code": code.strip(),
    }