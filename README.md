# clickup-timetracker

This repository provides a small ClickUp time-tracker frontend (Vite + React) and a FastAPI backend that proxies ClickUp API calls.

## Quick setup (development)

Prerequisites

- Python 3.10+ (3.11 recommended)
- Node.js 20.x (or recent LTS)
- npm (or yarn)

1) Backend (FastAPI)

```bash
# create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate

# install core dependencies (if you have a requirements file, use that)
pip install fastapi uvicorn python-dotenv requests

# run the backend (from repo root)
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

2) Frontend (Vite + React)

```bash
cd frontend
npm install
npm run dev
# open the Vite URL shown in the terminal (e.g. http://localhost:5173 or 5175)
```

## Environment variables

Create a `.env` file in the project root (this file is gitignored). At minimum set:

```
CLICKUP_API_TOKEN=your_clickup_api_token_here
CLICKUP_WORKSPACE_ID=90148016204   # keep your current ID formatting
CLICKUP_SPACE_ID=90148016204       # optional - used by some helper functions
BACKEND_URL=http://127.0.0.1:8000  # optional override used by the frontend
```

Notes:

- `.env` is included in `.gitignore` to avoid accidentally committing secrets. If you previously committed a token, rotate it in ClickUp.
- You can create a `.env.example` with the same keys but no secret values for sharing config with teammates.

## How the app fetches data

- The frontend requests spaces from `GET /spaces` on the backend.
- For each space it requests `GET /spaces/{space_id}/lists` to load lists.
- For each list it requests `GET /lists/{list_id}/tasks` to load tasks, then groups subtasks under parent tasks.

## Troubleshooting

- If the frontend shows stale content, hard-refresh the browser (Cmd/Ctrl+Shift+R) or open an Incognito window and unregister any Service Worker in DevTools.
- If you see CORS errors, ensure the backend is running and restarted after configuration changes. The backend allows the common Vite dev origins by default.
- If API responses are empty, confirm your `CLICKUP_API_TOKEN` and `CLICKUP_WORKSPACE_ID` values and that the token has the necessary permissions.

## Useful commands

```bash
# backend
uvicorn app.main:app --reload

# frontend (from /frontend)
npm run dev

# quickly check API from the repo root
curl http://127.0.0.1:8000/spaces
curl http://127.0.0.1:8000/spaces/<space_id>/lists
curl http://127.0.0.1:8000/lists/<list_id>/tasks
```

If you need the README expanded with deployment notes or CI steps, tell me what platform you plan to deploy to (e.g., Railway, Render, Docker) and I will add specific instructions.
