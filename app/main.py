from fastapi import FastAPI
from app.clickup import get_authorized_workspaces, CLICKUP_WORKSPACE_ID

app = FastAPI()

@app.get("/")
def home():
    return {"message": "ClickUp Time Tracker API is running"}

@app.get("/workspaces")
def workspaces():
    return get_authorized_workspaces()

@app.get("/test-workspace")
def test_workspace():
    return {
        "workspace_id": CLICKUP_WORKSPACE_ID
    }