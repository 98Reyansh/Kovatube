import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SubscribeButton from './SubscribeButton'
import { prewarmOnHover } from '../lib/prewarm'

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video bg-gray-200 dark:bg-gray-800 rounded-xl mb-2" />
      <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
    </div>
  )
}

function VideoCard({ video }) {
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
      <div className="flex-1 min-w-0 mt-3">
        <h3 className="font-medium text-[15px] leading-snug line-clamp-2 group-hover:text-yt-red dark:group-hover:text-yt-red-light transition-colors">{video.title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
          {video.views}{video.publishedTime ? ` · ${video.publishedTime}` : ''}
        </p>
      </div>
    </Link>
  )
}

export default function Channel() {
  const { name } = useParams()
  const channelName = (name || '')
  const [channel, setChannel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const sentinelRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setChannel(null)
    window.electronAPI.ytChannel(channelName).then((r) => {
      if (cancelled) return
      if (r && r.channel) setChannel(r.channel)
      else setError((r && r.error) || 'Could not load channel')
      setLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName])

  const loadMore = async () => {
    if (!channel?.nextToken || loadingMore) return
    setLoadingMore(true)
    try {
      const r = await window.electronAPI.ytChannelMore(channel.nextToken, channelName)
      if (r && r.videos?.length) {
        setChannel((prev) => {
          if (!prev) return prev
          const seen = new Set(prev.videos.map((v) => v.id))
          const fresh = r.videos.filter((v) => v.id && !seen.has(v.id))
          return { ...prev, videos: [...prev.videos, ...fresh], nextToken: r.nextToken || '' }
        })
      } else if (r && r.nextToken) {
        setChannel((prev) => (prev ? { ...prev, nextToken: r.nextToken } : prev))
      } else {
        setChannel((prev) => (prev ? { ...prev, nextToken: '' } : prev))
      }
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !channel?.nextToken || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingMore) loadMore()
    }, { rootMargin: '600px 0px' })
    obs.observe(el)
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.nextToken, loadingMore])

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="h-40 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse" />
        <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-64 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    )
  }

  if (error || !channel) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col items-center justify-center py-20 text-center">
        <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19h15a2.25 2.25 0 002.25-2.25V7.5A2.25 2.25 0 0019.5 5.25h-15A2.25 2.25 0 002.25 7.5v9.25A2.25 2.25 0 004.5 19z" />
        </svg>
        <h3 className="text-lg font-medium mb-2">Couldn't load channel</h3>
        <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">{error || 'Unknown error'}</p>
        <Link to="/" className="px-4 py-2 rounded-lg bg-yt-red hover:bg-yt-red-hover text-white text-sm font-medium transition-colors hover-ring">Back to For You</Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors hover-ring"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <Link to="/subscriptions" className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors hover-ring">
          Subscriptions
        </Link>
      </div>

      {/* Banner */}
      {channel.banner ? (
        <div className="relative h-40 md:h-56 rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-800">
          <img src={channel.banner} alt="" className="w-full h-full object-cover" loading="lazy" />
        </div>
      ) : (
        <div className="h-28 md:h-40 rounded-2xl bg-gradient-to-r from-yt-red/40 via-yt-red/20 to-pink-500/30" />
      )}

      {/* Channel header */}
      <div className="flex flex-col sm:flex-row items-start gap-4">
        <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-full bg-gradient-to-br from-yt-red to-pink-500 flex items-center justify-center text-3xl font-semibold text-white overflow-hidden ring-4 ring-white dark:ring-yt-dark">
          {channel.avatar ? (
            <img src={channel.avatar} alt={channel.name} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            channel.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-tight">{channel.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-gray-500 dark:text-gray-400">
            {channel.handle && <span>{channel.handle}</span>}
            {channel.subscribers && <span>{channel.subscribers}</span>}
            {channel.videoCount && <span>{channel.videoCount}</span>}
          </div>
          {channel.description && (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 line-clamp-3 max-w-2xl whitespace-pre-line">{channel.description}</p>
          )}
          <div className="mt-4">
            <SubscribeButton channel={channel.name} />
          </div>
        </div>
      </div>

      {/* Videos */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-1 h-6 bg-yt-red rounded-full" />
          <h2 className="text-xl font-semibold">Videos</h2>
          {channel.videos && <span className="text-sm text-gray-500 dark:text-gray-400">({channel.videos.length} loaded)</span>}
        </div>
        {channel.videos && channel.videos.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
            {channel.videos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">No videos found.</p>
        )}

        {channel.nextToken && (
          <div ref={sentinelRef} className="flex flex-col items-center gap-3 mt-8">
            {loadingMore ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Loading more videos…
              </div>
            ) : (
              <button
                onClick={loadMore}
                className="px-6 py-2.5 rounded-full bg-yt-red hover:bg-yt-red-hover text-white text-sm font-medium transition-colors hover-ring"
              >
                Load more videos
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
