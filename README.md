# clickup-timetracker

This repository provides a ClickUp time-tracker frontend (Vite + React) and a FastAPI backend that proxies ClickUp API calls.

## Quick setup (development)

Prerequisites

- Python 3.10+ (3.11 recommended)
- Node.js 20.19+ or 22.12+ (required by Vite 8)
- npm (or yarn)

1) Backend (FastAPI)

```bash
# create a project-local virtual environment
python3 -m venv .venv
source .venv/bin/activate

# install backend dependencies
python -m pip install -r requirements.txt

# run the backend (from repo root)
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

2) Frontend (Vite + React)

```bash
# install frontend dependencies (from the repository root)
npm install --prefix frontend

# start the frontend (from the repository root)
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
ANTHROPIC_API_KEY=your_anthropic_key  # optional - used by the AI Estimator tab when no key is entered there
GEMINI_API_KEY=your_gemini_key        # optional - used by the AI Estimator tab when no key is entered there
```

Notes:

- `.env` is included in `.gitignore` to avoid accidentally committing secrets. If you previously committed a token, rotate it in ClickUp.
- You can create a `.env.example` with the same keys but no secret values for sharing config with teammates.
- The app opens on a sign-in screen: team members continue straight to their day view, and admins enter the admin password to reach the dashboard. The password is empty by default; set `VITE_ADMIN_PASSWORD` in `frontend/.env` to require one. The check runs in the browser, so it separates the two views but is not real access control.

## How the app fetches data

- The frontend requests spaces from `GET /spaces` on the backend.
- For each space it requests `GET /spaces/{space_id}/lists` to load lists.
- For each list it requests `GET /lists/{list_id}/tasks` to load tasks, then groups subtasks under parent tasks.

## Troubleshooting

- If npm reports `ENOENT` while opening `/.../clickup-timetracker/package.json`, make sure you are in the repository root and that the root `package.json` exists. The root `npm run dev` script forwards to the frontend. If you are on an older checkout without that file, update the checkout; alternatively run `cd frontend && npm run dev`.
- If the root `npm run dev` reports `vite: not found`, install the frontend dependencies from the repository root with `npm install --prefix frontend`, then retry `npm run dev`.
- If `npm run dev` reports `env: node: No such file or directory`, install a supported Node.js version and restart the terminal so `node` is on your `PATH`. Verify with `node --version` and `npm --version`, then run `npm install --prefix frontend` from the repository root.
- If the frontend shows stale content, hard-refresh the browser (Cmd/Ctrl+Shift+R) or open an Incognito window and unregister any Service Worker in DevTools.
- If you see CORS errors, ensure the backend is running and restarted after configuration changes. The backend allows the common Vite dev origins by default.
- If API responses are empty, confirm your `CLICKUP_API_TOKEN` and `CLICKUP_WORKSPACE_ID` values and that the token has the necessary permissions.
- The AI Estimator accepts Anthropic (`sk-ant-...`) or Gemini (`AIza...`) API keys. Restart FastAPI after changing server-side keys.

## Useful commands

```bash
# backend
uvicorn app.main:app --reload

# frontend (from the repository root)
npm run dev

# quickly check API from the repo root
curl http://127.0.0.1:8000/spaces
curl http://127.0.0.1:8000/spaces/<space_id>/lists
curl http://127.0.0.1:8000/lists/<list_id>/tasks
```

If you need the README expanded with deployment notes or CI steps, tell me what platform you plan to deploy to (e.g., Railway, Render, Docker) and I will add specific instructions.
