import DayTimeline from "./DayTimeline.jsx"

// Non-admin app for individual team members
function TeamMemberApp({ onSignOut }) {
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-heading">
          <p className="eyebrow">TIME TRACKING</p>
          <h1>My Day</h1>
        </div>
        <div className="header-actions">
          <span className="header-badge">Team member</span>
          <button className="sign-out-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="team-timeline-wrapper">
        <DayTimeline />
      </div>
    </div>
  )
}

export default TeamMemberApp
