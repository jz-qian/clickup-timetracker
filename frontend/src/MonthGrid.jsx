import DeadlineChip from "./DeadlineChip.jsx"
import { DEFAULT_POINT_X, DRAFT_ID } from "./TimeGrid.jsx"
import {
  MINUTE,
  clipToDay,
  deadlinesOn,
  formatDuration,
  formatTime,
  isSameDay,
} from "./calendarUtils.js"

// How many deadlines and entries a day cell lists before "+N more"
const MAX_ITEMS = 3
const WEEKDAYS = Array.from({ length: 7 }, (_, index) =>
  new Date(2026, 0, 4 + index).toLocaleDateString([], { weekday: "short" })
)

// Month view: each day shows its deadlines, the time tracked, and its
// first few entries. Click a date to open that day; click an entry to
// edit it; click empty space to track time on that day.
function MonthGrid({ days, month, blocks, tasks, now, editingId, onNewBlock, onOpenBlock, onSelectDay }) {
  return (
    <div className="month-grid-scroll">
      <div className="month-grid" role="grid" aria-label="Month">
        <div className="month-grid-weekdays" role="row">
          {WEEKDAYS.map((name) => (
            <span key={name} role="columnheader">
              {name}
            </span>
          ))}
        </div>

        <div className="month-grid-days" style={{ "--week-count": days.length / 7 }}>
          {days.map((day) => {
            const dayStart = day.getTime()
            const deadlines = deadlinesOn(tasks, dayStart)
            const entries = clipToDay(blocks, dayStart).sort((a, b) => a.start - b.start)
            const tracked = entries
              .filter((entry) => entry.id !== DRAFT_ID)
              .reduce((total, entry) => total + entry.clippedEnd - entry.clippedStart, 0)
            // A new entry isn't listed until it's saved; an invisible
            // anchor over the cell is what its popover points at
            const hasDraft = entries.some((entry) => entry.id === DRAFT_ID)
            const items = [
              ...deadlines.map((task) => ({ kind: "deadline", task })),
              ...entries
                .filter((entry) => entry.id !== DRAFT_ID)
                .map((entry) => ({ kind: "entry", entry })),
            ]
            const shown = items.slice(0, MAX_ITEMS)
            const hidden = items.length - shown.length
            const classNames = ["month-day"]
            if (day.getMonth() !== month) classNames.push("outside")
            if (isSameDay(day, now)) classNames.push("today")

            return (
              <div
                key={dayStart}
                className={classNames.join(" ")}
                role="gridcell"
                onClick={(event) => {
                  if (event.target !== event.currentTarget) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  onNewBlock(dayStart + 9 * 60 * MINUTE, undefined, event.clientX - rect.left)
                }}
              >
                <div className="month-day-header">
                  <button
                    type="button"
                    className="month-day-number"
                    onClick={() => onSelectDay(day)}
                    aria-label={`Open ${day.toLocaleDateString([], {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}`}
                  >
                    {day.getDate()}
                  </button>
                  {tracked > 0 && (
                    <span className="month-day-total" title="Time tracked">
                      {formatDuration(tracked)}
                    </span>
                  )}
                </div>

                {hasDraft && (
                  <span data-block-id={DRAFT_ID} className="draft-anchor" aria-hidden="true" />
                )}

                {shown.map((item) =>
                  item.kind === "deadline" ? (
                    <DeadlineChip key={`deadline-${item.task.id}`} task={item.task} now={now} />
                  ) : (
                    <button
                      key={item.entry.id}
                      type="button"
                      data-block-id={item.entry.id}
                      className={
                        editingId === item.entry.id ? "month-entry selected" : "month-entry"
                      }
                      title={`${item.entry.title} · ${formatTime(item.entry.start)} – ${
                        item.entry.running ? "now" : formatTime(item.entry.end)
                      }`}
                      onClick={(clickEvent) =>
                        onOpenBlock(
                          item.entry,
                          clickEvent.detail === 0
                            ? DEFAULT_POINT_X
                            : clickEvent.clientX -
                                clickEvent.currentTarget.getBoundingClientRect().left
                        )
                      }
                    >
                      <span className="month-entry-time">{formatTime(item.entry.clippedStart)}</span>
                      <span className="month-entry-title">{item.entry.title}</span>
                    </button>
                  )
                )}

                {hidden > 0 && (
                  <button
                    type="button"
                    className="month-day-more"
                    onClick={() => onSelectDay(day)}
                  >
                    +{hidden} more
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default MonthGrid
