"""
Team capacity: whether each team member is open to more hours.

Team members will submit an up arrow (open to more hours) or a down arrow
(not open to more hours) from their own page. Each submission is appended to
a log file, and the admin page shows each member's latest answer next to the
hours they've logged in ClickUp.

There is no login yet, so the submit endpoint trusts the user id it's sent.
"""

from datetime import datetime, timedelta, timezone
import json
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.clickup import (
    BASE_DIR,
    CLICKUP_ROLE_NAMES,
    _hours,
    get_time_entries,
    get_workspace_members,
    normalize_workspace_members,
)

router = APIRouter()

AVAILABILITY_LOG_PATH = BASE_DIR / "data" / "availability.jsonl"
PREFERENCES = {"up", "down"}

_log_lock = threading.Lock()


def _load_latest_availability():
    """Each member's most recent submission, keyed by ClickUp user id."""
    latest = {}

    if not AVAILABILITY_LOG_PATH.exists():
        return latest

    with AVAILABILITY_LOG_PATH.open() as log_file:
        for line in log_file:
            if line.strip():
                entry = json.loads(line)
                latest[entry["clickup_user_id"]] = entry

    return latest


class AvailabilityRequest(BaseModel):
    clickup_user_id: str
    preference: str
    note: str = ""


@router.post("/team/availability")
def submit_availability(body: AvailabilityRequest):
    if body.preference not in PREFERENCES:
        raise HTTPException(status_code=400, detail='Preference must be "up" or "down".')

    member_ids = {member["clickup_user_id"] for member in normalize_workspace_members(get_workspace_members())}
    if body.clickup_user_id not in member_ids:
        raise HTTPException(status_code=404, detail="Unknown team member.")

    entry = {
        "clickup_user_id": body.clickup_user_id,
        "preference": body.preference,
        "note": body.note.strip(),
        "submitted_at": datetime.now(tz=timezone.utc).isoformat(),
    }

    with _log_lock:
        AVAILABILITY_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with AVAILABILITY_LOG_PATH.open("a") as log_file:
            log_file.write(json.dumps(entry) + "\n")

    return entry


@router.get("/admin/team-capacity")
def team_capacity():
    members = normalize_workspace_members(get_workspace_members())
    availability = _load_latest_availability()
    entries = get_time_entries().get("data", [])

    now = datetime.now(tz=timezone.utc)
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_ms = week_start.timestamp() * 1000
    last_30_days_ms = (now - timedelta(days=30)).timestamp() * 1000

    hours_by_user = {}
    for entry in entries:
        duration = int(entry.get("duration", 0) or 0)
        if duration < 0:  # a timer that is still running
            continue

        user_id = str((entry.get("user") or {}).get("id"))
        start = int(entry.get("start") or 0)
        totals = hours_by_user.setdefault(user_id, {"week": 0, "last_30_days": 0, "all_time": 0})

        totals["all_time"] += duration
        if start >= last_30_days_ms:
            totals["last_30_days"] += duration
        if start >= week_start_ms:
            totals["week"] += duration

    people = []
    for member in members:
        user_id = member["clickup_user_id"]
        totals = hours_by_user.get(user_id, {"week": 0, "last_30_days": 0, "all_time": 0})
        latest = availability.get(user_id)

        people.append({
            "clickup_user_id": user_id,
            "name": member["clickup_username"] or member["clickup_email"] or "Unknown user",
            "email": member["clickup_email"],
            "role": member["actual_role"] or CLICKUP_ROLE_NAMES.get(member["clickup_role"]) or "",
            "hours_this_week": _hours(totals["week"]),
            "hours_last_30_days": _hours(totals["last_30_days"]),
            "hours_all_time": _hours(totals["all_time"]),
            "preference": latest["preference"] if latest else None,
            "note": latest["note"] if latest else "",
            "submitted_at": latest["submitted_at"] if latest else None,
        })

    people.sort(key=lambda person: person["name"].lower())

    return {
        "generated_at": now.isoformat(),
        "week_start": week_start.date().isoformat(),
        "summary": {
            "members": len(people),
            "open_to_more": sum(1 for person in people if person["preference"] == "up"),
            "not_open_to_more": sum(1 for person in people if person["preference"] == "down"),
            "no_response": sum(1 for person in people if person["preference"] is None),
        },
        "people": people,
    }
