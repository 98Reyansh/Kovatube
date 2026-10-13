import { useNavigate } from 'react-router-dom'
import { useSaved } from '../context/SavedContext'
import { useDownloads } from '../context/DownloadContext'
import { useToast } from '../context/ToastContext'

function fmtSavedAt(ts) {
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

export default function SavedVideos() {
  const { saved, toggleSave } = useSaved()
  const { startDownload, activeDownloads } = useDownloads()
  const { addToast } = useToast()
  const navigate = useNavigate()

  const handleDownload = (e, video) => {
    e.stopPropagation()
    const downloading = activeDownloads.some(d => d.videoId === video.id && d.status !== 'failed')
    if (downloading) {
      addToast('info', 'This video is already downloading', 2500)
      return
    }
    startDownload({
      videoId: video.id,
      quality: '720p (HD)',
      format: 'mp4',
      title: video.title || '',
      thumbnail: video.thumbnail || '',
    }).catch(err => console.error('[Saved] download failed:', err))
    addToast('success', `Downloading: ${video.title || 'video'}`, 3000)
  }

  const handleRemove = (e, video) => {
    e.stopPropagation()
    toggleSave(video)
    addToast('success', 'Removed from Saved videos', 2500)
  }

  return (
    <div className="max-w-6xl mx-auto py-4 page-enter">
      <div className="flex items-center gap-3 mb-6">
        <span className="w-1 h-8 bg-yt-red rounded-full" />
        <div>
          <h1 className="text-2xl font-semibold">Saved videos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {saved.length > 0
              ? `${saved.length} video${saved.length === 1 ? '' : 's'} saved for later`
              : 'Your watch-later list'}
          </p>
        </div>
      </div>

      {saved.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in-up">
          <svg className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4 animate-floaty" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <h2 className="text-lg font-medium mb-1">Nothing saved yet</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
            Open the <span className="font-mono font-semibold">⋯</span> menu under any video and hit
            “Save video” to keep it here for later.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
          {saved.map((video) => (
            <div
              key={video.id}
              className="stagger-item hover-lift group cursor-pointer"
              onClick={() => navigate(`/video/${video.id}`)}
            >
              <div className="relative aspect-video bg-gray-200 dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm group-hover:shadow-lg transition-shadow">
                {video.thumbnail ? (
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                    <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
                {video.duration && (
                  <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-xs font-medium px-1.5 py-0.5 rounded">
                    {video.duration}
                  </span>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <span className="w-12 h-12 bg-yt-red/90 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-6 h-6 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                </div>
                {/* quick actions */}
                <div className="absolute top-1.5 right-1.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => handleDownload(e, video)}
                    className="w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-yt-red transition-colors"
                    title="Download (720p)"
                    aria-label="Download"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => handleRemove(e, video)}
                    className="w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-yt-red transition-colors"
                    title="Remove from Saved"
                    aria-label="Remove from Saved"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="mt-2.5">
                <h3 className="font-medium text-[15px] leading-snug line-clamp-2 group-hover:text-yt-red dark:group-hover:text-yt-red-light transition-colors">
                  {video.title || 'Untitled video'}
                </h3>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                    {video.channel || 'Unknown channel'}
                  </p>
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                    Saved {fmtSavedAt(video.savedAt)}
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
