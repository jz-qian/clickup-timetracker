import { useEffect, useRef, useState } from "react"
import { useActivityLog } from "./activityLog.js"

const HOUR_HEIGHT = 48
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

// Single-day calendar view, like Google Calendar's day view.
// `events` are { id, title, start, end } with start/end in milliseconds.
function DayTimeline({ events = [] }) {
  const [day, setDay] = useState(() => startOfDay(new Date()))
  const [now, setNow] = useState(() => Date.now())
  const scrollRef = useRef(null)
  const activity = useActivityLog()

  const dayStart = day.getTime()
  const dayEnd = dayStart + DAY
  const isToday = now >= dayStart && now < dayEnd

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

  const dayEvents = events
    .filter((event) => event.end > dayStart && event.start < dayEnd)
    .map((event) => {
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
            ? "Tracking activity anywhere on this computer while this page is open."
            : "Tracking activity in this tab only."}
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
              <div
                key={span.start}
                className="day-timeline-activity-span"
                style={{ top: span.top, height: span.height }}
                title={`Active ${formatTime(span.start)} – ${formatTime(span.end)}`}
              />
            ))}
          </div>

          <div className="day-timeline-events">
            {dayEvents.map((event) => (
              <div
                key={event.id}
                className="day-timeline-event"
                style={{ top: event.top, height: event.height }}
              >
                <span className="day-timeline-event-title">{event.title}</span>
                <span className="day-timeline-event-time">
                  {formatTime(event.start)} – {formatTime(event.end)}
                </span>
              </div>
            ))}

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
    </section>
  )
}

export default DayTimeline
