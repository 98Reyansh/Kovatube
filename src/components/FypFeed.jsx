import { useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSubscriptions } from '../context/SubscriptionsContext'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import VideoMenu from './VideoMenu'
import { prewarmOnHover } from '../lib/prewarm'

function SkeletonCard() {
  return (
    <div>
      <div className="aspect-video skeleton rounded-xl mb-2" />
      <div className="h-4 skeleton rounded w-3/4 mb-2" />
      <div className="h-3 skeleton rounded w-1/2 mb-1" />
      <div className="h-3 skeleton rounded w-1/3" />
    </div>
  )
}

// Full-window loading overlay. Fixed to the viewport (not the scroll container)
// so it covers the header too — no sliver of app chrome peeking above it.
function FullScreenLoader() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white dark:bg-yt-dark animate-fade-in" role="status" aria-label="Loading">
      <div className="relative w-14 h-14">
        <span className="absolute inset-0 rounded-full border-2 border-yt-red/20" />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-yt-red animate-spin" />
      </div>
      <p className="mt-5 text-sm text-gray-500 dark:text-gray-400 animate-pulse">Loading your feed…</p>
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

function EmptyState({ title, message, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <svg className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4 animate-floaty" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h9M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
      </svg>
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">{message}</p>
      {children}
    </div>
  )
}

export default function FypFeed() {
  const { feed, loading, loadingMore, error, loaded, hasMore, loadFyp, loadMore, subscriptions, isFirstLoad } = useSubscriptions()
  const { signedIn, checking } = useAuth()
  const { settings } = useSettings()
  const sentinelRef = useRef(null)
  const signed = signedIn && settings.fypSource !== 'anon'

  useEffect(() => {
    if (!checking) loadFyp({ background: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signed, checking])

  // IntersectionObserver to trigger loadMore as user scrolls to bottom
  const handleIntersect = useCallback((entries) => {
    if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
      loadMore()
    }
  }, [hasMore, loading, loadingMore, loadMore])

  useEffect(() => {
    const el = sentinelRef.current
    const root = document.querySelector('main')
    if (!el) return
    const obs = new IntersectionObserver(handleIntersect, { root: root || null, rootMargin: '800px' })
    obs.observe(el)
    const onScroll = () => {
      if (!root) return
      if (root.scrollHeight - root.scrollTop - root.clientHeight < 900) handleIntersect([{ isIntersecting: true }])
    }
    root?.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      obs.disconnect()
      root?.removeEventListener('scroll', onScroll)
    }
  }, [handleIntersect])

  const isEmpty = !loading && !loadingMore && feed.length === 0 && loaded
  // Any state where we have nothing to show yet gets the full-window overlay so
  // the app never renders a half-empty page with the header exposed.
  const showOverlay = checking || (loading && feed.length === 0)

  return (
    <div className="space-y-6">
      {showOverlay && <FullScreenLoader />}

      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">For You</h1>
        {subscriptions.length > 0 && (
          <Link
            to="/subscriptions"
            className="text-[13px] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Subscriptions
          </Link>
        )}
      </div>

      {!showOverlay && (error && isEmpty ? (
        <EmptyState title="Couldn't load your feed" message={error}>
          <button
            onClick={() => loadFyp({ force: true, background: true })}
            className="text-sm text-gray-900 dark:text-white underline underline-offset-4"
          >
            Retry
          </button>
        </EmptyState>
      ) : isEmpty ? (
        <EmptyState
          title="No recommendations yet"
          message="Watch a few videos and subscribe to channels. Your For You page will learn your taste and show smarter suggestions, plus the latest uploads from channels you follow."
        >
          <button
            onClick={() => loadFyp({ force: true })}
            className="text-sm text-gray-900 dark:text-white underline underline-offset-4"
          >
            Refresh Feed
          </button>
        </EmptyState>
      ) : (
        <>
          <div className="reveal-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
            {feed.map((video, i) => (
              <div key={video.id}>
                <VideoCard video={video} />
              </div>
            ))}
          </div>

          {/* Sentinels: first one tracks when we're near the end; second pre-triggers early */}
          <div ref={sentinelRef} className="h-8" aria-hidden />

          {loadingMore && (
            <div className="flex justify-center py-8">
              <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sm font-medium">Loading more videos…</span>
              </div>
            </div>
          )}

          {!hasMore && feed.length > 0 && (
            <div className="flex justify-center py-8">
              <p className="text-sm text-gray-400 dark:text-gray-500">You've reached the end of the feed</p>
            </div>
          )}

          {!loadingMore && hasMore && feed.length > 0 && (
            <div className="flex justify-center py-4">
              <button
                onClick={loadMore}
                className="px-4 py-2 rounded-full text-sm font-medium bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.09] dark:hover:bg-white/[0.14] transition-colors hover-ring"
              >
                Load More
              </button>
            </div>
          )}
        </>
      ))}
    </div>
  )
}
