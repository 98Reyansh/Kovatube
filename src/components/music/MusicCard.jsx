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
    <button onClick={open} className="music-card group text-left w-full" title={item.title}>
      <div className={`relative overflow-hidden ${round ? 'rounded-full' : 'rounded-md'}`}>
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            referrerPolicy="no-referrer"
            className={`music-art w-full ${round ? 'rounded-full' : 'rounded-md'}`}
          />
        ) : (
          <div className={`music-art w-full bg-black/10 dark:bg-white/10 ${round ? 'rounded-full' : 'rounded-md'}`} />
        )}
      </div>
      <p className="mt-2 text-sm font-medium truncate">{item.title}</p>
      {item.subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.subtitle}</p>}
    </button>
  )
}
