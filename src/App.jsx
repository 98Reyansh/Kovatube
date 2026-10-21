import { useEffect, useState } from 'react'
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import HeaderBar from './components/HeaderBar'
import Home from './components/Home'
import VideoDetail from './components/VideoDetail'
import Downloads from './components/Downloads'
import Settings from './components/Settings'
import ShortsFeed from './components/ShortsFeed'
import Subscriptions from './components/Subscriptions'
import Channel from './components/Channel'
import NewVideos from './components/NewVideos'
import SavedVideos from './components/SavedVideos'
import WatchLater from './components/WatchLater'
import Music from './components/music/Music'
import MusicBrowse from './components/music/MusicBrowse'
import MusicDownloads from './components/music/MusicDownloads'
import IntroLoader from './components/IntroLoader'
import { SettingsProvider } from './context/SettingsContext'
import { SearchProvider, useSearch } from './context/SearchContext'
import { SubscriptionsProvider, useSubscriptions } from './context/SubscriptionsContext'
import { DownloadProvider } from './context/DownloadContext'
import { SmartDownloadProvider } from './context/SmartDownloadContext'
import { SavedProvider } from './context/SavedContext'
import { WatchLaterProvider } from './context/WatchLaterContext'
import { ToastProvider } from './context/ToastContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { QueueProvider, useQueue } from './context/QueueContext'
import { NetworkProvider, useNetwork } from './context/NetworkContext'
import MiniPlayer from './components/MiniPlayer'
import OfflineGate from './components/OfflineGate'

// A thin accent progress line pinned to the very top of the window (above the
// header) so any loading state reads as full-screen activity, never a gap.
function TopProgressBar() {
  const { loading: subsLoading, loadingMore } = useSubscriptions()
  const { loading: searchLoading } = useSearch()
  const { checking } = useAuth()
  const location = useLocation()
  const [routing, setRouting] = useState(false)

  useEffect(() => {
    setRouting(true)
    const t = setTimeout(() => setRouting(false), 120)
    return () => clearTimeout(t)
  }, [location.pathname])

  const active = checking || subsLoading || loadingMore || searchLoading || routing

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[70] h-[3px] pointer-events-none overflow-hidden transition-opacity duration-300 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden
    >
      {active && <div className="top-loading-bar" />}
    </div>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  const { current: queueCurrent } = useQueue()
  const { refreshToken } = useNetwork()
  return (
    <main className={`flex-1 overflow-auto transition-[padding] duration-300 ${queueCurrent ? 'pb-20' : 'pb-0'}`}>
      <div key={location.pathname + ':' + refreshToken} className="h-full">
        <div className="px-6 py-5 page-enter">
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/video/:id" element={<VideoDetail />} />
            <Route path="/channel/:name" element={<Channel />} />
            <Route path="/downloads" element={<Downloads />} />
            <Route path="/downloads/music" element={<MusicDownloads />} />
            <Route path="/shorts" element={<ShortsFeed />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/new" element={<NewVideos />} />
            <Route path="/saved" element={<SavedVideos />} />
            <Route path="/watch-later" element={<WatchLater />} />
            <Route path="/music" element={<Music />} />
            <Route path="/music/browse/:browseId" element={<MusicBrowse />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </div>
    </main>
  )
}

function Layout() {
  const { checking } = useAuth()
  const { isFirstLoad } = useSubscriptions()
  const [showIntro, setShowIntro] = useState(true)

  useEffect(() => {
    if (!checking && !isFirstLoad) {
      setShowIntro(false)
    }
  }, [checking, isFirstLoad])

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-yt-dark">
      <TopProgressBar />
      <HeaderBar />
      {showIntro && <IntroLoader />}
      <AnimatedRoutes />
      <OfflineGate />
      <MiniPlayer />
    </div>
  )
}

function App() {
  return (
    <NetworkProvider>
    <SettingsProvider>
      <AuthProvider>
      <SearchProvider>
        <SubscriptionsProvider>
        <ToastProvider>
        <DownloadProvider>
          <SavedProvider>
          <WatchLaterProvider>
          <SmartDownloadProvider>
            <QueueProvider>
              <Router>
                <Layout />
              </Router>
            </QueueProvider>
          </SmartDownloadProvider>
          </WatchLaterProvider>
          </SavedProvider>
        </DownloadProvider>
        </ToastProvider>
        </SubscriptionsProvider>
      </SearchProvider>
      </AuthProvider>
    </SettingsProvider>
    </NetworkProvider>
  )
}

export default App