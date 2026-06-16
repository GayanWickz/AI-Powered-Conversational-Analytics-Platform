from src.aws.bedrock import get_bedrock_client
from src.prompts.agent_prompts import CRITIC_PROMPT, SUMMARIZER_PROMPT

llm = get_bedrock_client()

MAX_RETRIES = 3

def critic_node(state: dict) -> dict:
    """
    Two responsibilities:
    1. QA check — did the executor produce a real result or an error?
       Sets has_error=True to trigger a retry loop back to the analyst.
    2. If the output is good (PASS), generate the final executive summary.
    """
    retry_count = state.get("retry_count", 0)

    # ── Hard stop: too many retries ──────────────────────────────────────────
    if retry_count >= MAX_RETRIES:
        return {
            "has_error": False,  # Force exit from loop
            "final_recommendation": (
                f"Analysis could not be completed after {MAX_RETRIES} attempts. "
                f"Last error: {state.get('analysis_output', 'Unknown')}"
            ),
        }

    # ── Step 1: Ask the critic to evaluate the output ────────────────────────
    critic_prompt = CRITIC_PROMPT.format(
        query=state["user_query"],
        analysis_output=state["analysis_output"],
    )
    critic_response = llm.invoke(critic_prompt).content.strip()

    # Parse the first word of the response: PASS or FAIL
    verdict = critic_response.split("\n")[0].strip().upper()
    passed = verdict.startswith("PASS")

    # ── Step 2a: FAIL → signal a retry ──────────────────────────────────────
    if not passed:
        return {
            "has_error": True,
            "retry_count": retry_count + 1,
            # final_recommendation stays empty — we're looping back
        }

    # ── Step 2b: PASS → generate the executive summary ──────────────────────
    summary_prompt = SUMMARIZER_PROMPT.format(
        query=state["user_query"],
        analysis_output=state["analysis_output"],
    )
    summary = llm.invoke(summary_prompt).content.strip()

    return {
        "has_error": False,
        "final_recommendation": summary,
    }