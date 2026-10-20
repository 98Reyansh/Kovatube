import { Link } from 'react-router-dom'

// The two download destinations are separate pages: /downloads shows videos and
// /downloads/music shows songs. This pill switch moves between them.
export default function DownloadsTabs({ active }) {
  const base = 'px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5'
  const on = 'bg-white dark:bg-white/15 text-gray-900 dark:text-white shadow-sm'
  const off = 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'

  return (
    <div className="flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.06] rounded-xl p-1" role="tablist" aria-label="Download type">
      <Link to="/downloads" role="tab" aria-selected={active === 'videos'} className={`${base} ${active === 'videos' ? on : off}`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        Videos
      </Link>
      <Link to="/downloads/music" role="tab" aria-selected={active === 'music'} className={`${base} ${active === 'music' ? on : off}`}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" />
        </svg>
        Music
      </Link>
    </div>
  )
}
