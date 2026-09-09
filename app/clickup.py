from pathlib import Path
import os
import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

BASE_URL = "https://api.clickup.com/api/v2"

def get_authorized_workspaces():
    token = os.getenv("CLICKUP_API_TOKEN")
    workspace_id = os.getenv("CLICKUP_WORKSPACE_ID")

    if not token:
        raise RuntimeError("CLICKUP_API_TOKEN environment variable is not set")
    if not workspace_id:
        raise RuntimeError("CLICKUP_WORKSPACE_ID environment variable is not set")

    headers = {
        "Authorization": token,
        "Content-Type": "application/json",
    }

    resp = requests.get(f"{BASE_URL}/team/{workspace_id}", headers=headers)
    resp.raise_for_status()
    return resp.json()