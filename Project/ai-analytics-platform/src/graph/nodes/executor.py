from src.tools.code_engine import execute_python_logic

def executor_node(state: dict) -> dict:
    """
    Runs the AI-generated Python code against the S3 data.
    Captures both the output and whether a runtime error occurred.
    """
    output, has_error = execute_python_logic(
        s3_uri=state["s3_uri"],
        code=state["generated_python_code"],
    )

    return {
        "analysis_output": output,
        "has_error": has_error,
    }