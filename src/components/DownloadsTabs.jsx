import { Link } from 'react-router-dom'

// The two download destinations are separate pages: /downloads shows videos and
// /downloads/music shows songs. This switch moves between them.
export default function DownloadsTabs({ active }) {
  const item = (on) =>
    `nav-underline text-[13px] ${on ? 'text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`

  return (
    <div className="flex items-center gap-1.5" role="tablist" aria-label="Download type">
      <Link to="/downloads" role="tab" aria-selected={active === 'videos'} data-active={active === 'videos' ? 'true' : 'false'} className={item(active === 'videos')}>
        Videos
      </Link>
      <Link to="/downloads/music" role="tab" aria-selected={active === 'music'} data-active={active === 'music' ? 'true' : 'false'} className={item(active === 'music')}>
        Music
      </Link>
    </div>
  )
}
