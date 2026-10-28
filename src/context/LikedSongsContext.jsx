import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useToast } from './ToastContext'

const LikedSongsContext = createContext({
  liked: () => false,
  toggle: async () => false,
})

export function LikedSongsProvider({ children }) {
  const { addToast } = useToast()
  const [ids, setIds] = useState(() => new Set())

  useEffect(() => {
    let alive = true
    window.electronAPI?.ytMusicLikedIds?.()
      .then((list) => {
        if (!alive || !Array.isArray(list)) return
        setIds(new Set(list))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const liked = useCallback((videoId) => !!videoId && ids.has(videoId), [ids])

  const toggle = useCallback(async (videoId) => {
    if (!videoId) return false
    if (!window.electronAPI?.ytMusicRate) {
      addToast('error', 'Likes need the desktop app', 3000)
      return false
    }
    const wasLiked = ids.has(videoId)
    const nextLiked = !wasLiked
    setIds((prev) => {
      const next = new Set(prev)
      if (nextLiked) next.add(videoId)
      else next.delete(videoId)
      return next
    })
    const res = await window.electronAPI.ytMusicRate({ videoId, like: nextLiked }).catch((e) => ({ ok: false, reason: e.message }))
    if (!res?.ok) {
      setIds((prev) => {
        const next = new Set(prev)
        if (wasLiked) next.add(videoId)
        else next.delete(videoId)
        return next
      })
      addToast('error', res?.reason || 'Could not update Liked Music', 3500)
      return false
    }
    addToast('success', nextLiked ? 'Added to Liked Music' : 'Removed from Liked Music', 2200)
    return true
  }, [addToast, ids])

  return (
    <LikedSongsContext.Provider value={{ liked, toggle }}>
      {children}
    </LikedSongsContext.Provider>
  )
}

export function useLikedSongs() {
  return useContext(LikedSongsContext)
}
