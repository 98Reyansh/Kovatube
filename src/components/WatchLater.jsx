import { useNavigate } from 'react-router-dom'
import { useWatchLater } from '../context/WatchLaterContext'
import { useToast } from '../context/ToastContext'

function fmtAddedAt(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function WatchLater() {
  const { videos, removeFromWatchLater } = useWatchLater()
  const { addToast } = useToast()
  const navigate = useNavigate()

  const handleRemove = (e, video) => {
    e.stopPropagation()
    removeFromWatchLater(video.id)
    addToast('success', 'Removed from Watch later', 2500)
  }

  return (
    <div className="max-w-6xl mx-auto py-4 page-enter">
      <h1 className="text-lg font-medium tracking-tight mb-1">
        Watch later
        {videos.length > 0 && <span className="ml-2 text-sm font-normal text-gray-400">{videos.length}</span>}
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Saved on this device</p>

      {videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in-up">
          <svg className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 7v5l3 2" />
          </svg>
          <h2 className="text-lg font-medium mb-1">Nothing queued</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
            Use Watch later on a video, or the <span className="font-mono font-semibold">⋯</span> menu on a card, to keep it in this playlist.
          </p>
        </div>
      ) : (
        <div className="reveal-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
          {videos.map((video, index) => (
            <div
              key={video.id}
              className="group cursor-pointer"
              onClick={() => navigate(`/video/${video.id}`)}
            >
              <div className="relative aspect-video bg-neutral-200 dark:bg-neutral-900 rounded-md overflow-hidden">
                {video.thumbnail ? (
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                    <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
                <span className="absolute top-1.5 left-1.5 bg-black/75 text-white text-[11px] tabular-nums px-1.5 py-0.5 rounded">
                  {index + 1}
                </span>
                {video.duration && (
                  <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-xs font-medium px-1.5 py-0.5 rounded">
                    {video.duration}
                  </span>
                )}
                <button
                  onClick={(e) => handleRemove(e, video)}
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-yt-red transition-opacity"
                  title="Remove from Watch later"
                  aria-label="Remove from Watch later"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="mt-2.5">
                <h3 className="font-medium text-[14px] leading-snug line-clamp-2">
                  {video.title || 'Untitled video'}
                </h3>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                    {video.channel || 'Unknown channel'}
                  </p>
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                    {fmtAddedAt(video.addedAt)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
