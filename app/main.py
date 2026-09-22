from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware 
from app.clickup import (
    get_authorized_workspaces,
    get_spaces,
    get_lists,
    get_tasks,
    get_time_entries,
    get_project_data,
    get_workspace_members,
    normalize_workspace_members,
)
app = FastAPI()

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