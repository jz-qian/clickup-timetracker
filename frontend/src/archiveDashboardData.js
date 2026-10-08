// Loaded once per page load and shared, so switching tabs doesn't refetch
let archivePromise = null
let archiveData = null

export function loadArchiveDashboard() {
  if (!archivePromise) {
    archivePromise = fetch("http://127.0.0.1:8000/archive-dashboard")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not retrieve archive dashboard")
        }

        return response.json()
      })
      .then((data) => {
        archiveData = data
        return data
      })
      .catch((error) => {
        // Allow a retry the next time the tab is opened
        archivePromise = null
        throw error
      })
  }

  return archivePromise
}

export function getLoadedArchiveDashboard() {
  return archiveData
}
