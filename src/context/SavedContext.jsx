import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const SavedContext = createContext(null)
const STORAGE_KEY = 'yt_saved_videos'

export function useSaved() {
  const ctx = useContext(SavedContext)
  if (!ctx) throw new Error('useSaved must be used within SavedProvider')
  return ctx
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function SavedProvider({ children }) {
  const [saved, setSaved] = useState([])

  useEffect(() => { setSaved(readStored()) }, [])

  const persist = useCallback((next) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* quota */ }
  }, [])

  const isSaved = useCallback((id) => saved.some(v => v.id === id), [saved])

  const toggleSave = useCallback((video) => {
    if (!video || !video.id) return
    setSaved(prev => {
      const exists = prev.some(v => v.id === video.id)
      const next = exists
        ? prev.filter(v => v.id !== video.id)
        : [{
            id: video.id,
            title: video.title || '',
            thumbnail: video.thumbnail || '',
            channel: video.channel || '',
            duration: video.duration || '',
            savedAt: Date.now(),
          }, ...prev]
      persist(next)
      return next
    })
  }, [persist])

  const removeSaved = useCallback((id) => {
    setSaved(prev => {
      const next = prev.filter(v => v.id !== id)
      persist(next)
      return next
    })
  }, [persist])

  return (
    <SavedContext.Provider value={{ saved, isSaved, toggleSave, removeSaved }}>
      {children}
    </SavedContext.Provider>
  )
}
