import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware 
from fastapi.responses import JSONResponse
from app import clickup
from app.clickup import (
    get_authorized_workspaces,
    get_spaces,
    get_lists,
    get_tasks,
    get_time_entries,
    get_project_data,
    get_workspace_members,
    normalize_workspace_members,
    get_archived_client_dashboard,
    verify_webhook_signature,
    record_deadline_changes,
)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    # Vite moves to the next free port (5174, 5175, ...) when 5173 is taken,
    # so allow any local port.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Errors are returned as JSON from these handlers rather than left unhandled:
# an unhandled error skips the CORS middleware, so the browser only reports
# "Failed to fetch" and the real reason never reaches the frontend.

@app.exception_handler(RuntimeError)
def config_error(request: Request, error: RuntimeError):
    return JSONResponse(status_code=500, content={"detail": str(error)})

@app.exception_handler(requests.RequestException)
def clickup_error(request: Request, error: requests.RequestException):
    if not clickup.token or not clickup.workspace_id:
        detail = (
            "CLICKUP_API_TOKEN and CLICKUP_WORKSPACE_ID must be set in the "
            ".env file in the project root"
        )
    elif error.response is not None:
        detail = f"ClickUp returned {error.response.status_code}: {error.response.text[:300]}"
    else:
        detail = f"Could not reach ClickUp: {error}"

    return JSONResponse(status_code=502, content={"detail": detail})

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
def archive_dashboard():
    return get_archived_client_dashboard()

@app.post("/webhooks/clickup")
async def clickup_webhook(request: Request):
    body = await request.body()

    if not verify_webhook_signature(body, request.headers.get("X-Signature")):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    recorded = record_deadline_changes(await request.json())
    return {"recorded": recorded}
