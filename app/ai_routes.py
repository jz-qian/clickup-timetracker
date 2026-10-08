"""
API routes for the AI tab.

Each AI company is a provider, recognised from the shape of its API key, and
each agent runs on one provider. Connecting with a key returns the agents that
key can use. To add a company or an agent, add an entry to PROVIDERS or AGENTS
(with the agent's code in its own module, like app/estimator.py).

The key comes from the browser with each request and is only used for that
request. If it's blank, the first provider whose server-side key is set in the
environment is used.
"""

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import estimator

router = APIRouter(prefix="/ai")

PROVIDERS = {
    "anthropic": {
        "name": "Anthropic",
        "key_prefix": "sk-ant-",
        "server_key_env": "ANTHROPIC_API_KEY",
        "check_key": estimator.check_api_key,
    },
}

AGENTS = {
    "task-estimator": {
        "name": "Task Time Estimator",
        "description": "Projects a new task's hours from similar completed tasks.",
        "provider": "anthropic",
        "run": estimator.estimate_task,
    },
}


@router.on_event("startup")
def warm_task_history():
    # Build the completed-task history before anyone opens the AI tab.
    estimator.task_history_cache.refresh_in_background()


def _provider_for_key(api_key):
    if api_key:
        for provider_id, provider in PROVIDERS.items():
            if api_key.startswith(provider["key_prefix"]):
                return provider_id
    else:
        for provider_id, provider in PROVIDERS.items():
            if os.getenv(provider["server_key_env"]):
                return provider_id

    supported = ", ".join(f"{p['name']} ({p['key_prefix']}...)" for p in PROVIDERS.values())
    detail = f"Unrecognized API key. Supported: {supported}." if api_key else "Enter an API key."
    raise HTTPException(status_code=400, detail=detail)


def _agents_for(provider_id):
    return [
        {"id": agent_id, "name": agent["name"], "description": agent["description"]}
        for agent_id, agent in AGENTS.items()
        if agent["provider"] == provider_id
    ]


class ConnectRequest(BaseModel):
    api_key: str = ""


class RunRequest(BaseModel):
    api_key: str = ""
    agent_id: str
    task_name: str
    task_description: str = ""


@router.get("/projects")
def projects():
    history = estimator.task_history_cache.get()
    return {
        "projects": history["projects"],
        "completed_task_count": len(history["completed_tasks"]),
    }


@router.post("/connect")
def connect(body: ConnectRequest):
    api_key = body.api_key.strip()
    provider_id = _provider_for_key(api_key)

    try:
        PROVIDERS[provider_id]["check_key"](api_key)
    except estimator.EstimatorError as error:
        raise HTTPException(status_code=400, detail=str(error))

    return {
        "provider": provider_id,
        "provider_name": PROVIDERS[provider_id]["name"],
        "agents": _agents_for(provider_id),
    }


@router.post("/run")
def run_agent(body: RunRequest):
    api_key = body.api_key.strip()
    agent = AGENTS.get(body.agent_id)

    if not agent:
        raise HTTPException(status_code=404, detail="Unknown agent.")
    if agent["provider"] != _provider_for_key(api_key):
        raise HTTPException(status_code=400, detail="This API key can't run that agent.")
    if not body.task_name.strip():
        raise HTTPException(status_code=400, detail="Enter a task name.")

    try:
        return agent["run"](api_key, body.task_name.strip(), body.task_description.strip())
    except estimator.EstimatorError as error:
        raise HTTPException(status_code=400, detail=str(error))
