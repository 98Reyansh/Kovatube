import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useNetwork } from '../context/NetworkContext'

// Routes that already work without a connection — don't cover them with the
// offline screen (the user is exactly where they need to be).
const OFFLINE_ROUTES = ['/downloads', '/settings', '/watch-later', '/saved']

export default function OfflineGate() {
  const { online, checking, retry } = useNetwork()
  const navigate = useNavigate()
  const location = useLocation()
  const [dismissed, setDismissed] = useState(false)
  const [stillOffline, setStillOffline] = useState(false)

  // Coming back online clears the "Go to downloads" dismissal.
  useEffect(() => {
    if (online) {
      setDismissed(false)
      setStillOffline(false)
    }
  }, [online])

  const onOfflineRoute = OFFLINE_ROUTES.some(
    (r) => location.pathname === r || location.pathname.startsWith(r + '/')
  )

  if (online || dismissed || onOfflineRoute) return null

  const handleRetry = async () => {
    setStillOffline(false)
    const ok = await retry()
    if (!ok) setStillOffline(true)
  }

  const handleDownloads = () => {
    setDismissed(true)
    navigate('/downloads')
  }

  return (
    <div
      className="fixed inset-0 z-[35] flex items-center justify-center bg-white/95 dark:bg-yt-dark/95 backdrop-blur-sm animate-fade-in"
      role="alertdialog"
      aria-modal="true"
      aria-label="You're offline"
    >
      <div className="text-center px-6 max-w-sm">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1l22 22" />
            <path d="M16.72 11.06A10.94 10.94 0 0119 12.55" />
            <path d="M5 12.55a10.94 10.94 0 015.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0122.58 9" />
            <path d="M1.42 9a15.91 15.91 0 014.7-2.88" />
            <path d="M8.53 16.11a6 6 0 016.95 0" />
            <path d="M12 20h.01" />
          </svg>
        </div>

        <h2 className="text-xl font-semibold mb-1.5">You're offline</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Check your internet connection. Videos and music you've downloaded are still available to play.
        </p>

        {stillOffline && (
          <p className="text-xs text-yt-red mb-3">Still offline — check your connection and try again.</p>
        )}

        <div className="flex items-center justify-center gap-2.5">
          <button
            onClick={handleRetry}
            disabled={checking}
            className="btn-accent px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60"
          >
            {checking ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            )}
            {checking ? 'Checking…' : 'Retry'}
          </button>

          <button
            onClick={handleDownloads}
            className="btn-ghost px-4 py-2 text-sm flex items-center gap-2 text-gray-700 dark:text-gray-200"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Go to downloads
          </button>
        </div>
      </div>
    </div>
  )
}
