import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { prewarmOnHover } from '../lib/prewarm'

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
    <Link to={`/video/${video.id}`} onMouseEnter={() => prewarmOnHover(video.id)} className="group flex flex-col hover-lift rounded-xl">
      <div className="relative">
        <div className="relative aspect-video bg-gray-200 dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm group-hover:shadow-lg transition-shadow">
          {video.thumbnail ? (
            <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          {video.duration && (
            <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-xs font-medium px-1.5 py-0.5 rounded">{video.duration}</span>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <span className="w-12 h-12 bg-yt-red/90 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <svg className="w-6 h-6 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-3">
        <button
          onClick={openChannel}
          className="w-9 h-9 rounded-full bg-gradient-to-br from-yt-red to-pink-500 flex items-center justify-center text-white text-sm font-medium shrink-0 hover-ring"
          title={`View ${video.channel || 'channel'} channel`}
          aria-label="View channel"
        >
          {(video.channel || '?').charAt(0).toUpperCase()}
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-[15px] leading-snug line-clamp-2 group-hover:text-yt-red dark:group-hover:text-yt-red-light transition-colors">{video.title}</h3>
          <div className="flex flex-wrap items-center justify-between gap-1 mt-1">
            <button
              onClick={openChannel}
              className="text-sm text-gray-600 dark:text-gray-400 truncate hover:text-yt-red transition-colors"
              title={`View ${video.channel || 'channel'} channel`}
            >{video.channel}</button>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-0.5">
            {video.views}{video.publishedTime ? ` · ${video.publishedTime}` : ''}
          </p>
        </div>
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
        <h1 className="text-2xl font-bold">New From Subscriptions</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Latest uploads from channels you follow, grouped by channel
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
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
                  className="w-10 h-10 rounded-full bg-gradient-to-br from-yt-red to-pink-500 flex items-center justify-center text-white text-base font-medium shrink-0 hover-ring"
                  title={`View ${group.channel} channel`}
                >
                  {(group.channel || '?').charAt(0).toUpperCase()}
                </Link>
                <div className="min-w-0">
                  <Link
                    to={`/channel/${encodeURIComponent(group.channel)}`}
                    className="text-lg font-semibold hover:text-yt-red transition-colors line-clamp-1"
                  >
                    {group.channel}
                  </Link>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{group.videos.length} recent video{group.videos.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
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
