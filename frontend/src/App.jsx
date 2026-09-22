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
  )
}

export default App