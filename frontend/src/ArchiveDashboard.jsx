import { useEffect, useState } from "react"

// Line-by-line view of GET /archive-dashboard (archived clients summary)
function ArchiveDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch("http://127.0.0.1:8000/archive-dashboard")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not retrieve archive dashboard")
        }

        return response.json()
      })
      .then(setData)
      .catch((error) => {
        setError(error.message)
      })
  }, [])

  if (error) {
    return <p>Error: {error}</p>
  }

  if (!data) {
    return <p>Loading archive dashboard...</p>
  }

  const { totals, clients } = data

  return (
    <div>
      <h2>Archived Clients</h2>

      <p>Generated: {new Date(data.generated_at).toLocaleString()}</p>
      {data.time_entries_scope === "current_user_only" && (
        <p>
          Note: hours only include your own time entries (an admin
          token is needed to see everyone's).
        </p>
      )}

      <h3>Totals</h3>
      <p>Clients: {totals.clients}</p>
      <p>Tasks: {totals.tasks}</p>
      <p>Hours: {totals.hours}</p>
      <p>Billable hours: {totals.billable_hours}</p>
      <p>People: {totals.people}</p>
      <p>Moved deadlines: {totals.moved_deadlines}</p>
      <p>Late tasks: {totals.late_tasks}</p>

      {clients.map((client) => (
        <div key={client.id}>
          <h3>{client.name}</h3>

          <p>
            Active: {client.first_activity || "—"} to{" "}
            {client.last_activity || "—"}
          </p>
          <p>Lists: {client.lists.join(", ") || "None"}</p>
          <p>
            Tasks: {client.task_count} ({client.completed_task_count}{" "}
            completed)
          </p>
          <p>
            Hours: {client.hours} ({client.billable_hours} billable,{" "}
            {client.non_billable_hours} non-billable)
          </p>
          <p>Hours tracked on tasks: {client.task_tracked_hours}</p>
          <p>Moved deadlines: {client.moved_deadline_count}</p>
          <p>Late tasks: {client.late_task_count}</p>

          <h4>People</h4>
          {client.people.length === 0 && <p>None</p>}
          {client.people.map((person) => (
            <p key={person.id}>
              {person.name}
              {person.is_top_contributor && " (top contributor)"} —{" "}
              {person.actual_role || person.workspace_role} —{" "}
              {person.hours}h ({person.billable_hours}h billable,{" "}
              {Math.round(person.share_of_hours * 100)}% of hours) —{" "}
              {person.tasks_assigned} tasks assigned
            </p>
          ))}

          <h4>Deadline Changes</h4>
          {client.deadline_changes.length === 0 && <p>None</p>}
          {client.deadline_changes.map((deadline) => (
            <p key={deadline.task_id}>
              {deadline.task_name}
              {deadline.list_name && ` (${deadline.list_name})`} — due{" "}
              {deadline.original_due_date || "?"} →{" "}
              {deadline.current_due_date || "?"}
              {deadline.days_moved !== null &&
                ` (${deadline.days_moved} days)`}
              {deadline.times_moved > 0 &&
                ` — moved ${deadline.times_moved}x`}
              {deadline.finished_late &&
                ` — finished late on ${deadline.completed_date}`}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

export default ArchiveDashboard
