export const API_URL = "http://127.0.0.1:8000"

// Matches MIN_PASSWORD_LENGTH in app/member_routes.py
export const MIN_PASSWORD_LENGTH = 8

const SESSION_STORAGE_KEY = "clickup-time-tracker-member-session"

// Error with the HTTP status, so callers can spot an expired session (401)
export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

// JSON request to the backend. Sends the member's session token when given.
export async function apiFetch(path, { token, method = "GET", body } = {}) {
  const headers = {}
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError("Could not reach the server. Is the backend running?", 0)
  }

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : null
    throw new ApiError(detail || `Request failed (${response.status})`, response.status)
  }

  return data
}

// The signed-in member ({ token, user }) is kept across reloads so the
// day calendar can stay open and keep tracking
export function loadMemberSession() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY))
    return session?.token && session?.user ? session : null
  } catch {
    return null
  }
}

export function saveMemberSession(session) {
  try {
    if (session) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
    }
  } catch {
    // Storage blocked; the member just signs in again after a reload
  }
}
