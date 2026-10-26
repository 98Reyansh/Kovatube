import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const WatchLaterContext = createContext(null)
const STORAGE_KEY = 'yt_watch_later'

export function useWatchLater() {
  const ctx = useContext(WatchLaterContext)
  if (!ctx) throw new Error('useWatchLater must be used within WatchLaterProvider')
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

function entryFrom(video) {
  return {
    id: video.id,
    title: video.title || '',
    thumbnail: video.thumbnail || '',
    channel: video.channel || '',
    duration: video.duration || '',
    addedAt: Date.now(),
  }
}

export function WatchLaterProvider({ children }) {
  const [videos, setVideos] = useState([])

  useEffect(() => { setVideos(readStored()) }, [])

  const persist = useCallback((next) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* quota */ }
  }, [])

  const isInWatchLater = useCallback((id) => videos.some(v => v.id === id), [videos])

  const toggleWatchLater = useCallback((video) => {
    if (!video || !video.id) return
    setVideos(prev => {
      const exists = prev.some(v => v.id === video.id)
      const next = exists
        ? prev.filter(v => v.id !== video.id)
        : [entryFrom(video), ...prev]
      persist(next)
      return next
    })
  }, [persist])

  const removeFromWatchLater = useCallback((id) => {
    setVideos(prev => {
      const next = prev.filter(v => v.id !== id)
      persist(next)
      return next
    })
  }, [persist])

  return (
    <WatchLaterContext.Provider value={{ videos, isInWatchLater, toggleWatchLater, removeFromWatchLater }}>
      {children}
    </WatchLaterContext.Provider>
  )
}
