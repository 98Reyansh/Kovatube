import { useState, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSettings } from '../context/SettingsContext'
import { useSearch } from '../context/SearchContext'
import { useSmartDownloads } from '../context/SmartDownloadContext'
import { useSubscriptions } from '../context/SubscriptionsContext'
import { useDownloads } from '../context/DownloadContext'
import { isAudioDownload } from '../lib/media'
import { useAuth } from '../context/AuthContext'
import { useSaved } from '../context/SavedContext'
import { useWatchLater } from '../context/WatchLaterContext'

function NavItem({ to, active, onClick, children, count }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      data-active={active ? 'true' : 'false'}
      className={`nav-underline px-1.5 py-1 text-[13px] whitespace-nowrap transition-colors ${
        active
          ? 'text-gray-900 dark:text-white'
          : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
      }`}
    >
      <span>
        {children}
        {count > 0 && (
          <span className="ml-1 text-[11px] tabular-nums text-gray-400">{count > 99 ? '99+' : count}</span>
        )}
      </span>
    </Link>
  )
}

export default function HeaderBar() {
  const { settings, updateSetting } = useSettings()
  const { signedIn, account, signingIn, signIn, signOut } = useAuth()
  const { search, loading, clearSearch } = useSearch()
  const { subscriptions } = useSubscriptions()
  const { activeDownloads } = useDownloads()
  const videoDownloadsActive = activeDownloads.filter((d) => !isAudioDownload(d)).length
  const { saved: savedVideos } = useSaved()
  const { videos: watchLater } = useWatchLater()
  const { enabled: smartDlEnabled, clipboard: smartDlClipboard, activeDownloads: smartDlActive, toggleSmartDownload, toggleClipboard } = useSmartDownloads()
  const location = useLocation()
  const navigate = useNavigate()
  const [inputValue, setInputValue] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef(null)

  useEffect(() => {
    const onDocClick = (e) => {
      if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (inputValue.trim()) {
      search(inputValue.trim())
      if (location.pathname !== '/') {
        navigate('/')
      }
    }
  }

  const handleLogoClick = () => {
    clearSearch()
    setInputValue('')
  }

  return (
    <header className="sticky top-0 z-30 flex items-center gap-5 px-5 h-12 bg-white dark:bg-yt-dark border-b border-black/[0.06] dark:border-white/[0.06] animate-slide-down">
      <Link to="/" onClick={handleLogoClick} className="flex items-center shrink-0 group" aria-label="Home">
        <svg className="w-5 h-5 text-yt-red transition-transform duration-300 group-hover:scale-125 group-hover:-rotate-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zM9 16V8l8 3.993L9 16z"/>
        </svg>
      </Link>

      <form onSubmit={handleSubmit} className="flex-1 min-w-[8rem] max-w-md">
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search"
            className="search-field w-full px-3 py-1 pr-8 rounded-md bg-transparent border border-black/[0.08] dark:border-white/[0.1] outline-none text-[13px]"
          />
          <button
            type="submit"
            disabled={loading}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
          >
            {loading ? (
              <svg className="w-4.5 h-4.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </button>
        </div>
      </form>

      <nav className="flex items-center gap-3 shrink-0" aria-label="Main navigation">
        <NavItem to="/" active={location.pathname === '/'} onClick={handleLogoClick}>For You</NavItem>
        <NavItem to="/shorts" active={location.pathname === '/shorts'}>Shorts</NavItem>
        <NavItem to="/music" active={location.pathname.startsWith('/music')}>Music</NavItem>
        <NavItem to="/subscriptions" active={location.pathname === '/subscriptions'} count={subscriptions.length}>Subscriptions</NavItem>
        <NavItem to="/downloads" active={location.pathname.startsWith('/downloads')} count={videoDownloadsActive}>Downloads</NavItem>
      </nav>

      <div className="flex items-center gap-1 ml-auto">
        <button
          onClick={() => toggleSmartDownload()}
          className={`relative p-1.5 transition-colors ${
            smartDlEnabled
              ? 'text-gray-900 dark:text-white'
              : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
          title={smartDlEnabled ? 'Smart Downloads ON — auto-downloading For You recommendations' : 'Smart Downloads OFF — click to enable'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {smartDlEnabled && (
            <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${smartDlActive.length > 0 ? 'bg-yt-red' : 'bg-gray-400'}`} />
          )}
        </button>

        <Link
          to="/watch-later"
          className={`relative p-1.5 transition-colors ${
            location.pathname === '/watch-later'
              ? 'text-gray-900 dark:text-white'
              : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
          title="Watch later"
          aria-label="Watch later"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" strokeWidth={1.75} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 7v5l3 2" />
          </svg>
          {watchLater.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-black/80 dark:bg-white text-white dark:text-black text-[9px] font-medium flex items-center justify-center">
              {watchLater.length > 99 ? '99+' : watchLater.length}
            </span>
          )}
        </Link>

        {signedIn ? (
          <div className="relative" ref={accountRef}>
            <button
              onClick={() => setAccountOpen(o => !o)}
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors"
              aria-label="Account & Settings"
              title={account?.name || account?.handle || 'Signed in'}
            >
              {account?.avatar ? (
                <img src={account.avatar} alt="" className="w-7 h-7 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/5" referrerPolicy="no-referrer" />
              ) : (
                <span className="w-7 h-7 rounded-full bg-yt-red text-white flex items-center justify-center text-sm font-medium">
                  {(account?.name || 'G').charAt(0).toUpperCase()}
                </span>
              )}
            </button>
            {accountOpen && (
              <div className="absolute right-0 mt-1.5 w-56 glass-menu rounded-xl py-1 z-50 pop-in menu-stagger">
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    {account?.avatar ? (
                      <img src={account.avatar} alt="" className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-yt-red text-white flex items-center justify-center text-base font-medium">
                        {(account?.name || 'G').charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{account?.name || 'Google Account'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{account?.handle || 'personalized feed'}</p>
                    </div>
                  </div>
                </div>

                <div className="px-1.5 py-1 space-y-0.5">
                  <Link
                    to="/saved"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    Saved videos
                    {savedVideos.length > 0 && (
                      <span className="ml-auto text-[11px] tabular-nums text-gray-400">
                        {savedVideos.length > 99 ? '99+' : savedVideos.length}
                      </span>
                    )}
                  </Link>

                  <Link
                    to="/watch-later"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="9" strokeWidth={2} />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 2" />
                    </svg>
                    Watch later
                    {watchLater.length > 0 && (
                      <span className="ml-auto text-[11px] tabular-nums text-gray-400">
                        {watchLater.length > 99 ? '99+' : watchLater.length}
                      </span>
                    )}
                  </Link>

                  <Link
                    to="/settings"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-3.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Settings
                  </Link>

                  <button
                    onClick={() => updateSetting('theme', settings.theme === 'light' ? 'dark' : settings.theme === 'dark' ? 'amoled' : 'light')}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Theme: {settings.theme.charAt(0).toUpperCase() + settings.theme.slice(1)}
                  </button>

                  <button
                    onClick={() => updateSetting('fypSource', settings.fypSource === 'signed' ? 'anon' : 'signed')}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Feed: {settings.fypSource === 'signed' ? 'Personalized' : 'Trending'}
                  </button>

                  <button
                    onClick={() => updateSetting('autoplay', !settings.autoplay)}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 15.652l-3.536 3.536a1 1 0 01-1.414 0l-5-5a1 1 0 011.414-1.414L12 13.586l3.338-3.338a1 1 0 011.414 1.414z" />
                    </svg>
                    Autoplay: {settings.autoplay ? 'On' : 'Off'}
                  </button>

                  <button
                    onClick={() => updateSetting('videoQuality', settings.videoQuality === '1080p' ? '720p' : settings.videoQuality === '720p' ? '480p' : '1080p')}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Quality: {settings.videoQuality}
                  </button>

                  <button
                    onClick={() => updateSetting('smartDlInterval', settings.smartDlInterval === 60 ? 15 : settings.smartDlInterval === 15 ? 30 : settings.smartDlInterval === 30 ? 60 : 120)}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Feed check every: {settings.smartDlInterval < 60 ? `${settings.smartDlInterval}min` : settings.smartDlInterval === 60 ? '1h' : `${settings.smartDlInterval / 60}h`}
                  </button>

                  <button
                    onClick={() => { toggleSmartDownload().catch(() => {}) }}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Smart Downloads: {smartDlEnabled ? 'On' : 'Off'}
                  </button>

                  <button
                    onClick={() => { toggleClipboard().catch(() => {}) }}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-gray-700 dark:text-gray-200 hover:bg-black/[0.04] dark:hover:bg-white/6 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m0 0v3m0-3h2a2 2 0 012 2v2a2 2 0 01-2 2H8a2 2 0 01-2-2V7a2 2 0 012-2z" />
                    </svg>
                    From Clipboard: {smartDlClipboard ? 'On' : 'Off'}
                  </button>

                  <hr className="my-0.5 border-gray-100 dark:border-gray-700" />

                  <button
                    onClick={() => { setAccountOpen(false); signOut() }}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-yt-red hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={signIn}
            disabled={signingIn}
            className="px-2 py-1 text-[13px] text-gray-700 dark:text-gray-200 hover:text-black dark:hover:text-white disabled:opacity-50"
            title="Sign in with Google to load your personalized For You feed"
          >
            <svg className="w-4 h-4" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            <span className="hidden sm:inline">{signingIn ? 'Signing in...' : 'Sign in'}</span>
          </button>
        )}
      </div>
    </header>
  )
}