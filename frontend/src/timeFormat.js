// Format duration in milliseconds to hours/minutes string
export function formatDuration(milliseconds) {
  const totalMinutes = Math.round(milliseconds / 60000)

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`
  }

  if (hours > 0) {
    return `${hours}h`
  }

  return `${minutes}m`
}

// Same as formatDuration, but "-" when there's no time
export function formatHoursOrDash(milliseconds) {
  return milliseconds > 0 ? formatDuration(milliseconds) : "-"
}

// ClickUp dates are millisecond strings (or null)
export function formatDueDate(value) {
  return value ? new Date(Number(value)).toLocaleDateString() : "-"
}
