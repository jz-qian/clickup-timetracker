import { useEffect, useState } from "react"

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

// --------------------------------------------------
// Tabs
// --------------------------------------------------

const TABS = [
  { id: "time", label: "Time Tracking" },
  { id: "archive", label: "Client Archive" },
]

// The active tab lives in the URL hash so #archive can be bookmarked
// or opened in its own browser tab.
function getTabFromHash() {
  const id = window.location.hash.slice(1)
  return TABS.some((tab) => tab.id === id) ? id : "time"
}

// --------------------------------------------------
// Client Archive dashboard
// --------------------------------------------------

function formatHours(hours) {
  return formatDuration(hours * 3600000)
}

function formatDate(isoDate) {
  if (!isoDate) {
    return "—"
  }

  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function formatDaysMoved(days) {
  if (days === null || days === undefined) {
    return "—"
  }

  if (days === 0) {
    return "Same day"
  }

  const label = Math.abs(days) === 1 ? "day" : "days"
  return days > 0 ? `+${days} ${label}` : `${days} ${label}`
}

function ArchivedClientCard({ client }) {
  return (
    <details className="archive-client">
      <summary>
        <div className="archive-client-title">
          <h3>{client.name}</h3>
          <p>
            {formatDate(client.first_activity)} –{" "}
            {formatDate(client.last_activity)}
          </p>
        </div>

        <dl className="archive-client-stats">
          <div>
            <dt>Hours</dt>
            <dd>{formatHours(client.hours)}</dd>
          </div>
          <div>
            <dt>Billable</dt>
            <dd>{formatHours(client.billable_hours)}</dd>
          </div>
          <div>
            <dt>Tasks done</dt>
            <dd>
              {client.completed_task_count}/{client.task_count}
            </dd>
          </div>
          <div>
            <dt>People</dt>
            <dd>{client.people.length}</dd>
          </div>
          <div>
            <dt>Moved deadlines</dt>
            <dd>{client.moved_deadline_count}</dd>
          </div>
        </dl>
      </summary>

      <div className="archive-client-body">
        <h4>People and roles</h4>

        {client.people.length === 0 ? (
          <p className="archive-muted">No one logged time or was assigned tasks.</p>
        ) : (
          <div className="table-scroll">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th className="numeric">Tasks</th>
                  <th className="numeric">Hours</th>
                  <th className="numeric">Billable</th>
                  <th>Share of hours</th>
                </tr>
              </thead>

              <tbody>
                {client.people.map((person) => (
                  <tr key={person.id}>
                    <td>
                      {person.name}
                      {person.is_top_contributor && (
                        <span className="badge">Top contributor</span>
                      )}
                      {person.email && (
                        <span className="archive-muted archive-email">
                          {person.email}
                        </span>
                      )}
                    </td>
                    <td>{person.actual_role || person.workspace_role}</td>
                    <td className="numeric">{person.tasks_assigned}</td>
                    <td className="numeric">{formatHours(person.hours)}</td>
                    <td className="numeric">
                      {formatHours(person.billable_hours)}
                    </td>
                    <td>
                      <div className="share">
                        <div className="share-track">
                          <div
                            className="share-fill"
                            style={{ width: `${person.share_of_hours * 100}%` }}
                          />
                        </div>
                        <span>{Math.round(person.share_of_hours * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h4>Moved and late deadlines</h4>

        {client.deadline_changes.length === 0 ? (
          <p className="archive-muted">No deadlines were moved or missed.</p>
        ) : (
          <div className="table-scroll">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Original due</th>
                  <th>Final due</th>
                  <th className="numeric">Moved</th>
                  <th>Completed</th>
                </tr>
              </thead>

              <tbody>
                {client.deadline_changes.map((change) => (
                  <tr key={change.task_id}>
                    <td>
                      {change.url ? (
                        <a href={change.url} target="_blank" rel="noreferrer">
                          {change.task_name}
                        </a>
                      ) : (
                        change.task_name
                      )}
                      {change.list_name && (
                        <span className="archive-muted archive-email">
                          {change.list_name}
                        </span>
                      )}
                      {change.change_log.length > 0 && (
                        <ul className="change-log">
                          {change.change_log.map((entry, index) => (
                            <li key={index}>
                              {formatDate(entry.changed_at)}:{" "}
                              {formatDate(entry.from)} → {formatDate(entry.to)}
                              {entry.changed_by && ` by ${entry.changed_by}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>{formatDate(change.original_due_date)}</td>
                    <td>{formatDate(change.current_due_date)}</td>
                    <td className="numeric">
                      {formatDaysMoved(change.days_moved)}
                      {change.times_moved > 1 && (
                        <span className="archive-muted archive-email">
                          {change.times_moved} times
                        </span>
                      )}
                    </td>
                    <td>
                      {formatDate(change.completed_date)}
                      {change.finished_late && (
                        <span className="badge badge-late">Late</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  )
}

function ArchiveDashboard() {
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState("")
  const [refreshCount, setRefreshCount] = useState(0)

  useEffect(() => {
    let ignore = false

    const fetchDashboard = async () => {
      try {
        const response = await fetch(
          "http://127.0.0.1:8000/archive-dashboard"
        )

        if (!response.ok) {
          throw new Error("Could not retrieve the client archive")
        }

        const data = await response.json()

        if (!ignore) {
          setDashboard(data)
          setError(null)
        }
      } catch (error) {
        if (!ignore) {
          setError(error.message)
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    fetchDashboard()

    return () => {
      ignore = true
    }
  }, [refreshCount])

  const refresh = () => {
    setLoading(true)
    setRefreshCount((count) => count + 1)
  }

  const clients = (dashboard?.clients || []).filter((client) =>
    client.name.toLowerCase().includes(search.trim().toLowerCase())
  )

  return (
    <>
      <div className="section-header archive-toolbar">
        <h2>Past Clients</h2>

        <div className="archive-actions">
          <input
            type="search"
            placeholder="Search clients"
            aria-label="Search clients"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <button
            type="button"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <p className="archive-notice archive-error">Error: {error}</p>}

      {loading && !dashboard && (
        <p className="archive-muted">
          Loading archived clients. This can take a minute because every
          archived list and task is fetched from ClickUp.
        </p>
      )}

      {dashboard && (
        <>
          {dashboard.time_entries_scope === "current_user_only" && (
            <p className="archive-notice">
              Hours only include your own time entries. An Owner or Admin
              ClickUp token is needed to see everyone's hours.
            </p>
          )}

          <section className="summary-grid archive-summary">
            <div className="summary-card">
              <p className="summary-label">Past Clients</p>
              <p className="summary-value">{dashboard.totals.clients}</p>
            </div>

            <div className="summary-card">
              <p className="summary-label">Total Hours</p>
              <p className="summary-value">
                {formatHours(dashboard.totals.hours)}
              </p>
              <p className="summary-note">
                {formatHours(dashboard.totals.billable_hours)} billable
              </p>
            </div>

            <div className="summary-card">
              <p className="summary-label">People Involved</p>
              <p className="summary-value">{dashboard.totals.people}</p>
            </div>

            <div className="summary-card">
              <p className="summary-label">Moved Deadlines</p>
              <p className="summary-value">
                {dashboard.totals.moved_deadlines}
              </p>
              <p className="summary-note">
                {dashboard.totals.late_tasks} finished late
              </p>
            </div>
          </section>

          {dashboard.clients.length === 0 ? (
            <p className="archive-muted">No archived clients found in ClickUp.</p>
          ) : clients.length === 0 ? (
            <p className="archive-muted">No clients match “{search}”.</p>
          ) : (
            <div className="archive-client-list">
              {clients.map((client) => (
                <ArchivedClientCard key={client.id} client={client} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
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

  const [activeTab, setActiveTab] = useState(getTabFromHash)
  // The archive tab is only mounted once it's first opened, since its
  // endpoint is slow, and then kept mounted so switching back is instant.
  const [archiveOpened, setArchiveOpened] = useState(
    () => getTabFromHash() === "archive"
  )

  useEffect(() => {
    const handleHashChange = () => {
      const tab = getTabFromHash()
      setActiveTab(tab)

      if (tab === "archive") {
        setArchiveOpened(true)
      }
    }

    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])

  // --------------------------------------------------
  // Fetch Spaces
  // --------------------------------------------------
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
    const now = new Date()

    if (dateFilter === "today") {
      return (
        entryDate.getFullYear() === now.getFullYear() &&
        entryDate.getMonth() === now.getMonth() &&
        entryDate.getDate() === now.getDate()
      )
    }

    if (dateFilter === "week") {
      const startOfWeek = new Date(now)
      const day = startOfWeek.getDay()

      startOfWeek.setDate(
        startOfWeek.getDate() - day
      )
      startOfWeek.setHours(0, 0, 0, 0)

      return entryDate >= startOfWeek
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
        <div>
          <p className="eyebrow">TIME TRACKING</p>
          <h1>ClickUp Time Tracker</h1>
          <p className="subtitle">
            Track and understand where your team's time is going.
          </p>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Dashboard views">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            className="tab"
            onClick={() => {
              window.location.hash = tab.id
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div
        role="tabpanel"
        id="panel-time"
        aria-labelledby="tab-time"
        hidden={activeTab !== "time"}
      >
     <section className="summary-grid">
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
      <section className="filter-section">
        <div className="section-header">
          <h2>Filters</h2>
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
      <h2>Projects</h2>
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
                <>
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
                </>
              )
            })}
          </tbody>
        </table>
      {/* Error message */}
      {error && <p>Error: {error}</p>}

      {/* Time Entries */}
      <h2>Time Entries</h2>

      <ul>
        {filteredTimeEntries.map((entry) => (
          <li key={entry.id}>
            {entry.parentTaskName} — {formatDuration(entry.duration)} —{" "}
            {entry.billable ? "Billable" : "Non-billable"}
          </li>
        ))}
      </ul>

      {/* Loading state */}
      {!error && spaces.length === 0 && (
        <p>Loading Spaces...</p>
      )}

      {/* Space → List → Task → Subtask hierarchy */}
      {spaces.length > 0 && (
        <div>
          {spaces.map((space) => {
            const spaceLists = lists.filter(
              (list) => list.spaceId === space.id
            )

            return (
              <div key={space.id}>
                <h2>
                  {space.name} — Space ID: {space.id}
                </h2>

                {spaceLists.map((list) => {
                  const listTasks = tasks.filter(
                    (task) => task.listId === list.id
                  )

                  return (
                    <div key={list.id}>
                      <h3>
                        {list.name} — List ID: {list.id}
                      </h3>

                      <ul>
                        {listTasks.map((task) => (
                          <li key={task.id}>
                            {task.name} — Task ID: {task.id}

                            {task.subtasks.length > 0 && (
                              <ul>
                                {task.subtasks.map((subtask) => (
                                  <li key={subtask.id}>
                                    {subtask.name} — Subtask ID:{" "}
                                    {subtask.id}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
      </div>

      {archiveOpened && (
        <div
          role="tabpanel"
          id="panel-archive"
          aria-labelledby="tab-archive"
          hidden={activeTab !== "archive"}
        >
          <ArchiveDashboard />
        </div>
      )}
    </div>
  )
}

export default App