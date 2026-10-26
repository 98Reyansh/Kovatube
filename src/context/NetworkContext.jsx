import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'

// Tracks whether the app can reach the network and powers the offline screen.
//
// Detection is intentionally layered so we don't cry "offline" by mistake:
//   1. navigator.onLine + the window online/offline events (fast, OS-level).
//   2. A `network-error` ping from the main process whenever a real request
//      fails at the network level — this catches "connected to Wi-Fi but the
//      internet is unreachable".
// Every signal is confirmed with an explicit probe before we commit to
// offline, and `retry()` re-probes on demand.
const NetworkContext = createContext(null)

export function useNetwork() {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider')
  return ctx
}

export function NetworkProvider({ children }) {
  const initial = typeof navigator === 'undefined' ? true : navigator.onLine !== false
  const [online, setOnline] = useState(initial)
  const [checking, setChecking] = useState(false)
  // Bumped after a successful retry so the current page refetches its data.
  const [refreshToken, setRefreshToken] = useState(0)
  const lastProbeRef = useRef(0)

  const probe = useCallback(async ({ force = false } = {}) => {
    const now = Date.now()
    if (!force && now - lastProbeRef.current < 4000) return undefined
    lastProbeRef.current = now
    try {
      if (window.electronAPI?.netProbe) {
        const r = await window.electronAPI.netProbe()
        return !!(r && r.ok)
      }
      // Plain browser (e.g. preview): fall back to the navigator hint.
      return typeof navigator === 'undefined' ? true : navigator.onLine !== false
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    const goOnline = async () => {
      const ok = await probe({ force: true })
      setOnline(ok !== false)
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [probe])

  // Main process couldn't reach the network on a real request → confirm offline.
  useEffect(() => {
    if (!window.electronAPI?.onNetworkError) return
    const onNetError = async () => {
      const ok = await probe()
      if (ok === false) setOnline(false)
    }
    window.electronAPI.onNetworkError(onNetError)
    return () => window.electronAPI.removeNetworkErrorListeners?.()
  }, [probe])

  const retry = useCallback(async () => {
    setChecking(true)
    const ok = await probe({ force: true })
    setChecking(false)
    if (ok) {
      setOnline(true)
      setRefreshToken((n) => n + 1)
    } else {
      setOnline(false)
    }
    return !!ok
  }, [probe])

  // Let data-loading code report a failure; a probe decides if it's really offline.
  const reportNetworkFailure = useCallback(async () => {
    const ok = await probe()
    if (ok === false) setOnline(false)
  }, [probe])

  return (
    <NetworkContext.Provider value={{ online, checking, retry, reportNetworkFailure, refreshToken }}>
      {children}
    </NetworkContext.Provider>
  )
}
