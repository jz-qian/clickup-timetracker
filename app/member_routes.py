"""
Team member sign-in and the signed-in member's own data.

A member signs in with their ClickUp name. The first time, they choose a
password; after that they sign in with it. Each name maps to one ClickUp
workspace member, so the rest of the app can pull that person's ClickUp
data: the tasks assigned to them, their up/down/dash answer for the admin
capacity view, and the time they track on their day calendar. Members can
also mark their assigned tasks complete in ClickUp from here.

Tracked time is stored in ClickUp as time entries on the chosen task, so it
shows up everywhere ClickUp time does, including the admin dashboard.
Accounts and sessions are stored as JSON files in data/.
Whoever sets a name's password first owns it, so delete that member's
entry in data/accounts.json to let them set it again.
"""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import secrets
import threading

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
import requests

from app.clickup import (
    BASE_DIR,
    _clickup_delete,
    _clickup_get,
    _clickup_post,
    _clickup_put,
    get_workspace_members,
    normalize_workspace_members,
    workspace_id,
)
from app.team_routes import load_latest_availability, record_availability

router = APIRouter()

ACCOUNTS_PATH = BASE_DIR / "data" / "accounts.json"
SESSIONS_PATH = BASE_DIR / "data" / "sessions.json"

MIN_PASSWORD_LENGTH = 8
SESSION_LIFETIME = timedelta(days=30)

_store_lock = threading.Lock()


@contextmanager
def clickup_errors(action):
    """
    Turn a failed ClickUp call into a clear error for the page. ClickUp's
    own 401/403 become 502, so the page doesn't mistake them for the
    member's session expiring.
    """
    try:
        yield
    except requests.HTTPError as error:
        response = error.response
        try:
            message = response.json().get("err") if response is not None else None
        except ValueError:
            message = None

        status = response.status_code if response is not None else None
        if status in (401, 403):
            message = (
                "ClickUp refused this. The backend's CLICKUP_API_TOKEN must belong "
                "to a Workspace Owner or Admin to change team members' time and tasks."
            )

        raise HTTPException(
            status_code=404 if status == 404 else 502,
            detail=f"Couldn't {action} in ClickUp: {message or f'error {status}'}",
        ) from error
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=f"Couldn't reach ClickUp to {action}.") from error


# --------------------------------------------------
# JSON file storage
# --------------------------------------------------

def _read_json(path):
    if not path.exists():
        return {}
    with path.open() as json_file:
        return json.load(json_file)


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(".tmp")
    with temporary_path.open("w") as json_file:
        json.dump(data, json_file, indent=2)
    temporary_path.replace(path)


# --------------------------------------------------
# Passwords and sessions
# --------------------------------------------------

def _hash_password(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1).hex()


def _new_session(clickup_user_id):
    token = secrets.token_urlsafe(32)
    now = datetime.now(tz=timezone.utc)

    with _store_lock:
        sessions = _read_json(SESSIONS_PATH)
        # Drop expired sessions while we're here
        sessions = {
            key: session
            for key, session in sessions.items()
            if datetime.fromisoformat(session["expires_at"]) > now
        }
        sessions[token] = {
            "clickup_user_id": clickup_user_id,
            "expires_at": (now + SESSION_LIFETIME).isoformat(),
        }
        _write_json(SESSIONS_PATH, sessions)

    return token


def _normalize_name(name):
    return " ".join(name.split()).casefold()


def _find_member(name):
    """The one ClickUp workspace member whose username (or email) matches."""
    wanted = _normalize_name(name)
    if not wanted:
        raise HTTPException(status_code=400, detail="Enter your name.")

    members = normalize_workspace_members(get_workspace_members())
    matches = [
        member
        for member in members
        if _normalize_name(member["clickup_username"] or "") == wanted
        or _normalize_name(member["clickup_email"] or "") == wanted
    ]

    if not matches:
        raise HTTPException(
            status_code=404,
            detail="No ClickUp member has that name. Use your name exactly as it appears in ClickUp.",
        )
    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail="More than one ClickUp member has that name. Sign in with your ClickUp email instead.",
        )

    return matches[0]


def _public_user(member):
    return {
        "clickup_user_id": member["clickup_user_id"],
        "name": member["clickup_username"] or member["clickup_email"],
        "email": member["clickup_email"],
    }


def current_member(authorization: str = Header(default="")):
    """FastAPI dependency: the member a `Bearer <token>` header belongs to."""
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sign in first.")

    with _store_lock:
        session = _read_json(SESSIONS_PATH).get(token)

    if not session or datetime.fromisoformat(session["expires_at"]) <= datetime.now(tz=timezone.utc):
        raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.")

    account = _read_json(ACCOUNTS_PATH).get(session["clickup_user_id"])
    if not account:
        raise HTTPException(status_code=401, detail="Sign in again.")

    return {
        "clickup_user_id": session["clickup_user_id"],
        "name": account["name"],
        "email": account.get("email"),
    }


class NameRequest(BaseModel):
    name: str


class PasswordRequest(BaseModel):
    name: str
    password: str


@router.post("/auth/lookup")
def lookup(body: NameRequest):
    """Whether a name matches a ClickUp member, and if they've set a password."""
    member = _find_member(body.name)
    account = _read_json(ACCOUNTS_PATH).get(member["clickup_user_id"])

    return {"user": _public_user(member), "has_password": bool(account)}


@router.post("/auth/setup")
def set_up_password(body: PasswordRequest):
    """First sign-in: choose a password for this ClickUp member."""
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Use at least {MIN_PASSWORD_LENGTH} characters.",
        )

    member = _find_member(body.name)
    user = _public_user(member)
    salt = secrets.token_bytes(16)

    with _store_lock:
        accounts = _read_json(ACCOUNTS_PATH)
        if member["clickup_user_id"] in accounts:
            raise HTTPException(
                status_code=409,
                detail="This name already has a password. Sign in instead.",
            )

        accounts[member["clickup_user_id"]] = {
            "name": user["name"],
            "email": user["email"],
            "salt": salt.hex(),
            "password_hash": _hash_password(body.password, salt),
            "created_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        _write_json(ACCOUNTS_PATH, accounts)

    return {"token": _new_session(member["clickup_user_id"]), "user": user}


@router.post("/auth/login")
def log_in(body: PasswordRequest):
    member = _find_member(body.name)
    account = _read_json(ACCOUNTS_PATH).get(member["clickup_user_id"])

    if not account:
        raise HTTPException(status_code=404, detail="Set up a password first.")

    attempt = _hash_password(body.password, bytes.fromhex(account["salt"]))
    if not hmac.compare_digest(attempt, account["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect password.")

    return {"token": _new_session(member["clickup_user_id"]), "user": _public_user(member)}


@router.post("/auth/logout")
def log_out(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()

    with _store_lock:
        sessions = _read_json(SESSIONS_PATH)
        if sessions.pop(token, None):
            _write_json(SESSIONS_PATH, sessions)

    return {"signed_out": True}


@router.get("/me")
def me(member=Depends(current_member)):
    return member


# --------------------------------------------------
# Assigned ClickUp tasks
# --------------------------------------------------

def _space_names():
    """ClickUp space names by id. Tasks only carry their space's id."""
    data = _clickup_get(f"/team/{workspace_id}/space", {"archived": "false"})
    return {space["id"]: space.get("name") for space in data.get("spaces", [])}


def get_assigned_tasks(clickup_user_id):
    """Open tasks (and subtasks) assigned to a member, oldest first."""
    tasks = []
    page = 0

    while True:
        data = _clickup_get(
            f"/team/{workspace_id}/task",
            [
                ("assignees[]", clickup_user_id),
                ("subtasks", "true"),
                ("page", page),
            ],
        )
        tasks.extend(data.get("tasks", []))

        if data.get("last_page", True) or not data.get("tasks"):
            break
        page += 1

    tasks.sort(key=lambda task: int(task.get("date_created") or 0))
    space_names = _space_names() if tasks else {}

    return [
        {
            "id": task["id"],
            "name": task.get("name"),
            "status": (task.get("status") or {}).get("status"),
            "url": task.get("url"),
            "list": (task.get("list") or {}).get("name"),
            "space_id": (task.get("space") or {}).get("id"),
            "space": space_names.get((task.get("space") or {}).get("id")),
            "date_created": task.get("date_created"),
            # Deadline in ms, shown on the calendar; None when there isn't one
            "due_date": int(task["due_date"]) if task.get("due_date") else None,
        }
        for task in tasks
    ]


def _assigned_task(task_id, clickup_user_id):
    """A task, but only if it's assigned to this member."""
    task = _clickup_get(f"/task/{task_id}")
    assignee_ids = {str(person.get("id")) for person in task.get("assignees", [])}
    if clickup_user_id not in assignee_ids:
        raise HTTPException(status_code=403, detail="That task isn't assigned to you.")
    return task


def _closed_status(list_id):
    """The status a list uses for complete tasks ("closed", else "done")."""
    statuses = _clickup_get(f"/list/{list_id}").get("statuses", [])
    for status_type in ("closed", "done"):
        for status in statuses:
            if status.get("type") == status_type:
                return status["status"]

    raise HTTPException(status_code=409, detail="This task's list has no complete status.")


@router.get("/me/tasks")
def my_tasks(member=Depends(current_member)):
    with clickup_errors("load your tasks"):
        return {"tasks": get_assigned_tasks(member["clickup_user_id"])}


@router.post("/me/tasks/{task_id}/complete")
def complete_task(task_id: str, member=Depends(current_member)):
    """Move a task to its list's complete status in ClickUp."""
    with clickup_errors("complete the task"):
        task = _assigned_task(task_id, member["clickup_user_id"])
        previous_status = (task.get("status") or {}).get("status")
        status = _closed_status((task.get("list") or {}).get("id"))

        _clickup_put(f"/task/{task_id}", {"status": status})
    return {"id": task_id, "status": status, "previous_status": previous_status}


class ReopenRequest(BaseModel):
    status: str


@router.post("/me/tasks/{task_id}/reopen")
def reopen_task(task_id: str, body: ReopenRequest, member=Depends(current_member)):
    """Undo a completion by putting the task back in the status it had."""
    with clickup_errors("reopen the task"):
        _assigned_task(task_id, member["clickup_user_id"])
        _clickup_put(f"/task/{task_id}", {"status": body.status})
    return {"id": task_id, "status": body.status}


# --------------------------------------------------
# Up / down / dash answer for the admin capacity view
# --------------------------------------------------

class PreferenceRequest(BaseModel):
    preference: str
    note: str = ""


@router.get("/me/availability")
def my_availability(member=Depends(current_member)):
    return {"latest": load_latest_availability().get(member["clickup_user_id"])}


@router.post("/me/availability")
def submit_my_availability(body: PreferenceRequest, member=Depends(current_member)):
    return {"latest": record_availability(member["clickup_user_id"], body.preference, body.note)}


# --------------------------------------------------
# Tracked time on the member's day calendar, kept as ClickUp time entries
# --------------------------------------------------

def _time_entries_path(entry_id=None):
    path = f"/team/{workspace_id}/time_entries"
    return f"{path}/{entry_id}" if entry_id else path


def _to_block(entry, task_name=None, space=None):
    """A ClickUp time entry as a calendar block."""
    task = entry.get("task") or {}
    if not isinstance(task, dict):  # ClickUp sends "" for no task
        task = {}
    location = entry.get("task_location") or {}
    start = int(entry.get("start") or 0)
    duration = int(entry.get("duration") or 0)
    running = duration < 0  # a timer still running in ClickUp

    return {
        "id": str(entry["id"]),
        "task_id": task.get("id"),
        "title": task_name or task.get("name") or entry.get("description") or "No task",
        "space": space or location.get("space_name"),
        "description": entry.get("description") or "",
        "billable": bool(entry.get("billable")),
        "start": start,
        "end": int(entry["end"]) if entry.get("end") and not running else start + max(duration, 0),
        "running": running,
    }


def _own_entry(entry_id, clickup_user_id):
    """A time entry, but only if it's this member's."""
    entry = _clickup_get(_time_entries_path(entry_id)).get("data")
    if isinstance(entry, list):
        entry = entry[0] if entry else None
    if not entry or str((entry.get("user") or {}).get("id")) != clickup_user_id:
        raise HTTPException(status_code=404, detail="Time entry not found.")
    return entry


class TimeBlockRequest(BaseModel):
    # Every block is for one ClickUp task; its name is the block's title
    task_id: str
    task_name: str
    space: str | None = None
    description: str = ""
    billable: bool = False
    start: int  # milliseconds since the epoch
    end: int


def _validate_block(body):
    if not body.task_id.strip() or not body.task_name.strip():
        raise HTTPException(status_code=400, detail="Choose a ClickUp task.")
    if body.end <= body.start:
        raise HTTPException(status_code=400, detail="The end time must be after the start time.")


@router.get("/me/time-blocks")
def my_time_blocks(start: int, end: int, member=Depends(current_member)):
    """The member's ClickUp time entries that start in [start, end), in ms."""
    with clickup_errors("load your tracked time"):
        data = _clickup_get(
            _time_entries_path(),
            {
                "start_date": start,
                "end_date": end,
                "assignee": member["clickup_user_id"],
                "include_location_names": "true",
            },
        )

    return {"time_blocks": [_to_block(entry) for entry in data.get("data", [])]}


@router.post("/me/time-blocks")
def add_time_block(body: TimeBlockRequest, member=Depends(current_member)):
    """Log time to a task in ClickUp."""
    _validate_block(body)

    with clickup_errors("log this time"):
        data = _clickup_post(
            _time_entries_path(),
            {
                "tid": body.task_id.strip(),
                "description": body.description.strip(),
                "start": body.start,
                "duration": body.end - body.start,
                "billable": body.billable,
                "assignee": int(member["clickup_user_id"]),
            },
        )

    # ClickUp's reply may leave out fields we sent, like the task
    entry = data.get("data") or data
    if not isinstance(entry.get("task"), dict):
        entry["task"] = {"id": body.task_id.strip(), "name": body.task_name.strip()}
    entry.setdefault("start", body.start)
    entry.setdefault("duration", body.end - body.start)
    entry.setdefault("description", body.description.strip())
    entry.setdefault("billable", body.billable)
    return _to_block(entry, task_name=body.task_name.strip(), space=body.space)


@router.put("/me/time-blocks/{block_id}")
def update_time_block(block_id: str, body: TimeBlockRequest, member=Depends(current_member)):
    _validate_block(body)

    with clickup_errors("update this time"):
        entry = _own_entry(block_id, member["clickup_user_id"])
        _clickup_put(
            _time_entries_path(block_id),
            {
                "tid": body.task_id.strip(),
                "description": body.description.strip(),
                "start": body.start,
                "end": body.end,
                "duration": body.end - body.start,
                "billable": body.billable,
            },
        )

    entry.update({
        "description": body.description.strip(),
        "start": body.start,
        "end": body.end,
        "duration": body.end - body.start,
        "billable": body.billable,
        "task": {"id": body.task_id.strip(), "name": body.task_name.strip()},
    })
    return _to_block(entry, task_name=body.task_name.strip(), space=body.space)


@router.delete("/me/time-blocks/{block_id}")
def delete_time_block(block_id: str, member=Depends(current_member)):
    with clickup_errors("delete this time"):
        _own_entry(block_id, member["clickup_user_id"])
        _clickup_delete(_time_entries_path(block_id))

    return {"deleted": block_id}
