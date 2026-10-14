import { useCallback, useEffect, useRef, useState } from "react"
import { useActivityLog } from "./activityLog.js"
import { apiFetch } from "./api.js"
import TimeBlockPopover from "./TimeBlockPopover.jsx"

const HOUR_HEIGHT = 55
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

function startOfDay(date) {
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  return day
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatHour(hour) {
  if (hour === 0) return "12 AM"
  if (hour === 12) return "12 PM"
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

function formatTime(milliseconds) {
  return new Date(milliseconds).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
}

// Pixel offset from the top of the grid for a time within the day
function offsetFor(milliseconds, dayStart) {
  return ((milliseconds - dayStart) / (60 * MINUTE)) * HOUR_HEIGHT
}

// Round a time to the nearest `step` minutes
function roundTo(milliseconds, step) {
  const size = step * MINUTE
  return Math.round(milliseconds / size) * size
}

// Side-by-side columns for entries that overlap, like a calendar app.
// Adds `column` and `columns` to each event.
function layOutColumns(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end)
  const laidOut = []
  let group = []
  let groupEnd = -Infinity
  let columnEnds = []

  const finishGroup = () => {
    group.forEach((event) => laidOut.push({ ...event, columns: columnEnds.length }))
    group = []
    columnEnds = []
  }

  sorted.forEach((event) => {
    if (event.start >= groupEnd) {
      finishGroup()
      groupEnd = -Infinity
    }

    let column = columnEnds.findIndex((end) => end <= event.start)
    if (column === -1) column = columnEnds.length
    columnEnds[column] = event.end
    groupEnd = Math.max(groupEnd, event.end)
    group.push({ ...event, column })
  })
  finishGroup()

  return laidOut
}

const DRAFT_ID = "draft"
// Where the popover opens across a block when there's no click to go by
const DEFAULT_POINT_X = 160

// Single-day calendar view, like Google Calendar's day view. Click an
// empty spot (or a green activity stretch) to track time there, or an
// entry to edit it; a popover opens beside it. Every entry is for one of
// the member's ClickUp tasks, and is saved to the backend.
function DayTimeline({ token, tasks = [], onUnauthorized }) {
  const [day, setDay] = useState(() => startOfDay(new Date()))
  const [now, setNow] = useState(() => Date.now())
  const [blocks, setBlocks] = useState([])
  const [loadError, setLoadError] = useState(null)
  // The entry open in the popover ({ block, pointX }), or null
  const [editing, setEditing] = useState(null)
  const scrollRef = useRef(null)
  const activity = useActivityLog()

  const dayStart = day.getTime()
  const dayEnd = dayStart + DAY
  const isToday = now >= dayStart && now < dayEnd

  const handleError = (error) => {
    if (error.status === 401) onUnauthorized?.()
    throw error
  }

  // Load this day's entries
  useEffect(() => {
    let cancelled = false

    apiFetch(`/me/time-blocks?start=${dayStart}&end=${dayStart + DAY}`, { token })
      .then((data) => {
        if (cancelled) return
        setBlocks(data.time_blocks)
        setLoadError(null)
      })
      .catch((error) => {
        if (cancelled) return
        if (error.status === 401) onUnauthorized?.()
        setLoadError(error.message)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart, token])

  const saveBlock = async (block) => {
    const body = {
      task_id: block.task_id,
      task_name: block.title,
      space: block.space,
      description: block.description,
      start: block.start,
      end: block.end,
    }
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
  }

  // Start a new entry at `start`, an hour long unless `end` is given.
  // It shows as a draft block on the calendar for the popover to sit by.
  const openNewBlock = (start, end = start + 60 * MINUTE, pointX = DEFAULT_POINT_X) => {
    setEditing({
      block: {
        task_id: null,
        title: "",
        space: null,
        description: "",
        start,
        end: Math.min(end, dayEnd),
      },
      pointX,
    })
  }

  // Clicking an empty spot starts an entry at that time, to the quarter hour
  const onGridClick = (event) => {
    if (event.target !== event.currentTarget) return

    const rect = event.currentTarget.getBoundingClientRect()
    const minutes = ((event.clientY - rect.top) / HOUR_HEIGHT) * 60
    const quarter = Math.floor(minutes / 15) * 15
    openNewBlock(
      dayStart + Math.max(0, Math.min(quarter, 23 * 60 + 45)) * MINUTE,
      undefined,
      event.clientX - rect.left
    )
  }

  const editingId = editing ? editing.block.id || DRAFT_ID : null
  const getAnchor = useCallback(
    () => scrollRef.current?.querySelector(`[data-block-id="${editingId}"]`),
    [editingId]
  )
  const closeEditor = useCallback(() => setEditing(null), [])

  const trackNow = () => {
    const start = isToday ? roundTo(Date.now(), 15) : dayStart + 9 * 60 * MINUTE
    openNewBlock(Math.min(start, dayEnd - 15 * MINUTE))
  }

  // Keep the current-time line moving
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE)
    return () => window.clearInterval(timer)
  }, [])

  // Open each day scrolled to an hour before now, or 8 AM on other days
  useEffect(() => {
    if (!scrollRef.current) return

    const anchorHour = isToday
      ? Math.max(0, new Date().getHours() - 1)
      : 8
    scrollRef.current.scrollTop = anchorHour * HOUR_HEIGHT
    // Only re-anchor when the shown day changes, not every minute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart])

  const draft =
    editing && !editing.block.id ? [{ ...editing.block, id: DRAFT_ID }] : []
  const dayEvents = layOutColumns(
    [...blocks, ...draft].filter((event) => event.end > dayStart && event.start < dayEnd)
  ).map((event) => {
      const start = Math.max(event.start, dayStart)
      const end = Math.min(event.end, dayEnd)
      return {
        ...event,
        top: offsetFor(start, dayStart),
        height: Math.max(offsetFor(end, dayStart) - offsetFor(start, dayStart), 18),
      }
  })

  // Computer activity, clipped to the shown day. A span still being
  // recorded is drawn at least 2px tall so a short burst stays visible.
  const activeSpans = activity.spans
    .filter((span) => span.end >= dayStart && span.start < dayEnd)
    .map((span) => {
      const start = Math.max(span.start, dayStart)
      const end = Math.min(span.end, dayEnd)
      return {
        ...span,
        top: offsetFor(start, dayStart),
        height: Math.max(offsetFor(end, dayStart) - offsetFor(start, dayStart), 2),
      }
    })

  return (
    <section className="day-timeline panel" aria-labelledby="day-timeline-title">
      <div className="day-timeline-header">
        <div>
          <p className="section-kicker">
            {day.toLocaleDateString([], { weekday: "long" }).toUpperCase()}
          </p>
          <h2 id="day-timeline-title">
            {day.toLocaleDateString([], {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </h2>
        </div>
        <div className="day-timeline-controls">
          <button className="primary-button day-timeline-add" onClick={trackNow}>
            + Track time
          </button>
          <button
            className="secondary-button"
            onClick={() => setDay(startOfDay(new Date()))}
            disabled={isToday}
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label="Previous day"
            onClick={() => setDay((current) => addDays(current, -1))}
          >
            ‹
          </button>
          <button
            className="icon-button"
            aria-label="Next day"
            onClick={() => setDay((current) => addDays(current, 1))}
          >
            ›
          </button>
        </div>
      </div>

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

      {loadError && (
        <p className="day-timeline-error" role="alert">
          Couldn't load your tracked time: {loadError}
        </p>
      )}

      <div className="day-timeline-scroll" ref={scrollRef}>
        <div
          className="day-timeline-grid"
          style={{ height: HOURS.length * HOUR_HEIGHT }}
        >
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="day-timeline-hour"
              style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
            >
              <span className="day-timeline-hour-label">
                {hour === 0 ? "" : formatHour(hour)}
              </span>
            </div>
          ))}

          <div className="day-timeline-activity" aria-label="Computer activity">
            {activeSpans.map((span) => (
              <button
                key={span.start}
                type="button"
                className="day-timeline-activity-span"
                style={{ top: span.top, height: span.height }}
                title={`Active ${formatTime(span.start)} – ${formatTime(span.end)}. Click to track this time.`}
                aria-label={`Active ${formatTime(span.start)} to ${formatTime(span.end)}. Track this time.`}
                onClick={() =>
                  openNewBlock(
                    Math.max(roundTo(span.start, 5), dayStart),
                    Math.max(roundTo(span.end, 5), roundTo(span.start, 5) + 5 * MINUTE)
                  )
                }
              />
            ))}
          </div>

          {/* Clicking empty space here starts a new entry */}
          <div className="day-timeline-events" onClick={onGridClick}>
            {dayEvents.map((event) => {
              const style = {
                top: event.top,
                height: event.height,
                left: `calc(${(event.column / event.columns) * 100}% + 2px)`,
                width: `calc(${100 / event.columns}% - 4px)`,
              }

              if (event.id === DRAFT_ID) {
                return (
                  <div
                    key={DRAFT_ID}
                    data-block-id={DRAFT_ID}
                    className="day-timeline-event draft"
                    style={style}
                    aria-hidden="true"
                  >
                    <span className="day-timeline-event-title">New entry</span>
                    <span className="day-timeline-event-time">
                      {formatTime(event.start)} – {formatTime(event.end)}
                    </span>
                  </div>
                )
              }

              return (
                <button
                  key={event.id}
                  type="button"
                  data-block-id={event.id}
                  className={
                    editingId === event.id
                      ? "day-timeline-event selected"
                      : "day-timeline-event"
                  }
                  style={style}
                  aria-expanded={editingId === event.id}
                  onClick={(clickEvent) =>
                    setEditing({
                      block: event,
                      // detail is 0 for a keyboard press, which has no position
                      pointX:
                        clickEvent.detail === 0
                          ? DEFAULT_POINT_X
                          : clickEvent.clientX -
                            clickEvent.currentTarget.getBoundingClientRect().left,
                    })
                  }
                >
                  <span className="day-timeline-event-title">{event.title}</span>
                  <span className="day-timeline-event-time">
                    {event.space && `${event.space} · `}
                    {formatTime(event.start)} – {formatTime(event.end)}
                  </span>
                  {event.description && (
                    <span className="day-timeline-event-description">
                      {event.description}
                    </span>
                  )}
                </button>
              )
            })}

            {isToday && (
              <div
                className="day-timeline-now"
                style={{ top: offsetFor(now, dayStart) }}
                aria-label={`Current time ${formatTime(now)}`}
              />
            )}
          </div>
        </div>
      </div>

      {editing && (
        <TimeBlockPopover
          key={`${editingId}-${editing.block.start}`}
          block={editing.block}
          getAnchor={getAnchor}
          pointX={editing.pointX}
          dayStart={dayStart}
          tasks={tasks}
          onSave={saveBlock}
          onDelete={deleteBlock}
          onClose={closeEditor}
        />
      )}
    </section>
  )
}

export default DayTimeline
