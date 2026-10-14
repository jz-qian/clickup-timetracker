import { useState } from "react"
import AccessGate from "./AccessGate.jsx"
import AdminApp from "./AdminApp.jsx"
import TeamMemberApp from "./TeamMemberApp.jsx"

const ROLE_STORAGE_KEY = "clickup-time-tracker-role"

// Remember the role for this browser tab only
function loadRole() {
  try {
    const role = window.sessionStorage.getItem(ROLE_STORAGE_KEY)
    return role === "admin" || role === "member" ? role : null
  } catch {
    return null
  }
}

function saveRole(role) {
  try {
    if (role) {
      window.sessionStorage.setItem(ROLE_STORAGE_KEY, role)
    } else {
      window.sessionStorage.removeItem(ROLE_STORAGE_KEY)
    }
  } catch {
    // Storage blocked; the role just won't survive a reload
  }
}

function App() {
  const [role, setRole] = useState(loadRole)

  const changeRole = (nextRole) => {
    saveRole(nextRole)
    setRole(nextRole)
  }

  if (role === "admin") {
    return <AdminApp onSignOut={() => changeRole(null)} />
  }

  if (role === "member") {
    return <TeamMemberApp onSignOut={() => changeRole(null)} />
  }

  return <AccessGate onEnter={changeRole} />
}

export default App
