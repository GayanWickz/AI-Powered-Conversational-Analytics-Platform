import boto3
import io
import pandas as pd

def fetch_s3_data(s3_uri: str) -> pd.DataFrame:
    """
    Fetches a file from S3 and returns it as a DataFrame.
    Supports .xlsx, .xls, and .csv files.
    """
    s3 = boto3.client("s3")

    # Correctly parse the s3_uri into bucket and key
    path = s3_uri.replace("s3://", "")
    bucket, key = path.split("/", 1)

    obj = s3.get_object(Bucket=bucket, Key=key)
    file_bytes = obj["Body"].read()

    # Auto-detect file type and parse accordingly
    key_lower = key.lower()
    if key_lower.endswith(".xlsx") or key_lower.endswith(".xls"):
        return pd.read_excel(io.BytesIO(file_bytes))
    elif key_lower.endswith(".csv"):
        return pd.read_csv(io.BytesIO(file_bytes))
    else:
        # Try Excel first, fall back to CSV
        try:
            return pd.read_excel(io.BytesIO(file_bytes))
        except Exception:
            return pd.read_csv(io.BytesIO(file_bytes))