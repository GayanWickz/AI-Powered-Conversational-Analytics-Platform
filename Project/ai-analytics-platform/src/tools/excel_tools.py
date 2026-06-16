from src.aws.s3_utils import fetch_s3_data

def get_rich_schema(s3_uri: str) -> str:
    """
    Returns a rich schema string including column names, data types,
    row count, and 3 sample rows — enough context for the analyst
    to write accurate Pandas code without guessing column names.
    """
    df = fetch_s3_data(s3_uri)

    schema_lines = [
        f"Total rows: {len(df)}",
        f"Total columns: {len(df.columns)}",
        "",
        "Columns and data types:",
    ]

    for col, dtype in df.dtypes.items():
        schema_lines.append(f"  - {col} ({dtype})")

    schema_lines.append("")
    schema_lines.append("Sample data (first 3 rows):")
    schema_lines.append(df.head(3).to_string(index=False))

    return "\n".join(schema_lines)