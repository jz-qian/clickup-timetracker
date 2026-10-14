import { useEffect, useRef, useState } from "react"

const MINUTE = 60 * 1000

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

// Popup for adding or editing a block of tracked time on the day calendar.
// `block` is { id?, title, description, start, end, task_id }; no id means
// a new entry.
function TimeBlockDialog({ block, dayStart, tasks, onSave, onDelete, onClose }) {
  const dialogRef = useRef(null)
  const [title, setTitle] = useState(block.title || "")
  const [description, setDescription] = useState(block.description || "")
  const [startTime, setStartTime] = useState(toTimeInput(block.start))
  const [endTime, setEndTime] = useState(toTimeInput(block.end))
  const [taskId, setTaskId] = useState(block.task_id || "")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Native modal dialog: traps focus, and Escape closes it
  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])

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

  const save = (event) => {
    event.preventDefault()

    const start = fromTimeInput(startTime, dayStart, false)
    const end = fromTimeInput(endTime, dayStart, true)
    if (end <= start) {
      setError("The end time must be after the start time.")
      return
    }

    run(() =>
      onSave({
        ...block,
        title: title.trim(),
        description: description.trim(),
        start,
        end,
        task_id: taskId || null,
      })
    )
  }

  const isNew = !block.id

  return (
    <dialog
      ref={dialogRef}
      className="time-block-dialog"
      aria-labelledby="time-block-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // Clicking the dimmed backdrop closes it
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <form className="time-block-form" onSubmit={save}>
        <div className="time-block-dialog-header">
          <h2 id="time-block-dialog-title">
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

        <label htmlFor="time-block-title">Title</label>
        <input
          id="time-block-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What did you work on?"
          autoFocus
          required
        />

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

        <label htmlFor="time-block-task">ClickUp task (optional)</label>
        <select
          id="time-block-task"
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
        >
          <option value="">No task</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.name} ({task.custom_id || task.id})
            </option>
          ))}
        </select>

        <label htmlFor="time-block-description">Details</label>
        <textarea
          id="time-block-description"
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Notes about this time"
        />

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
              onClick={() => run(() => onDelete(block))}
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
    </dialog>
  )
}

export default TimeBlockDialog
