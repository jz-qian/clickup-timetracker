"""
Team capacity: whether each team member is open to more hours.

Team members answer "Want more tasks?" once a week from their own page: an
up arrow (open to more), a down arrow (fewer), or a dash (happy as is).
Weeks run Monday to Sunday and are named by their Monday's date. Answers
are tracked week to week, so the admin page shows this week's answer next
to earlier weeks'. Each submission is appended to
a log file, and the admin page shows each member's latest answer next to the
hours they've logged in ClickUp.

Signed-in team members submit through POST /me/availability
(member_routes.py). The older POST /team/availability trusts the user id
it's sent.
"""

from datetime import date, datetime, timedelta, timezone
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
PREFERENCES = {"up", "down", "same"}

_log_lock = threading.Lock()


# How many earlier weeks the history shows
HISTORY_WEEKS = 8


def current_week_start():
    """This week's Monday (UTC), as a date."""
    today = datetime.now(tz=timezone.utc).date()
    return today - timedelta(days=today.weekday())


def parse_week_start(value):
    """
    A "YYYY-MM-DD" Monday sent by a browser, which knows the member's own
    time zone. Missing means this week (UTC).
    """
    if not value:
        return current_week_start()

    try:
        week_start = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="week_start must be a YYYY-MM-DD date.")
    if week_start.weekday() != 0:
        raise HTTPException(status_code=400, detail="week_start must be a Monday.")

    return week_start


def _entry_week(entry):
    """The week an answer is for. Answers from before weekly tracking
    count for the week they were sent in (UTC)."""
    if entry.get("week_start"):
        return entry["week_start"]

    sent = datetime.fromisoformat(entry["submitted_at"]).date()
    return (sent - timedelta(days=sent.weekday())).isoformat()


def load_weekly_availability():
    """Each member's answer per week: {user id: {"YYYY-MM-DD": entry}}.
    A later answer for the same week replaces an earlier one."""
    weekly = {}

    if not AVAILABILITY_LOG_PATH.exists():
        return weekly

    with AVAILABILITY_LOG_PATH.open() as log_file:
        for line in log_file:
            if line.strip():
                entry = json.loads(line)
                weekly.setdefault(entry["clickup_user_id"], {})[_entry_week(entry)] = entry

    return weekly


def availability_history(answers_by_week, week_start, weeks=HISTORY_WEEKS):
    """The answers for `week_start` and the weeks before it, oldest first.
    Weeks with no answer have preference None."""
    history = []
    for offset in range(weeks - 1, -1, -1):
        week = (week_start - timedelta(weeks=offset)).isoformat()
        entry = answers_by_week.get(week)
        history.append({
            "week_start": week,
            "preference": entry["preference"] if entry else None,
            "submitted_at": entry["submitted_at"] if entry else None,
        })
    return history


class AvailabilityRequest(BaseModel):
    clickup_user_id: str
    preference: str
    note: str = ""


def record_availability(clickup_user_id, preference, note="", week_start=None):
    """Append one member's answer for a week to the log and return it."""
    if preference not in PREFERENCES:
        raise HTTPException(status_code=400, detail='Preference must be "up", "down" or "same".')

    week_start = week_start or current_week_start()
    # Only this week can be answered (a day's slack for time zones)
    if abs((week_start - current_week_start()).days) > 7:
        raise HTTPException(status_code=400, detail="You can only answer for this week.")

    entry = {
        "clickup_user_id": clickup_user_id,
        "week_start": week_start.isoformat(),
        "preference": preference,
        "note": note.strip(),
        "submitted_at": datetime.now(tz=timezone.utc).isoformat(),
    }

    with _log_lock:
        AVAILABILITY_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with AVAILABILITY_LOG_PATH.open("a") as log_file:
            log_file.write(json.dumps(entry) + "\n")

    return entry


@router.post("/team/availability")
def submit_availability(body: AvailabilityRequest):
    member_ids = {member["clickup_user_id"] for member in normalize_workspace_members(get_workspace_members())}
    if body.clickup_user_id not in member_ids:
        raise HTTPException(status_code=404, detail="Unknown team member.")

    return record_availability(body.clickup_user_id, body.preference, body.note)


@router.get("/admin/team-capacity")
def team_capacity(week_start: str | None = None):
    """Hours per member, with this week's "Want more tasks?" answer and
    earlier weeks'. `week_start` is the admin's local Monday."""
    question_week = parse_week_start(week_start)
    last_week = (question_week - timedelta(weeks=1)).isoformat()
    weekly = load_weekly_availability()
    members = normalize_workspace_members(get_workspace_members())
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
        answers = weekly.get(user_id, {})
        latest = answers.get(question_week.isoformat())

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
            "last_week_preference": (answers.get(last_week) or {}).get("preference"),
            "history": availability_history(answers, question_week),
        })

    people.sort(key=lambda person: person["name"].lower())

    return {
        "generated_at": now.isoformat(),
        "week_start": week_start.date().isoformat(),
        "question_week_start": question_week.isoformat(),
        "summary": {
            "members": len(people),
            "open_to_more": sum(1 for person in people if person["preference"] == "up"),
            "not_open_to_more": sum(1 for person in people if person["preference"] == "down"),
            "no_change": sum(1 for person in people if person["preference"] == "same"),
            "no_response": sum(1 for person in people if person["preference"] is None),
        },
        "people": people,
    }
