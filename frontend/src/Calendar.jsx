import { useCallback, useEffect, useRef, useState } from "react"
import { useActivityLog } from "./activityLog.js"
import { apiFetch } from "./api.js"
import { useLiveRefresh } from "./liveRefresh.js"
import {
  MINUTE,
  addDays,
  addMonths,
  daysInView,
  endOfDay,
  isSameDay,
  roundTo,
  startOfDay,
} from "./calendarUtils.js"
import MonthGrid from "./MonthGrid.jsx"
import TimeBlockPopover from "./TimeBlockPopover.jsx"
import TimeGrid, { DEFAULT_POINT_X, DRAFT_ID } from "./TimeGrid.jsx"

const VIEWS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
]
const VIEW_STORAGE_KEY = "clickup-time-tracker-calendar-view"
// How long the "Entry deleted · Undo" notice stays up
const UNDO_TIMEOUT = 8000

function loadView() {
  try {
    const view = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return VIEWS.some((option) => option.value === view) ? view : "day"
  } catch {
    return "day"
  }
}

function saveView(view) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // Storage blocked; the view just resets on reload
  }
}

// Heading for the shown range
function rangeTitle(view, days, anchor) {
  if (view === "day") {
    return {
      kicker: anchor.toLocaleDateString([], { weekday: "long" }).toUpperCase(),
      title: anchor.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }),
    }
  }

  if (view === "week") {
    // e.g. "Oct 11 – 17, 2026" or "Sep 27 – Oct 3, 2026"
    const first = days[0]
    const last = days[days.length - 1]
    const month = (date) => date.toLocaleDateString([], { month: "short" })
    const end =
      first.getMonth() === last.getMonth()
        ? last.getDate()
        : `${month(last)} ${last.getDate()}`
    const startYear =
      first.getFullYear() === last.getFullYear() ? "" : `, ${first.getFullYear()}`
    return {
      kicker: "WEEK",
      title: `${month(first)} ${first.getDate()}${startYear} – ${end}, ${last.getFullYear()}`,
    }
  }

  return {
    kicker: "MONTH",
    title: anchor.toLocaleDateString([], { month: "long", year: "numeric" }),
  }
}

// The member's calendar, with day, week and month views like Google
// Calendar. Every entry is a ClickUp time entry on one of their tasks, so
// it counts everywhere ClickUp time does, including the admin dashboard.
// Their tasks' ClickUp deadlines show as all-day items.
function Calendar({ token, tasks = [], onUnauthorized }) {
  const [view, setView] = useState(loadView)
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [now, setNow] = useState(() => Date.now())
  const [blocks, setBlocks] = useState([])
  const [loadError, setLoadError] = useState(null)
  // The entry open in the popover ({ block, pointX }), or null
  const [editing, setEditing] = useState(null)
  // The last deleted entry, offered for undo
  const [deleted, setDeleted] = useState(null)
  const calendarRef = useRef(null)
  const activity = useActivityLog()

  const days = daysInView(view, anchor)
  const rangeStart = days[0].getTime()
  const rangeEnd = endOfDay(days[days.length - 1].getTime())
  const showsToday = now >= rangeStart && now < rangeEnd
  const heading = rangeTitle(view, days, anchor)

  const handleError = (error) => {
    if (error.status === 401) onUnauthorized?.()
    throw error
  }

  // Load the entries for the shown range. The ref guards against a slow
  // reply for a range we've since moved away from.
  const shownRangeRef = useRef(null)
  const loadBlocks = useCallback(() => {
    const range = `${rangeStart}-${rangeEnd}`
    shownRangeRef.current = range

    apiFetch(`/me/time-blocks?start=${rangeStart}&end=${rangeEnd}`, { token })
      .then((data) => {
        if (shownRangeRef.current !== range) return
        setBlocks(data.time_blocks)
        setLoadError(null)
      })
      .catch((error) => {
        if (shownRangeRef.current !== range) return
        if (error.status === 401) onUnauthorized?.()
        setLoadError(`Couldn't load your tracked time: ${error.message}`)
      })
  }, [rangeStart, rangeEnd, token, onUnauthorized])

  useEffect(loadBlocks, [loadBlocks])
  // Time logged or changed in ClickUp shows up without reloading
  useLiveRefresh(loadBlocks)

  // Keep the current-time line and running timers moving
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE)
    return () => window.clearInterval(timer)
  }, [])

  // The undo notice goes away on its own
  useEffect(() => {
    if (!deleted) return
    const timer = window.setTimeout(() => setDeleted(null), UNDO_TIMEOUT)
    return () => window.clearTimeout(timer)
  }, [deleted])

  const changeView = (nextView) => {
    saveView(nextView)
    setView(nextView)
    setEditing(null)
  }

  const step = (direction) => {
    setEditing(null)
    setAnchor((current) =>
      view === "month"
        ? addMonths(current, direction)
        : addDays(current, direction * (view === "week" ? 7 : 1))
    )
  }

  const openDay = (day) => {
    setEditing(null)
    setAnchor(startOfDay(day))
    changeView("day")
  }

  const toRequestBody = (block) => ({
    task_id: block.task_id,
    task_name: block.title,
    space: block.space,
    description: block.description,
    billable: block.billable,
    start: block.start,
    end: block.end,
  })

  const saveBlock = async (block) => {
    const body = toRequestBody(block)
    const saved = block.id
      ? await apiFetch(`/me/time-blocks/${block.id}`, { token, method: "PUT", body }).catch(handleError)
      : await apiFetch("/me/time-blocks", { token, method: "POST", body }).catch(handleError)

    setBlocks((current) => [
      ...current.filter((existing) => existing.id !== saved.id),
      saved,
    ])
  }

  const deleteBlock = async (block) => {
    await apiFetch(`/me/time-blocks/${block.id}`, { token, method: "DELETE" }).catch(handleError)
    setBlocks((current) => current.filter((existing) => existing.id !== block.id))
    setDeleted(block)
  }

  // Undo puts the entry back in ClickUp (as a new entry with the same
  // task, times and details). A running timer can't be put back.
  const undoDelete = async () => {
    const block = deleted
    setDeleted(null)
    try {
      await saveBlock({ ...block, id: undefined })
    } catch (error) {
      setLoadError(`Couldn't restore the entry: ${error.message}`)
    }
  }

  // Start a new entry at `start`, an hour long unless `end` is given.
  // It shows as a draft on the calendar for the popover to sit by.
  const openNewBlock = (start, end = start + 60 * MINUTE, pointX = DEFAULT_POINT_X) => {
    setEditing({
      block: {
        task_id: null,
        title: "",
        space: null,
        description: "",
        billable: false,
        start,
        end: Math.min(end, endOfDay(startOfDay(start).getTime())),
      },
      pointX,
    })
  }

  const openBlock = (block, pointX) => setEditing({ block, pointX })

  const trackNow = () => {
    const today = startOfDay(new Date())
    const day = view === "day" || !showsToday ? anchor : today
    const start = isSameDay(day, now)
      ? roundTo(Date.now(), 15)
      : startOfDay(day).getTime() + 9 * 60 * MINUTE
    openNewBlock(Math.min(start, endOfDay(startOfDay(day).getTime()) - 15 * MINUTE))
  }

  const editingId = editing ? editing.block.id || DRAFT_ID : null
  const getAnchor = useCallback(
    () => calendarRef.current?.querySelector(`[data-block-id="${editingId}"]`),
    [editingId]
  )
  const closeEditor = useCallback(() => setEditing(null), [])

  // Running timers stretch to now. A new entry rides along as an
  // invisible draft, only so the popover has something to point at.
  const shownBlocks = [
    ...blocks.map((block) =>
      block.running ? { ...block, end: Math.max(now, block.start + MINUTE) } : block
    ),
    ...(editing && !editing.block.id ? [{ ...editing.block, id: DRAFT_ID }] : []),
  ]

  return (
    <section
      className="day-timeline panel"
      aria-labelledby="day-timeline-title"
      ref={calendarRef}
    >
      <div className="day-timeline-header">
        <div>
          <p className="section-kicker">{heading.kicker}</p>
          <h2 id="day-timeline-title">{heading.title}</h2>
        </div>
        <div className="day-timeline-controls">
          <div className="view-switcher" role="group" aria-label="Calendar view">
            {VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => changeView(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="primary-button day-timeline-add" onClick={trackNow}>
            + Track time
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              setEditing(null)
              setAnchor(startOfDay(new Date()))
            }}
            disabled={showsToday}
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label={`Previous ${view}`}
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <button
            className="icon-button"
            aria-label={`Next ${view}`}
            onClick={() => step(1)}
          >
            ›
          </button>
        </div>
      </div>

      {view === "day" && (
        <div className="day-timeline-legend">
          <span className="day-timeline-legend-item">
            <span className="day-timeline-legend-swatch" aria-hidden="true" />
            Computer active
          </span>
          <span className="day-timeline-legend-note">
            {activity.source === "system"
              ? "Green while this page is open, pausing after 10 idle minutes or when the screen locks."
              : "Green while this page is open."}
          </span>
          {activity.source !== "system" &&
            (activity.permission === "prompt" || activity.permission === "default") && (
              <button
                className="link-button day-timeline-legend-action"
                onClick={activity.enableSystemTracking}
              >
                Track the whole computer
              </button>
            )}
        </div>
      )}

      {loadError && (
        <p className="day-timeline-error" role="alert">
          {loadError}
        </p>
      )}

      {view === "month" ? (
        <MonthGrid
          days={days}
          month={anchor.getMonth()}
          blocks={shownBlocks}
          tasks={tasks}
          now={now}
          editingId={editingId}
          onNewBlock={openNewBlock}
          onOpenBlock={openBlock}
          onSelectDay={openDay}
        />
      ) : (
        <TimeGrid
          days={days}
          blocks={shownBlocks}
          tasks={tasks}
          now={now}
          editingId={editingId}
          activitySpans={view === "day" ? activity.spans : null}
          onNewBlock={openNewBlock}
          onOpenBlock={openBlock}
          onSelectDay={openDay}
        />
      )}

      {editing && (
        <TimeBlockPopover
          key={`${editingId}-${editing.block.start}`}
          block={editing.block}
          getAnchor={getAnchor}
          pointX={editing.pointX}
          tasks={tasks}
          onSave={saveBlock}
          onDelete={deleteBlock}
          onClose={closeEditor}
        />
      )}

      {deleted && (
        <div className="calendar-toast" role="status">
          <span>Entry deleted</span>
          {!deleted.running && deleted.task_id && (
            <button type="button" className="link-button" onClick={undoDelete}>
              Undo
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export default Calendar
