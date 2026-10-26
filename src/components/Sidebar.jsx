import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useSettings } from '../context/SettingsContext'
import { useSubscriptions } from '../context/SubscriptionsContext'
import { useDownloads } from '../context/DownloadContext'
import { isAudioDownload } from '../lib/media'
import { useAuth } from '../context/AuthContext'
import { useSaved } from '../context/SavedContext'
import { useWatchLater } from '../context/WatchLaterContext'
import { useSmartDownloads } from '../context/SmartDownloadContext'
import { useSearch } from '../context/SearchContext'

function Icon({ d, children }) {
  return (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      {d ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={d} /> : children}
    </svg>
  )
}

function NavRow({ to, active, onClick, icon, label, count }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`side-link ${active ? 'side-link-active' : ''}`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {count > 0 && (
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-yt-red text-white text-[11px] font-medium grid place-items-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}

export default function Sidebar() {
  const { settings, updateSetting } = useSettings()
  const { signedIn, account: profile, signingIn, signIn, signOut } = useAuth()
  const { subscriptions } = useSubscriptions()
  const { activeDownloads } = useDownloads()
  const videoDownloadsActive = activeDownloads.filter((d) => !isAudioDownload(d)).length
  const { saved: savedVideos } = useSaved()
  const { videos: watchLater } = useWatchLater()
  const { enabled: smartDlEnabled, clipboard: smartDlClipboard, toggleSmartDownload, toggleClipboard } = useSmartDownloads()
  const { clearSearch } = useSearch()
  const location = useLocation()
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef(null)

  useEffect(() => {
    const onDocClick = (e) => {
      if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const home = () => clearSearch()
  const path = location.pathname
  const top = settings.navPosition === 'top'

  const links = (
    <>
      {!top && <div className="px-3 pb-2 text-[11px] font-medium tracking-[0.14em] uppercase text-gray-400 dark:text-zinc-500">Library</div>}
      <NavRow to="/" active={path === '/'} onClick={home} label="For You" icon={<Icon d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z" />} />
      <NavRow to="/shorts" active={path === '/shorts'} label="Shorts" icon={<Icon d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 4v8l5-4-5-4z" />} />
      <NavRow to="/music" active={path.startsWith('/music')} label="Music" icon={<Icon d="M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" />} />
      <NavRow to="/subscriptions" active={path === '/subscriptions'} label="Subscriptions" count={subscriptions.length} icon={<Icon d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm11-1v6m3-3h-6" />} />
      <NavRow to="/new" active={path === '/new'} label="New videos" icon={<Icon d="M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />} />
      <NavRow to="/downloads" active={path.startsWith('/downloads')} label="Downloads" count={videoDownloadsActive} icon={<Icon d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />} />
      <NavRow to="/saved" active={path === '/saved'} label="Saved" count={savedVideos.length} icon={<Icon d="M6 4h12a1 1 0 0 1 1 1v16l-7-3.5L5 21V5a1 1 0 0 1 1-1z" />} />
      <NavRow to="/watch-later" active={path === '/watch-later'} label="Watch later" count={watchLater.length} icon={<Icon><circle cx="12" cy="12" r="9" strokeWidth="1.75" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M12 7v5l3 2" /></Icon>} />
      <NavRow to="/settings" active={path === '/settings'} label="Settings" icon={<Icon d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a7.8 7.8 0 0 0 .1-1 7.8 7.8 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1L15 4h-4l-.3 2.4a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 12a7.8 7.8 0 0 0-.1 1 7.8 7.8 0 0 0 .1 1l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 1.7 1L11 22h4l.3-2.4a7.3 7.3 0 0 0 1.7-1l2.4 1 2-3.4-2-1.2z" />} />
    </>
  )

  const accountMenu = (
    <div className={`relative ${top ? '' : 'border-t border-black/[0.06] dark:border-white/[0.08] p-3'}`} ref={accountRef}>
      {signedIn ? (
        <button
          onClick={() => setAccountOpen((o) => !o)}
          className={`flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.05] ${top ? 'shrink-0' : 'w-full'}`}
          aria-label="Account and settings"
        >
          {profile?.avatar ? (
            <img src={profile.avatar} alt="" className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="grid w-8 h-8 place-items-center rounded-full bg-yt-red text-sm font-medium text-white">
              {(profile?.name || 'G').charAt(0).toUpperCase()}
            </span>
          )}
          {!top && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{profile?.name || 'Signed in'}</span>
              <span className="block truncate text-xs text-gray-500 dark:text-zinc-500">{profile?.handle || 'Google account'}</span>
            </span>
          )}
        </button>
      ) : (
        <button
          onClick={signIn}
          disabled={signingIn}
          className={`flex items-center gap-3 rounded-xl px-2 py-2 text-sm text-gray-600 dark:text-zinc-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] disabled:opacity-50 ${top ? 'shrink-0 whitespace-nowrap' : 'w-full'}`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
          </svg>
          {signingIn ? 'Signing in…' : 'Sign in'}
        </button>
      )}

      {accountOpen && signedIn && (
        <div className={`absolute z-50 glass-menu rounded-2xl py-1 pop-in max-h-[70vh] overflow-auto ${top ? 'right-0 top-full mt-2 w-56' : 'left-3 right-3 bottom-full mb-2'}`}>
          <MenuLink to="/saved" onClick={() => setAccountOpen(false)} label="Saved videos" count={savedVideos.length} />
          <MenuLink to="/watch-later" onClick={() => setAccountOpen(false)} label="Watch later" count={watchLater.length} />
          <MenuLink to="/settings" onClick={() => setAccountOpen(false)} label="Settings" />
          <MenuButton onClick={() => updateSetting('theme', settings.theme === 'light' ? 'dark' : settings.theme === 'dark' ? 'amoled' : 'light')}>
            Theme: {settings.theme.charAt(0).toUpperCase() + settings.theme.slice(1)}
          </MenuButton>
          <MenuButton onClick={() => updateSetting('fypSource', settings.fypSource === 'signed' ? 'anon' : 'signed')}>
            Feed: {settings.fypSource === 'signed' ? 'Personalized' : 'Trending'}
          </MenuButton>
          <MenuButton onClick={() => updateSetting('autoplay', !settings.autoplay)}>
            Autoplay: {settings.autoplay ? 'On' : 'Off'}
          </MenuButton>
          <MenuButton onClick={() => updateSetting('videoQuality', settings.videoQuality === '1080p' ? '720p' : settings.videoQuality === '720p' ? '480p' : '1080p')}>
            Quality: {settings.videoQuality}
          </MenuButton>
          <MenuButton onClick={() => updateSetting('smartDlInterval', settings.smartDlInterval === 60 ? 15 : settings.smartDlInterval === 15 ? 30 : settings.smartDlInterval === 30 ? 60 : 120)}>
            Feed check every: {settings.smartDlInterval < 60 ? `${settings.smartDlInterval}min` : settings.smartDlInterval === 60 ? '1h' : `${settings.smartDlInterval / 60}h`}
          </MenuButton>
          <MenuButton onClick={() => { toggleSmartDownload().catch(() => {}) }}>
            Smart Downloads: {smartDlEnabled ? 'On' : 'Off'}
          </MenuButton>
          <MenuButton onClick={() => { toggleClipboard().catch(() => {}) }}>
            From Clipboard: {smartDlClipboard ? 'On' : 'Off'}
          </MenuButton>
          <button
            onClick={() => { setAccountOpen(false); signOut() }}
            className="flex w-full items-center px-3 py-2 text-xs text-yt-red hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )

  if (top) {
    return (
      <header className="app-topnav">
        <Link to="/" onClick={home} className="flex items-center gap-2 shrink-0 pr-2" aria-label="Kovatube">
          <span className="grid w-8 h-8 place-items-center rounded-xl bg-yt-red text-white">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M9 7v10l8-5z" />
            </svg>
          </span>
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto min-w-0" aria-label="Main navigation">
          {links}
        </nav>
        {accountMenu}
      </header>
    )
  }

  return (
    <aside className="app-sidebar">
      <Link to="/" onClick={home} className="flex items-center gap-3 px-4 py-4 border-b border-black/[0.06] dark:border-white/[0.08]">
        <span className="grid w-9 h-9 place-items-center rounded-xl bg-yt-red text-white">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M9 7v10l8-5z" />
          </svg>
        </span>
        <span>
          <span className="block text-sm font-semibold tracking-tight">Kovatube</span>
          <span className="block text-xs text-gray-500 dark:text-zinc-500">Desktop</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-auto p-3 flex flex-col gap-1" aria-label="Main navigation">
        {links}
      </nav>
      {accountMenu}
    </aside>
  )
}

function MenuLink({ to, onClick, label, count }) {
  return (
    <Link to={to} onClick={onClick} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">
      <span className="flex-1">{label}</span>
      {count > 0 && <span className="tabular-nums text-gray-400">{count > 99 ? '99+' : count}</span>}
    </Link>
  )
}

function MenuButton({ onClick, children }) {
  return (
    <button onClick={onClick} className="flex w-full items-center px-3 py-2 text-left text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">
      {children}
    </button>
  )
}
