import { useState } from "react"
import { apiFetch, MIN_PASSWORD_LENGTH } from "./api.js"

// Placeholder admin password. Empty for now, so the gate only separates
// the admin and team member views; set VITE_ADMIN_PASSWORD to require one.
// This check runs in the browser, so it is not real access control.
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? ""

// Team member sign-in: enter your ClickUp name, then set up a password
// the first time or enter it after that
function MemberSignIn({ onSignIn }) {
  // "name" → ask for the name; "setup" / "login" → ask for a password
  const [step, setStep] = useState("name")
  const [name, setName] = useState("")
  const [member, setMember] = useState(null)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const run = async (action) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  const findName = (event) => {
    event.preventDefault()
    run(async () => {
      const result = await apiFetch("/auth/lookup", {
        method: "POST",
        body: { name },
      })
      setMember(result.user)
      setStep(result.has_password ? "login" : "setup")
    })
  }

  const submitPassword = (event) => {
    event.preventDefault()

    if (step === "setup") {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
        return
      }
      if (password !== confirmPassword) {
        setError("The passwords don't match.")
        return
      }
    }

    run(async () => {
      const session = await apiFetch(
        step === "setup" ? "/auth/setup" : "/auth/login",
        { method: "POST", body: { name, password } }
      )
      onSignIn(session)
    })
  }

  const startOver = () => {
    setStep("name")
    setMember(null)
    setPassword("")
    setConfirmPassword("")
    setError(null)
  }

  if (step === "name") {
    return (
      <form className="access-form" onSubmit={findName}>
        <label htmlFor="member-name">Your name</label>
        <input
          id="member-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          placeholder="As it appears in ClickUp"
          autoComplete="username"
          autoFocus
          required
        />
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    )
  }

  return (
    <form className="access-form" onSubmit={submitPassword}>
      <div className="access-member">
        <span>
          {step === "setup" ? "Welcome, " : "Welcome back, "}
          <strong>{member?.name}</strong>
        </span>
        <button type="button" className="link-button" onClick={startOver}>
          Not you?
        </button>
      </div>

      {/* Hidden username field so password managers save the right name */}
      <input
        type="text"
        name="username"
        value={name}
        autoComplete="username"
        readOnly
        hidden
      />

      <label htmlFor="member-password">
        {step === "setup" ? "Create a password" : "Password"}
      </label>
      <input
        id="member-password"
        type="password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value)
          setError(null)
        }}
        autoComplete={step === "setup" ? "new-password" : "current-password"}
        autoFocus
        required
      />

      {step === "setup" && (
        <>
          <p className="access-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
          <label htmlFor="member-password-confirm">Confirm password</label>
          <input
            id="member-password-confirm"
            type="password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value)
              setError(null)
            }}
            autoComplete="new-password"
            required
          />
        </>
      )}

      {error && (
        <p className="access-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary-button" disabled={busy}>
        {busy
          ? "Signing in…"
          : step === "setup"
            ? "Create password and sign in"
            : "Sign in"}
      </button>
    </form>
  )
}

// First screen: team members sign in with their name, admins with the
// admin password
function AccessGate({ onMemberSignIn, onAdminSignIn }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState(null)

  const enterAdmin = (event) => {
    event.preventDefault()

    if (password !== ADMIN_PASSWORD) {
      setError("Incorrect password")
      return
    }

    onAdminSignIn()
  }

  return (
    <div className="access-gate">
      <div className="access-card panel">
        <p className="eyebrow">TIME TRACKING</p>
        <h1>ClickUp Time Tracker</h1>
        <p className="subtitle">Sign in with your ClickUp name.</p>

        <MemberSignIn onSignIn={onMemberSignIn} />

        <div className="access-divider">
          <span>or</span>
        </div>

        <details className="access-admin">
          <summary>Sign in as admin</summary>
          <form className="access-form" onSubmit={enterAdmin}>
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
        </details>
      </div>
    </div>
  )
}

export default AccessGate
