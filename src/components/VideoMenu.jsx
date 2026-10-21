import { useState, useRef, useEffect } from 'react'
import { useSubscriptions } from '../context/SubscriptionsContext'
import { useDownloads } from '../context/DownloadContext'
import { useSaved } from '../context/SavedContext'
import { useWatchLater } from '../context/WatchLaterContext'
import { useToast } from '../context/ToastContext'

// "More options" ellipsis menu shown under video cards.
// Offers Save, Download, and Subscribe without crowding the card row.
export default function VideoMenu({ video }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const { isSubscribed, toggleSubscription } = useSubscriptions()
  const { startDownload, activeDownloads } = useDownloads()
  const { isSaved, toggleSave } = useSaved()
  const { isInWatchLater, toggleWatchLater } = useWatchLater()
  const { addToast } = useToast()

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!video?.id) return null

  const saved = isSaved(video.id)
  const queued = isInWatchLater(video.id)
  const subbed = video.channel ? isSubscribed(video.channel) : false
  const downloading = activeDownloads.some(d => d.videoId === video.id && d.status !== 'failed')

  const stop = (e) => { e.preventDefault(); e.stopPropagation() }

  const handleSave = (e) => {
    stop(e)
    toggleSave(video)
    addToast('success', saved ? 'Removed from Saved videos' : 'Saved to your list', 2500)
    setOpen(false)
  }

  const handleWatchLater = (e) => {
    stop(e)
    toggleWatchLater(video)
    addToast('success', queued ? 'Removed from Watch later' : 'Added to Watch later', 2500)
    setOpen(false)
  }

  const handleDownload = (e) => {
    stop(e)
    if (downloading) {
      addToast('info', 'This video is already downloading', 2500)
      setOpen(false)
      return
    }
    startDownload({
      videoId: video.id,
      quality: '720p (HD)',
      format: 'mp4',
      title: video.title || '',
      thumbnail: video.thumbnail || '',
    }).catch(err => console.error('[VideoMenu] download failed:', err))
    addToast('success', `Downloading: ${video.title || 'video'}`, 3000)
    setOpen(false)
  }

  const handleSubscribe = (e) => {
    stop(e)
    if (!video.channel) return
    toggleSubscription(video.channel)
    addToast('success', subbed ? `Unsubscribed from ${video.channel}` : `Subscribed to ${video.channel}`, 2500)
    setOpen(false)
  }

  const itemClass = 'flex items-center gap-2.5 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] rounded-lg transition-colors text-left'

  return (
    <div ref={rootRef} className="relative shrink-0" onClick={(e) => { e.stopPropagation() }}>
      <button
        onClick={(e) => { stop(e); setOpen(o => !o) }}
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
          open
            ? 'bg-black/[0.08] dark:bg-white/[0.12] text-gray-800 dark:text-white'
            : 'text-gray-500 dark:text-gray-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.10] hover:text-gray-800 dark:hover:text-white'
        }`}
        title="More options"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 mb-1.5 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/5 py-1 z-40 pop-in pop-in-bottom menu-stagger"
        >
          <button role="menuitem" onClick={handleSave} className={itemClass}>
            <svg className="w-4 h-4 shrink-0" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            {saved ? 'Remove from Saved' : 'Save video'}
          </button>

          <button role="menuitem" onClick={handleWatchLater} className={itemClass}>
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" strokeWidth={2} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 2" />
            </svg>
            {queued ? 'Remove from Watch later' : 'Watch later'}
          </button>

          <button role="menuitem" onClick={handleDownload} className={itemClass}>
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {downloading ? 'Downloading…' : 'Download (720p)'}
          </button>

          {video.channel && (
            <>
              <hr className="my-1 border-gray-100 dark:border-gray-700" />
              <button role="menuitem" onClick={handleSubscribe} className={itemClass}>
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {subbed
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9m-4.27 4.36A2 2 0 0112 15.36" />}
                </svg>
                {subbed ? 'Unsubscribe' : 'Subscribe'}
                {video.channel && (
                  <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 truncate max-w-[70px]">{video.channel}</span>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
