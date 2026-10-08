import { useState } from "react"

const API_URL = "http://127.0.0.1:8000"

async function postJson(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.detail || `Request failed (${response.status})`)
  }

  return data
}

function formatHours(hours) {
  return hours === null || hours === undefined ? "—" : `${hours}h`
}

function sumHours(values) {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100
}

// AI tab: estimates a new task's hours from similar completed tasks, and adds
// the estimate to a running total for a project.
function AiEstimator() {
  // The key stays in this component's memory; it's sent with each request
  // and never saved.
  const [apiKey, setApiKey] = useState("")
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)

  // The company the key belongs to, and the agents that key can run
  const [providerName, setProviderName] = useState("")
  const [agents, setAgents] = useState([])
  const [agentId, setAgentId] = useState("")

  const [projects, setProjects] = useState([])
  const [historySize, setHistorySize] = useState(null)
  const [projectId, setProjectId] = useState("")

  const [taskName, setTaskName] = useState("")
  const [taskDescription, setTaskDescription] = useState("")
  const [estimating, setEstimating] = useState(false)
  const [estimate, setEstimate] = useState(null)

  // New tasks added to each project's total, keyed by project id
  const [addedTasks, setAddedTasks] = useState({})

  const [error, setError] = useState(null)

  const connect = async () => {
    setConnecting(true)
    setError(null)

    try {
      const connection = await postJson("/ai/connect", { api_key: apiKey })

      const response = await fetch(`${API_URL}/ai/projects`)
      if (!response.ok) {
        throw new Error("Could not load project history")
      }
      const data = await response.json()

      setProjects(data.projects)
      setHistorySize(data.completed_task_count)
      setProjectId((current) => current || data.projects[0]?.id || "")
      setProviderName(connection.provider_name)
      setAgents(connection.agents)
      setAgentId(connection.agents[0]?.id || "")
      setConnected(true)
    } catch (error) {
      setError(error.message)
    } finally {
      setConnecting(false)
    }
  }

  const runEstimate = async () => {
    setEstimating(true)
    setEstimate(null)
    setError(null)

    try {
      setEstimate(
        await postJson("/ai/run", {
          api_key: apiKey,
          agent_id: agentId,
          task_name: taskName,
          task_description: taskDescription,
        })
      )
    } catch (error) {
      setError(error.message)
    } finally {
      setEstimating(false)
    }
  }

  const addToProject = () => {
    setAddedTasks((current) => ({
      ...current,
      [projectId]: [
        ...(current[projectId] || []),
        {
          id: crypto.randomUUID(),
          name: estimate.task_name,
          hours: estimate.projection.average_hours,
        },
      ],
    }))
    setEstimate(null)
    setTaskName("")
    setTaskDescription("")
  }

  const removeFromProject = (taskId) => {
    setAddedTasks((current) => ({
      ...current,
      [projectId]: current[projectId].filter((task) => task.id !== taskId),
    }))
  }

  const project = projects.find((current) => current.id === projectId)
  const projectAdded = addedTasks[projectId] || []
  const addedHours = sumHours(projectAdded.map((task) => task.hours))

  return (
    <div>
      <h2>AI Agents</h2>

      <h3>1. Connect</h3>
      <p>
        <label htmlFor="ai-key">API key </label>
        <input
          id="ai-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value)
            setConnected(false)
          }}
          placeholder="Your company's AI API key"
        />{" "}
        <button onClick={connect} disabled={connecting}>
          {connecting ? "Connecting..." : "Connect"}
        </button>
      </p>
      <p>
        Supported: Anthropic (sk-ant-...). Leave blank to use the backend's
        own key. The key is only kept while this page is open.
      </p>
      {connected && (
        <p>
          Connected to {providerName}. {historySize} completed tasks with
          tracked time available.
        </p>
      )}

      {error && <p>Error: {error}</p>}

      {connected && (
        <>
          <h3>2. Agent</h3>
          <p>
            <select
              value={agentId}
              onChange={(event) => {
                setAgentId(event.target.value)
                setEstimate(null)
              }}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>{" "}
            {agents.find((agent) => agent.id === agentId)?.description}
          </p>

          <h3>3. Project</h3>
          <p>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((current) => (
                <option key={current.id} value={current.id}>
                  {current.name}
                </option>
              ))}
            </select>
          </p>

          <h3>4. New task</h3>
          <p>
            <label htmlFor="ai-task-name">Task name </label>
            <input
              id="ai-task-name"
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
            />
          </p>
          <p>
            <label htmlFor="ai-task-description">Description (optional)</label>
            <br />
            <textarea
              id="ai-task-description"
              rows={3}
              cols={60}
              value={taskDescription}
              onChange={(event) => setTaskDescription(event.target.value)}
            />
          </p>
          <p>
            <button
              onClick={runEstimate}
              disabled={estimating || !agentId || !taskName.trim()}
            >
              {estimating ? "Estimating (this can take a minute)..." : "Estimate"}
            </button>
          </p>

          {estimate && (
            <div>
              <h3>Estimate for "{estimate.task_name}"</h3>

              {estimate.projection.sample_size === 0 ? (
                <p>No similar completed tasks were found.</p>
              ) : (
                <>
                  <p>
                    Average: {formatHours(estimate.projection.average_hours)}{" "}
                    (from {estimate.projection.sample_size} similar tasks)
                  </p>
                  <p>
                    Median: {formatHours(estimate.projection.median_hours)} —
                    Range: {formatHours(estimate.projection.min_hours)} to{" "}
                    {formatHours(estimate.projection.max_hours)}
                  </p>
                </>
              )}
              <p>Confidence: {estimate.confidence}</p>
              <p>Reasoning: {estimate.reasoning}</p>

              <h4>Similar completed tasks</h4>
              {estimate.similar_tasks.map((task) => (
                <p key={task.id}>
                  {task.name} ({task.project}
                  {task.list && ` / ${task.list}`}) — {formatHours(task.hours)}{" "}
                  — Assigned:{" "}
                  {task.assignees.length === 0
                    ? "nobody"
                    : task.assignees
                        .map(
                          (person) =>
                            `${person.name} (${person.role || "no role"})`
                        )
                        .join(", ")}
                </p>
              ))}

              {estimate.projection.average_hours !== null && project && (
                <button onClick={addToProject}>
                  Add {formatHours(estimate.projection.average_hours)} to{" "}
                  {project.name}
                </button>
              )}
            </div>
          )}

          {project && (
            <div>
              <h3>Projected total for {project.name}</h3>
              <p>Hours logged so far: {formatHours(project.logged_hours)}</p>
              <p>
                Remaining ClickUp estimates on open tasks:{" "}
                {formatHours(project.open_remaining_estimate_hours)} (
                {project.open_task_count} open tasks)
              </p>
              <p>New tasks estimated here: {formatHours(addedHours)}</p>
              {projectAdded.map((task) => (
                <p key={task.id}>
                  — {task.name}: {formatHours(task.hours)}{" "}
                  <button onClick={() => removeFromProject(task.id)}>
                    Remove
                  </button>
                </p>
              ))}
              <p>
                <strong>
                  Projected total:{" "}
                  {formatHours(
                    sumHours([
                      project.logged_hours,
                      project.open_remaining_estimate_hours,
                      addedHours,
                    ])
                  )}
                </strong>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default AiEstimator
