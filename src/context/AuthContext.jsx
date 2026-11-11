import { api } from '../lib/bridge'
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function AuthProvider({ children }) {
  const [signedIn, setSignedIn] = useState(false)
  const [account, setAccount] = useState(null)
  const [signingIn, setSigningIn] = useState(false)
  const [checking, setChecking] = useState(true)

  // Probe the stored session on mount. yt-auth-status returns the persisted
  // state instantly (no page navigation), then the main process pushes fresh
  // account details over 'auth-updated' once the background probe finishes.
  useEffect(() => {
    if (!api) { setChecking(false); return }
    api.ytAuthStatus().then(st => {
      setSignedIn(!!st?.signedIn)
      setAccount(st?.account || null)
    }).catch(() => setSignedIn(false)).finally(() => setChecking(false))

    const onAuthUpdated = (st) => {
      if (!st) return
      setSignedIn(!!st.signedIn)
      setAccount(st.account || null)
    }
    if (api.onAuthUpdated) {
      api.onAuthUpdated(onAuthUpdated)
      return () => { if (api.removeAuthUpdatedListeners) api.removeAuthUpdatedListeners() }
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!api) return
    const st = await api.ytAuthStatus().catch(() => null)
    if (st) {
      setSignedIn(!!st.signedIn)
      setAccount(st.account || null)
    }
  }, [])

  const signIn = useCallback(async () => {
    if (!api || signingIn) return
    setSigningIn(true)
    try {
      const st = await api.ytAuthSignIn()
      setSignedIn(!!st?.ok)
      setAccount(st?.account || null)
      return st?.ok
    } catch (e) {
      console.error('[Auth] signIn error:', e)
      return false
    } finally {
      setSigningIn(false)
    }
  }, [signingIn])

  const signOut = useCallback(async () => {
    if (!api) return
    try { await api.ytAuthSignOut() } catch (e) { console.error('[Auth] signOut error:', e) }
    setSignedIn(false)
    setAccount(null)
  }, [])

  return (
    <AuthContext.Provider value={{ signedIn, account, signingIn, checking, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}
