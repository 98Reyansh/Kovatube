import { Link, useNavigate } from 'react-router-dom'
import { useSearch } from '../context/SearchContext'
import FypFeed from './FypFeed'
import { prewarmOnHover } from '../lib/prewarm'
import VideoMenu from './VideoMenu'

function SkeletonShort() {
  return (
    <div className="shrink-0 w-40">
      <div className="aspect-[9/16] skeleton rounded-xl mb-2" />
      <div className="h-3 skeleton rounded w-full mb-1" />
      <div className="h-3 skeleton rounded w-2/3" />
    </div>
  )
}

function ShortCard({ video }) {
  const navigate = useNavigate()
  return (
    <Link to={`/video/${video.id}`} onMouseEnter={() => prewarmOnHover(video.id)} className="shrink-0 w-36 group">
      <div className="relative aspect-[9/16] bg-neutral-200 dark:bg-neutral-900 rounded-md overflow-hidden">
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt={video.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>
      <h3 className="font-medium text-sm mt-2 leading-snug line-clamp-2">{video.title}</h3>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (video.channel) navigate(`/channel/${encodeURIComponent(video.channel)}`) }}
        className="text-xs text-gray-600 dark:text-gray-400 mt-1 hover:text-yt-red transition-colors"
      >{video.channel}</button>
      <p className="text-xs text-gray-500 dark:text-gray-500">{video.views}</p>
    </Link>
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
          <img
            src={video.thumbnail}
            alt={video.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {video.duration && (
          <span className="absolute bottom-1.5 right-1.5 bg-black/75 text-white text-[11px] px-1 py-0.5 rounded">
            {video.duration}
          </span>
        )}
      </div>
      <div className="mt-2.5 min-w-0">
          <h3 className="font-medium text-[14px] leading-snug line-clamp-2">{video.title}</h3>
          <div className="mt-1 flex items-center justify-between gap-2 text-[13px] text-gray-500 dark:text-gray-400">
            <button onClick={openChannel} className="truncate hover:text-gray-800 dark:hover:text-gray-200">
              {video.channel}
            </button>
            <VideoMenu video={video} />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {video.views}{video.publishedTime ? ` · ${video.publishedTime}` : ''}
          </p>
      </div>
    </Link>
  )
}

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

function SearchError({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <svg className="w-16 h-16 text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
      <h3 className="text-lg font-medium mb-2">Search Error</h3>
      <p className="text-gray-500 dark:text-gray-400 max-w-md">{message}</p>
      <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">Try a different search term or check your connection</p>
    </div>
  )
}

export default function Home() {
  const { results, loading, error, hasSearched, query } = useSearch()

  // Not searching → show the For You feed
  if (!hasSearched) return <FypFeed />

  if (error) {
    return <SearchError message={error} />
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  const hasResults = (results.videos?.length || 0) > 0 || (results.shorts?.length || 0) > 0

  if (!hasResults) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <h3 className="text-lg font-medium mb-2">No results found</h3>
        <p className="text-gray-500 dark:text-gray-400">
          {query ? `No videos found for "${query}"` : 'Could not load any videos'}
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Try a different search term</p>
      </div>
    )
  }

  return (
    <div className="space-y-10">
      {results.shorts.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="text-base font-medium">
              Shorts
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                {results.shorts.length} found
              </span>
            </h2>
          </div>
          <div className="reveal-grid flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
            {results.shorts.map((video, i) => (
              <div key={video.id} className="">
                <ShortCard video={video} />
              </div>
            ))}
          </div>
        </section>
      )}

      {results.videos.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="text-base font-medium">
              Videos
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                {results.videos.length} results for "{query}"
              </span>
            </h2>
          </div>
          <div className="reveal-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
            {results.videos.map((video, i) => (
              <div key={video.id} className="">
                <VideoCard video={video} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
