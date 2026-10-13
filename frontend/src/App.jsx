import { Fragment, useEffect, useState } from "react"
import AiEstimator from "./AiEstimator.jsx"
import ArchiveDashboard from "./ArchiveDashboard.jsx"
import { loadArchiveDashboard } from "./archiveDashboardData.js"

const WEEKLY_HOURS_PER_PERSON = 40
const BILLABLE_TARGET_RATIO = 0.8
const TEAM_SIZE_STORAGE_KEY = "clickup-time-tracker-team-size"

// Organize flat task data into parent tasks with their subtasks
function organizeTasks(tasks) {
  const parentTasks = tasks.filter((task) => !task.parent)

  return parentTasks.map((task) => ({
    ...task,
    subtasks: tasks.filter(
      (subtask) => subtask.parent?.id === task.id
    ),
  }))
}

// Format duration in milliseconds to hours/minutes string
function formatDuration(milliseconds) {
  const totalMinutes = Math.round(milliseconds / 60000)

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`
  }

  if (hours > 0) {
    return `${hours}h`
  }

  return `${minutes}m`
}

// Normalize time entry data to a consistent structure
function normalizeTimeEntries(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    taskId: entry.task?.id || null,
    taskName: entry.task?.name || "No task",

    userId: entry.user?.id || null,
    userName: entry.user?.username || "Unknown user",

    billable: entry.billable,

    start: Number(entry.start),
    end: Number(entry.end),
    duration: Number(entry.duration),

    spaceId: entry.task_location?.space_id || null,
    spaceName: entry.task_location?.space_name || "Unknown space",

    listId: entry.task_location?.list_id || null,
    listName: entry.task_location?.list_name || "Unknown list",

    folderId: entry.task_location?.folder_id || null,
    folderName: entry.task_location?.folder_name || "Unknown folder",

    tags: entry.tags || [],
    description: entry.description || "",
  }))
}

// Aggregate time entries by project (space)
function aggregateByProject(entries) {
  const projects = {}

  entries.forEach((entry) => {
    const projectId = entry.spaceId || "unknown"
    const projectName = entry.spaceName || "Unknown Project"

    if (!projects[projectId]) {
      projects[projectId] = {
        id: projectId,
        name: projectName,
        total: 0,
        billable: 0,
        nonBillable: 0,
      }
    }

    projects[projectId].total += entry.duration

    if (entry.billable) {
      projects[projectId].billable += entry.duration
    } else {
      projects[projectId].nonBillable += entry.duration
    }
  })

  return Object.values(projects)
}

function App() {
  // States
  const [spaces, setSpaces] = useState([])
  const [lists, setLists] = useState([])
  const [tasks, setTasks] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [error, setError] = useState(null)

  const [dateFilter, setDateFilter] = useState("all")
  const [clientFilter, setClientFilter] = useState("all")
  const [userFilter, setUserFilter] = useState("all")

  const [activeTab, setActiveTab] = useState("time")
  const [teamSize, setTeamSize] = useState(() => {
    if (typeof window === "undefined") {
      return 0
    }

    const savedTeamSize = Number(
      window.localStorage.getItem(TEAM_SIZE_STORAGE_KEY)
    )

    return Number.isInteger(savedTeamSize) && savedTeamSize >= 0
      ? savedTeamSize
      : 0
  })

  // --------------------------------------------------
  // Fetch Spaces
  // --------------------------------------------------
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  weekStart.setHours(0, 0, 0, 0)

  const nextWeekStart = new Date(weekStart)
  nextWeekStart.setDate(nextWeekStart.getDate() + 7)

  const weeklyEntries = timeEntries.filter(
    (entry) =>
      entry.start >= weekStart.getTime() &&
      entry.start < nextWeekStart.getTime()
  )
  const weeklyUtilizedTime = weeklyEntries.reduce(
    (total, entry) => total + entry.duration,
    0
  )
  const weeklyBillableTime = weeklyEntries
    .filter((entry) => entry.billable)
    .reduce((total, entry) => total + entry.duration, 0)
  const weeklyCapacity = teamSize * WEEKLY_HOURS_PER_PERSON
  const weeklyBillableTarget = weeklyCapacity * BILLABLE_TARGET_RATIO
  const weeklyCapacityMilliseconds = weeklyCapacity * 60 * 60 * 1000
  const weeklyBillableTargetMilliseconds =
    weeklyBillableTarget * 60 * 60 * 1000
  const weeklyRemainingTime = Math.max(
    0,
    weeklyCapacityMilliseconds - weeklyUtilizedTime
  )
  const weeklyOverCapacityTime = Math.max(
    0,
    weeklyUtilizedTime - weeklyCapacityMilliseconds
  )
  const utilizationPercent = weeklyCapacity
    ? Math.min(
        100,
        (weeklyUtilizedTime / weeklyCapacityMilliseconds) * 100
      )
    : 0
  const billableTargetPercent = weeklyBillableTarget
    ? Math.min(
        100,
        (weeklyBillableTime / weeklyBillableTargetMilliseconds) * 100
      )
    : 0

  useEffect(() => {
    window.localStorage.setItem(TEAM_SIZE_STORAGE_KEY, String(teamSize))
  }, [teamSize])

  const filteredTimeEntries = timeEntries.filter((entry) => {
    // Client filter
    if (
      clientFilter !== "all" &&
      entry.spaceId !== clientFilter
    ) {
      return false
    }

    // Team filter
    if (
      userFilter !== "all" &&
      String(entry.userId) !== String(userFilter)
    ) {
      return false
    }

    // Date filter
    const entryDate = new Date(entry.start)
    if (dateFilter === "today") {
      return (
        entryDate.getFullYear() === now.getFullYear() &&
        entryDate.getMonth() === now.getMonth() &&
        entryDate.getDate() === now.getDate()
      )
    }

    if (dateFilter === "week") {
      return entryDate >= weekStart
    }

    if (dateFilter === "month") {
      return (
        entryDate.getFullYear() === now.getFullYear() &&
        entryDate.getMonth() === now.getMonth()
      )
    }

    return true
  })

    const totalTime = filteredTimeEntries.reduce(
    (total, entry) => total + entry.duration,
    0
  )

  const billableTime = filteredTimeEntries
    .filter((entry) => entry.billable)
    .reduce((total, entry) => total + entry.duration, 0)

  const nonBillableTime = totalTime - billableTime

  const clients = Array.from(
    new Map(
      timeEntries
        .filter((entry) => entry.spaceId)
        .map((entry) => [
          entry.spaceId,
          entry.spaceName,
        ])
    ).entries()
  )

const taskLookup = new Map()

tasks.forEach((task) => {
  taskLookup.set(task.id, {
    ...task,
    parentId: null,
  })

  ;(task.subtasks || []).forEach((subtask) => {
    taskLookup.set(subtask.id, {
      ...subtask,
      parentId: task.id,
    })
  })
})

const entriesWithParents = filteredTimeEntries.map((entry) => {
  const task = taskLookup.get(entry.taskId)

  const parentTask = task?.parentId
    ? taskLookup.get(task.parentId)
    : null

  return {
    ...entry,
    parentTaskId: task?.parentId || null,
    parentTaskName:
      parentTask?.name || task?.name || entry.taskName,
  }
})



  const users = Array.from(
    new Map(
      filteredTimeEntries
        .filter((entry) => entry.userId)
        .map((entry) => [
          entry.userId,
          entry.userName,
        ])
    ).entries()
  )

  const projects = aggregateByProject(filteredTimeEntries)

    useEffect(() => {
      fetch("http://127.0.0.1:8000/spaces")
        .then((response) => {
          if (!response.ok) {
            throw new Error("Could not retrieve Spaces")
          }

          return response.json()
        })
        .then((data) => {
          setSpaces(data.spaces)
        })
        .catch((error) => {
          setError(error.message)
        })
    }, [])

  // --------------------------------------------------
  // Fetch Lists
  // --------------------------------------------------

  useEffect(() => {
    if (spaces.length === 0) {
      return
    }

    const fetchLists = async () => {
      try {
        const results = await Promise.all(
          spaces.map(async (space) => {
            const response = await fetch(
              `http://127.0.0.1:8000/spaces/${space.id}/lists`
            )

            if (!response.ok) {
              console.error(
                `Could not retrieve Lists for Space ${space.id}`
              )

              return { lists: [] }
            }

            return response.json()
          })
        )

        const allLists = results.flatMap(
          (result, index) =>
            (result.lists || []).map((list) => ({
              ...list,
              spaceId: spaces[index].id,
            }))
        )

        setLists(allLists)
      } catch (error) {
        console.error("LIST ERROR:", error)
        setError(error.message)
      }
    }

    fetchLists()
  }, [spaces])

  // --------------------------------------------------
  // Fetch Tasks
  // --------------------------------------------------

  useEffect(() => {
    if (lists.length === 0) {
      return
    }

    const fetchTasks = async () => {
      try {
        const results = await Promise.all(
          lists.map((list) =>
            fetch(
              `http://127.0.0.1:8000/lists/${list.id}/tasks`
            ).then((response) => {
              if (!response.ok) {
                throw new Error("Could not retrieve tasks")
              }

              return response.json()
            })
          )
        )

        const allTasks = results.flatMap(
          (result, index) =>
            (result.tasks || []).map((task) => ({
              ...task,
              listId: lists[index].id,
            }))
        )

        setTasks(organizeTasks(allTasks))
      } catch (error) {
        setError(error.message)
      }
    }

    fetchTasks()
  }, [lists])

  // Start loading the archive dashboard in the background so it's ready
  // by the time its tab is opened
  useEffect(() => {
    loadArchiveDashboard().catch(() => {})
  }, [])

  // --------------------------------------------------
  // Fetch Time Entries
  // --------------------------------------------------

  useEffect(() => {
    const fetchTimeEntries = async () => {
      try {
        const response = await fetch(
          "http://127.0.0.1:8000/time-entries"
        )

        if (!response.ok) {
          throw new Error("Could not retrieve time entries")
        }

        const data = await response.json()

        setTimeEntries(normalizeTimeEntries(data.data || []))
      } catch (error) {
        setError(error.message)
      }
    }

    fetchTimeEntries()
  }, [])

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-heading">
          <p className="eyebrow">TIME TRACKING</p>
          <h1>ClickUp Time Tracker</h1>
          <p className="subtitle">
            Track and understand where your team's time is going.
          </p>
        </div>
        <span className="header-badge">Weekly overview</span>
      </header>

      <nav className="tab-navigation" aria-label="Dashboard sections">
        <button
          className={activeTab === "time" ? "tab-button active" : "tab-button"}
          aria-current={activeTab === "time" ? "page" : undefined}
          onClick={() => setActiveTab("time")}
        >
          Time Tracking
        </button>
        <button
          className={activeTab === "archive" ? "tab-button active" : "tab-button"}
          aria-current={activeTab === "archive" ? "page" : undefined}
          onClick={() => setActiveTab("archive")}
        >
          Archived Clients
        </button>
        <button
          className={activeTab === "ai" ? "tab-button active" : "tab-button"}
          aria-current={activeTab === "ai" ? "page" : undefined}
          onClick={() => setActiveTab("ai")}
        >
          AI Agents
        </button>
      </nav>

      {activeTab === "archive" && <ArchiveDashboard />}

      {/* Kept mounted so the key and estimates survive switching tabs */}
      <div hidden={activeTab !== "ai"}>
        <AiEstimator />
      </div>

      {activeTab === "time" && (
      <>
      <section className="summary-grid" aria-label="Time summary">
        <div className="summary-card">
          <p className="summary-label">Total Time</p>
          <p className="summary-value">
            {formatDuration(totalTime)}
          </p>
        </div>

        <div className="summary-card">
          <p className="summary-label">Billable Time</p>
          <p className="summary-value">
            {formatDuration(billableTime)}
          </p>
        </div>

        <div className="summary-card">
          <p className="summary-label">Non-Billable Time</p>
          <p className="summary-value">
            {formatDuration(nonBillableTime)}
          </p>
        </div>
      </section>
      <section className="filter-section panel">
        <div className="section-header">
          <div>
            <p className="section-kicker">REFINE YOUR VIEW</p>
            <h2>Filters</h2>
          </div>
        </div>

        <div className="filter-bar">
          <div className="filter-control">
            <label htmlFor="date-filter">Date</label>

            <select
              id="date-filter"
              value={dateFilter}
              onChange={(event) =>
                setDateFilter(event.target.value)
              }
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          </div>

          <div className="filter-control">
            <label htmlFor="client-filter">Client</label>

            <select
              id="client-filter"
              value={clientFilter}
              onChange={(event) =>
                setClientFilter(event.target.value)
              }
            >
              <option value="all">All Clients</option>

              {clients.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-control">
            <label htmlFor="user-filter">People</label>

            <select
              id="user-filter"
              value={userFilter}
              onChange={(event) =>
                setUserFilter(event.target.value)
              }
            >
              <option value="all">Everyone</option>

              {users.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
      <section className="capacity-card panel" aria-labelledby="capacity-title">
        <div className="capacity-header">
          <div>
            <p className="section-kicker">COMPANY-WIDE · THIS WEEK</p>
            <h2 id="capacity-title">Team capacity</h2>
            <p className="capacity-description">
              Weekly capacity is 40 hours per person, with an 80% billable target.
            </p>
          </div>
          <div className="team-size-control">
            <label htmlFor="team-size">Team members</label>
            <input
              id="team-size"
              type="number"
              min="0"
              step="1"
              value={teamSize}
              onChange={(event) => {
                const value = Number(event.target.value)
                setTeamSize(
                  Number.isInteger(value) && value >= 0 ? value : 0
                )
              }}
            />
          </div>
        </div>
        {teamSize === 0 ? (
          <p className="capacity-empty">
            Enter your team size to calculate company capacity.
          </p>
        ) : (
          <>
            <div className="capacity-summary">
              <span>
                <strong>{formatDuration(weeklyUtilizedTime)}</strong> utilized
                {weeklyOverCapacityTime > 0 && (
                  <em className="over-capacity">
                    {formatDuration(weeklyOverCapacityTime)} over capacity
                  </em>
                )}
              </span>
              <span>
                <strong>{formatDuration(weeklyRemainingTime)}</strong> remaining
              </span>
              <span>
                <strong>{formatDuration(weeklyCapacityMilliseconds)}</strong>{" "}
                total capacity
              </span>
            </div>
            <div
              className="capacity-track"
              role="progressbar"
              aria-label="Weekly company capacity utilized"
              aria-valuemin="0"
              aria-valuemax={weeklyCapacityMilliseconds}
              aria-valuenow={Math.min(weeklyUtilizedTime, weeklyCapacityMilliseconds)}
              aria-valuetext={`${formatDuration(weeklyUtilizedTime)} utilized of ${formatDuration(weeklyCapacityMilliseconds)} capacity`}
            >
              <div
                className="capacity-fill"
                style={{ width: `${utilizationPercent}%` }}
              />
            </div>
            <div className="billable-progress">
              <div className="billable-progress-copy">
                <span>Billable hours</span>
                <span>
                  {formatDuration(weeklyBillableTime)} /{" "}
                  {formatDuration(weeklyBillableTargetMilliseconds)} target
                </span>
              </div>
              <div
                className="billable-track"
                role="progressbar"
                aria-label="Progress toward the weekly billable-hours target"
                aria-valuemin="0"
                aria-valuemax={weeklyBillableTargetMilliseconds}
                aria-valuenow={Math.min(
                  weeklyBillableTime,
                  weeklyBillableTargetMilliseconds
                )}
                aria-valuetext={`${formatDuration(weeklyBillableTime)} billable of ${formatDuration(weeklyBillableTargetMilliseconds)} target`}
              >
                <div
                  className="billable-fill"
                  style={{ width: `${billableTargetPercent}%` }}
                />
              </div>
            </div>
          </>
        )}
      </section>
      <div className="section-heading">
        <div>
          <p className="section-kicker">TIME BREAKDOWN</p>
          <h2>Projects</h2>
        </div>
        <span className="entry-count">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>
      </div>
      {timeEntries.length === 0 && (
        <p className="empty-state">
          ClickUp returned no time entries. Time totals and project breakdowns
          will appear here once time entries are available.
        </p>
      )}
      <div className="table-container">
         <table>
          <thead>
            <tr>
              <th>Client / Project</th>
              <th>Total Time</th>
              <th>Billable Time</th>
              <th>Non-Billable Time</th>
            </tr>
          </thead>

          <tbody>
            {projects.map((project) => {
              const projectEntries = entriesWithParents.filter(
               (entry) => entry.spaceId === project.id
              )

              return (
                <Fragment key={project.id}>
                  <tr key={project.id}>
                    <td>{project.name}</td>

                    <td>{formatDuration(project.total)}</td>

                    <td>{formatDuration(project.billable)}</td>

                    <td>{formatDuration(project.nonBillable)}</td>
                  </tr>

                  {projectEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ paddingLeft: "40px" }}>
                        {entry.taskName}
                      </td>

                      <td>{formatDuration(entry.duration)}</td>

                      <td>
                        {entry.billable ? "Billable" : "Non-billable"}
                      </td>

                      <td></td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Error message */}
      {error && <p className="error-message" role="alert">Error: {error}</p>}

      {/* Time Entries */}
      <div className="section-heading time-entries-heading">
        <div>
          <p className="section-kicker">DETAILED ACTIVITY</p>
          <h2>Time Entries</h2>
        </div>
        <span className="entry-count">
          {filteredTimeEntries.length}{" "}
          {filteredTimeEntries.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <ul className="time-entry-list">
        {filteredTimeEntries.map((entry) => (
          <li key={entry.id}>
            <span className="time-entry-task">{entry.parentTaskName}</span>
            <span>{entry.userName}</span>
            <span>{formatDuration(entry.duration)}</span>
            <span className={entry.billable ? "billable-tag" : "non-billable-tag"}>
              {entry.billable ? "Billable" : "Non-billable"}
            </span>
          </li>
        ))}
      </ul>
      </>
      )}
    </div>
  )
}

export default App