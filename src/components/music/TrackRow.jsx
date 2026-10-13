import { useQueue } from '../../context/QueueContext'

function fmtDur(s) {
  if (!s) return ''
  if (typeof s === 'string' && /^\d+:\d{2}$/.test(s)) return s
  const n = Number(s)
  if (!isFinite(n) || n <= 0) return typeof s === 'string' ? s : ''
  const m = Math.floor(n / 60)
  const sec = Math.floor(n % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// A single playable row. `queue` is the list this row belongs to; clicking the
// row plays that whole list starting here (so next/prev work through it).
export default function TrackRow({ track, queue, sourceMeta = null, index, onRemove }) {
  const { startQueue, isCurrent, playing, loading } = useQueue()
  if (!track || !track.videoId) return null

  const active = isCurrent(track.videoId)

  const play = () => startQueue(queue && queue.length ? queue : [track], index ?? 0, sourceMeta)

  return (
    <div
      className="track-row group"
      data-active={active}
      onClick={play}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play() } }}
    >
      {typeof index === 'number' && (
        <div className="w-6 text-center shrink-0">
          {active ? (
            <span className="eq"><span /><span /><span /></span>
          ) : (
            <span className="text-xs tabular-nums text-gray-400 group-hover:hidden">{index + 1}</span>
          )}
          {!active && (
            <svg viewBox="0 0 24 24" className="hidden group-hover:block w-4 h-4 mx-auto text-gray-700 dark:text-gray-200" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </div>
      )}

      {track.thumbnail && (
        <img src={track.thumbnail} alt="" referrerPolicy="no-referrer" className="w-10 h-10 rounded-lg object-cover shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <p className={`text-sm truncate ${active ? 'text-yt-red font-medium' : 'font-medium'}`}>{track.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {[track.artist, track.album, track.subtitle].filter(Boolean).join(' • ') || 'Unknown artist'}
        </p>
      </div>

      {track.duration && (
        <span className="text-xs tabular-nums text-gray-400 shrink-0">{fmtDur(track.duration)}</span>
      )}

      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(track) }}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-yt-red p-1 shrink-0"
          aria-label="Remove from queue"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {active && loading && (
        <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin text-yt-red shrink-0" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
          <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {active && !loading && !playing && (
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-yt-red shrink-0" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      )}
    </div>
  )
}
