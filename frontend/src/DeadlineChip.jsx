import { formatTime } from "./calendarUtils.js"

// A task's ClickUp deadline, shown like an all-day event in Google
// Calendar. Overdue deadlines are red. Opens the task in ClickUp.
function DeadlineChip({ task, now }) {
  const overdue = task.due_date < now
  const due = new Date(task.due_date)
  const details = [
    `Due ${due.toLocaleDateString([], { month: "short", day: "numeric" })} ${formatTime(task.due_date)}`,
    task.space,
    task.list,
    task.status,
  ]
    .filter(Boolean)
    .join(" · ")

  const className = overdue ? "deadline-chip overdue" : "deadline-chip"
  const content = (
    <>
      <span className="deadline-chip-icon" aria-hidden="true">
        ⚑
      </span>
      <span className="deadline-chip-name">{task.name}</span>
    </>
  )

  return task.url ? (
    <a
      className={className}
      href={task.url}
      target="_blank"
      rel="noreferrer"
      title={`${task.name}\n${details}`}
      aria-label={`${overdue ? "Overdue: " : "Deadline: "}${task.name}, ${details}`}
    >
      {content}
    </a>
  ) : (
    <span className={className} title={`${task.name}\n${details}`}>
      {content}
    </span>
  )
}

export default DeadlineChip
