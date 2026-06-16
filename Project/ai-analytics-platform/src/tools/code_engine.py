import io
import pandas as pd
from src.aws.s3_utils import fetch_s3_data

# Safe built-ins that the generated code is allowed to use
SAFE_BUILTINS = {
    "print": print,
    "len": len,
    "range": range,
    "enumerate": enumerate,
    "zip": zip,
    "sum": sum,
    "min": min,
    "max": max,
    "round": round,
    "sorted": sorted,
    "list": list,
    "dict": dict,
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
}

def execute_python_logic(s3_uri: str, code: str) -> tuple[str, bool]:
    """
    Executes AI-generated Python code against the S3 DataFrame.

    Returns:
        (output: str, has_error: bool)
        - output is whatever the code printed, or an error message.
        - has_error is True if a runtime exception occurred.
    """
    df = fetch_s3_data(s3_uri)

    output_buffer = io.StringIO()
    has_error = False

    # Restricted execution environment — only safe builtins + pandas + df
    exec_globals = {
        "__builtins__": SAFE_BUILTINS,
        "pd": pd,
        "df": df,
    }

    import contextlib
    with contextlib.redirect_stdout(output_buffer):
        try:
            exec(code, exec_globals)
        except Exception as e:
            print(f"EXECUTION ERROR: {type(e).__name__}: {e}")
            has_error = True

    return output_buffer.getvalue(), has_error