import { useCallback, useEffect, useRef, useState } from "react"

// Records when this computer was in use, as { start, end } spans in
// milliseconds, so the day timeline can draw them.
//
// A span runs from the first activity until 10 minutes pass with none.
// Those last idle 10 minutes are cut off, so the span ends at the last
// activity. Activity again after that starts a new span.
//
// A web page can't watch the whole computer on its own. Where the browser
// supports the Idle Detection API (Chrome, Edge) and the user allows it,
// we use it to learn whether the user is active anywhere on the computer
// and whether the screen is locked. Otherwise we fall back to input on
// this page (mouse, keyboard, touch, scroll). Either way, activity is only
// recorded while this app is open in a tab.

const STORAGE_KEY = "clickup-time-tracker-activity"
const MINUTE = 60 * 1000
// This long with no activity ends a span; activity closer together than
// this joins into one span
const IDLE_LIMIT = 10 * MINUTE
const MERGE_GAP = IDLE_LIMIT
// How long without input before the Idle Detection API reports "idle"
const IDLE_THRESHOLD = IDLE_LIMIT
// While the system reports "active", extend the current span this often
const HEARTBEAT = 30 * 1000
// Throttle for page input events, which can fire many times a second
const INPUT_THROTTLE = 5 * 1000
const KEEP_FOR = 30 * 24 * 60 * MINUTE
const PAGE_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"]

// Sort spans and join any that overlap or sit within MERGE_GAP of each other
function mergeSpans(spans) {
  const sorted = spans
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end))
    .sort((a, b) => a.start - b.start)
  const merged = []

  sorted.forEach((span) => {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end + MERGE_GAP) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ start: span.start, end: Math.max(span.start, span.end) })
    }
  })

  return merged
}

function loadSpans() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]")
    return Array.isArray(stored) ? mergeSpans(stored) : []
  } catch {
    return []
  }
}

// Merge with what's stored so other open tabs don't overwrite each other
function saveSpans(spans) {
  const cutoff = Date.now() - KEEP_FOR
  const merged = mergeSpans([...loadSpans(), ...spans]).filter(
    (span) => span.end >= cutoff
  )

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // Storage blocked; activity just won't survive a reload
  }

  return merged
}

function supportsIdleDetection() {
  return typeof window !== "undefined" && "IdleDetector" in window
}

// Returns the recorded spans and how activity is being detected:
// "system" (Idle Detection API) or "page" (input on this page only).
// `enableSystemTracking` asks for Idle Detection permission and must be
// called from a click; the first click or key press on the page also asks.
export function useActivityLog() {
  // Opening the page while it has focus counts as activity
  const [spans, setSpans] = useState(() => {
    const now = Date.now()
    return document.visibilityState === "visible" && document.hasFocus()
      ? saveSpans([{ start: now, end: now }])
      : loadSpans()
  })
  const [source, setSource] = useState("page")
  const [permission, setPermission] = useState(
    supportsIdleDetection() ? "prompt" : "unsupported"
  )
  const lastMarkRef = useRef(0)
  const enableSystemTrackingRef = useRef(() => {})
  const detectorAbortRef = useRef(null)

  // Record that the computer was in use at `time`
  const markActive = useCallback((time = Date.now()) => {
    lastMarkRef.current = time
    setSpans(saveSpans([{ start: time, end: time }]))
  }, [])

  // Pull the end of the latest span back to `time`, for when the system
  // reports idle after IDLE_THRESHOLD with no input. This cuts the idle
  // minutes off the end of the span.
  const trimTo = useCallback((time) => {
    setSpans(() => {
      const current = loadSpans()
      const last = current[current.length - 1]
      if (last && last.end > time) {
        last.end = Math.max(last.start, time)
      }

      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
      } catch {
        // Storage blocked
      }

      return current
    })
  }, [])

  // Fallback: input on this page counts as activity
  useEffect(() => {
    const onInput = () => {
      const now = Date.now()
      if (now - lastMarkRef.current >= INPUT_THROTTLE) {
        markActive(now)
      }
    }

    PAGE_EVENTS.forEach((type) =>
      window.addEventListener(type, onInput, { passive: true })
    )
    return () =>
      PAGE_EVENTS.forEach((type) => window.removeEventListener(type, onInput))
  }, [markActive])

  // Pick up activity recorded by other tabs
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) {
        setSpans(loadSpans())
      }
    }

    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const startSystemTracking = useCallback(async () => {
    if (detectorAbortRef.current) return

    const controller = new AbortController()
    const detector = new window.IdleDetector()
    let heartbeat = null

    const update = () => {
      window.clearInterval(heartbeat)
      heartbeat = null

      if (detector.userState === "active" && detector.screenState === "unlocked") {
        markActive()
        heartbeat = window.setInterval(() => markActive(), HEARTBEAT)
      } else {
        trimTo(Date.now() - IDLE_THRESHOLD)
      }
    }

    controller.signal.addEventListener("abort", () => window.clearInterval(heartbeat))
    detector.addEventListener("change", update)

    try {
      await detector.start({ threshold: IDLE_THRESHOLD, signal: controller.signal })
      detectorAbortRef.current = controller
      setSource("system")
      update()
    } catch {
      controller.abort()
    }
  }, [markActive, trimTo])

  // Ask for Idle Detection permission on the first click or key press,
  // since the browser only shows the prompt in response to one
  useEffect(() => {
    if (permission !== "prompt") return

    const onGesture = () => {
      remove()
      enableSystemTrackingRef.current()
    }
    const remove = () => {
      window.removeEventListener("pointerdown", onGesture)
      window.removeEventListener("keydown", onGesture)
    }

    window.addEventListener("pointerdown", onGesture)
    window.addEventListener("keydown", onGesture)
    return remove
  }, [permission])

  // Start system tracking right away if permission was granted before
  useEffect(() => {
    if (!supportsIdleDetection() || !navigator.permissions?.query) return

    let cancelled = false
    navigator.permissions
      .query({ name: "idle-detection" })
      .then((status) => {
        if (cancelled) return
        setPermission(status.state)
        if (status.state === "granted") {
          startSystemTracking()
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [startSystemTracking])

  useEffect(() => () => detectorAbortRef.current?.abort(), [])

  const enableSystemTracking = useCallback(async () => {
    if (!supportsIdleDetection()) return

    try {
      const state = await window.IdleDetector.requestPermission()
      setPermission(state)
      if (state === "granted") {
        startSystemTracking()
      }
    } catch {
      setPermission("denied")
    }
  }, [startSystemTracking])

  useEffect(() => {
    enableSystemTrackingRef.current = enableSystemTracking
  }, [enableSystemTracking])

  return { spans, source, permission, enableSystemTracking }
}
