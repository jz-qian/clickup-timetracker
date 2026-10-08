from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware 
from pydantic import BaseModel
from app.clickup import (
    get_authorized_workspaces,
    get_spaces,
    get_lists,
    get_tasks,
    get_time_entries,
    get_project_data,
    get_workspace_members,
    normalize_workspace_members,
    archive_dashboard_cache,
    verify_webhook_signature,
    record_deadline_changes,
)
from app.estimator import (
    EstimatorError,
    check_api_key,
    estimate_task,
    task_history_cache,
)
app = FastAPI()


@app.on_event("startup")
def warm_archive_dashboard():
    # Build the slow views before anyone opens them.
    archive_dashboard_cache.refresh_in_background()
    task_history_cache.refresh_in_background()


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return {
        "message": "ClickUp Time Tracker API is running"
    }


@app.get("/workspaces")
def authorized_workspace():
    return get_authorized_workspaces()

@app.get("/spaces")
def spaces():
    return get_spaces()


@app.get("/spaces/{space_id}/lists")
def lists(space_id: str):
    return get_lists(space_id)


@app.get("/lists/{list_id}/tasks")
def tasks(list_id: str):
    return get_tasks(list_id)

@app.get("/time-entries")
def time_entries():
    return get_time_entries()

@app.get("/project-data")
def project_data():
    return get_project_data()

@app.get("/workspace-members")
def workspace_members():
    members = get_workspace_members()
    return {"members": normalize_workspace_members(members)}

@app.get("/archive-dashboard")
def archive_dashboard(refresh: bool = False):
    return archive_dashboard_cache.get(force_refresh=refresh)

@app.post("/webhooks/clickup")
async def clickup_webhook(request: Request):
    body = await request.body()

    if not verify_webhook_signature(body, request.headers.get("X-Signature")):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    recorded = record_deadline_changes(await request.json())
    if recorded:
        archive_dashboard_cache.refresh_in_background()
    return {"recorded": recorded}


# --------------------------------------------------
# AI estimator
# --------------------------------------------------
# The API key comes from the browser with each request and is only used for
# that request. If it's blank, the backend's own ANTHROPIC_API_KEY is used.

class ConnectRequest(BaseModel):
    api_key: str = ""


class EstimateRequest(BaseModel):
    api_key: str = ""
    task_name: str
    task_description: str = ""


@app.get("/ai/projects")
def ai_projects():
    history = task_history_cache.get()
    return {
        "projects": history["projects"],
        "completed_task_count": len(history["completed_tasks"]),
    }


@app.post("/ai/connect")
def ai_connect(body: ConnectRequest):
    try:
        check_api_key(body.api_key.strip())
    except EstimatorError as error:
        raise HTTPException(status_code=400, detail=str(error))
    return {"connected": True}


@app.post("/ai/estimate")
def ai_estimate(body: EstimateRequest):
    if not body.task_name.strip():
        raise HTTPException(status_code=400, detail="Enter a task name.")

    try:
        return estimate_task(
            body.api_key.strip(),
            body.task_name.strip(),
            body.task_description.strip(),
        )
    except EstimatorError as error:
        raise HTTPException(status_code=400, detail=str(error))
