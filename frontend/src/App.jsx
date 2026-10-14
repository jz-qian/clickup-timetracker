import { useCallback, useState } from "react"
import AccessGate from "./AccessGate.jsx"
import { apiFetch, loadMemberSession, saveMemberSession } from "./api.js"
import AdminApp from "./AdminApp.jsx"
import TeamMemberApp from "./TeamMemberApp.jsx"

const ROLE_STORAGE_KEY = "clickup-time-tracker-role"

// Remember the admin role for this browser tab only. Team members stay
// signed in through their session token instead (see api.js).
function loadRole() {
  try {
    const role = window.sessionStorage.getItem(ROLE_STORAGE_KEY)
    return role === "admin" ? role : null
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
  const [memberSession, setMemberSession] = useState(loadMemberSession)

  const changeRole = (nextRole) => {
    saveRole(nextRole)
    setRole(nextRole)
  }

  const signInMember = useCallback((session) => {
    saveMemberSession(session)
    setMemberSession(session)
  }, [])

  const signOutMember = useCallback(() => {
    if (memberSession) {
      apiFetch("/auth/logout", { token: memberSession.token, method: "POST" }).catch(
        () => {}
      )
    }
    signInMember(null)
  }, [memberSession, signInMember])

  if (role === "admin") {
    return <AdminApp onSignOut={() => changeRole(null)} />
  }

  if (memberSession) {
    return <TeamMemberApp session={memberSession} onSignOut={signOutMember} />
  }

  return (
    <AccessGate
      onMemberSignIn={signInMember}
      onAdminSignIn={() => changeRole("admin")}
    />
  )
}

export default App
