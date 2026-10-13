import { Fragment, useState } from "react"
import { formatDueDate, formatHoursOrDash } from "./timeFormat.js"

const NO_TASK_ID = "no-task"

function memberNames(tasks) {
  const names = new Set()

  tasks.forEach((task) => {
    ;(task.assignees || []).forEach((person) => {
      names.add(person.username || person.email || "Unknown user")
    })
  })

  return Array.from(names)
}

function formatMembers(names) {
  return names.length > 0 ? names.join(", ") : "-"
}

// Billable / non-billable totals for a set of time entries
function sumTime(entries) {
  const billable = entries
    .filter((entry) => entry.billable)
    .reduce((total, entry) => total + entry.duration, 0)
  const nonBillable = entries
    .filter((entry) => !entry.billable)
    .reduce((total, entry) => total + entry.duration, 0)

  return { billable, nonBillable, total: billable + nonBillable }
}

function TimeColumns({ time }) {
  return (
    <>
      <td>{formatHoursOrDash(time.total)}</td>
      <td>{formatHoursOrDash(time.billable)}</td>
      <td>{formatHoursOrDash(time.nonBillable)}</td>
    </>
  )
}

// Overview: one row per client/project, with an indented row per task.
// Subtask time is rolled up into its parent task.
function ProjectsOverview({ entries, taskLookup, spaceIds, onOpenSpace }) {
  const projects = new Map()

  entries.forEach((entry) => {
    const spaceId = entry.spaceId || "unknown"
    if (!projects.has(spaceId)) {
      projects.set(spaceId, { id: spaceId, name: entry.spaceName, tasks: new Map() })
    }

    const task = taskLookup.get(entry.taskId)
    const topTaskId = task?.parentId || entry.taskId || NO_TASK_ID
    const tasks = projects.get(spaceId).tasks

    if (!tasks.has(topTaskId)) {
      tasks.set(topTaskId, { id: topTaskId, name: entry.parentTaskName, entries: [] })
    }
    tasks.get(topTaskId).entries.push(entry)
  })

  return (
    <div className="table-container">
      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Client / Project</th>
            <th>Total Time</th>
            <th>Billable Hours</th>
            <th>Non-Billable Hours</th>
            <th>Due Date</th>
            <th>Team Member(s)</th>
          </tr>
        </thead>

        <tbody>
          {Array.from(projects.values()).map((project) => {
            const projectTasks = Array.from(project.tasks.values()).map((row) => {
              const task = taskLookup.get(row.id)
              const taggedTasks = task ? [task, ...(task.subtasks || [])] : []

              return {
                ...row,
                time: sumTime(row.entries),
                dueDate: task?.due_date,
                members: memberNames(taggedTasks),
              }
            })
            const projectMembers = Array.from(
              new Set(projectTasks.flatMap((row) => row.members))
            )

            return (
              <Fragment key={project.id}>
                <tr className="project-row">
                  <td>
                    {spaceIds.has(project.id) ? (
                      <button
                        className="link-button"
                        onClick={() => onOpenSpace(project.id)}
                      >
                        {project.name}
                      </button>
                    ) : (
                      project.name
                    )}
                  </td>
                  <TimeColumns time={sumTime(projectTasks.flatMap((row) => row.entries))} />
                  <td>-</td>
                  <td>{formatMembers(projectMembers)}</td>
                </tr>

                {projectTasks.map((row) => (
                  <tr key={row.id} className="task-row">
                    <td className="indent-1">{row.name}</td>
                    <TimeColumns time={row.time} />
                    <td>{formatDueDate(row.dueDate)}</td>
                    <td>{formatMembers(row.members)}</td>
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Detail: every task in one space, grouped by list, with subtasks indented.
// Each row shows the time logged on that task itself.
function SpaceDetail({ space, lists, tasks, entries }) {
  const spaceLists = lists.filter((list) => list.spaceId === space.id)
  const entriesByTask = new Map()

  entries.forEach((entry) => {
    if (!entriesByTask.has(entry.taskId)) {
      entriesByTask.set(entry.taskId, [])
    }
    entriesByTask.get(entry.taskId).push(entry)
  })

  const taskRow = (task, indentClass) => (
    <tr key={task.id} className="task-row">
      <td className={indentClass}>{task.name}</td>
      <td>{task.status?.status || "-"}</td>
      <TimeColumns time={sumTime(entriesByTask.get(task.id) || [])} />
      <td>{formatHoursOrDash(Number(task.time_estimate) || 0)}</td>
      <td>{formatDueDate(task.due_date)}</td>
      <td>{formatMembers(memberNames([task]))}</td>
    </tr>
  )

  const spaceTasks = tasks.filter((task) =>
    spaceLists.some((list) => list.id === task.listId)
  )

  return (
    <>
      <p className="breakdown-note">
        Every task in {space.name}. Times follow the filters above; subtask
        time is shown on the subtask's own row.
      </p>
      {spaceTasks.length === 0 && (
        <p className="empty-state">No tasks loaded for this space yet.</p>
      )}
      <div className="table-container">
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Total Time</th>
              <th>Billable Hours</th>
              <th>Non-Billable Hours</th>
              <th>Estimate</th>
              <th>Due Date</th>
              <th>Team Member(s)</th>
            </tr>
          </thead>

          <tbody>
            {spaceLists.map((list) => {
              const listTasks = spaceTasks.filter((task) => task.listId === list.id)
              if (listTasks.length === 0) {
                return null
              }

              return (
                <Fragment key={list.id}>
                  <tr className="project-row">
                    <td colSpan={8}>{list.name}</td>
                  </tr>
                  {listTasks.map((task) => (
                    <Fragment key={task.id}>
                      {taskRow(task, "indent-1")}
                      {(task.subtasks || []).map((subtask) =>
                        taskRow(subtask, "indent-2")
                      )}
                    </Fragment>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// Time breakdown section: an overview tab plus a tab per space
function TimeBreakdown({ entries, spaces, lists, tasks }) {
  const [selectedSpaceId, setSelectedSpaceId] = useState("all")

  const taskLookup = new Map()
  tasks.forEach((task) => {
    taskLookup.set(task.id, { ...task, parentId: null })
    ;(task.subtasks || []).forEach((subtask) => {
      taskLookup.set(subtask.id, { ...subtask, parentId: task.id })
    })
  })

  const spaceIds = new Set(spaces.map((space) => space.id))
  const selectedSpace = spaces.find((space) => space.id === selectedSpaceId)

  return (
    <>
      <nav className="tab-navigation sub-tabs" aria-label="Projects">
        <button
          className={!selectedSpace ? "tab-button active" : "tab-button"}
          onClick={() => setSelectedSpaceId("all")}
        >
          All Projects
        </button>
        {spaces.map((space) => (
          <button
            key={space.id}
            className={selectedSpaceId === space.id ? "tab-button active" : "tab-button"}
            onClick={() => setSelectedSpaceId(space.id)}
          >
            {space.name}
          </button>
        ))}
      </nav>

      {selectedSpace ? (
        <SpaceDetail
          space={selectedSpace}
          lists={lists}
          tasks={tasks}
          entries={entries}
        />
      ) : (
        <ProjectsOverview
          entries={entries}
          taskLookup={taskLookup}
          spaceIds={spaceIds}
          onOpenSpace={setSelectedSpaceId}
        />
      )}
    </>
  )
}

export default TimeBreakdown
