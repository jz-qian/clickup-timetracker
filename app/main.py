from fastapi import FastAPI
from app.clickup import get_authorized_workspaces

app = FastAPI()


@app.get("/")
def home():
    return {
        "message": "ClickUp Time Tracker API is running"
    }


@app.get("/workspace")
def authorized_workspace():
    return get_authorized_workspaces()