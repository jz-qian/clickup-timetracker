import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "./api.js"
import Calendar from "./Calendar.jsx"
import { fromISODate, mondayOf } from "./calendarUtils.js"
import { useLiveRefresh } from "./liveRefresh.js"

const PREFERENCE_OPTIONS = [
  { value: "up", symbol: "↑", label: "Open to more hours" },
  { value: "same", symbol: "–", label: "Happy as is" },
  { value: "down", symbol: "↓", label: "Less hours" },
]

const SYMBOLS = Object.fromEntries(
  PREFERENCE_OPTIONS.map((option) => [option.value, option.symbol])
)

function shortDate(isoDate) {
  return fromISODate(isoDate).toLocaleDateString([], { month: "short", day: "numeric" })
}

// "Want more tasks?", asked once a week (Monday to Sunday). This week's
// answer feeds the admin page's Team Capacity view, and earlier weeks
// show underneath so the answers can be followed week to week.
function AvailabilityCard({ token, onUnauthorized }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [current, setCurrent] = useState(null)
  const [history, setHistory] = useState([])
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    // A new week starts a new question, even on a page left open
    const week = mondayOf(new Date())
    apiFetch(`/me/availability?week_start=${week}`, { token })
      .then((data) => {
        setWeekStart(week)
        setCurrent(data.current)
        setHistory(data.history)
        setError(null)
      })
      .catch((requestError) => {
        if (requestError.status === 401) onUnauthorized()
        setError(requestError.message)
      })
  }, [token, onUnauthorized])

  useEffect(load, [load])
  useLiveRefresh(load)

  const choose = async (preference) => {
    setSaving(preference)
    setError(null)
    try {
      const data = await apiFetch("/me/availability", {
        token,
        method: "POST",
        body: { preference, week_start: weekStart },
      })
      setCurrent(data.current)
      setHistory(data.history)
    } catch (requestError) {
      if (requestError.status === 401) onUnauthorized()
      setError(requestError.message)
    } finally {
      setSaving(null)
    }
  }

  // Earlier weeks, oldest first, not counting this one
  const pastWeeks = history.filter((week) => week.week_start !== weekStart)
  const answered = Boolean(current)

  return (
    <section
      className={answered ? "member-card panel" : "member-card panel unanswered"}
      aria-labelledby="availability-title"
    >
      <p className="section-kicker">WEEK OF {shortDate(weekStart).toUpperCase()}</p>
      <h2 id="availability-title">Want more tasks?</h2>

      <div className="availability-buttons" role="group" aria-label="Want more tasks this week?">
        {PREFERENCE_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`availability-button availability-${option.value}`}
            aria-pressed={current?.preference === option.value}
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
          : answered
            ? `${PREFERENCE_OPTIONS.find((option) => option.value === current.preference)?.label ?? current.preference} this week. You can change it until Sunday.`
            : "You haven't answered for this week yet."}
      </p>

      {pastWeeks.length > 0 && (
        <div className="availability-history">
          <p className="availability-history-label">Earlier weeks</p>
          <ol className="availability-history-list">
            {pastWeeks.map((week) => (
              <li
                key={week.week_start}
                className={
                  week.preference ? `availability-${week.preference}` : "availability-none"
                }
                title={`Week of ${shortDate(week.week_start)}: ${
                  PREFERENCE_OPTIONS.find((option) => option.value === week.preference)
                    ?.label ?? "no answer"
                }`}
              >
                <span className="availability-history-symbol" aria-hidden="true">
                  {SYMBOLS[week.preference] ?? "·"}
                </span>
                <span className="availability-history-week">{shortDate(week.week_start)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
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

  const completedRef = useRef(completed)
  useEffect(() => {
    completedRef.current = completed
  })

  // Load tasks now and keep them live: deadlines, new assignments and
  // tasks closed in ClickUp show up without reloading the page
  const loadTasks = useCallback(() => {
    apiFetch("/me/tasks", { token })
      .then((data) => {
        setTasks((current) => {
          // Tasks ticked off here stay listed (crossed out, with undo)
          // even though ClickUp no longer returns them as open
          const ticked = (current || []).filter(
            (task) =>
              completedRef.current[task.id] &&
              !data.tasks.some((fresh) => fresh.id === task.id)
          )
          return [...data.tasks, ...ticked].sort(
            (a, b) => Number(a.date_created || 0) - Number(b.date_created || 0)
          )
        })
        setTasksError(null)
      })
      .catch((error) => {
        if (error.status === 401) onSignOut()
        setTasksError(error.message)
      })
  }, [token, onSignOut])

  useEffect(loadTasks, [loadTasks])
  useLiveRefresh(loadTasks)

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
        <Calendar token={token} tasks={openTasks} onUnauthorized={onSignOut} />

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
