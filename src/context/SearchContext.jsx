import { createContext, useContext, useState, useCallback } from 'react'

const SearchContext = createContext()

export function SearchProvider({ children }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ videos: [], shorts: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [isHomeFeed, setIsHomeFeed] = useState(false)

  const search = useCallback(async (searchQuery) => {
    if (!searchQuery || !searchQuery.trim()) return

    setLoading(true)
    setError(null)
    setQuery(searchQuery)
    setHasSearched(true)
    setIsHomeFeed(false)

    try {
      if (window.electronAPI) {
        const data = await window.electronAPI.ytSearch(searchQuery)
        if (data.error) {
          setError(data.error)
          setResults({ videos: [], shorts: [] })
        } else {
          setResults({ videos: data.videos || [], shorts: data.shorts || [] })
        }
      } else {
        setError('Electron API not available. Run in Electron for full functionality.')
        setResults({ videos: [], shorts: [] })
      }
    } catch (err) {
      console.error('[Search]', err)
      setError(err.message || 'Search failed. Please try again.')
      setResults({ videos: [], shorts: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHomeFeed = useCallback(async () => {
    setLoading(true)
    setError(null)
    setQuery('')
    setHasSearched(false)
    setIsHomeFeed(true)

    try {
      if (window.electronAPI) {
        const data = await window.electronAPI.ytHomeFeed()
        if (data.error && !(data.videos?.length || data.shorts?.length)) {
          setError(data.error)
          setResults({ videos: [], shorts: [] })
        } else {
          setResults({ videos: data.videos || [], shorts: data.shorts || [] })
        }
      } else {
        setError('Electron API not available. Run in Electron for full functionality.')
        setResults({ videos: [], shorts: [] })
      }
    } catch (err) {
      console.error('[HomeFeed]', err)
      setError(err.message || 'Failed to load home feed.')
      setResults({ videos: [], shorts: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  const clearSearch = useCallback(() => {
    setQuery('')
    setResults({ videos: [], shorts: [] })
    setError(null)
    setHasSearched(false)
    setIsHomeFeed(false)
  }, [])

  return (
    <SearchContext.Provider value={{ query, results, loading, error, hasSearched, isHomeFeed, search, loadHomeFeed, clearSearch }}>
      {children}
    </SearchContext.Provider>
  )
}

export const useSearch = () => useContext(SearchContext)