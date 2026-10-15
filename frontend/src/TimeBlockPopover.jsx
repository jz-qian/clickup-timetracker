import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { formatTime, startOfDay } from "./calendarUtils.js"

const MINUTE = 60 * 1000
const GAP = 12
const EDGE = 8
// Below this width the popover becomes a sheet along the bottom
const SHEET_BREAKPOINT = 640

function toTimeInput(milliseconds) {
  const date = new Date(milliseconds)
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

// "HH:MM" on the given day, in milliseconds. An end time of 00:00 means
// midnight at the end of the day.
function fromTimeInput(value, dayStart, isEnd) {
  const [hours, minutes] = value.split(":").map(Number)
  const time = dayStart + (hours * 60 + minutes) * MINUTE
  return isEnd && time === dayStart ? dayStart + 24 * 60 * MINUTE : time
}

// How far the arrow keeps from the popover's top and bottom corners
const ARROW_INSET = 18

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max))
}

// Where to put the popover beside its anchor: to the right of the clicked
// point, or the left when there's no room, with an arrow on that edge
// pointing back at the entry. `side` says which edge has the arrow
// ("left" when the popover is to the right of the anchor), or is null
// when neither side fits or the anchor is scrolled out of view.
// Returns null for the bottom-sheet layout on small screens.
function placeNextTo(anchor, pointX, popover) {
  if (window.innerWidth < SHEET_BREAKPOINT || !anchor || !popover) return null

  const rect = anchor.getBoundingClientRect()
  const width = popover.offsetWidth
  const height = popover.offsetHeight
  const x = clamp(rect.left + pointX, rect.left, rect.right)
  // Point at the top of the entry, or the middle of a short one
  const pointY = rect.top + Math.min(rect.height / 2, 20)

  let side = "left"
  let left = x + GAP
  if (left + width > window.innerWidth - EDGE) {
    side = "right"
    left = x - width - GAP
  }
  if (left < EDGE) {
    side = null
    left = clamp(left, EDGE, window.innerWidth - width - EDGE)
  }

  // Line the arrow up near the popover's top, keeping it all on screen
  const top = clamp(pointY - ARROW_INSET - 10, EDGE, window.innerHeight - height - EDGE)
  const arrowTop = pointY - top
  if (arrowTop < ARROW_INSET || arrowTop > height - ARROW_INSET) side = null

  return { left, top, side, arrowTop }
}

// Popover anchored to a block on the day calendar, for tracking time
// against one of the member's ClickUp tasks. `block` is
// { id?, task_id, title, space, description, start, end }; no id means a
// new entry. `getAnchor` returns the block's element on the calendar, and
// `pointX` is where it was clicked, from the block's left edge.
function TimeBlockPopover({
  block,
  getAnchor,
  pointX,
  tasks,
  onSave,
  onDelete,
  onClose,
}) {
  const popoverRef = useRef(null)
  const returnFocusRef = useRef(null)
  const deleteRef = useRef(null)
  const isNew = !block.id
  // Times in the form are on the entry's own day
  const dayStart = startOfDay(block.start).getTime()
  const [position, setPosition] = useState(null)

  // A block's task may have been completed since, so it's no longer in
  // the assigned list; keep it choosable
  const taskOptions =
    block.task_id && !tasks.some((task) => task.id === block.task_id)
      ? [...tasks, { id: block.task_id, name: block.title, space: block.space }]
      : tasks
  const spaces = Array.from(
    new Set(taskOptions.map((task) => task.space || "Other"))
  ).sort((a, b) => a.localeCompare(b))

  const [space, setSpace] = useState(block.task_id ? block.space || "Other" : "")
  const [taskId, setTaskId] = useState(block.task_id || "")
  const [description, setDescription] = useState(block.description || "")
  const [billable, setBillable] = useState(Boolean(block.billable))
  const [startTime, setStartTime] = useState(toTimeInput(block.start))
  const [endTime, setEndTime] = useState(toTimeInput(block.end))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const shownTasks = space
    ? taskOptions.filter((task) => (task.space || "Other") === space)
    : taskOptions

  // Keep beside the anchor as the calendar scrolls or the window resizes
  useLayoutEffect(() => {
    const update = () =>
      setPosition(placeNextTo(getAnchor(), pointX, popoverRef.current))

    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [getAnchor, pointX, block.start, block.end])

  // Escape or a click outside closes it. Focus goes back where it was.
  // For an existing entry, pressing Delete (or Backspace) deletes it,
  // unless you're typing in a field.
  useEffect(() => {
    returnFocusRef.current = document.activeElement
    const returnFocus = returnFocusRef.current

    // Focus the popover itself, so Delete works straight away
    if (block.id) popoverRef.current?.focus({ preventScroll: true })

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose()
        return
      }

      const typing = event.target.closest?.("input, textarea, select, [contenteditable]")
      if (block.id && !typing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault()
        deleteRef.current?.()
      }
    }
    const onPointerDown = (event) => {
      if (!popoverRef.current?.contains(event.target)) onClose()
    }

    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    }
  }, [onClose, block.id])

  const run = async (action) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onClose()
    } catch (requestError) {
      setError(requestError.message)
      setBusy(false)
    }
  }

  const deleteEntry = () => {
    if (!busy) run(() => onDelete(block))
  }

  useEffect(() => {
    deleteRef.current = deleteEntry
  })

  const save = (event) => {
    event.preventDefault()

    const task = taskOptions.find((option) => option.id === taskId)
    if (!task) {
      setError("Choose a ClickUp task.")
      return
    }

    const start = fromTimeInput(startTime, dayStart, false)
    const end = fromTimeInput(endTime, dayStart, true)
    if (end <= start) {
      setError("The end time must be after the start time.")
      return
    }

    run(() =>
      onSave({
        ...block,
        task_id: task.id,
        title: task.name,
        space: task.space || null,
        description: description.trim(),
        billable,
        start,
        end,
      })
    )
  }

  const chooseTask = (id) => {
    setTaskId(id)
    setError(null)
    const task = taskOptions.find((option) => option.id === id)
    if (task) setSpace(task.space || "Other")
  }

  const chooseSpace = (name) => {
    setSpace(name)
    setError(null)
    const task = taskOptions.find((option) => option.id === taskId)
    if (name && task && (task.space || "Other") !== name) setTaskId("")
  }

  const isSheet = window.innerWidth < SHEET_BREAKPOINT

  return (
    <div
      ref={popoverRef}
      className={[
        "time-block-popover",
        isSheet && "sheet",
        position?.side && `arrow-${position.side}`,
      ]
        .filter(Boolean)
        .join(" ")}
      role="dialog"
      aria-labelledby="time-block-popover-title"
      tabIndex={-1}
      style={
        position
          ? { left: position.left, top: position.top, "--arrow-top": `${position.arrowTop}px` }
          : isSheet
            ? undefined
            : { visibility: "hidden" }
      }
    >
      {block.running ? (
        <div className="time-block-form">
          <div className="time-block-popover-header">
            <h2 id="time-block-popover-title">Timer running</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <p className="time-block-running-task">{block.title}</p>
          <p className="time-block-note">
            {block.space && `${block.space} · `}Started {formatTime(block.start)}.
            Stop or edit it in ClickUp, or delete it here.
          </p>
          {error && (
            <p className="access-error" role="alert">
              {error}
            </p>
          )}
          <div className="time-block-actions">
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={deleteEntry}
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
            <button type="button" className="secondary-button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form className="time-block-form" onSubmit={save}>
          <div className="time-block-popover-header">
            <h2 id="time-block-popover-title">
              {isNew ? "Track time" : "Edit tracked time"}
            </h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>

          <label htmlFor="time-block-task">ClickUp task</label>
          <select
            id="time-block-task"
            value={taskId}
            onChange={(event) => chooseTask(event.target.value)}
            autoFocus={isNew}
            required
          >
            <option value="" disabled>
              {taskOptions.length ? "Choose a task" : "No tasks assigned to you"}
            </option>
            {shownTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>

          <label htmlFor="time-block-space">Space</label>
          <select
            id="time-block-space"
            value={space}
            onChange={(event) => chooseSpace(event.target.value)}
          >
            <option value="">All spaces</option>
            {spaces.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <div className="time-block-times">
            <div>
              <label htmlFor="time-block-start">Start</label>
              <input
                id="time-block-start"
                type="time"
                step="300"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="time-block-end">End</label>
              <input
                id="time-block-end"
                type="time"
                step="300"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                required
              />
            </div>
          </div>

          <label htmlFor="time-block-description">Details</label>
          <textarea
            id="time-block-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Notes about this time"
          />

          <label className="time-block-billable">
            <input
              type="checkbox"
              checked={billable}
              onChange={(event) => setBillable(event.target.checked)}
            />
            Billable
          </label>

          <p className="time-block-note">Saved to this task's time in ClickUp.</p>

          {error && (
            <p className="access-error" role="alert">
              {error}
            </p>
          )}

          <div className="time-block-actions">
            {!isNew && (
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={deleteEntry}
                title="Delete this entry (Delete key)"
              >
                Delete
              </button>
            )}
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default TimeBlockPopover
