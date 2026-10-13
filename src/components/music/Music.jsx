import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useQueue } from '../../context/QueueContext'
import MusicCard from './MusicCard'
import TrackRow from './TrackRow'

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'charts', label: 'Charts' },
  { id: 'search', label: 'Search' },
  { id: 'library', label: 'Library' },
]

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
]

function CardRow({ items }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
      {items.map((item, i) => (
        <div key={(item.browseId || item.id || i) + '-' + i} className="w-40 shrink-0 snap-start stagger-item">
          <MusicCard item={item} />
        </div>
      ))}
    </div>
  )
}

function TrackShelf({ title, tracks, sourceMeta, onShuffle }) {
  const { startQueue } = useQueue()
  if (!tracks.length) return null
  return (
    <section className="mb-7">
      <div className="flex items-center justify-between mb-2 gap-3">
        <h2 className="text-lg font-semibold truncate">{title}</h2>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => startQueue(tracks, 0, sourceMeta)}
            className="btn-accent px-3.5 py-1.5 text-xs flex items-center gap-1.5"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            Play all
          </button>
          <button
            onClick={onShuffle}
            className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5 text-gray-600 dark:text-gray-300"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><path d="M17 3h4v4h-2V6.414l-4.293 4.293-1.414-1.414L17.586 5H17V3zM3 5h4.586l3.707 3.707-1.414 1.414L6.586 7H3V5zm14 12h-2v-2h2v-.586l2-2V21h-4v-2h2v-.586l-4.293-4.293 1.414-1.414L17 15.414V17zM3 17h3.586l3.707-3.707 1.414 1.414L7.586 19H3v-2z" /></svg>
            Shuffle
          </button>
        </div>
      </div>
      <div className="space-y-0.5">
        {tracks.map((t, i) => (
          <TrackRow key={t.videoId + '-' + i} track={t} queue={tracks} sourceMeta={sourceMeta} index={i} />
        ))}
      </div>
    </section>
  )
}

function Shelf({ shelf }) {
  const { startQueue } = useQueue()
  const tracks = shelf.items.filter(i => i.videoId)
  const cards = shelf.items.filter(i => !i.videoId && i.browseId)

  if (tracks.length && !cards.length) {
    return (
      <TrackShelf
        title={shelf.title}
        tracks={tracks}
        sourceMeta={shelf.title ? { title: shelf.title } : null}
        onShuffle={() => startQueue([...tracks].sort(() => Math.random() - 0.5), 0, shelf.title ? { title: shelf.title } : null)}
      />
    )
  }

  return (
    <section className="mb-7">
      {shelf.title && <h2 className="text-lg font-semibold mb-2">{shelf.title}</h2>}
      {cards.length > 0 && <CardRow items={cards} />}
      {tracks.length > 0 && (
        <div className="space-y-0.5 mt-2">
          {tracks.slice(0, 5).map((t, i) => (
            <TrackRow key={t.videoId + '-' + i} track={t} queue={tracks} sourceMeta={shelf.title ? { title: shelf.title } : null} index={i} />
          ))}
        </div>
      )}
    </section>
  )
}

function SkeletonRows({ count = 8 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="music-skeleton w-10 h-10 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <div className="music-skeleton h-3.5 w-2/5" />
            <div className="music-skeleton h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

function CardSkeletonRow() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="w-40 shrink-0">
          <div className="music-skeleton aspect-square w-full rounded-xl" />
          <div className="music-skeleton h-3.5 w-3/4 mt-2" />
          <div className="music-skeleton h-3 w-1/2 mt-1.5" />
        </div>
      ))}
    </div>
  )
}

export default function Music() {
  const { signedIn } = useAuth()
  const { startQueue } = useQueue()
  const [tab, setTab] = useState('home')
  const [home, setHome] = useState(null)
  const [charts, setCharts] = useState(null)
  const [library, setLibrary] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (home) return
    window.electronAPI?.ytMusicHome?.().then(setHome).catch(() => setHome({ shelves: [], error: 'failed' }))
  }, [home])

  useEffect(() => {
    if (tab === 'charts' && !charts) {
      window.electronAPI?.ytMusicCharts?.().then(setCharts).catch(() => setCharts({ shelves: [], error: 'failed' }))
    }
    if (tab === 'library' && !library) {
      window.electronAPI?.ytMusicLibrary?.().then(setLibrary).catch(() => setLibrary({ signedIn: false, shelves: [], items: [] }))
    }
  }, [tab, charts, library])

  const runSearch = useCallback(async (q, f) => {
    if (!q || !q.trim()) { setResults(null); return }
    setSearching(true)
    try {
      const r = await window.electronAPI.ytMusicSearch({ query: q.trim(), filter: f || undefined })
      setResults(r)
    } catch {
      setResults({ items: [], error: 'Search failed' })
    } finally {
      setSearching(false)
    }
  }, [])

  const onSearchSubmit = (e) => {
    e.preventDefault()
    runSearch(query, filter)
  }

  const onFilter = (f) => {
    setFilter(f)
    if (query.trim()) runSearch(query, f)
  }

  const searchTracks = results?.items?.filter(i => i.videoId) || []
  const searchCards = results?.items?.filter(i => !i.videoId && i.browseId) || []

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h1 className="text-2xl font-bold mr-2 gradient-text">Music</h1>
        <div className="flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.06] rounded-full p-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-white dark:bg-white/15 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'home' && (
        <div>
          {!home && <div className="space-y-6">{[0, 1].map(i => (<div key={i}><div className="music-skeleton h-5 w-40 mb-3" /><CardSkeletonRow /></div>))}</div>}
          {home?.error && !home.shelves?.length && <p className="text-sm text-gray-500">Couldn't load music home. Check your connection and try again.</p>}
          {home?.shelves?.map((s, i) => <Shelf key={i} shelf={s} />)}
        </div>
      )}

      {tab === 'charts' && (
        <div>
          {!charts && <SkeletonRows />}
          {charts?.error && !charts.shelves?.length && <p className="text-sm text-gray-500">Couldn't load charts.</p>}
          {charts?.shelves?.map((s, i) => <Shelf key={i} shelf={s} />)}
        </div>
      )}

      {tab === 'search' && (
        <div>
          <form onSubmit={onSearchSubmit} className="relative max-w-xl mb-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search songs, albums, artists, playlists"
              className="w-full px-4 py-2.5 pr-11 rounded-full bg-black/[0.05] dark:bg-white/[0.08] border border-transparent focus:bg-black/[0.03] dark:focus:bg-white/[0.06] focus:ring-1 focus:ring-yt-red/30 outline-none transition-all text-sm input-minimal"
            />
            <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-yt-red" aria-label="Search music">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </button>
          </form>

          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {FILTERS.map(f => (
              <button
                key={f.id || 'all'}
                onClick={() => onFilter(f.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  filter === f.id ? 'bg-yt-red text-white' : 'bg-black/[0.05] dark:bg-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-black/[0.08] dark:hover:bg-white/[0.12]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {searching && <SkeletonRows />}
          {!searching && results && (
            <div>
              {searchTracks.length > 0 && (
                <section className="mb-7">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold">Songs</h2>
                    <button onClick={() => startQueue(searchTracks, 0, { title: `Search: ${query}` })} className="btn-accent px-3.5 py-1.5 text-xs flex items-center gap-1.5">
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      Play all
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {searchTracks.map((t, i) => <TrackRow key={t.videoId + '-' + i} track={t} queue={searchTracks} sourceMeta={{ title: `Search: ${query}` }} index={i} />)}
                  </div>
                </section>
              )}
              {searchCards.length > 0 && (
                <section className="mb-6">
                  <h2 className="text-lg font-semibold mb-2">Albums & artists</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {searchCards.map((item, i) => <div key={(item.browseId || i) + '-' + i} className="stagger-item"><MusicCard item={item} /></div>)}
                  </div>
                </section>
              )}
              {!searchTracks.length && !searchCards.length && !results.error && (
                <p className="text-sm text-gray-500">No results for "{query}".</p>
              )}
              {results.error && <p className="text-sm text-gray-500">{results.error}</p>}
            </div>
          )}
          {!searching && !results && <p className="text-sm text-gray-500">Search YouTube Music for songs, albums, artists and playlists.</p>}
        </div>
      )}

      {tab === 'library' && (
        <div>
          {!library && <SkeletonRows />}
          {library && !library.signedIn && (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center animate-floaty">
                <svg viewBox="0 0 24 24" className="w-8 h-8 text-yt-red" fill="currentColor"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" /></svg>
              </div>
              <h2 className="text-lg font-semibold mb-1">Your library lives here</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Sign in to YouTube to see your liked songs, playlists and saved albums.</p>
            </div>
          )}
          {library?.signedIn && (
            <>
              {library.items?.length > 0 && (
                <section className="mb-7">
                  <h2 className="text-lg font-semibold mb-2">Your Library</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {library.items.map((item, i) => <div key={(item.browseId || item.id || i) + '-' + i} className="stagger-item"><MusicCard item={item} /></div>)}
                  </div>
                </section>
              )}
              {(!library.items || !library.items.length) && (
                <p className="text-sm text-gray-500">Nothing in your library yet.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
