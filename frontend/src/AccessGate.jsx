import { useState } from "react"

// Placeholder admin password. Empty for now, so the gate only separates
// the admin and team member views; set VITE_ADMIN_PASSWORD to require one.
// This check runs in the browser, so it is not real access control.
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? ""

// First screen: pick the team member app, or enter the admin password
function AccessGate({ onEnter }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState(null)

  const enterAdmin = (event) => {
    event.preventDefault()

    if (password !== ADMIN_PASSWORD) {
      setError("Incorrect password")
      return
    }

    onEnter("admin")
  }

  return (
    <div className="access-gate">
      <div className="access-card panel">
        <p className="eyebrow">TIME TRACKING</p>
        <h1>ClickUp Time Tracker</h1>
        <p className="subtitle">Choose how you want to sign in.</p>

        <button
          className="primary-button access-member-button"
          onClick={() => onEnter("member")}
        >
          Continue as team member
        </button>

        <div className="access-divider">
          <span>or</span>
        </div>

        <form className="access-admin-form" onSubmit={enterAdmin}>
          <label htmlFor="admin-password">Admin password</label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError(null)
            }}
            placeholder={ADMIN_PASSWORD ? "" : "No password set yet"}
          />
          {error && (
            <p className="access-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="secondary-button">
            Sign in as admin
          </button>
        </form>
      </div>
    </div>
  )
}

export default AccessGate
