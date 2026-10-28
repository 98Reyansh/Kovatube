import { useLikedSongs } from '../../context/LikedSongsContext'

export default function LikeButton({ videoId, className = '', iconClass = 'w-4 h-4' }) {
  const { liked, toggle } = useLikedSongs()
  if (!videoId) return null
  const on = liked(videoId)
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggle(videoId) }}
      aria-label={on ? 'Remove from Liked Music' : 'Add to Liked Music'}
      title={on ? 'Liked' : 'Like'}
      className={`shrink-0 rounded-full p-1.5 transition-colors ${on ? 'text-yt-red' : 'text-gray-400 hover:text-gray-800 dark:hover:text-white'} ${className}`}
    >
      <svg viewBox="0 0 24 24" className={iconClass} fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
      </svg>
    </button>
  )
}
