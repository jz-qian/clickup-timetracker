import { useEffect, useState } from "react"
import { apiFetch } from "./api.js"
import DayTimeline from "./DayTimeline.jsx"

const PREFERENCE_OPTIONS = [
  { value: "up", symbol: "↑", label: "Open to more hours" },
  { value: "same", symbol: "–", label: "Happy as is" },
  { value: "down", symbol: "↓", label: "Not open to more hours" },
]

// Up / dash / down buttons. The latest answer feeds the admin page's
// Team Capacity view.
function AvailabilityCard({ token, onUnauthorized }) {
  const [latest, setLatest] = useState(null)
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch("/me/availability", { token })
      .then((data) => setLatest(data.latest))
      .catch((requestError) => {
        if (requestError.status === 401) onUnauthorized()
        setError(requestError.message)
      })
  }, [token, onUnauthorized])

  const choose = async (preference) => {
    setSaving(preference)
    setError(null)
    try {
      const data = await apiFetch("/me/availability", {
        token,
        method: "POST",
        body: { preference },
      })
      setLatest(data.latest)
    } catch (requestError) {
      if (requestError.status === 401) onUnauthorized()
      setError(requestError.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="member-card panel" aria-labelledby="availability-title">
      <p className="section-kicker">YOUR HOURS</p>
      <h2 id="availability-title">Want more hours?</h2>

      <div className="availability-buttons" role="group" aria-label="Want more hours?">
        {PREFERENCE_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`availability-button availability-${option.value}`}
            aria-pressed={latest?.preference === option.value}
            aria-label={option.label}
            title={option.label}
            disabled={saving !== null}
            onClick={() => choose(option.value)}
          >
            {option.symbol}
          </button>
        ))}
      </div>

      <p className="member-card-note">
        {error
          ? error
          : latest
            ? `${PREFERENCE_OPTIONS.find((option) => option.value === latest.preference)?.label ?? latest.preference} · ${new Date(latest.submitted_at).toLocaleDateString()}`
            : "No answer yet."}
      </p>
    </section>
  )
}

// The ClickUp tasks assigned to this member, oldest first
function AssignedTasks({ tasks, error }) {
  return (
    <section className="member-card member-tasks panel" aria-labelledby="tasks-title">
      <div className="member-tasks-header">
        <div>
          <p className="section-kicker">CLICKUP</p>
          <h2 id="tasks-title">Assigned tasks</h2>
        </div>
        {tasks && <span className="entry-count">{tasks.length}</span>}
      </div>

      {error && <p className="member-card-note">{error}</p>}
      {!error && !tasks && <p className="member-card-note">Loading tasks…</p>}
      {tasks?.length === 0 && (
        <p className="member-card-note">No open tasks are assigned to you.</p>
      )}

      {tasks?.length > 0 && (
        <ol className="member-task-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <span className="member-task-name">
                {task.url ? (
                  <a href={task.url} target="_blank" rel="noreferrer">
                    {task.name}
                  </a>
                ) : (
                  task.name
                )}
              </span>
              <span className="member-task-meta">
                <code>{task.custom_id || task.id}</code>
                {task.status && <span>{task.status}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// Non-admin app for individual team members
function TeamMemberApp({ session, onSignOut }) {
  const { token, user } = session
  const [tasks, setTasks] = useState(null)
  const [tasksError, setTasksError] = useState(null)

  useEffect(() => {
    apiFetch("/me/tasks", { token })
      .then((data) => setTasks(data.tasks))
      .catch((error) => {
        if (error.status === 401) onSignOut()
        setTasksError(error.message)
      })
  }, [token, onSignOut])

  return (
    <div className="dashboard member-dashboard">
      <header className="dashboard-header">
        <div className="dashboard-heading">
          <p className="eyebrow">TIME TRACKING</p>
          <h1>My Day</h1>
        </div>
        <div className="header-actions">
          <span className="header-badge">{user.name}</span>
          <button className="sign-out-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="member-layout">
        <DayTimeline token={token} tasks={tasks || []} onUnauthorized={onSignOut} />

        <aside className="member-sidebar">
          <AvailabilityCard token={token} onUnauthorized={onSignOut} />
          <AssignedTasks tasks={tasks} error={tasksError} />
        </aside>
      </div>
    </div>
  )
}

export default TeamMemberApp
