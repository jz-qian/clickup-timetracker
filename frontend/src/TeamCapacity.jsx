import { useEffect, useState } from "react"

const PREFERENCE_LABELS = {
  up: "↑ Open to more hours",
  down: "↓ Not open to more hours",
}

// Admin view: each team member's logged hours next to their latest
// up/down answer on whether they're open to more hours.
function TeamCapacity() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch("http://127.0.0.1:8000/admin/team-capacity")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not retrieve team capacity")
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
    return <p>Loading team capacity...</p>
  }

  const { summary, people } = data

  return (
    <div>
      <h2>Team Capacity</h2>

      <h3>Summary</h3>
      <p>Team members: {summary.members}</p>
      <p>↑ Open to more hours: {summary.open_to_more}</p>
      <p>↓ Not open to more hours: {summary.not_open_to_more}</p>
      <p>No response yet: {summary.no_response}</p>

      <h3>Team Members</h3>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>This Week (since {data.week_start})</th>
              <th>Last 30 Days</th>
              <th>All Time</th>
              <th>More Hours?</th>
              <th>Note</th>
              <th>Answered</th>
            </tr>
          </thead>

          <tbody>
            {people.map((person) => (
              <tr key={person.clickup_user_id}>
                <td>{person.name}</td>
                <td>{person.role || "—"}</td>
                <td>{person.hours_this_week}h</td>
                <td>{person.hours_last_30_days}h</td>
                <td>{person.hours_all_time}h</td>
                <td>{PREFERENCE_LABELS[person.preference] || "No response"}</td>
                <td>{person.note || "—"}</td>
                <td>
                  {person.submitted_at
                    ? new Date(person.submitted_at).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default TeamCapacity
