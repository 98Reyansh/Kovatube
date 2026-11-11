import { api } from '../lib/bridge'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const SmartDownloadContext = createContext(null)

export function useSmartDownloads() {
  const ctx = useContext(SmartDownloadContext)
  if (!ctx) throw new Error('useSmartDownloads must be used within SmartDownloadProvider')
  return ctx
}

export function SmartDownloadProvider({ children }) {
  const [enabled, setEnabled] = useState(false)
  const [clipboard, setClipboard] = useState(false)
  const [counts, setCounts] = useState({ fyp: 0, clipboard: 0, limit: 0 })
  const [activeDownloads, setActiveDownloads] = useState([])
  const [history, setHistory] = useState([])
  const [hasHydrated, setHasHydrated] = useState(false)

  useEffect(() => {
    if (!api) { setHasHydrated(true); return }
    api.smartDlStatus().then(status => {
      setEnabled(status.enabled)
      if (typeof status.clipboard === 'boolean') setClipboard(status.clipboard)
      setCounts({ fyp: status.count || 0, clipboard: status.clipboardCount || 0, limit: status.limit || 0 })
      setActiveDownloads(status.active)
      setHasHydrated(true)
    }).catch(() => setHasHydrated(true))
    api.smartDlHistory().then(h => setHistory(h)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!api) return

    const handleProgress = (data) => {
      setActiveDownloads(prev => {
        const idx = prev.findIndex(d => d.id === data.id)
        const item = {
          id: data.id,
          videoId: data.videoId,
          title: data.title || '',
          fileName: data.fileName || '',
          progress: data.progress || 0,
          speed: data.speed || '',
          eta: data.eta || '',
          totalSize: data.totalSize || '',
          status: data.status,
          error: data.error || null,
        }
        if (data.status === 'failed') {
          return prev.filter(d => d.id !== data.id)
        }
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], ...item }
          return next
        }
        return [...prev, item]
      })
    }

    const handleComplete = (data) => {
      setActiveDownloads(prev => prev.filter(d => d.id !== data.id))
      setHistory(prev => [{
        id: data.id,
        videoId: data.videoId,
        title: data.title,
        fileName: data.fileName,
        filePath: data.filePath,
        totalBytes: data.totalBytes,
        status: 'completed',
        completedAt: data.completedAt,
      }, ...prev])
    }

    const handleCancelled = (data) => {
      setActiveDownloads(prev => prev.filter(d => d.id !== data.id))
    }

    api.onSmartDlProgress(handleProgress)
    api.onSmartDlComplete(handleComplete)
    api.onSmartDlCancelled(handleCancelled)

    return () => { api.removeSmartDlListeners() }
  }, [])

  const toggleSmartDownload = useCallback(async (nextEnabled) => {
    if (!api) return false
    try {
      const val = nextEnabled !== undefined ? nextEnabled : !enabled
      const result = await api.smartDlToggle(val)
      setEnabled(result.enabled)
      if (typeof result.clipboard === 'boolean') setClipboard(result.clipboard)
      return result.enabled
    } catch (e) {
      console.error('[SmartDownloadContext] toggle failed:', e)
      return false
    }
  }, [enabled])

  const toggleClipboard = useCallback(async (nextEnabled) => {
    if (!api) return false
    try {
      const val = nextEnabled !== undefined ? nextEnabled : !clipboard
      const result = await api.smartDlClipboardToggle(val)
      if (typeof result.clipboard === 'boolean') setClipboard(result.clipboard)
      return result.clipboard
    } catch (e) {
      console.error('[SmartDownloadContext] clipboard toggle failed:', e)
      return false
    }
  }, [clipboard])

  const cancelSmartDownload = useCallback(async (dlId) => {
    if (!api) return false
    try { return await api.smartDlCancel(dlId) }
    catch (e) { console.error('[SmartDownloadContext] cancel failed:', e); return false }
  }, [])

  const refreshHistory = useCallback(async () => {
    if (!api) return
    const h = await api.smartDlHistory()
    setHistory(h)
  }, [])

  const refreshStatus = useCallback(async () => {
    if (!api) return
    try {
      const status = await api.smartDlStatus()
      setEnabled(status.enabled)
      if (typeof status.clipboard === 'boolean') setClipboard(status.clipboard)
      setCounts({ fyp: status.count || 0, clipboard: status.clipboardCount || 0, limit: status.limit || 0 })
      setActiveDownloads(status.active)
    } catch {}
  }, [])

  const resetCounts = useCallback(async () => {
    if (!api) return null
    try {
      const res = await api.smartDlResetCounts()
      setCounts(c => ({ ...c, fyp: 0, clipboard: 0 }))
      return res
    } catch (e) {
      console.error('[SmartDownloadContext] reset failed:', e)
      return null
    }
  }, [])

  return (
    <SmartDownloadContext.Provider value={{
      enabled, clipboard, counts, activeDownloads, history, hasHydrated,
      toggleSmartDownload, toggleClipboard, cancelSmartDownload,
      refreshHistory, refreshStatus, resetCounts,
    }}>
      {children}
    </SmartDownloadContext.Provider>
  )
}