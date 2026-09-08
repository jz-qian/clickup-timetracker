from pathlib import Path
import os
import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

CLICKUP_API_TOKEN = os.getenv("CLICKUP_API_TOKEN")
CLICKUP_WORKSPACE_ID = os.getenv("CLICKUP_WORKSPACE_ID")

print("TOKEN EXISTS:", CLICKUP_API_TOKEN is not None)
print("TOKEN LENGTH:", len(CLICKUP_API_TOKEN) if CLICKUP_API_TOKEN else 0)

BASE_URL = "https://api.clickup.com/api/v2"

HEADERS = {
    "Authorization": CLICKUP_API_TOKEN,
    "Content-Type": "application/json",
}

def get_authorized_workspaces():
    response = requests.get(
        f"{BASE_URL}/team",
        headers=HEADERS,
    )

    print("STATUS:", response.status_code)
    print("RESPONSE:", response.text)

    response.raise_for_status()

    return response.json()