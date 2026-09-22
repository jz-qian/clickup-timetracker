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

def get_workspace_members():
    workspace_data = get_authorized_workspaces()

    members = workspace_data.get("team", {}).get("members", [])

    if not members:
        members = workspace_data.get("members", [])

    return members
    workspace_data = get_authorized_workspaces()

    members = workspace_data.get("team", {}).get("members", [])

    if not members:
        members = workspace_data.get("members", [])

    return members

def normalize_workspace_members(members):
    normalized_members = []

    for member in members:
        user = member.get("user", member)

        normalized_members.append({
            "clickup_user_id": str(user.get("id")),
            "clickup_username": user.get("username"),
            "clickup_email": user.get("email"),
            "clickup_role": user.get("role"),
            "actual_role": None,
            "team": None,
            "employment_status": "unknown",
            "start_date": None,
            "end_date": None,
        })

    return normalized_members

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
        headers={"Authorization": token, "Content-Type": "application/json"},
        params={
            "include_location_names": "true",
            "include_task_tags": "true",
        },
    )
    response.raise_for_status()

    data = response.json()

    return data

def get_project_data(): 
    spaces_data = get_spaces()
    time_entries_data = get_time_entries()

    projects = []

    for space in spaces_data.get("spaces", []):
        space_id = space["id"]
        space_name = space["name"]

        lists_data = get_lists(space_id)
        lists = lists_data.get("lists", [])

        project_lists = []

        for current_list in lists:
            list_id = current_list["id"]
            list_name = current_list["name"]

            tasks_data = get_tasks(list_id)
            tasks = tasks_data.get("tasks", [])

            project_lists.append({
                "id": list_id,
                "name": list_name,
                "tasks": tasks,
            })

        projects.append({
            "id": space_id,
            "name": space_name,
            "lists": project_lists,
        })

        project_summaries = []

    for project in projects:
        summary = summarize_project_time(
            project,
            time_entries_data.get("data", []),
        )

        project_summaries.append({
            **project,
            "summary": summary,
        })

    return {
        "projects": project_summaries,
        "time_entries": time_entries_data.get("data", []),
    }

def summarize_project_time(project, time_entries):
    project_id = project["id"]

    project_entries = [
        entry
        for entry in time_entries
        if entry.get("task_location", {}).get("space_id") == project_id
    ]

    total_time = 0
    billable_time = 0
    non_billable_time = 0
    people = {}

    for entry in project_entries:
        duration = int(entry.get("duration", 0) or 0)
        user = entry.get("user", {})

        user_id = str(user.get("id", "unknown"))
        user_name = user.get("username") or user.get("email") or "Unknown user"

        total_time += duration

        if entry.get("billable"):
            billable_time += duration
        else:
            non_billable_time += duration

        people[user_id] = {
            "id": user_id,
            "name": user_name,
        }

    return {
        "total_time": total_time,
        "billable_time": billable_time,
        "non_billable_time": non_billable_time,
        "people": list(people.values()),
    }