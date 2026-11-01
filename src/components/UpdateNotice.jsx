import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const UpdateContext = createContext(null)

export function useAppUpdate() {
  const ctx = useContext(UpdateContext)
  if (!ctx) throw new Error('useAppUpdate must be used within UpdateProvider')
  return ctx
}

export function UpdateProvider({ children }) {
  const [state, setState] = useState(null)
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return undefined
    api.appVersion?.().then((version) => {
      if (version) setState((prev) => prev || { current: version, latest: '', available: false, status: 'idle', reason: '' })
    }).catch(() => {})
    api.onUpdateAvailable?.((data) => setState(data))
    api.onUpdateProgress?.((data) => setProgress(data && data.percent))
    api.onUpdateError?.((data) => setState(data))
    return () => api.removeUpdateListeners?.()
  }, [])

  const check = useCallback(async () => {
    if (!window.electronAPI?.checkForUpdate) return null
    setChecking(true)
    try {
      const result = await window.electronAPI.checkForUpdate()
      if (result) setState(result)
      return result
    } finally {
      setChecking(false)
    }
  }, [])

  const install = useCallback(async () => {
    if (!window.electronAPI?.updateInstall) return null
    setState((prev) => (prev ? { ...prev, status: 'downloading' } : prev))
    setProgress(0)
    const result = await window.electronAPI.updateInstall()
    if (result && result.opened) setState((prev) => (prev ? { ...prev, status: 'available' } : prev))
    else if (result && !result.ok) setState(result)
    return result
  }, [])

  return (
    <UpdateContext.Provider value={{ state, checking, progress, check, install }}>
      {children}
    </UpdateContext.Provider>
  )
}

export function UpdateBanner() {
  const { state, progress, install } = useAppUpdate()
  if (!state || !state.available) return null
  const downloading = state.status === 'downloading'
  const label = downloading
    ? (progress != null ? `Downloading ${progress}%` : 'Downloading…')
    : 'Update'
  return (
    <div className="flex items-center justify-between gap-3 border-b border-yt-red/20 bg-yt-red/10 px-4 py-2 text-sm">
      <p>Version {state.latest} is available.</p>
      <button
        type="button"
        onClick={install}
        disabled={downloading}
        className="btn-accent px-3 py-1 text-xs disabled:opacity-60"
      >
        {label}
      </button>
    </div>
  )
}
