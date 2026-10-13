import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './AuthContext'
import { useSettings } from './SettingsContext'

const SubscriptionsContext = createContext(null)

export function useSubscriptions() {
  const ctx = useContext(SubscriptionsContext)
  if (!ctx) throw new Error('useSubscriptions must be used within SubscriptionsProvider')
  return ctx
}

export function SubscriptionsProvider({ children }) {
  const [subscriptions, setSubscriptions] = useState([])
  const [history, setHistory] = useState([])

  // FYP feed state (infinite, accumulated)
  const [feed, setFeed] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const seenRef = useRef({})
  const cursorRef = useRef(0)
  const continuationRef = useRef('')
  // Renderer-side FYP cache so revisits render instantly (the main process keeps
  // its own copy too; this one also survives renderer reloads).
  const fypCacheRef = useRef(null)
  // True only for the very first FYP load of a session (i.e. app launch), so the
  // intro animation plays on open but not when revisiting the FYP later.
  const [isFirstLoad, setIsFirstLoad] = useState(true)

  const { signedIn, signOut } = useAuth()
  const { settings } = useSettings()

  // Whether the personalized (signed-in) feed should be used.
  const useSignedFeed = signedIn && settings.fypSource !== 'anon'

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.ytPrefs().then(p => {
      if (p) {
        setSubscriptions(p.subscriptions || [])
        setHistory(p.history || [])
      }
    }).catch(() => {})
  }, [])

  // When a Google account is signed in, pull the account's YouTube channel
  // subscriptions over and merge them into the local list (and prefs).
  useEffect(() => {
    if (!signedIn) return
    if (!window.electronAPI || !window.electronAPI.ytAuthSubscriptions) return
    let cancelled = false
    window.electronAPI.ytAuthSubscriptions()
      .then(res => {
        if (cancelled || !res?.ok || !Array.isArray(res.subscriptions)) return
        setSubscriptions(prev => {
          const merged = [...prev]
          for (const name of res.subscriptions) {
            if (!merged.some(c => c.toLowerCase() === (name || '').toLowerCase())) merged.push(name)
          }
          return merged
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [signedIn])

  const subscribe = useCallback(async (channel) => {
    if (!channel || !channel.trim()) return
    const list = window.electronAPI
      ? await window.electronAPI.ytSubscribe(channel).catch(() => null)
      : null
    if (list) setSubscriptions(list)
  }, [])

  const unsubscribe = useCallback(async (channel) => {
    const list = window.electronAPI
      ? await window.electronAPI.ytUnsubscribe(channel).catch(() => null)
      : null
    if (list) setSubscriptions(list)
  }, [])

  const isSubscribed = useCallback((channel) => {
    return subscriptions.some(c => c.toLowerCase() === (channel || '').toLowerCase())
  }, [subscriptions])

  const toggleSubscription = useCallback(async (channel) => {
    if (isSubscribed(channel)) await unsubscribe(channel)
    else await subscribe(channel)
  }, [isSubscribed, subscribe, unsubscribe])

  const recordWatch = useCallback(async (v) => {
    if (!v || !v.id) return
    const h = window.electronAPI
      ? await window.electronAPI.ytRecordWatch(v).catch(() => null)
      : null
    if (h) setHistory(h)
  }, [])

  // Load the FIRST page of the feed.
  // - Cache-first: revisits render instantly from a fresh cache.
  // - `background`: after serving the cache, silently re-fetch so the UI updates
  //   in place without clearing the list or showing a spinner.
  // - `force`: skip the cache and fetch fresh (manual refresh / retry).
  const loadFyp = useCallback(async (opts = {}) => {
    const { force = false, background = false } = opts || {}
    const mode = useSignedFeed ? 'signed' : 'anon'
    const c = fypCacheRef.current
    const fresh = !!c && c.mode === mode && Date.now() - c.ts < 30 * 60 * 1000

    const fetchPage = async (isForce) => {
      setLoading(true)
      try {
        if (mode === 'signed') {
          const data = await window.electronAPI.ytAuthHomePage({ continuation: '', seen: [], force: isForce })
          if (data?.ok) {
            const vids = data.videos || []
            vids.forEach(v => { seenRef.current[v.id] = true })
            continuationRef.current = data.continuation || ''
            fypCacheRef.current = {
              ts: Date.now(), mode, seen: { ...seenRef.current },
              continuation: data.continuation || '', hasMore: !!data.hasMore,
              videos: vids, error: null,
            }
            setFeed(vids)
            setHasMore(!!data.hasMore)
            setError(null)
          } else if (data?.reason === 'expired') {
            // Cookies rotated — drop auth, fall back to the anonymous feed.
            await signOut().catch(() => {})
            setError('Your Google session expired. Reconnect in Settings.')
          } else {
            setError(data?.reason === 'request-error'
              ? 'Signed-in feed unavailable right now. Your Google session is active but the feed request failed.'
              : 'Signed-in feed unavailable right now.')
          }
        } else {
          const data = await window.electronAPI.ytFypPage({ cursor: 0, seen: [] })
          const vids = data?.videos || []
          vids.forEach(v => { seenRef.current[v.id] = true })
          cursorRef.current = data?.nextCursor || 0
          fypCacheRef.current = {
            ts: Date.now(), mode, seen: { ...seenRef.current },
            continuation: '', hasMore: !!data?.hasMore,
            videos: vids, error: data?.error || null,
          }
          setFeed(vids)
          setHasMore(!!data?.hasMore)
          setError(data?.error || null)
          if (data?.subscriptions) setSubscriptions(data.subscriptions)
          if (data?.history) setHistory(data.history)
        }
      } catch (err) {
        setError(err.message || 'Failed to load your feed')
      } finally {
        setLoading(false)
        setLoaded(true)
        setIsFirstLoad(false)
      }
    }

    if (fresh && !force) {
      // Cache-first: render the cached list instantly, then refresh silently.
      seenRef.current = { ...(c.seen || {}) }
      cursorRef.current = 0
      continuationRef.current = c.continuation || ''
      setHasMore(!!c.hasMore)
      setFeed(c.videos)
      setError(c.error || null)
      setLoading(false)
      setLoaded(true)
      setIsFirstLoad(false)
      if (background) fetchPage(true)
      return
    }

    seenRef.current = {}
    cursorRef.current = 0
    continuationRef.current = ''
    setHasMore(true)
    setFeed([])
    setError(null)
    if (!window.electronAPI) {
      setError('Electron API not available')
      setLoading(false)
      setLoaded(true)
      setIsFirstLoad(false)
      return
    }
    fypCacheRef.current = null
    await fetchPage(force)
  }, [useSignedFeed, signOut])

  // Load the NEXT page (infinite scroll). No-op while already loading or when exhausted.
  const loadMore = useCallback(async () => {
    if (!window.electronAPI || loading || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const seen = Object.keys(seenRef.current)
      const useSigned = signedIn && settings.fypSource !== 'anon'
      if (useSigned) {
        const data = await window.electronAPI.ytAuthHomePage({ continuation: continuationRef.current, seen })
        if (data?.ok) {
          const vids = data.videos || []
          let applied = false
          setFeed(prev => {
            const next = [...prev]
            for (const v of vids) {
              if (!seenRef.current[v.id]) { seenRef.current[v.id] = true; applied = true; next.push(v) }
            }
            return next
          })
          continuationRef.current = data.continuation || ''
          setHasMore(!!data.hasMore)
        } else if (data?.reason === 'expired') {
          await signOut().catch(() => {})
          setHasMore(false)
        }
      } else {
        const data = await window.electronAPI.ytFypPage({ cursor: cursorRef.current, seen })
        const vids = data?.videos || []
        let applied = false
        setFeed(prev => {
          const next = [...prev]
          for (const v of vids) {
            if (!seenRef.current[v.id]) { seenRef.current[v.id] = true; applied = true; next.push(v) }
          }
          return next
        })
        cursorRef.current = data?.nextCursor || 0
        setHasMore(!!data?.hasMore)
        if (data?.subscriptions) setSubscriptions(data.subscriptions)
        if (data?.history) setHistory(data.history)
      }
    } catch (err) {
      // Ignore "load more" transient errors; keep hasMore as-is
    } finally {
      setLoadingMore(false)
    }
  }, [loading, loadingMore, hasMore, signedIn, settings.fypSource, signOut])

  return (
    <SubscriptionsContext.Provider value={{
      subscriptions, history, feed, loading, loadingMore, error, loaded, hasMore, isFirstLoad,
      subscribe, unsubscribe, toggleSubscription, isSubscribed, recordWatch, loadFyp, loadMore,
    }}>
      {children}
    </SubscriptionsContext.Provider>
  )
}
