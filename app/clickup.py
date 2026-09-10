from pathlib import Path
import os
import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

BASE_URL = "https://api.clickup.com/api/v2"

token = os.getenv("CLICKUP_API_TOKEN")
workspace_id = os.getenv("CLICKUP_WORKSPACE_ID")

def get_authorized_workspaces():
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

def get_spaces():
    response = requests.get(
        f"{BASE_URL}/team/{workspace_id}/space",
        headers={
            "Authorization": token,
            "Content-Type": "application/json",
        },
    )
    response.raise_for_status()
    return response.json()

def get_lists(space_id):
    response = requests.get(
        f"{BASE_URL}/space/{space_id}/list",
        headers={
            "Authorization": token,
            "Content-Type": "application/json",
        },
    )
    response.raise_for_status()
    return response.json()

def get_tasks(list_id):
    response = requests.get(
        f"{BASE_URL}/list/{list_id}/task",
        headers={
            "Authorization": token,
            "Content-Type": "application/json",
        },
        params={
            "subtasks": "true",
        },
    )

    response.raise_for_status()
    return response.json()

def get_time_entries():
    response = requests.get(
        f"{BASE_URL}/team/{workspace_id}/time_entries",
        headers={
            "Authorization": token,
            "Content-Type": "application/json",
        },
        params={
            "include_location_names": "true",
            "include_task_tags": "true",
        },
    )

    response.raise_for_status()
    return response.json()
