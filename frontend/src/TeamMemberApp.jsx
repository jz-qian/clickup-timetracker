import DayTimeline from "./DayTimeline.jsx"

// Non-admin app for individual team members
function TeamMemberApp({ onSignOut }) {
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-heading">
          <p className="eyebrow">TIME TRACKING</p>
          <h1>My Day</h1>
          <p className="subtitle">See and plan where your time goes today.</p>
        </div>
        <div className="header-actions">
          <span className="header-badge">Team member</span>
          <button className="sign-out-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <DayTimeline />
    </div>
  )
}

export default TeamMemberApp
