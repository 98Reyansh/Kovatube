import { useEffect, useState } from 'react'
import { useQueue } from '../../context/QueueContext'
import { useDownloads } from '../../context/DownloadContext'

const AUDIO_RE = /\.(mp3|m4a|aac|opus|ogg|oga|flac|wav)$/i

function fmtDur(s) {
  if (!s) return ''
  if (typeof s === 'string' && /^\d+:\d{2}$/.test(s)) return s
  const n = Number(s)
  if (!isFinite(n) || n <= 0) return typeof s === 'string' ? s : ''
  const m = Math.floor(n / 60)
  const sec = Math.floor(n % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// "just now", "5m ago", "3h ago", "2d ago"
function fmtWhen(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!isFinite(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// Small spinning ring used while a playlist is being checked/downloaded.
function Spinner({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function SyncBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
      <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 9a8 8 0 00-14.9-2.3M4 15a8 8 0 0014.9 2.3" />
      </svg>
      auto
    </span>
  )
}

// iOS-style switch for the per-playlist auto-download setting.
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${checked ? 'bg-yt-red' : 'bg-gray-300 dark:bg-gray-600'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  )
}

function LyricsBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-500 dark:text-purple-400">
      <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="currentColor"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" /></svg>
      lyrics
    </span>
  )
}

// A downloaded song. Plays through the app's music player like any other track
// (local file, so it works offline and carries its saved lyrics).
function DownloadedRow({ track, queue, index, sourceMeta }) {
  const { startQueue, isCurrent, playing, loading } = useQueue()
  const { showInFolder, formatBytes } = useDownloads()
  const active = isCurrent(track.videoId || track.id)

  const play = () => startQueue(queue && queue.length ? queue : [track], index ?? 0, sourceMeta)
  const ext = (track.format || '').replace(/^\./, '').toUpperCase()
  const meta = [track.artist, ext].filter(Boolean).join(' • ')

  return (
    <div
      className="track-row group"
      data-active={active}
      onClick={play}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play() } }}
    >
      <div className="w-6 text-center shrink-0">
        {active ? (
          <span className="eq"><span /><span /><span /></span>
        ) : (
          <span className="text-xs tabular-nums text-gray-400 group-hover:hidden">{index + 1}</span>
        )}
        {!active && (
          <svg viewBox="0 0 24 24" className="hidden group-hover:block w-4 h-4 mx-auto text-gray-700 dark:text-gray-200" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        )}
      </div>

      {track.thumbnail ? (
        <img src={track.thumbnail} alt="" referrerPolicy="no-referrer" className="w-10 h-10 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-purple-500 dark:text-purple-400" fill="currentColor"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" /></svg>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className={`text-sm truncate ${active ? 'text-yt-red font-medium' : 'font-medium'}`}>{track.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1.5">
          <span className="truncate">{meta || 'Downloaded'}</span>
          {track.hasLyrics && <LyricsBadge />}
        </p>
      </div>

      {track.totalBytes > 0 && (
        <span className="hidden sm:block text-xs tabular-nums text-gray-400 shrink-0">{formatBytes(track.totalBytes)}</span>
      )}

      {track.duration && (
        <span className="text-xs tabular-nums text-gray-400 shrink-0">{fmtDur(track.duration)}</span>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); track.filePath && showInFolder(track.filePath) }}
        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-yt-red p-1 shrink-0 transition-opacity"
        title="Show in folder"
        aria-label="Show in folder"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
      </button>

      {active && loading && (
        <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin text-yt-red shrink-0" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
          <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {active && !loading && !playing && (
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-yt-red shrink-0" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      )}
    </div>
  )
}

// One downloaded playlist, collapsed to a single entry. Clicking opens its
// ordered track list.
function PlaylistRow({ playlist, onOpen }) {
  const { formatBytes, syncingPlaylists } = useDownloads()
  const count = playlist.trackCount || 0
  const syncing = playlist.syncing || syncingPlaylists.includes(playlist.id)
  const meta = [
    `${count} song${count === 1 ? '' : 's'}`,
    playlist.artist,
    playlist.totalBytes ? formatBytes(playlist.totalBytes) : '',
  ].filter(Boolean).join(' • ')

  const open = () => onOpen(playlist.id)

  return (
    <div
      className="track-row group"
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
    >
      <div className="w-6 text-center shrink-0">
        {syncing ? (
          <Spinner className="w-4 h-4 mx-auto text-yt-red" />
        ) : (
          <svg viewBox="0 0 24 24" className="w-4 h-4 mx-auto text-purple-500 dark:text-purple-400" fill="currentColor">
            <path d="M4 6h10v2H4V6zm0 4h10v2H4v-2zm0 4h7v2H4v-2zm12-9l4 2.5V18a2.5 2.5 0 11-2-2.45V8.28l-4-2.5L16 5z" />
          </svg>
        )}
      </div>

      {playlist.thumbnail ? (
        <img src={playlist.thumbnail} alt="" referrerPolicy="no-referrer" className="w-10 h-10 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-purple-500 dark:text-purple-400" fill="currentColor"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" /></svg>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate group-hover:text-yt-red dark:group-hover:text-yt-red-light transition-colors">{playlist.title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1.5">
          <span className="truncate">{meta || 'Playlist'}</span>
          {playlist.hasLyrics && <LyricsBadge />}
          {playlist.autoSync && <SyncBadge />}
          {syncing && <span className="shrink-0 text-[10px] text-yt-red">checking…</span>}
        </p>
      </div>

      <span className="shrink-0 text-xs font-medium text-gray-400 group-hover:text-yt-red transition-colors">Open</span>
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" /></svg>
    </div>
  )
}

// The ordered track list for one downloaded playlist.
function PlaylistDetail({ playlist, onBack }) {
  const { startQueue } = useQueue()
  const { formatBytes, syncPlaylist, setPlaylistAutoSync, syncingPlaylists } = useDownloads()
  const [busy, setBusy] = useState(false)
  const tracks = playlist.tracks || []
  const sourceMeta = { title: playlist.title }
  const count = tracks.length
  const canSync = !!playlist.browseId
  const syncing = busy || playlist.syncing || syncingPlaylists.includes(playlist.id)
  const meta = [
    `${count} song${count === 1 ? '' : 's'}`,
    playlist.artist,
    playlist.totalBytes ? formatBytes(playlist.totalBytes) : '',
  ].filter(Boolean).join(' • ')

  const checkNow = async () => {
    if (syncing || !canSync) return
    setBusy(true)
    try { await syncPlaylist(playlist.id) } finally { setBusy(false) }
  }

  const toggleAuto = async () => {
    if (busy) return
    setBusy(true)
    try { await setPlaylistAutoSync(playlist.id, !playlist.autoSync) } finally { setBusy(false) }
  }

  return (
    <section className="animate-fade-in">
      <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 mb-4 text-sm text-gray-600 dark:text-gray-300">
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Downloaded
      </button>

      <div className="flex flex-col sm:flex-row gap-5 mb-6 items-center sm:items-end">
        {playlist.thumbnail ? (
          <img src={playlist.thumbnail} alt="" referrerPolicy="no-referrer" className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl object-cover shadow-xl" />
        ) : (
          <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shadow-xl">
            <svg viewBox="0 0 24 24" className="w-16 h-16 text-purple-500 dark:text-purple-400" fill="currentColor"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" /></svg>
          </div>
        )}
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Downloaded playlist</p>
          <h1 className="text-2xl font-bold mb-1 break-words">{playlist.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{meta}</p>
          <div className="flex items-center gap-2 justify-center sm:justify-start">
            <button
              onClick={() => startQueue(tracks, 0, sourceMeta)}
              disabled={!count}
              className="btn-accent px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              Play all
            </button>
            <button
              onClick={() => startQueue([...tracks].sort(() => Math.random() - 0.5), 0, sourceMeta)}
              disabled={!count}
              className="btn-ghost px-4 py-2 text-sm flex items-center gap-2 text-gray-700 dark:text-gray-200 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M17 3h4v4h-2V6.414l-4.293 4.293-1.414-1.414L17.586 5H17V3zM3 5h4.586l3.707 3.707-1.414 1.414L6.586 7H3V5zm14 12h-2v-2h2v-.586l2-2V21h-4v-2h2v-.586l-4.293-4.293 1.414-1.414L17 15.414V17zM3 17h3.586l3.707-3.707 1.414 1.414L7.586 19H3v-2z" /></svg>
              Shuffle
            </button>
            <button
              onClick={checkNow}
              disabled={!canSync || syncing}
              className="btn-ghost px-4 py-2 text-sm flex items-center gap-2 text-gray-700 dark:text-gray-200 disabled:opacity-50"
              title={canSync ? 'Check YouTube Music for songs added to this playlist' : 'This playlist has no link back to YouTube Music'}
            >
              {syncing ? <Spinner className="w-4 h-4" /> : (
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 9a8 8 0 00-14.9-2.3M4 15a8 8 0 0014.9 2.3" />
                </svg>
              )}
              {syncing ? 'Checking…' : 'Sync now'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 px-1">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-2">
            Auto-download new songs
            {playlist.autoSync && <SyncBadge />}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {playlist.autoSync
              ? `New songs added to this playlist download automatically${playlist.lastSyncAt ? ` • checked ${fmtWhen(playlist.lastSyncAt)}` : ''}`
              : canSync
                ? 'Off — press Sync now to check for new songs yourself'
                : 'Off — this playlist has no link back to YouTube Music'}
          </p>
        </div>
        <Toggle checked={!!playlist.autoSync} onChange={toggleAuto} disabled={!canSync || busy} />
      </div>

      <div className="space-y-0.5">
        {tracks.map((t, i) => (
          <DownloadedRow key={t.id + '-' + i} track={t} queue={tracks} index={i} sourceMeta={sourceMeta} />
        ))}
      </div>
    </section>
  )
}

export default function DownloadedMusic() {
  const { completedDownloads, playlists, refreshCompleted, syncAllPlaylists, syncingPlaylists } = useDownloads()
  const { startQueue } = useQueue()
  const [selectedId, setSelectedId] = useState(null)
  const [syncingAll, setSyncingAll] = useState(false)

  // Pick up sidecars and playlist records written by the download pipeline.
  useEffect(() => { refreshCompleted().catch(() => {}) }, [refreshCompleted])

  const syncAll = async () => {
    if (syncingAll) return
    setSyncingAll(true)
    try { await syncAllPlaylists() } finally { setSyncingAll(false) }
  }

  // Files owned by a playlist are shown under that playlist, not as loose songs.
  const playlistFiles = new Set()
  for (const pl of playlists || []) {
    for (const t of pl.tracks || []) {
      if (t.fileName) playlistFiles.add(t.fileName)
      if (t.filePath) playlistFiles.add(t.filePath)
    }
  }

  const songs = completedDownloads
    .filter((d) => d.isAudio || AUDIO_RE.test(d.fileName || ''))
    .filter((d) => !playlistFiles.has(d.fileName) && !playlistFiles.has(d.filePath))
    .map((d) => ({
      id: d.id || d.filePath,
      videoId: d.videoId || '',
      title: d.title || d.fileName || 'Unknown track',
      thumbnail: d.thumbnail || '',
      filePath: d.filePath,
      localUrl: d.localUrl || '',
      format: d.format || '',
      artist: d.artist || '',
      duration: d.duration || '',
      totalBytes: d.totalBytes || 0,
      hasLyrics: !!d.hasLyrics,
    }))

  const lists = playlists || []
  const selected = selectedId ? lists.find((p) => p.id === selectedId) : null
  const syncable = lists.some((p) => p.browseId)
  const syncingAny = syncingAll || syncingPlaylists.length > 0

  if (selected) {
    return <PlaylistDetail playlist={selected} onBack={() => setSelectedId(null)} />
  }

  if (!lists.length && !songs.length) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center animate-floaty">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-purple-500 dark:text-purple-400" fill="currentColor"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" /></svg>
        </div>
        <h2 className="text-lg font-semibold mb-1">No downloaded music yet</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          Open a playlist or album and press <span className="font-medium text-gray-700 dark:text-gray-200">Download</span> — the songs (and their lyrics) will show up here, ready to play offline.
        </p>
      </div>
    )
  }

  const sourceMeta = { title: 'Downloaded' }

  return (
    <>
      {lists.length > 0 && (
        <section className="mb-7">
          <div className="flex items-center justify-between mb-2 gap-3">
            <h2 className="text-lg font-semibold truncate">
              Playlists
              <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">{lists.length}</span>
            </h2>
            {syncable && (
              <button
                onClick={syncAll}
                disabled={syncingAny}
                className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5 text-gray-600 dark:text-gray-300 disabled:opacity-50 shrink-0"
                title="Check every playlist for newly added songs"
              >
                {syncingAny ? <Spinner className="w-3.5 h-3.5" /> : (
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 9a8 8 0 00-14.9-2.3M4 15a8 8 0 0014.9 2.3" />
                  </svg>
                )}
                {syncingAny ? 'Checking…' : 'Sync all'}
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {lists.map((pl) => <PlaylistRow key={pl.id} playlist={pl} onOpen={setSelectedId} />)}
          </div>
        </section>
      )}

      {songs.length > 0 && (
        <section className="mb-7">
          <div className="flex items-center justify-between mb-2 gap-3">
            <h2 className="text-lg font-semibold truncate">
              Songs
              <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">{songs.length}</span>
            </h2>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => startQueue(songs, 0, sourceMeta)} className="btn-accent px-3.5 py-1.5 text-xs flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                Play all
              </button>
              <button
                onClick={() => startQueue([...songs].sort(() => Math.random() - 0.5), 0, sourceMeta)}
                className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5 text-gray-600 dark:text-gray-300"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><path d="M17 3h4v4h-2V6.414l-4.293 4.293-1.414-1.414L17.586 5H17V3zM3 5h4.586l3.707 3.707-1.414 1.414L6.586 7H3V5zm14 12h-2v-2h2v-.586l2-2V21h-4v-2h2v-.586l-4.293-4.293 1.414-1.414L17 15.414V17zM3 17h3.586l3.707-3.707 1.414 1.414L7.586 19H3v-2z" /></svg>
                Shuffle
              </button>
            </div>
          </div>
          <div className="space-y-0.5">
            {songs.map((t, i) => (
              <DownloadedRow key={t.id + '-' + i} track={t} queue={songs} index={i} sourceMeta={sourceMeta} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
