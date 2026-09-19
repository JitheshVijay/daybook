import * as React from "react"

// Shared app actions so pages don't prop-drill.
// { state, commit, storageError, today, aiStatus, navigate(page, params?), page, params,
//   openEntry(entry), logEntry(type?, overrides?), openBook(book?), openSong(song?) }
export const AppContext = React.createContext(null)

export function useApp() {
  const value = React.useContext(AppContext)
  if (!value) throw new Error("useApp must be used inside <AppContext.Provider>")
  return value
}
