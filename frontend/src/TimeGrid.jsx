import { useEffect, useRef } from "react"
import DeadlineChip from "./DeadlineChip.jsx"
import {
  HOUR_HEIGHT,
  HOURS,
  MINUTE,
  clipToDay,
  deadlinesOn,
  endOfDay,
  formatHour,
  formatTime,
  isSameDay,
  layOutColumns,
  offsetFor,
  roundTo,
} from "./calendarUtils.js"

export const DRAFT_ID = "draft"
// Where the popover opens across a block when there's no click to go by
export const DEFAULT_POINT_X = 160

// One entry on the hour grid
function GridEvent({ event, selected, onOpen }) {
  const style = {
    top: event.top,
    height: event.height,
    left: `calc(${(event.column / event.columns) * 100}% + 2px)`,
    width: `calc(${100 / event.columns}% - 4px)`,
  }

  const classNames = ["day-timeline-event"]
  if (event.running) classNames.push("running")
  if (selected) classNames.push("selected")

  return (
    <button
      type="button"
      data-block-id={event.id}
      className={classNames.join(" ")}
      style={style}
      aria-expanded={selected}
      onClick={(clickEvent) =>
        onOpen(
          event,
          // detail is 0 for a keyboard press, which has no position
          clickEvent.detail === 0
            ? DEFAULT_POINT_X
            : clickEvent.clientX - clickEvent.currentTarget.getBoundingClientRect().left
        )
      }
    >
      <span className="day-timeline-event-title">{event.title}</span>
      <span className="day-timeline-event-time">
        {event.space && `${event.space} · `}
        {formatTime(event.start)} –{" "}
        {event.running ? "now · running in ClickUp" : formatTime(event.end)}
      </span>
      {event.description && (
        <span className="day-timeline-event-description">{event.description}</span>
      )}
    </button>
  )
}

// Google Calendar-style hour grid with one column per day (one for the
// day view, seven for the week view). Deadlines sit in a row above the
// hours. Clicking empty space starts a new entry there.
function TimeGrid({
  days,
  blocks,
  tasks,
  now,
  editingId,
  activitySpans,
  onNewBlock,
  onOpenBlock,
  onSelectDay,
}) {
  const scrollRef = useRef(null)
  const firstDay = days[0].getTime()
  const isWeek = days.length > 1
  const showsToday = days.some((day) => isSameDay(day, now))
  const hasDeadlines = days.some((day) => deadlinesOn(tasks, day.getTime()).length)

  // Open scrolled to an hour before now, or 8 AM when today isn't shown
  useEffect(() => {
    if (!scrollRef.current) return

    const anchorHour = showsToday ? Math.max(0, new Date().getHours() - 1) : 8
    scrollRef.current.scrollTop = anchorHour * HOUR_HEIGHT
    // Only re-anchor when the shown days change, not every minute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, days.length])

  // Clicking an empty spot starts an entry at that time, to the quarter hour
  const onColumnClick = (event, dayStart) => {
    if (event.target !== event.currentTarget) return

    const rect = event.currentTarget.getBoundingClientRect()
    const minutes = ((event.clientY - rect.top) / HOUR_HEIGHT) * 60
    const quarter = Math.max(0, Math.min(Math.floor(minutes / 15) * 15, 23 * 60 + 45))
    onNewBlock(dayStart + quarter * MINUTE, undefined, event.clientX - rect.left)
  }

  return (
    <div
      className={isWeek ? "day-timeline-scroll week" : "day-timeline-scroll"}
      ref={scrollRef}
      style={{ "--day-count": days.length }}
    >
      {(isWeek || hasDeadlines) && (
        <div className="calendar-head">
          <div className="calendar-head-gutter">
            {hasDeadlines && <span>Due</span>}
          </div>
          <div className="calendar-head-days">
            {days.map((day) => {
              const dayStart = day.getTime()
              const deadlines = deadlinesOn(tasks, dayStart)
              const isToday = isSameDay(day, now)

              return (
                <div key={dayStart} className="calendar-head-day">
                  {isWeek && (
                    <button
                      type="button"
                      className={isToday ? "calendar-day-label today" : "calendar-day-label"}
                      onClick={() => onSelectDay(day)}
                      aria-label={`Open ${day.toLocaleDateString([], {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}`}
                    >
                      <span>{day.toLocaleDateString([], { weekday: "short" })}</span>
                      <strong>{day.getDate()}</strong>
                    </button>
                  )}
                  {deadlines.map((task) => (
                    <DeadlineChip key={task.id} task={task} now={now} />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="day-timeline-grid" style={{ height: HOURS.length * HOUR_HEIGHT }}>
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

        {/* Computer activity, in the day view only */}
        {activitySpans && (
          <div className="day-timeline-activity" aria-label="Computer activity">
            {clipToDay(activitySpans, firstDay).map((span) => (
              <button
                key={span.start}
                type="button"
                className="day-timeline-activity-span"
                style={{
                  top: offsetFor(span.clippedStart, firstDay),
                  // A span still being recorded stays at least 2px tall
                  height: Math.max(
                    offsetFor(span.clippedEnd, firstDay) - offsetFor(span.clippedStart, firstDay),
                    2
                  ),
                }}
                title={`Active ${formatTime(span.start)} – ${formatTime(span.end)}. Click to track this time.`}
                aria-label={`Active ${formatTime(span.start)} to ${formatTime(span.end)}. Track this time.`}
                onClick={() =>
                  onNewBlock(
                    Math.max(roundTo(span.start, 5), firstDay),
                    Math.max(roundTo(span.end, 5), roundTo(span.start, 5) + 5 * MINUTE)
                  )
                }
              />
            ))}
          </div>
        )}

        <div className="day-timeline-columns">
          {days.map((day) => {
            const dayStart = day.getTime()
            // A new entry isn't drawn until it's saved; an invisible
            // anchor marks its slot for the popover to point at
            const draft = clipToDay(
              blocks.filter((event) => event.id === DRAFT_ID),
              dayStart
            )[0]
            const events = layOutColumns(
              clipToDay(
                blocks.filter((event) => event.id !== DRAFT_ID),
                dayStart
              ).map((event) => ({
                ...event,
                // Lay out by the part on this day
                start: event.clippedStart,
                end: event.clippedEnd,
                originalStart: event.start,
                originalEnd: event.end,
              }))
            ).map((event) => ({
              ...event,
              start: event.originalStart,
              end: event.originalEnd,
              top: offsetFor(event.clippedStart, dayStart),
              height: Math.max(
                offsetFor(event.clippedEnd, dayStart) - offsetFor(event.clippedStart, dayStart),
                18
              ),
            }))
            const showNow = now >= dayStart && now < endOfDay(dayStart)

            return (
              // Clicking empty space in a column starts a new entry
              <div
                key={dayStart}
                className="day-timeline-events"
                onClick={(event) => onColumnClick(event, dayStart)}
              >
                {draft && (
                  <span
                    data-block-id={DRAFT_ID}
                    className="draft-anchor"
                    style={{
                      top: offsetFor(draft.clippedStart, dayStart),
                      height: offsetFor(draft.clippedEnd, dayStart) - offsetFor(draft.clippedStart, dayStart),
                    }}
                    aria-hidden="true"
                  />
                )}

                {events.map((event) => (
                  <GridEvent
                    key={event.id}
                    event={event}
                    selected={editingId === event.id}
                    onOpen={onOpenBlock}
                  />
                ))}

                {showNow && (
                  <div
                    className="day-timeline-now"
                    style={{ top: offsetFor(now, dayStart) }}
                    aria-label={`Current time ${formatTime(now)}`}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default TimeGrid
