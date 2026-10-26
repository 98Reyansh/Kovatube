import { useState } from 'react'
import { useDownloads } from '../context/DownloadContext'
import { useSmartDownloads } from '../context/SmartDownloadContext'
import { useSettings } from '../context/SettingsContext'
import { isAudioDownload } from '../lib/media'
import DownloadsTabs from './DownloadsTabs'
import LocalPlayer from './LocalPlayer'

function SectionHeader({ title, count }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {title}
          {count != null && <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">{count}</span>}
        </h2>
      </div>
    </div>
  )
}

// Independent on/off switch for one smart-download source.
function SourceToggle({ on, onChange, disabled, title, description, note }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-black/[0.06] dark:border-white/[0.06]">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
        {note && <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">{note}</p>}
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        aria-pressed={on}
        aria-label={title}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${on ? 'bg-neutral-900 dark:bg-white' : 'bg-gray-300 dark:bg-gray-700'}`}
        title={on ? `${title} ON` : `${title} OFF`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full shadow-sm ${on ? 'bg-white dark:bg-black' : 'bg-white'}`}
          style={{
            left: on ? '18px' : '2px',
            transition: 'left 260ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </button>
    </div>
  )
}

export function ActiveDownloadCard({ download }) {
  const { cancelDownload, formatBytes, formatSpeed } = useDownloads()
  const progress = download.progress || 0
  const transferred = formatBytes(download.transferredBytes)
  const total = download.totalBytes > 0 ? formatBytes(download.totalBytes) : ''
  const speed = formatSpeed(download.speed || 0)

  return (
    <div className="group py-3 border-b border-black/[0.06] dark:border-white/[0.06]">
      <div className="flex items-center gap-3 mb-3">
        <div className="relative w-20 h-12 shrink-0 overflow-hidden rounded-lg">
          {download.thumbnail ? (
            <img src={download.thumbnail} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center">
              <svg className="w-5 h-5 text-yt-red" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <span className="absolute bottom-1 left-1.5 text-[10px] font-semibold text-white drop-shadow">{Math.round(progress)}%</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate">{download.title || download.fileName || 'Downloading...'}</h3>
          <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            {download.quality}{download.format ? ` · ${download.format}` : ''}
          </span>
        </div>
        <button
          onClick={() => cancelDownload(download.id)}
          className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-red-500 shrink-0"
          title="Cancel download"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className="progress-sheen h-full bg-yt-red rounded-full transition-all duration-300">
          </div>
        </div>
        <span className="text-xs text-gray-500 w-12 text-right tabular-nums">{Math.round(progress)}%</span>
      </div>
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-gray-500 tabular-nums">{transferred}{total ? ` / ${total}` : ''} · {speed}</p>
        {download.eta && <p className="text-xs text-gray-500 tabular-nums">{download.eta}</p>}
      </div>
    </div>
  )
}

function CompletedDownloadTile({ download, onPlayInApp }) {
  const { showInFolder, formatBytes } = useDownloads()
  const size = formatBytes(download.totalBytes)
  const date = download.completedAt ? new Date(download.completedAt).toLocaleDateString() : ''
  const isAudio = isAudioDownload(download)

  return (
    <div className="group flex flex-col hover-lift">
      <div className="relative">
        <div className="relative aspect-video bg-neutral-200 dark:bg-neutral-900 rounded-md overflow-hidden thumb-zoom">
          {download.thumbnail ? (
            <img src={download.thumbnail} alt={download.title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${isAudio ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-gray-100 dark:bg-gray-800'}`}>
              {isAudio ? (
                <svg className="w-12 h-12 text-purple-500 dark:text-purple-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
              ) : (
                <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              )}
            </div>
          )}
          {download.quality && !isAudio && (
            <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-xs font-medium px-1.5 py-0.5 rounded">{download.quality}</span>
          )}
          {isAudio && download.quality && (
            <span className="absolute bottom-1.5 right-1.5 bg-purple-600/90 text-white text-xs font-medium px-1.5 py-0.5 rounded">{download.quality}</span>
          )}
          {/* hover play overlay */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/20 transition-opacity flex items-center justify-center">
            <button
              onClick={() => onPlayInApp(download)}
              className="w-11 h-11 bg-yt-red text-white rounded-full flex items-center justify-center scale-50 group-hover:scale-100 transition-transform duration-300"
              title="Play in app"
            >
              <svg className="w-6 h-6 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-3">
        <div className="w-8 h-8 rounded-full bg-black/[0.06] dark:bg-white/10 flex items-center justify-center text-gray-700 dark:text-gray-200 text-sm shrink-0">
          {isAudio ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          ) : (
            (download.title || '?').charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-[14px] leading-snug line-clamp-1">{download.title || download.fileName}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap items-center gap-x-1.5">
            <span className="tabular-nums">{size}</span>
            {date && <><span>·</span><span>{date}</span></>}
          </p>
          <button
            onClick={() => showInFolder(download.filePath)}
            className="mt-1.5 text-xs font-medium flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-yt-red transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
            Show in folder
          </button>
        </div>
      </div>
    </div>
  )
}

function SmartDownloadCard({ download }) {
  const { cancelSmartDownload } = useSmartDownloads()
  const progress = download.progress || 0

  return (
    <div className="p-4 bg-gray-100 dark:bg-gray-800/80 rounded-xl border border-transparent hover:border-green-500/40 transition-all">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate">{download.title || download.fileName || 'Resolving title...'}</h3>
          <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
            {download.status === 'starting' ? 'Starting...' :
             download.status === 'merging' ? 'Merging formats...' :
             download.status === 'downloading' ? `yt-dlp · ${download.speed || ''}` :
             download.status}
          </p>
        </div>
        <button
          onClick={() => cancelSmartDownload(download.id)}
          className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors text-red-500 shrink-0"
          title="Cancel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      {download.status === 'downloading' && (
        <>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all duration-300 relative overflow-hidden">
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
              </div>
            </div>
            <span className="text-xs text-gray-500 w-12 text-right tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-500">{download.totalSize || ''}</p>
            {download.eta && <p className="text-xs text-gray-500">ETA {download.eta}</p>}
          </div>
        </>
      )}
    </div>
  )
}

function SmartDownloadHistoryCard({ download, onPlayInApp }) {
  const { showInFolder, formatBytes } = useDownloads()
  const size = formatBytes(download.totalBytes)

  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl transition-colors ${
      download.status === 'completed'
        ? 'bg-gray-100 dark:bg-gray-800/80 hover:bg-gray-200 dark:hover:bg-gray-800 hover-lift'
        : 'bg-red-50 dark:bg-red-900/10'
    }`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
        download.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
      }`}>
        {download.status === 'completed' ? (
          <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        ) : (
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium truncate text-sm">{download.title || download.fileName || download.videoId}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{download.status === 'completed' ? size : download.error || 'Cancelled'}</p>
      </div>
      {download.status === 'completed' && (
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onPlayInApp(download)} className="p-2 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-full transition-colors" title="Play in app">
            <svg className="w-5 h-5 text-yt-red" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button onClick={() => showInFolder(download.filePath)} className="p-2 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-full transition-colors" title="Show in folder">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}

function EmptyBox({ icon, title, message, accent }) {
  return (
    <div className="relative p-10 text-center bg-gray-100 dark:bg-gray-800/60 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 overflow-hidden">
      <div className={`pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl ${accent}`} />
      <div className={`relative w-16 h-16 mx-auto ${accent} rounded-2xl flex items-center justify-center mb-4`}>
        {icon}
      </div>
      <h3 className="font-medium mb-1 relative">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 relative">{message}</p>
    </div>
  )
}

function TabButton({ active, onClick, children, badge }) {
  return (
    <button
      onClick={onClick}
      className={`px-1 py-1 text-[13px] transition-colors ${
        active ? 'text-gray-900 dark:text-white border-b border-current' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="ml-1 text-[11px] tabular-nums text-gray-400">{badge}</span>
      )}
    </button>
  )
}

export default function Downloads() {
  const { activeDownloads, completedDownloads, hasHydrated, formatBytes } = useDownloads()
  const { enabled: smartDlEnabled, clipboard: smartDlClipboard, counts, toggleSmartDownload, toggleClipboard, activeDownloads: smartDlActive, history: smartDlHistory } = useSmartDownloads()
  const { settings } = useSettings()
  const [nowPlaying, setNowPlaying] = useState(null)
  const [tab, setTab] = useState('active')

  // This page is only for videos. Songs have their own page (Music → Downloaded,
  // and /downloads/music).
  const videoActiveDownloads = activeDownloads.filter((d) => !isAudioDownload(d))
  const videoCompletedDownloads = completedDownloads.filter((d) => !isAudioDownload(d))

  const smartDlMax = counts?.limit || 0
  const fypFull = smartDlMax > 0 && (counts?.fyp || 0) >= smartDlMax
  const clipboardFull = smartDlMax > 0 && (counts?.clipboard || 0) >= smartDlMax
  const limitNote = 'Limit reached — reset the counter or raise the limit in Settings'

  const handlePlayInApp = async (download) => {
    if (!download?.filePath) return
    if (settings.playbackMode === 'inApp' && window.electronAPI) {
      const url = await window.electronAPI.preparePlayback(download.filePath)
      if (url) { setNowPlaying({ url, title: download.title || download.fileName }); return }
    }
    if (settings.playbackMode !== 'inApp' && window.electronAPI) {
      await window.electronAPI.dlPlay(download.filePath)
    }
  }

  if (!hasHydrated) {
    return (
      <div className="max-w-5xl mx-auto space-y-8">
        <SectionHeader title="Active Downloads" />
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="p-4 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-16 h-10 bg-gray-300 dark:bg-gray-700 rounded" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-1/3" />
                </div>
              </div>
              <div className="h-2 bg-gray-300 dark:bg-gray-700 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Page header */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-medium tracking-tight">Video downloads</h1>
            </div>
            <DownloadsTabs active="videos" />
          </div>
          <div className="flex items-center gap-4">
            <TabButton active={tab === 'active'} onClick={() => setTab('active')} badge={videoActiveDownloads.length}>
              Active
            </TabButton>
            <TabButton active={tab === 'completed'} onClick={() => setTab('completed')} badge={videoCompletedDownloads.length}>
              Completed
            </TabButton>
          </div>
        </div>

        {tab === 'active' && (
          <>
            <section>
              <SectionHeader title="Active Downloads" count={videoActiveDownloads.length} />
              {videoActiveDownloads.length > 0 ? (
                <div className="reveal-grid grid grid-cols-1 md:grid-cols-2 gap-3">
                  {videoActiveDownloads.map(dl => <ActiveDownloadCard key={dl.id} download={dl} />)}
                </div>
              ) : (
                <EmptyBox
                  accent="bg-yt-red/10"
                  icon={<svg className="w-8 h-8 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
                  title="No active downloads"
                  message="Start a download from any video and it'll appear here"
                />
              )}
            </section>

            <section>
              <SectionHeader title="Smart Downloads" />
              <div className="space-y-3 mb-4">
                <SourceToggle
                  on={smartDlEnabled}
                  onChange={() => { toggleSmartDownload().catch(() => {}) }}
                  title="For You recommendations"
                  description="Automatically download new videos from your For You page."
                  note={smartDlEnabled && fypFull ? limitNote : ''}
                />
                <SourceToggle
                  on={smartDlClipboard}
                  onChange={() => { toggleClipboard().catch(() => {}) }}
                  title="Download from clipboard"
                  description="Automatically download YouTube links you copy to the clipboard."
                  note={smartDlClipboard && clipboardFull ? limitNote : ''}
                />
              </div>

              {smartDlActive.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {smartDlActive.map(dl => <SmartDownloadCard key={dl.id} download={dl} />)}
                </div>
              ) : smartDlHistory.length > 0 ? (
                <div className="space-y-2">
                  {smartDlHistory.map(dl => <SmartDownloadHistoryCard key={dl.id} download={dl} onPlayInApp={handlePlayInApp} />)}
                </div>
              ) : (smartDlEnabled || smartDlClipboard) ? (
                <EmptyBox
                  accent="bg-green-500/10"
                  icon={<svg className="w-8 h-8 text-green-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>}
                  title="Watching for new downloads..."
                  message={
                    smartDlEnabled && smartDlClipboard
                      ? 'New recommendations and copied links are downloaded automatically.'
                      : smartDlClipboard
                        ? 'YouTube links you copy are downloaded automatically.'
                        : 'Recommended videos are downloaded automatically as they appear on your For You page.'
                  }
                />
              ) : (
                <EmptyBox
                  accent="bg-green-500/10"
                  icon={<svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>}
                  title="Smart Downloads are off"
                  message="Turn on the For You feed source or the clipboard source above to download automatically"
                />
              )}
            </section>
          </>
        )}

        {tab === 'completed' && (
          <section>
            <SectionHeader title="Completed Downloads" count={videoCompletedDownloads.length} />
            {videoCompletedDownloads.length > 0 && (
              <div className="flex items-center gap-2.5 mt-2 mb-6 text-sm text-gray-500 dark:text-gray-400">
                <svg className="w-4 h-4 text-yt-red shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                <span>
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{videoCompletedDownloads.length}</span> {videoCompletedDownloads.length === 1 ? 'video' : 'videos'} · Total size{' '}
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{formatBytes(videoCompletedDownloads.reduce((s, d) => s + (d.totalBytes || 0), 0))}</span>
                </span>
              </div>
            )}
            {videoCompletedDownloads.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
                {videoCompletedDownloads.map((dl, i) => (
                  <div key={dl.id} className="stagger-item hover-lift">
                    <CompletedDownloadTile download={dl} onPlayInApp={handlePlayInApp} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyBox
                accent="bg-yt-red/10"
                icon={<svg className="w-8 h-8 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                title="No downloaded videos"
                message={`${videoActiveDownloads.length ? 'Your current download will show up here once finished.' : 'Download a video and it will appear here. Songs live on the Music downloads page.'}`}
              />
            )}
          </section>
        )}
      </div>

      {nowPlaying && (
        <LocalPlayer url={nowPlaying.url} title={nowPlaying.title} onClose={() => setNowPlaying(null)} />
      )}
    </>
  )
}
