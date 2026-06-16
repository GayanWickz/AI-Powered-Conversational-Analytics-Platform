import os
from langchain_aws import ChatBedrock

def get_bedrock_client():
    return ChatBedrock(
        model_id="eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
        region_name="eu-west-1",
        model_kwargs={"max_tokens": 4096}
    )