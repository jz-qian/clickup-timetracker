import { useEffect, useState } from "react"

// Organize flat task data into parent tasks with their subtasks
function organizeTasks(tasks) {
  const parentTasks = tasks.filter((task) => !task.parent)

  return parentTasks.map((task) => ({
    ...task,
    subtasks: tasks.filter(
      (subtask) => subtask.parent === task.id
    ),
  }))
}

function App() {
  // --------------------------------------------------
  // State
  // --------------------------------------------------

  const [spaces, setSpaces] = useState([])
  const [lists, setLists] = useState([])
  const [tasks, setTasks] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [error, setError] = useState(null)

  // --------------------------------------------------
  // Fetch Spaces
  // --------------------------------------------------

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

        setTimeEntries(data.data || [])
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
    <div>
      <h1>ClickUp Time Tracker</h1>

      {/* Error message */}
      {error && <p>Error: {error}</p>}

      {/* Time Entries */}
      <h2>Time Entries</h2>

      <ul>
        {timeEntries.map((entry) => (
          <li key={entry.id}>
            {entry.task?.name} — {entry.duration} ms —{" "}
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