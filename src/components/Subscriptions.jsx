import { Link, useNavigate } from 'react-router-dom'
import { useSubscriptions } from '../context/SubscriptionsContext'
import { prewarmOnHover } from '../lib/prewarm'

export default function Subscriptions() {
  const navigate = useNavigate()
  const { subscriptions, unsubscribe, history } = useSubscriptions()

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Subscriptions</h1>
          <Link to="/" className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors hover-ring">
            ← Back to For You
          </Link>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Subscribe to channels from any video or recommendation. New uploads from your channels show up on your For You page.
        </p>
      </div>

      {subscriptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <h3 className="text-lg font-medium mb-2">No subscriptions yet</h3>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
            When you watch a video or browse your feed, hit the Subscribe button on any channel to start following them.
          </p>
          <Link to="/" className="px-4 py-2 rounded-lg bg-yt-red hover:bg-yt-red-hover text-white text-sm font-medium transition-colors">
            Browse For You
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {subscriptions.map((channel) => (
            <div key={channel} className="flex items-center gap-3 p-4 bg-gray-100 dark:bg-gray-800/80 rounded-xl border border-transparent hover:border-yt-red/40 transition-all hover-lift">
              <button
                onClick={() => navigate(`/channel/${encodeURIComponent(channel)}`)}
                className="w-10 h-10 shrink-0 bg-gradient-to-br from-yt-red to-pink-500 rounded-full flex items-center justify-center text-lg font-medium text-white hover-ring"
                title={`View ${channel} channel`}
                aria-label="View channel"
              >
                {channel.charAt(0).toUpperCase()}
              </button>
              <button
                onClick={() => navigate(`/channel/${encodeURIComponent(channel)}`)}
                className="min-w-0 flex-1 text-left hover:text-yt-red transition-colors"
              >
                <p className="font-medium truncate">{channel}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Channel</p>
              </button>
              <button
                onClick={() => unsubscribe(channel)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-red-500 hover:text-white transition-colors shrink-0"
              >
                Unsubscribe
              </button>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <section>
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-1 h-6 bg-yt-red rounded-full" />
            <h2 className="text-xl font-semibold">
              Watch History
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                {history.length} recently watched — powers your recommendations
              </span>
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {history.slice(0, 12).map((v) => (
              <Link key={v.id} to={`/video/${v.id}`} onMouseEnter={() => prewarmOnHover(v.id)} className="group flex gap-3 p-3 bg-gray-100 dark:bg-gray-800/80 rounded-xl hover:border hover:border-yt-red/40 transition-all hover-lift">
                <div className="w-20 h-12 shrink-0 rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700">
                  {v.thumbnail ? (
                    <img src={v.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium line-clamp-2 group-hover:text-yt-red dark:group-hover:text-yt-red-light transition-colors">{v.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{v.channel}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
