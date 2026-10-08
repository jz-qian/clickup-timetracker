"""
AI task-time estimator.

Builds a history of completed ClickUp tasks (with the hours they took and the
roles of the people assigned), lets a Claude agent search it for tasks similar
to a new one, and turns the tasks it picks into an average-hours projection.

The averaging is done here in code, not by the model, so the numbers shown
always come straight from the historical data.
"""

from concurrent.futures import ThreadPoolExecutor
from statistics import mean, median
import json
import re

import anthropic

from app.clickup import (
    CLICKUP_ROLE_NAMES,
    MAX_PARALLEL_REQUESTS,
    BackgroundCache,
    _clickup_get,
    _hours,
    _ms_to_iso,
    _to_ms,
    get_all_lists_in_space,
    get_all_tasks,
    get_workspace_members,
    normalize_workspace_members,
    workspace_id,
)

MODEL = "claude-opus-5-5"
TASK_HISTORY_TTL_SECONDS = 30 * 60
MAX_AGENT_TURNS = 10
MAX_SEARCH_RESULTS = 25
DESCRIPTION_PREVIEW_CHARS = 400

STOP_WORDS = {
    "the", "and", "for", "with", "from", "into", "that", "this", "task",
    "new", "add", "update", "make", "create", "set", "our", "are", "was",
}


# --------------------------------------------------
# Historical task data
# --------------------------------------------------

def _get_spaces(archived):
    data = _clickup_get(f"/team/{workspace_id}/space", {"archived": archived})
    return data.get("spaces", [])


def _is_completed(task):
    return (task.get("status") or {}).get("type") == "closed" or bool(task.get("date_done"))


def _assignee_roles(task, members_by_id):
    people = []

    for assignee in task.get("assignees", []):
        member = members_by_id.get(str(assignee.get("id")), {})
        role = member.get("actual_role") or CLICKUP_ROLE_NAMES.get(member.get("clickup_role"))

        people.append({
            "name": assignee.get("username") or assignee.get("email") or "Unknown user",
            "role": role or "",
        })

    return people


def _space_tasks(space):
    lists = get_all_lists_in_space(space["id"])

    with ThreadPoolExecutor(MAX_PARALLEL_REQUESTS) as pool:
        batches = pool.map(get_all_tasks, [current_list["id"] for current_list in lists])
        return [task for batch in batches for task in batch]


def build_task_history():
    """
    Completed tasks from every space (active and archived), plus a per-project
    summary of the active spaces that new tasks can be estimated into.
    """
    members = normalize_workspace_members(get_workspace_members())
    members_by_id = {member["clickup_user_id"]: member for member in members}

    active_spaces = _get_spaces("false")
    archived_spaces = _get_spaces("true")
    spaces = [(space, False) for space in active_spaces] + [(space, True) for space in archived_spaces]

    with ThreadPoolExecutor(MAX_PARALLEL_REQUESTS) as pool:
        space_tasks = list(pool.map(lambda pair: _space_tasks(pair[0]), spaces))

    completed_tasks = []
    projects = []

    for (space, archived), tasks in zip(spaces, space_tasks):
        logged_ms = 0
        open_count = 0
        open_estimate_ms = 0

        for task in tasks:
            tracked_ms = int(task.get("time_spent") or 0)
            logged_ms += tracked_ms

            if not _is_completed(task):
                open_count += 1
                # Only what's left, since time already spent is in logged_ms.
                open_estimate_ms += max(int(task.get("time_estimate") or 0) - tracked_ms, 0)
                continue

            # A completed task with no tracked time says nothing about duration.
            if tracked_ms <= 0:
                continue

            completed_tasks.append({
                "id": task["id"],
                "name": task.get("name") or "",
                "description": (task.get("text_content") or task.get("description") or "").strip(),
                "project": space["name"],
                "list": (task.get("list") or {}).get("name") or "",
                "hours": _hours(tracked_ms),
                "completed": _ms_to_iso(_to_ms(task.get("date_done") or task.get("date_closed"))),
                "assignees": _assignee_roles(task, members_by_id),
            })

        if not archived:
            projects.append({
                "id": space["id"],
                "name": space["name"],
                "logged_hours": _hours(logged_ms),
                "open_task_count": open_count,
                "open_remaining_estimate_hours": _hours(open_estimate_ms),
            })

    return {"completed_tasks": completed_tasks, "projects": projects}


task_history_cache = BackgroundCache("task history", build_task_history, TASK_HISTORY_TTL_SECONDS)


# --------------------------------------------------
# Agent tools
# --------------------------------------------------

def _words(text):
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) >= 3 and word not in STOP_WORDS}


def _task_summary(task):
    return {
        "id": task["id"],
        "name": task["name"],
        "project": task["project"],
        "list": task["list"],
        "hours": task["hours"],
        "completed": task["completed"],
        "assignee_roles": [person["role"] for person in task["assignees"]],
    }


def search_completed_tasks(history, query, limit):
    query_words = _words(query)
    if not query_words:
        return {"results": [], "note": "The query had no searchable words."}

    scored = []
    for task in history["completed_tasks"]:
        name_hits = len(query_words & _words(task["name"]))
        other_hits = len(query_words & _words(f"{task['list']} {task['description']}"))
        score = name_hits * 2 + other_hits
        if score:
            scored.append((score, task))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    limit = max(1, min(limit, MAX_SEARCH_RESULTS))

    return {
        "total_matches": len(scored),
        "results": [_task_summary(task) for _, task in scored[:limit]],
    }


def get_task_details(history, task_ids):
    tasks_by_id = {task["id"]: task for task in history["completed_tasks"]}
    details = []

    for task_id in task_ids:
        task = tasks_by_id.get(task_id)
        if task:
            details.append({
                **_task_summary(task),
                "description": task["description"][:DESCRIPTION_PREVIEW_CHARS],
                "assignees": task["assignees"],
            })

    return {"tasks": details, "not_found": [task_id for task_id in task_ids if task_id not in tasks_by_id]}


TOOLS = [
    {
        "name": "search_completed_tasks",
        "description": (
            "Keyword search over completed tasks from past and current projects. "
            "Returns each matching task's id, name, project, list, hours it took, "
            "and the roles of the people assigned (a role may be blank). "
            "Search several times with different wordings and synonyms."
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keywords describing the kind of work."},
                "limit": {"type": "integer", "description": f"Maximum results, up to {MAX_SEARCH_RESULTS}."},
            },
            "required": ["query", "limit"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_task_details",
        "description": (
            "Full details for specific completed tasks, including their description "
            "and each assignee's name and role. Use it to check whether a search "
            "result is really similar before choosing it."
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "task_ids": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["task_ids"],
            "additionalProperties": False,
        },
    },
]

FINAL_ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "similar_task_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "IDs of the completed tasks most similar to the new task.",
        },
        "reasoning": {
            "type": "string",
            "description": "A few sentences on why these tasks are comparable.",
        },
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
    },
    "required": ["similar_task_ids", "reasoning", "confidence"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """\
You help a team estimate how long a new task will take, based on how long similar \
tasks took in the past. You have tools that search the team's completed ClickUp \
tasks, which include the hours each task took and the roles of the people assigned.

Search the history with several different wordings, check promising matches with \
get_task_details, and then choose the completed tasks that are genuinely similar \
in the kind and size of work. Prefer a handful of close matches over many loose \
ones. If nothing is similar, return an empty list and say so in the reasoning. \
Only return IDs that the tools gave you. The hours are averaged from the tasks \
you choose, so do not compute an estimate yourself."""


def _run_tool(history, name, tool_input):
    if name == "search_completed_tasks":
        return search_completed_tasks(history, tool_input["query"], tool_input["limit"])
    if name == "get_task_details":
        return get_task_details(history, tool_input["task_ids"])
    raise ValueError(f"Unknown tool: {name}")


# --------------------------------------------------
# Agent loop
# --------------------------------------------------

class EstimatorError(Exception):
    """A problem to show the user, such as a bad API key."""


def _client(api_key):
    return anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()


def check_api_key(api_key):
    try:
        _client(api_key).models.retrieve(MODEL)
    except anthropic.AuthenticationError:
        raise EstimatorError("That API key was rejected by Anthropic.")
    except anthropic.PermissionDeniedError:
        raise EstimatorError(f"That API key can't use {MODEL}.")
    except anthropic.APIConnectionError:
        raise EstimatorError("Could not reach the Anthropic API.")


def _find_similar_tasks(client, history, task_name, task_description):
    request = f"New task: {task_name}"
    if task_description:
        request += f"\n\nDescription: {task_description}"

    messages = [{"role": "user", "content": request}]

    for _ in range(MAX_AGENT_TURNS):
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
            output_config={
                "effort": "medium",
                "format": {"type": "json_schema", "schema": FINAL_ANSWER_SCHEMA},
            },
            # On a safety decline, rerun on Anthropic's recommended fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )

        if response.stop_reason == "refusal":
            raise EstimatorError("The AI model declined to estimate this task.")

        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})
            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue
                try:
                    result = _run_tool(history, block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result),
                    })
                except Exception as error:
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"Error: {error}",
                        "is_error": True,
                    })

            messages.append({"role": "user", "content": tool_results})
            continue

        if response.stop_reason == "max_tokens":
            raise EstimatorError("The AI model's answer was cut off. Try a shorter description.")

        text = "".join(block.text for block in response.content if block.type == "text")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            raise EstimatorError("The AI model's answer couldn't be read. Try again.")

    raise EstimatorError("The AI model took too many steps without answering.")


def estimate_task(api_key, task_name, task_description=""):
    history = task_history_cache.get()
    client = _client(api_key)

    try:
        answer = _find_similar_tasks(client, history, task_name, task_description)
    except anthropic.AuthenticationError:
        raise EstimatorError("That API key was rejected by Anthropic.")
    except anthropic.RateLimitError:
        raise EstimatorError("Anthropic rate limit reached. Try again in a minute.")
    except anthropic.APIConnectionError:
        raise EstimatorError("Could not reach the Anthropic API.")

    tasks_by_id = {task["id"]: task for task in history["completed_tasks"]}
    # Drop any ID the model invented, and duplicates, keeping its order.
    chosen_ids = list(dict.fromkeys(task_id for task_id in answer["similar_task_ids"] if task_id in tasks_by_id))
    similar = [tasks_by_id[task_id] for task_id in chosen_ids]
    hours = [task["hours"] for task in similar]

    return {
        "task_name": task_name,
        "projection": {
            "average_hours": round(mean(hours), 2) if hours else None,
            "median_hours": round(median(hours), 2) if hours else None,
            "min_hours": min(hours) if hours else None,
            "max_hours": max(hours) if hours else None,
            "sample_size": len(hours),
        },
        "similar_tasks": [
            {**_task_summary(task), "assignees": task["assignees"]}
            for task in similar
        ],
        "reasoning": answer["reasoning"],
        "confidence": answer["confidence"],
        "history_size": len(history["completed_tasks"]),
    }
