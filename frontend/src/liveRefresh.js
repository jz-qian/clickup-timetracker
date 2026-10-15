import { useEffect, useRef } from "react"

// How often open pages re-check ClickUp. ClickUp allows about 100 API
// calls a minute per token, shared by everyone using the app, so this
// stays well under that even with several people signed in.
export const LIVE_REFRESH_INTERVAL = 30 * 1000

// Calls `refresh` every LIVE_REFRESH_INTERVAL while the page is visible,
// and straight away when you come back to the tab or window. Hidden tabs
// don't poll, so they don't use up ClickUp's rate limit.
//
// This is how changes made in ClickUp (a new deadline, a task assigned
// to you, time logged there) show up without reloading. ClickUp can push
// changes with webhooks instead, but only to a public web address, not a
// backend running on localhost.
export function useLiveRefresh(refresh) {
  const refreshRef = useRef(refresh)

  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    let lastRun = Date.now()
    const run = () => {
      if (document.visibilityState !== "visible") return
      lastRun = Date.now()
      refreshRef.current()
    }

    const timer = window.setInterval(run, LIVE_REFRESH_INTERVAL)
    // Coming back after a while: refresh now rather than at the next tick
    const onReturn = () => {
      if (Date.now() - lastRun > 5 * 1000) run()
    }

    document.addEventListener("visibilitychange", onReturn)
    window.addEventListener("focus", onReturn)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onReturn)
      window.removeEventListener("focus", onReturn)
    }
  }, [])
}
