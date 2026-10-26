import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSearch } from '../context/SearchContext'
import { useSmartDownloads } from '../context/SmartDownloadContext'

export default function HeaderBar() {
  const { search, loading } = useSearch()
  const { enabled: smartDlEnabled, activeDownloads: smartDlActive, toggleSmartDownload } = useSmartDownloads()
  const location = useLocation()
  const navigate = useNavigate()
  const [inputValue, setInputValue] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (inputValue.trim()) {
      search(inputValue.trim())
      if (location.pathname !== '/') navigate('/')
    }
  }

  return (
    <header className="app-header sticky top-0 z-30 flex items-center gap-3 px-6 h-14">
      <form onSubmit={handleSubmit} className="flex-1 min-w-[8rem] max-w-xl">
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search"
            aria-label="Search"
            className="search-field w-full px-4 py-2 pr-9 bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] outline-none text-[13px]"
          />
          <button
            type="submit"
            disabled={loading}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
            aria-label="Search"
          >
            {loading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </button>
        </div>
      </form>
      <button
        onClick={() => toggleSmartDownload()}
        className={`relative ml-auto p-2 rounded-xl ${
          smartDlEnabled ? 'text-gray-900 dark:text-white bg-black/[0.04] dark:bg-white/[0.06]' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
        }`}
        title={smartDlEnabled ? 'Smart Downloads ON — auto-downloading For You recommendations' : 'Smart Downloads OFF — click to enable'}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {smartDlEnabled && (
          <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${smartDlActive.length > 0 ? 'bg-yt-red' : 'bg-gray-400'}`} />
        )}
      </button>
    </header>
  )
}
