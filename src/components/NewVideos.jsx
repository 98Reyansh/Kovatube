import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { prewarmOnHover } from '../lib/prewarm'
import VideoMenu from './VideoMenu'

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video bg-gray-200 dark:bg-gray-800 rounded-xl mb-2" />
      <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/2 mb-1" />
      <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/3" />
    </div>
  )
}

function VideoCard({ video }) {
  const navigate = useNavigate()
  const openChannel = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (video.channel) navigate(`/channel/${encodeURIComponent(video.channel)}`)
  }
  return (
    <Link to={`/video/${video.id}`} onMouseEnter={() => prewarmOnHover(video.id)} className="group flex flex-col">
      <div className="relative aspect-video bg-neutral-200 dark:bg-neutral-900 rounded-md overflow-hidden">
          {video.thumbnail ? (
            <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          {video.duration && (
            <span className="absolute bottom-1.5 right-1.5 bg-black/75 text-white text-[11px] px-1 py-0.5 rounded">{video.duration}</span>
          )}
      </div>
      <div className="mt-2.5 min-w-0">
          <h3 className="font-medium text-[14px] leading-snug line-clamp-2">{video.title}</h3>
          <div className="flex flex-wrap items-center justify-between gap-1 mt-1">
            <button
              onClick={openChannel}
              className="text-[13px] text-gray-500 dark:text-gray-400 truncate hover:text-gray-800 dark:hover:text-gray-200"
              title={`View ${video.channel || 'channel'} channel`}
            >{video.channel}</button>
            <VideoMenu video={video} />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-0.5">
            {video.views}{video.publishedTime ? ` · ${video.publishedTime}` : ''}
          </p>
      </div>
    </Link>
  )
}

export default function NewVideos() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    if (!window.electronAPI) { setError('Electron API not available'); setLoading(false); return }
    setLoading(true)
    setError(null)
    window.electronAPI.ytNewVideos()
      .then(data => {
        setGroups(data?.groups || [])
        setError(data?.error || null)
      })
      .catch(err => setError(err.message || 'Failed to load new videos'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isLoading = loading && groups.length === 0
  const isEmpty = !loading && groups.length === 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-medium tracking-tight">New from subscriptions</h1>
      </div>

      {isLoading ? (
        <div className="reveal-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          <h3 className="text-lg font-medium mb-2">Nothing to show yet</h3>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
            {error ? error : 'Subscribe to channels to see their latest uploads here.'}
          </p>
          <Link
            to="/subscriptions"
            className="px-4 py-2 rounded-lg bg-yt-red hover:bg-yt-red-hover text-white text-sm font-medium transition-colors"
          >
            Manage Subscriptions
          </Link>
        </div>
      ) : (
        <>
          {loading && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Refreshing…</p>
          )}
          {groups.map((group, gi) => (
            <section key={group.channel || gi} className="space-y-4">
              <div className="flex items-center gap-3">
                <Link
                  to={`/channel/${encodeURIComponent(group.channel)}`}
                  className="w-8 h-8 rounded-full bg-black/[0.06] dark:bg-white/10 flex items-center justify-center text-gray-700 dark:text-gray-200 text-sm shrink-0"
                  title={`View ${group.channel} channel`}
                >
                  {(group.channel || '?').charAt(0).toUpperCase()}
                </Link>
                <div className="min-w-0">
                  <Link
                    to={`/channel/${encodeURIComponent(group.channel)}`}
                    className="text-base font-medium line-clamp-1"
                  >
                    {group.channel}
                  </Link>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{group.videos.length} recent video{group.videos.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <div className="reveal-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
                {group.videos.map((video, i) => (
                  <div key={video.id} className="stagger-item hover-lift">
                    <VideoCard video={video} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
