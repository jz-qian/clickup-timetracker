import { useEffect, useState } from "react"
import { fromISODate, mondayOf } from "./calendarUtils.js"

const PREFERENCE_LABELS = {
  up: "↑ Open to more",
  down: "↓ Fewer",
  same: "– Happy as is",
}
const SYMBOLS = { up: "↑", down: "↓", same: "–" }

function shortDate(isoDate) {
  return fromISODate(isoDate).toLocaleDateString([], { month: "short", day: "numeric" })
}

// Admin view: each team member's logged hours next to their answer to
// the weekly "Want more tasks?" question, this week and the weeks before.
function TeamCapacity() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    // This week is the admin's local Monday-to-Sunday week
    fetch(`http://127.0.0.1:8000/admin/team-capacity?week_start=${mondayOf(new Date())}`)
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

      <h3>Want more tasks? · Week of {shortDate(data.question_week_start)}</h3>
      <p>Team members: {summary.members}</p>
      <p>↑ Open to more: {summary.open_to_more}</p>
      <p>↓ Fewer: {summary.not_open_to_more}</p>
      <p>– Happy as is: {summary.no_change ?? 0}</p>
      <p>No answer yet this week: {summary.no_response}</p>

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
              <th>More Tasks? (This Week)</th>
              <th>Last Week</th>
              <th>Earlier Weeks</th>
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
                <td>{PREFERENCE_LABELS[person.preference] || "No answer yet"}</td>
                <td>{PREFERENCE_LABELS[person.last_week_preference] || "—"}</td>
                <td>
                  {/* Oldest to newest, one symbol per week; · means no answer */}
                  <span
                    className="capacity-history"
                    title={(person.history || [])
                      .map(
                        (week) =>
                          `${shortDate(week.week_start)}: ${
                            PREFERENCE_LABELS[week.preference] || "no answer"
                          }`
                      )
                      .join("\n")}
                  >
                    {(person.history || [])
                      .map((week) => SYMBOLS[week.preference] || "·")
                      .join(" ")}
                  </span>
                </td>
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
