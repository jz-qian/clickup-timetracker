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

// The ClickUp tasks assigned to this member, oldest first. Ticking one
// marks it complete in ClickUp; it stays here, crossed out, with an undo
// until the page reloads.
function AssignedTasks({ tasks, error, completed, onComplete, onUndo }) {
  // What's in flight per task ("complete" or "undo"), and the last error
  const [pending, setPending] = useState({})
  const [taskErrors, setTaskErrors] = useState({})

  const run = async (taskId, kind, action) => {
    setPending((current) => ({ ...current, [taskId]: kind }))
    setTaskErrors((current) => ({ ...current, [taskId]: null }))
    try {
      await action()
    } catch (requestError) {
      setTaskErrors((current) => ({ ...current, [taskId]: requestError.message }))
    } finally {
      setPending((current) => ({ ...current, [taskId]: null }))
    }
  }

  const openCount = tasks ? tasks.filter((task) => !completed[task.id]).length : 0

  return (
    <section className="member-card member-tasks panel" aria-labelledby="tasks-title">
      <div className="member-tasks-header">
        <div>
          <p className="section-kicker">CLICKUP</p>
          <h2 id="tasks-title">Assigned tasks</h2>
        </div>
        {tasks && <span className="entry-count">{openCount}</span>}
      </div>

      {error && <p className="member-card-note">{error}</p>}
      {!error && !tasks && <p className="member-card-note">Loading tasks…</p>}
      {tasks?.length === 0 && (
        <p className="member-card-note">No open tasks are assigned to you.</p>
      )}

      {tasks?.length > 0 && (
        <ol className="member-task-list">
          {tasks.map((task) => {
            const isDone = Boolean(completed[task.id])
            // Tick or untick straight away while ClickUp is updated
            const showDone = pending[task.id] ? pending[task.id] === "complete" : isDone
            const checkboxId = `task-done-${task.id}`

            return (
              <li key={task.id} className={showDone ? "done" : undefined}>
                <input
                  id={checkboxId}
                  type="checkbox"
                  className="member-task-check"
                  checked={showDone}
                  disabled={Boolean(pending[task.id])}
                  aria-label={`Mark ${task.name} complete`}
                  onChange={() =>
                    isDone
                      ? run(task.id, "undo", () => onUndo(task))
                      : run(task.id, "complete", () => onComplete(task))
                  }
                />
                <div className="member-task-body">
                  <label htmlFor={checkboxId} className="member-task-name">
                    {task.name}
                  </label>
                  <span className="member-task-meta">
                    {task.space && <span>{task.space}</span>}
                    {task.list && <span>{task.list}</span>}
                    <span>{isDone ? completed[task.id].status : task.status}</span>
                    {task.url && (
                      <a href={task.url} target="_blank" rel="noreferrer">
                        Open in ClickUp
                      </a>
                    )}
                  </span>
                  {isDone && (
                    <button
                      type="button"
                      className="link-button member-task-undo"
                      disabled={Boolean(pending[task.id])}
                      onClick={() => run(task.id, "undo", () => onUndo(task))}
                    >
                      Undo
                    </button>
                  )}
                  {taskErrors[task.id] && (
                    <span className="member-task-error" role="alert">
                      {taskErrors[task.id]}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
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
  // Tasks completed from this page: id → { status, previous_status }
  const [completed, setCompleted] = useState({})

  const taskRequest = async (path, body) => {
    try {
      return await apiFetch(path, { token, method: "POST", body })
    } catch (error) {
      if (error.status === 401) onSignOut()
      throw error
    }
  }

  const completeTask = async (task) => {
    const result = await taskRequest(`/me/tasks/${task.id}/complete`)
    setCompleted((current) => ({ ...current, [task.id]: result }))
  }

  const undoComplete = async (task) => {
    const previous = completed[task.id]?.previous_status || task.status
    await taskRequest(`/me/tasks/${task.id}/reopen`, { status: previous })
    setCompleted((current) => {
      const next = { ...current }
      delete next[task.id]
      return next
    })
  }

  // Completed tasks drop out of the time-entry task picker
  const openTasks = (tasks || []).filter((task) => !completed[task.id])

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
        <DayTimeline token={token} tasks={openTasks} onUnauthorized={onSignOut} />

        <aside className="member-sidebar">
          <AvailabilityCard token={token} onUnauthorized={onSignOut} />
          <AssignedTasks
            tasks={tasks}
            error={tasksError}
            completed={completed}
            onComplete={completeTask}
            onUndo={undoComplete}
          />
        </aside>
      </div>
    </div>
  )
}

export default TeamMemberApp
