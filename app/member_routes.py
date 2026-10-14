"""
Team member sign-in and the signed-in member's own data.

A member signs in with their ClickUp name. The first time, they choose a
password; after that they sign in with it. Each name maps to one ClickUp
workspace member, so the rest of the app can pull that person's ClickUp
data: the tasks assigned to them, their up/down/dash answer for the admin
capacity view, and the time blocks they add to their day calendar. Members
can also mark their assigned tasks complete in ClickUp from here.

Accounts, sessions and time blocks are stored as JSON files in data/.
Whoever sets a name's password first owns it, so delete that member's
entry in data/accounts.json to let them set it again.
"""

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import secrets
import threading
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.clickup import (
    BASE_DIR,
    _clickup_get,
    _clickup_put,
    get_workspace_members,
    normalize_workspace_members,
    workspace_id,
)
from app.team_routes import load_latest_availability, record_availability

router = APIRouter()

ACCOUNTS_PATH = BASE_DIR / "data" / "accounts.json"
SESSIONS_PATH = BASE_DIR / "data" / "sessions.json"
TIME_BLOCKS_PATH = BASE_DIR / "data" / "time_blocks.json"

MIN_PASSWORD_LENGTH = 8
SESSION_LIFETIME = timedelta(days=30)

_store_lock = threading.Lock()


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
    return {"tasks": get_assigned_tasks(member["clickup_user_id"])}


@router.post("/me/tasks/{task_id}/complete")
def complete_task(task_id: str, member=Depends(current_member)):
    """Move a task to its list's complete status in ClickUp."""
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
# Time blocks on the member's day calendar
# --------------------------------------------------

class TimeBlockRequest(BaseModel):
    # Every block is for one ClickUp task; its name is the block's title
    task_id: str
    task_name: str
    space: str | None = None
    description: str = ""
    start: int  # milliseconds since the epoch
    end: int


def _validate_block(body):
    if not body.task_id.strip() or not body.task_name.strip():
        raise HTTPException(status_code=400, detail="Choose a ClickUp task.")
    if body.end <= body.start:
        raise HTTPException(status_code=400, detail="The end time must be after the start time.")

    return {
        "task_id": body.task_id.strip(),
        "title": body.task_name.strip(),
        "space": (body.space or "").strip() or None,
        "description": body.description.strip(),
        "start": body.start,
        "end": body.end,
    }


@router.get("/me/time-blocks")
def my_time_blocks(start: int, end: int, member=Depends(current_member)):
    """Blocks that overlap [start, end), in milliseconds."""
    blocks = _read_json(TIME_BLOCKS_PATH).get(member["clickup_user_id"], [])
    return {"time_blocks": [block for block in blocks if block["end"] > start and block["start"] < end]}


@router.post("/me/time-blocks")
def add_time_block(body: TimeBlockRequest, member=Depends(current_member)):
    block = {"id": uuid.uuid4().hex, **_validate_block(body)}

    with _store_lock:
        all_blocks = _read_json(TIME_BLOCKS_PATH)
        all_blocks.setdefault(member["clickup_user_id"], []).append(block)
        _write_json(TIME_BLOCKS_PATH, all_blocks)

    return block


@router.put("/me/time-blocks/{block_id}")
def update_time_block(block_id: str, body: TimeBlockRequest, member=Depends(current_member)):
    with _store_lock:
        all_blocks = _read_json(TIME_BLOCKS_PATH)
        for block in all_blocks.get(member["clickup_user_id"], []):
            if block["id"] == block_id:
                block.update(_validate_block(body))
                _write_json(TIME_BLOCKS_PATH, all_blocks)
                return block

    raise HTTPException(status_code=404, detail="Time entry not found.")


@router.delete("/me/time-blocks/{block_id}")
def delete_time_block(block_id: str, member=Depends(current_member)):
    with _store_lock:
        all_blocks = _read_json(TIME_BLOCKS_PATH)
        blocks = all_blocks.get(member["clickup_user_id"], [])
        remaining = [block for block in blocks if block["id"] != block_id]
        if len(remaining) == len(blocks):
            raise HTTPException(status_code=404, detail="Time entry not found.")

        all_blocks[member["clickup_user_id"]] = remaining
        _write_json(TIME_BLOCKS_PATH, all_blocks)

    return {"deleted": block_id}
