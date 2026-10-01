from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import hmac
import json
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

# ---------------------------------------------------------------------------
# Archived clients dashboard
#
# A "client" is a ClickUp space (same as get_project_data). This section pulls
# archived spaces plus everything inside them, then rolls it up into one
# summary per client: people and roles, hours, and moved deadlines.
# ---------------------------------------------------------------------------

DEADLINE_LOG_PATH = BASE_DIR / "data" / "deadline_changes.jsonl"

# Names (lowercased) of a date custom field that holds a task's first deadline.
ORIGINAL_DUE_FIELD_NAMES = {"original due date", "original deadline", "baseline due date"}

CLICKUP_ROLE_NAMES = {1: "Owner", 2: "Admin", 3: "Member", 4: "Guest"}

MS_PER_HOUR = 3_600_000
MS_PER_DAY = 86_400_000


def _clickup_get(path, params=None):
    response = requests.get(
        f"{BASE_URL}{path}",
        headers={
            "Authorization": token,
            "Content-Type": "application/json",
        },
        params=params,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def _to_ms(value):
    """ClickUp sends timestamps as millisecond strings (or null)."""
    if value in (None, ""):
        return None
    return int(value)


def _ms_to_iso(value):
    if value is None:
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()


def _hours(ms):
    return round(ms / MS_PER_HOUR, 2)


def get_archived_spaces():
    data = _clickup_get(f"/team/{workspace_id}/space", {"archived": "true"})
    return data.get("spaces", [])


def get_all_lists_in_space(space_id):
    """Every list in a space: folderless and in folders, archived or not."""
    lists_by_id = {}

    for archived in ("false", "true"):
        folderless = _clickup_get(f"/space/{space_id}/list", {"archived": archived})
        for current_list in folderless.get("lists", []):
            lists_by_id[current_list["id"]] = current_list

        folders = _clickup_get(f"/space/{space_id}/folder", {"archived": archived})
        for folder in folders.get("folders", []):
            for list_archived in ("false", "true"):
                folder_lists = _clickup_get(
                    f"/folder/{folder['id']}/list",
                    {"archived": list_archived},
                )
                for current_list in folder_lists.get("lists", []):
                    lists_by_id[current_list["id"]] = current_list

    return list(lists_by_id.values())


def get_all_tasks(list_id):
    """Every task in a list, including closed, archived, and subtasks."""
    tasks_by_id = {}

    for archived in ("false", "true"):
        page = 0
        while True:
            data = _clickup_get(
                f"/list/{list_id}/task",
                {
                    "archived": archived,
                    "include_closed": "true",
                    "subtasks": "true",
                    "page": page,
                },
            )
            for task in data.get("tasks", []):
                tasks_by_id[task["id"]] = task

            if data.get("last_page", True) or not data.get("tasks"):
                break
            page += 1

    return list(tasks_by_id.values())


def get_space_time_entries(space_id, assignee_ids, start_ms, end_ms):
    """
    Time entries logged against a space between start_ms and end_ms.

    Without `assignee`, ClickUp only returns the token owner's entries, and
    without dates it only returns the last 30 days. Requesting other users'
    entries needs an Owner/Admin token, so fall back to the token owner's
    entries if that is refused.

    Returns (entries, scope) where scope is "all_members" or "current_user_only".
    """
    params = {
        "space_id": space_id,
        "start_date": start_ms,
        "end_date": end_ms,
        "include_location_names": "true",
    }

    if assignee_ids:
        try:
            data = _clickup_get(
                f"/team/{workspace_id}/time_entries",
                {**params, "assignee": ",".join(assignee_ids)},
            )
            return data.get("data", []), "all_members"
        except requests.HTTPError as error:
            if error.response is None or error.response.status_code not in (400, 401, 403):
                raise

    data = _clickup_get(f"/team/{workspace_id}/time_entries", params)
    return data.get("data", []), "current_user_only"


def load_deadline_log():
    """Due-date changes captured by the ClickUp webhook, keyed by task id."""
    changes = defaultdict(list)

    if not DEADLINE_LOG_PATH.exists():
        return changes

    with DEADLINE_LOG_PATH.open() as log_file:
        for line in log_file:
            if line.strip():
                change = json.loads(line)
                changes[change["task_id"]].append(change)

    return changes


def verify_webhook_signature(body, signature):
    secret = os.getenv("CLICKUP_WEBHOOK_SECRET")
    if not secret:
        raise RuntimeError("CLICKUP_WEBHOOK_SECRET environment variable is not set")

    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def record_deadline_changes(payload):
    """Append due-date changes from a taskDueDateUpdated webhook to the log."""
    if payload.get("event") != "taskDueDateUpdated":
        return 0

    DEADLINE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    recorded = 0

    with DEADLINE_LOG_PATH.open("a") as log_file:
        for item in payload.get("history_items", []):
            if item.get("field") != "due_date":
                continue

            user = item.get("user") or {}
            log_file.write(json.dumps({
                "task_id": payload.get("task_id"),
                "changed_at": _to_ms(item.get("date")),
                "before": _to_ms(item.get("before")),
                "after": _to_ms(item.get("after")),
                "changed_by": user.get("username") or user.get("email"),
            }) + "\n")
            recorded += 1

    return recorded


def _original_due_from_custom_field(task):
    for field in task.get("custom_fields", []):
        if (field.get("name") or "").strip().lower() in ORIGINAL_DUE_FIELD_NAMES:
            return _to_ms(field.get("value"))
    return None


def summarize_task_deadline(task, logged_changes):
    """
    Describe how a task's deadline moved, or return None if it didn't.

    The ClickUp API has no task history endpoint, so a move is detected from
    (1) changes recorded by the webhook, or (2) an "Original Due Date" custom
    field that differs from the current due date. A task closed after its due
    date is also reported, as finished late.
    """
    current_due = _to_ms(task.get("due_date"))
    done_at = _to_ms(task.get("date_done") or task.get("date_closed"))
    changes = sorted(logged_changes, key=lambda change: change["changed_at"] or 0)

    if changes and changes[0]["before"] is not None:
        original_due = changes[0]["before"]
    else:
        original_due = _original_due_from_custom_field(task)

    moved = bool(changes) or (
        original_due is not None
        and current_due is not None
        and original_due != current_due
    )
    finished_late = done_at is not None and current_due is not None and done_at > current_due

    if not moved and not finished_late:
        return None

    days_moved = None
    if moved and original_due is not None and current_due is not None:
        days_moved = round((current_due - original_due) / MS_PER_DAY, 1)

    return {
        "task_id": task["id"],
        "task_name": task.get("name"),
        "list_name": (task.get("list") or {}).get("name"),
        "url": task.get("url"),
        "original_due_date": _ms_to_iso(original_due),
        "current_due_date": _ms_to_iso(current_due),
        "completed_date": _ms_to_iso(done_at),
        "times_moved": len(changes) if changes else int(moved),
        "days_moved": days_moved,
        "finished_late": finished_late,
        "change_log": [
            {
                "changed_at": _ms_to_iso(change["changed_at"]),
                "from": _ms_to_iso(change["before"]),
                "to": _ms_to_iso(change["after"]),
                "changed_by": change["changed_by"],
            }
            for change in changes
        ],
    }


def summarize_archived_client(space, lists, tasks, time_entries, members_by_id, deadline_log):
    people = {}

    def person(user):
        user_id = str(user.get("id", "unknown"))
        if user_id not in people:
            member = members_by_id.get(user_id, {})
            people[user_id] = {
                "id": user_id,
                "name": user.get("username") or member.get("clickup_username") or user.get("email") or "Unknown user",
                "email": user.get("email") or member.get("clickup_email"),
                "workspace_role": CLICKUP_ROLE_NAMES.get(member.get("clickup_role"), "Former member" if not member else "Unknown"),
                "actual_role": member.get("actual_role"),
                "tasks_assigned": 0,
                "total_ms": 0,
                "billable_ms": 0,
            }
        return people[user_id]

    total_ms = 0
    billable_ms = 0
    activity_dates = []

    for entry in time_entries:
        duration = int(entry.get("duration", 0) or 0)
        if duration < 0:  # a timer that is still running
            continue

        contributor = person(entry.get("user", {}))
        contributor["total_ms"] += duration
        total_ms += duration

        if entry.get("billable"):
            contributor["billable_ms"] += duration
            billable_ms += duration

        activity_dates.append(_to_ms(entry.get("start")))

    deadline_changes = []
    completed = 0

    for task in tasks:
        for assignee in task.get("assignees", []):
            person(assignee)["tasks_assigned"] += 1

        if (task.get("status") or {}).get("type") == "closed" or task.get("date_done"):
            completed += 1

        activity_dates.append(_to_ms(task.get("date_created")))
        activity_dates.append(_to_ms(task.get("date_closed")))

        deadline = summarize_task_deadline(task, deadline_log.get(task["id"], []))
        if deadline:
            deadline_changes.append(deadline)

    # Hours logged directly on tasks, for when time entries are incomplete
    # (e.g. a non-admin token that can only see its own entries).
    task_tracked_ms = sum(int(task.get("time_spent") or 0) for task in tasks)

    top_contributor = max(people.values(), key=lambda p: p["total_ms"], default=None)
    people_summary = []

    for contributor in sorted(people.values(), key=lambda p: p["total_ms"], reverse=True):
        people_summary.append({
            "id": contributor["id"],
            "name": contributor["name"],
            "email": contributor["email"],
            "workspace_role": contributor["workspace_role"],
            "actual_role": contributor["actual_role"],
            "is_top_contributor": contributor is top_contributor and contributor["total_ms"] > 0,
            "tasks_assigned": contributor["tasks_assigned"],
            "hours": _hours(contributor["total_ms"]),
            "billable_hours": _hours(contributor["billable_ms"]),
            "share_of_hours": round(contributor["total_ms"] / total_ms, 3) if total_ms else 0,
        })

    activity_dates = [date for date in activity_dates if date]

    return {
        "id": space["id"],
        "name": space["name"],
        "first_activity": _ms_to_iso(min(activity_dates, default=None)),
        "last_activity": _ms_to_iso(max(activity_dates, default=None)),
        "lists": [current_list["name"] for current_list in lists],
        "task_count": len(tasks),
        "completed_task_count": completed,
        "hours": _hours(total_ms),
        "billable_hours": _hours(billable_ms),
        "non_billable_hours": _hours(total_ms - billable_ms),
        "task_tracked_hours": _hours(task_tracked_ms),
        "people": people_summary,
        "deadline_changes": deadline_changes,
        "moved_deadline_count": sum(1 for d in deadline_changes if d["times_moved"]),
        "late_task_count": sum(1 for d in deadline_changes if d["finished_late"]),
    }


def get_archived_client_dashboard():
    members = normalize_workspace_members(get_workspace_members())
    members_by_id = {member["clickup_user_id"]: member for member in members}
    assignee_ids = list(members_by_id)
    deadline_log = load_deadline_log()
    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)

    clients = []
    scopes = set()

    for space in get_archived_spaces():
        lists = get_all_lists_in_space(space["id"])

        tasks = []
        for current_list in lists:
            tasks.extend(get_all_tasks(current_list["id"]))

        # Ask for time entries from the client's first task onward, since the
        # endpoint only covers the last 30 days by default.
        created_dates = [_to_ms(task.get("date_created")) for task in tasks]
        start_ms = min((date for date in created_dates if date), default=0)

        time_entries, scope = get_space_time_entries(space["id"], assignee_ids, start_ms, now_ms)
        scopes.add(scope)

        clients.append(summarize_archived_client(
            space, lists, tasks, time_entries, members_by_id, deadline_log,
        ))

    clients.sort(key=lambda client: client["last_activity"] or "", reverse=True)
    all_people = {person["id"] for client in clients for person in client["people"]}

    return {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "time_entries_scope": "current_user_only" if "current_user_only" in scopes else "all_members",
        "totals": {
            "clients": len(clients),
            "tasks": sum(client["task_count"] for client in clients),
            "hours": round(sum(client["hours"] for client in clients), 2),
            "billable_hours": round(sum(client["billable_hours"] for client in clients), 2),
            "people": len(all_people),
            "moved_deadlines": sum(client["moved_deadline_count"] for client in clients),
            "late_tasks": sum(client["late_task_count"] for client in clients),
        },
        "clients": clients,
    }
