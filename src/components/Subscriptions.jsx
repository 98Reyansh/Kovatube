import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSubscriptions } from '../context/SubscriptionsContext'
import { prewarmOnHover } from '../lib/prewarm'

function ChannelPhoto({ name, url }) {
  const [failed, setFailed] = useState(false)
  const letter = (name || '?').charAt(0).toUpperCase()
  if (!url || failed) {
    return (
      <span className="grid w-10 h-10 shrink-0 place-items-center rounded-full bg-black/[0.06] text-sm text-gray-700 dark:bg-white/10 dark:text-gray-200">
        {letter}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className="w-10 h-10 shrink-0 rounded-full object-cover bg-black/[0.06] dark:bg-white/10"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

export default function Subscriptions() {
  const navigate = useNavigate()
  const { subscriptions, channelAvatars, unsubscribe, history } = useSubscriptions()

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-medium tracking-tight">Subscriptions</h1>
          <Link to="/" className="text-[13px] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            For You
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
        <div className="max-w-xl">
          {subscriptions.map((channel) => (
            <div key={channel} className="stagger-item flex items-center gap-3 py-3 border-b border-black/[0.06] dark:border-white/[0.06]">
              <button
                onClick={() => navigate(`/channel/${encodeURIComponent(channel)}`)}
                className="shrink-0"
                title={`View ${channel} channel`}
                aria-label={`View ${channel}`}
              >
                <ChannelPhoto name={channel} url={channelAvatars?.[(channel || '').toLowerCase()]} />
              </button>
              <button
                onClick={() => navigate(`/channel/${encodeURIComponent(channel)}`)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="font-medium truncate">{channel}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Channel</p>
              </button>
              <button
                onClick={() => unsubscribe(channel)}
                className="shrink-0 rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
              >
                Unsubscribe
              </button>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="text-base font-medium">
              Watch history
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-2">
                {history.length} recently watched — powers your recommendations
              </span>
            </h2>
          </div>
          <div className="reveal-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {history.slice(0, 12).map((v) => (
              <Link key={v.id} to={`/video/${v.id}`} onMouseEnter={() => prewarmOnHover(v.id)} className="group flex gap-3 py-2">
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
