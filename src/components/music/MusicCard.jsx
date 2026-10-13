import { useNavigate } from 'react-router-dom'
import { useQueue } from '../../context/QueueContext'

// Grid card for a playlist / album / artist (and, defensively, a track).
export default function MusicCard({ item, queue = null }) {
  const navigate = useNavigate()
  const { startQueue } = useQueue()
  if (!item) return null

  const open = () => {
    if (item.videoId) { startQueue([item], 0, queue ? { title: queue } : null); return }
    if (item.browseId) navigate(`/music/browse/${encodeURIComponent(item.browseId)}?kind=${item.kind || 'playlist'}`)
  }

  const round = item.kind === 'artist'

  return (
    <button onClick={open} className="music-card group text-left p-2.5 w-full" title={item.title}>
      <div className="relative">
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            referrerPolicy="no-referrer"
            className={`music-art w-full ${round ? 'rounded-full' : 'rounded-xl'}`}
          />
        ) : (
          <div className={`music-art w-full bg-black/10 dark:bg-white/10 ${round ? 'rounded-full' : 'rounded-xl'}`} />
        )}
        <span className="absolute bottom-2 right-2 flex items-center justify-center w-9 h-9 rounded-full bg-yt-red text-white shadow-lg opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-105">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </span>
      </div>
      <p className="mt-2 text-sm font-medium truncate">{item.title}</p>
      {item.subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.subtitle}</p>}
    </button>
  )
}
