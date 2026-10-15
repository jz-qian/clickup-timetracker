// Date and layout helpers shared by the day, week and month calendar views

export const HOUR_HEIGHT = 55
export const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
export const MINUTE = 60 * 1000
export const DAY = 24 * 60 * MINUTE

export function startOfDay(date) {
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  return day
}

export function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

// Weeks start on Sunday, like Google Calendar's default
export function startOfWeek(date) {
  const day = startOfDay(date)
  return addDays(day, -day.getDay())
}

export function startOfMonth(date) {
  const day = startOfDay(date)
  day.setDate(1)
  return day
}

export function addMonths(date, months) {
  const next = startOfMonth(date)
  next.setMonth(next.getMonth() + months)
  return next
}

// Days shown by each view, as Date objects at midnight
export function daysInView(view, anchor) {
  if (view === "day") return [startOfDay(anchor)]

  if (view === "week") {
    const first = startOfWeek(anchor)
    return Array.from({ length: 7 }, (_, index) => addDays(first, index))
  }

  // Month: whole weeks covering the month, so always 5 or 6 rows of 7
  const first = startOfWeek(startOfMonth(anchor))
  const last = addDays(startOfMonth(addMonths(anchor, 1)), -1)
  const days = []
  for (let day = first; day <= last || day.getDay() !== 0; day = addDays(day, 1)) {
    days.push(day)
  }
  return days
}

// Midnight at the end of the day that starts at `dayStart` (ms). Not
// always 24 hours later, because of daylight saving changes.
export function endOfDay(dayStart) {
  return addDays(dayStart, 1).getTime()
}

export function isSameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

export function formatHour(hour) {
  if (hour === 0) return "12 AM"
  if (hour === 12) return "12 PM"
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

export function formatTime(milliseconds) {
  return new Date(milliseconds).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
}

export function formatDuration(milliseconds) {
  const minutes = Math.round(milliseconds / MINUTE)
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${minutes}m`
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
}

// Pixel offset from the top of the hour grid for a time within a day
export function offsetFor(milliseconds, dayStart) {
  return ((milliseconds - dayStart) / (60 * MINUTE)) * HOUR_HEIGHT
}

// Round a time to the nearest `step` minutes
export function roundTo(milliseconds, step) {
  const size = step * MINUTE
  return Math.round(milliseconds / size) * size
}

// The part of each event that falls on one day, or nothing if none does
export function clipToDay(events, dayStart) {
  const dayEnd = endOfDay(dayStart)
  return events
    .filter((event) => event.end > dayStart && event.start < dayEnd)
    .map((event) => ({
      ...event,
      clippedStart: Math.max(event.start, dayStart),
      clippedEnd: Math.min(event.end, dayEnd),
    }))
}

// Side-by-side columns for entries that overlap, like a calendar app.
// Adds `column` and `columns` to each event.
export function layOutColumns(events) {
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

// Assigned tasks with a deadline on the given day
export function deadlinesOn(tasks, dayStart) {
  return tasks
    .filter((task) => task.due_date >= dayStart && task.due_date < endOfDay(dayStart))
    .sort((a, b) => a.due_date - b.due_date)
}
