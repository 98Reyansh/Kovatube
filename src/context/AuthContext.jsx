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
    if (!window.electronAPI) { setChecking(false); return }
    window.electronAPI.ytAuthStatus().then(st => {
      setSignedIn(!!st?.signedIn)
      setAccount(st?.account || null)
    }).catch(() => setSignedIn(false)).finally(() => setChecking(false))

    const onAuthUpdated = (st) => {
      if (!st) return
      setSignedIn(!!st.signedIn)
      setAccount(st.account || null)
    }
    if (window.electronAPI.onAuthUpdated) {
      window.electronAPI.onAuthUpdated(onAuthUpdated)
      return () => { if (window.electronAPI.removeAuthUpdatedListeners) window.electronAPI.removeAuthUpdatedListeners() }
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!window.electronAPI) return
    const st = await window.electronAPI.ytAuthStatus().catch(() => null)
    if (st) {
      setSignedIn(!!st.signedIn)
      setAccount(st.account || null)
    }
  }, [])

  const signIn = useCallback(async () => {
    if (!window.electronAPI || signingIn) return
    setSigningIn(true)
    try {
      const st = await window.electronAPI.ytAuthSignIn()
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
    if (!window.electronAPI) return
    try { await window.electronAPI.ytAuthSignOut() } catch (e) { console.error('[Auth] signOut error:', e) }
    setSignedIn(false)
    setAccount(null)
  }, [])

  return (
    <AuthContext.Provider value={{ signedIn, account, signingIn, checking, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}
