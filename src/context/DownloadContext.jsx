import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useToast } from './ToastContext'

const DownloadContext = createContext(null)

export function useDownloads() {
  const ctx = useContext(DownloadContext)
  if (!ctx) throw new Error('useDownloads must be used within DownloadProvider')
  return ctx
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`
}

function formatEta(seconds) {
  if (seconds > 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  if (seconds > 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  if (seconds > 0) return `${seconds}s`
  return 'Almost done...'
}

export function DownloadProvider({ children }) {
  const { addToast } = useToast()
  const toastHandledIds = useRef(new Set())
  const [activeDownloads, setActiveDownloads] = useState([])
  const [completedDownloads, setCompletedDownloads] = useState([])
  const [playlists, setPlaylists] = useState([])
  const [syncingPlaylists, setSyncingPlaylists] = useState([])
  const [hasHydrated, setHasHydrated] = useState(false)

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.dlActive().then(list => {
      setActiveDownloads(list)
      setHasHydrated(true)
    }).catch(() => setHasHydrated(true))
    window.electronAPI.dlCompleted().then(list => setCompletedDownloads(list)).catch(() => {})
    window.electronAPI.dlPlaylists?.().then(list => setPlaylists(list || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return

    const handleProgress = (data) => {
      if (data.status === 'downloading') {
        setActiveDownloads(prev => {
          const idx = prev.findIndex(d => d.id === data.id)
          const item = {
            id: data.id,
            progress: data.progress || 0,
            speed: data.speed || 0,
            transferredBytes: data.transferredBytes || 0,
            totalBytes: data.totalBytes || 0,
            eta: data.eta || '',
            fileName: data.fileName || '',
            title: data.title || '',
            thumbnail: data.thumbnail || '',
            quality: data.quality || '',
            format: data.format || '',
            videoId: data.videoId || '',
          }
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = { ...next[idx], ...item }
            return next
          }
          return [...prev, item]
        })
      } else if (data.status === 'failed' || data.status === 'cancelled') {
        setActiveDownloads(prev => prev.filter(d => d.id !== data.id))
      }
    }

    const handleComplete = (data) => {
      setActiveDownloads(prev => prev.filter(d => d.id !== data.id))
      setCompletedDownloads(prev => {
        if (prev.some(c => c.id === data.id)) return prev
        return [{
          id: data.id,
          videoId: data.videoId,
          title: data.title || data.fileName,
          thumbnail: data.thumbnail || '',
          fileName: data.fileName,
          filePath: data.filePath,
          quality: data.quality,
          format: data.format,
          totalBytes: data.totalBytes,
          completedAt: data.completedAt,
          status: 'completed',
          artist: data.artist || '',
          duration: data.duration || '',
          audio: !!data.audio,
          isAudio: !!data.isAudio,
          localUrl: data.localUrl || '',
          hasLyrics: !!data.hasLyrics,
        }, ...prev]
      })
      if (!toastHandledIds.current.has(data.id)) {
        toastHandledIds.current.add(data.id)
        addToast('success', `Download complete: ${data.title || data.fileName || 'video'}`, 6000)
      }
    }

    window.electronAPI.onDownloadProgress(handleProgress)
    window.electronAPI.onDownloadComplete(handleComplete)

    return () => {
      window.electronAPI.removeDownloadListeners()
    }
  }, [])

  const startDownload = useCallback(async ({ videoId, quality, format, title, thumbnail, audio }) => {
    if (!window.electronAPI) return null
    try {
      const dlId = await window.electronAPI.dlStart({ videoId, quality, format, title, thumbnail, audio: !!audio })
      if (dlId) {
        setActiveDownloads(prev => [...prev, {
          id: dlId, videoId, quality, format, title, thumbnail,
          progress: 0, speed: 0, transferredBytes: 0, totalBytes: 0,
          eta: 'Starting...', fileName: '', status: 'downloading',
        }])
      }
      return dlId
    } catch (e) {
      console.error('[DownloadContext] startDownload failed:', e)
      return null
    }
  }, [])

  const cancelDownload = useCallback(async (downloadId) => {
    if (!window.electronAPI) return false
    try {
      const ok = await window.electronAPI.dlCancel(downloadId)
      if (ok) setActiveDownloads(prev => prev.filter(d => d.id !== downloadId))
      return ok
    } catch (e) {
      console.error('[DownloadContext] cancelDownload failed:', e)
      return false
    }
  }, [])

  const playFile = useCallback(async (filePath) => {
    if (!window.electronAPI) return false
    try { return await window.electronAPI.dlPlay(filePath) }
    catch (e) { console.error('[DownloadContext] playFile failed:', e); return false }
  }, [])

  const showInFolder = useCallback(async (filePath) => {
    if (!window.electronAPI) return false
    try { return await window.electronAPI.dlShowInFolder(filePath) }
    catch (e) { console.error('[DownloadContext] showInFolder failed:', e); return false }
  }, [])

  const refreshPlaylists = useCallback(async () => {
    if (!window.electronAPI?.dlPlaylists) return
    try { setPlaylists(await window.electronAPI.dlPlaylists() || []) } catch {}
  }, [])

  // Auto-download newly added songs: toggle the switch, or check a playlist now.
  const setPlaylistAutoSync = useCallback(async (id, enabled) => {
    if (!window.electronAPI?.dlPlaylistAutoSync) return false
    try {
      const ok = await window.electronAPI.dlPlaylistAutoSync(id, enabled)
      await refreshPlaylists()
      return ok
    } catch { return false }
  }, [refreshPlaylists])

  const syncPlaylist = useCallback(async (id) => {
    if (!window.electronAPI?.dlPlaylistSync) return null
    try { return await window.electronAPI.dlPlaylistSync(id) }
    catch { return null }
  }, [])

  const syncAllPlaylists = useCallback(async () => {
    if (!window.electronAPI?.dlSyncAll) return null
    try { return await window.electronAPI.dlSyncAll() }
    catch { return null }
  }, [])

  const refreshCompleted = useCallback(async () => {
    if (!window.electronAPI) return
    const [list, pls] = await Promise.all([
      window.electronAPI.dlCompleted(),
      window.electronAPI.dlPlaylists ? window.electronAPI.dlPlaylists() : Promise.resolve([]),
    ])
    setCompletedDownloads(list)
    setPlaylists(pls || [])
  }, [])

  // The main process tells us when a playlist record changes (a track landed or
  // the group was created) so the Downloaded tab can update as it fills in.
  useEffect(() => {
    if (!window.electronAPI?.onPlaylistUpdate) return
    const onUpdate = () => { refreshPlaylists() }
    window.electronAPI.onPlaylistUpdate(onUpdate)
    return () => { window.electronAPI.removePlaylistUpdateListeners?.() }
  }, [refreshPlaylists])

  // Auto-sync start/finish, so the UI can spin the playlist's sync control.
  useEffect(() => {
    if (!window.electronAPI?.onPlaylistSync) return
    const onSync = (data) => {
      const id = data && data.id
      if (id) {
        setSyncingPlaylists((prev) => (
          data.status === 'started'
            ? (prev.includes(id) ? prev : [...prev, id])
            : prev.filter((x) => x !== id)
        ))
      }
      refreshPlaylists()
    }
    window.electronAPI.onPlaylistSync(onSync)
    return () => { window.electronAPI.removePlaylistSyncListeners?.() }
  }, [refreshPlaylists])

  return (
    <DownloadContext.Provider value={{
      activeDownloads, completedDownloads, playlists, syncingPlaylists, hasHydrated,
      startDownload, cancelDownload, playFile, showInFolder, refreshCompleted, refreshPlaylists,
      setPlaylistAutoSync, syncPlaylist, syncAllPlaylists,
      formatBytes, formatSpeed, formatEta,
    }}>
      {children}
    </DownloadContext.Provider>
  )
}