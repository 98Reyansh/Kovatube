import { useSubscriptions } from '../context/SubscriptionsContext'

export default function SubscribeButton({ channel, size = 'md' }) {
  const { isSubscribed, toggleSubscription } = useSubscriptions()
  const subbed = isSubscribed(channel)

  const base = size === 'sm'
    ? 'px-3 py-1.5 text-xs rounded-full'
    : 'px-4 py-2 text-sm rounded-full'

  if (!channel) return null

  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSubscription(channel) }}
      className={`${base} font-medium transition-colors flex items-center gap-1.5 hover-ring ${
        subbed
          ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
          : 'bg-yt-red hover:bg-yt-red-hover text-white'
      }`}
    >
      {subbed && (
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
      )}
      {subbed ? 'Subscribed' : 'Subscribe'}
    </button>
  )
}
