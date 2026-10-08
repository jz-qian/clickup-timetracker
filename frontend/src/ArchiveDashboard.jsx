import { useEffect, useState } from "react"

// Raw view of GET /archive-dashboard (archived clients summary)
function ArchiveDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch("http://127.0.0.1:8000/archive-dashboard")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not retrieve archive dashboard")
        }

        return response.json()
      })
      .then(setData)
      .catch((error) => {
        setError(error.message)
      })
  }, [])

  if (error) {
    return <p>Error: {error}</p>
  }

  if (!data) {
    return <p>Loading archive dashboard...</p>
  }

  return <pre>{JSON.stringify(data, null, 2)}</pre>
}

export default ArchiveDashboard
