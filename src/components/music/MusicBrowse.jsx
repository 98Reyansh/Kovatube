import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueue } from '../../context/QueueContext'
import { useDownloads } from '../../context/DownloadContext'
import { useToast } from '../../context/ToastContext'
import TrackRow from './TrackRow'

export default function MusicBrowse() {
  const { browseId } = useParams()
  const navigate = useNavigate()
  const { startQueue } = useQueue()
  const { activeDownloads } = useDownloads()
  const { addToast } = useToast()
  const [data, setData] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    const id = decodeURIComponent(browseId)
    window.electronAPI?.ytMusicBrowse?.(id)
      .then(d => { if (alive) setData(d) })
      .catch(() => { if (alive) setData({ error: 'failed', tracks: [] }) })
    return () => { alive = false }
  }, [browseId])

  const tracks = data?.tracks || []
  const header = data?.header
  const sourceMeta = header ? { title: header.title, browseId: decodeURIComponent(browseId) } : null

  const loadMore = async () => {
    if (!data?.continuation || loadingMore) return
    setLoadingMore(true)
    try {
      const more = await window.electronAPI.ytMusicMore(data.continuation)
      setData(prev => ({
        ...prev,
        tracks: [...(prev.tracks || []), ...(more.tracks || [])],
        continuation: more.continuation,
      }))
    } catch { /* ignore */ } finally {
      setLoadingMore(false)
    }
  }

  // How many tracks of this playlist are downloading right now (drives the
  // button's progress state).
  const activeIds = new Set(activeDownloads.map(d => d.videoId))
  const downloadCount = tracks.filter(t => t.videoId && activeIds.has(t.videoId)).length

  // Download the whole list as MP3, each track bundled with its lyrics sidecar.
  const downloadAll = async () => {
    const list = tracks.filter(t => t.videoId)
    if (!list.length) return
    try {
      const res = await window.electronAPI?.dlPlaylist?.({
        tracks: list.map(t => ({
          videoId: t.videoId, title: t.title, thumbnail: t.thumbnail,
          artist: t.artist, duration: t.duration,
        })),
      })
      if (res && res.started) {
        addToast('success', `Downloading ${list.length} track${list.length === 1 ? '' : 's'} with lyrics…`, 4000)
      }
    } catch (e) {
      console.error('[MusicBrowse] playlist download failed:', e)
      addToast('error', 'Could not start the playlist download', 4000)
    }
  }

  return (
    <div className="animate-fade-in">
      <button onClick={() => navigate(-1)} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 mb-3 text-sm text-gray-600 dark:text-gray-300">
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Back
      </button>

      {!data && (
        <div className="flex flex-col sm:flex-row gap-5 mb-6 items-center sm:items-end animate-fade-in">
          <div className="music-skeleton w-44 h-44 rounded-2xl" />
          <div className="flex-1 space-y-3 w-full">
            <div className="music-skeleton h-4 w-24" />
            <div className="music-skeleton h-8 w-2/3" />
            <div className="music-skeleton h-4 w-1/3" />
          </div>
        </div>
      )}

      {data?.error && !tracks.length && <p className="text-sm text-gray-500">Couldn't load this item.</p>}

      {header && (
        <div className="flex flex-col sm:flex-row gap-5 mb-6 items-center sm:items-end">
          {header.thumbnail ? (
            <img src={header.thumbnail} alt="" referrerPolicy="no-referrer" className="w-44 h-44 rounded-2xl object-cover shadow-xl animate-scale-in" />
          ) : (
            <div className="w-44 h-44 rounded-2xl bg-black/10 dark:bg-white/10" />
          )}
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Playlist / Album</p>
            <h1 className="text-3xl font-bold mb-1 break-words">{header.title}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {[header.artist, header.subtitle].filter(Boolean).join(' • ')}
            </p>
            <div className="flex items-center gap-2 justify-center sm:justify-start">
              <button
                onClick={() => startQueue(tracks, 0, sourceMeta)}
                disabled={!tracks.length}
                className="btn-accent px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                Play all
              </button>
              <button
                onClick={() => startQueue([...tracks].sort(() => Math.random() - 0.5), 0, sourceMeta)}
                disabled={!tracks.length}
                className="btn-ghost px-4 py-2 text-sm flex items-center gap-2 text-gray-700 dark:text-gray-200 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M17 3h4v4h-2V6.414l-4.293 4.293-1.414-1.414L17.586 5H17V3zM3 5h4.586l3.707 3.707-1.414 1.414L6.586 7H3V5zm14 12h-2v-2h2v-.586l2-2V21h-4v-2h2v-.586l-4.293-4.293 1.414-1.414L17 15.414V17zM3 17h3.586l3.707-3.707 1.414 1.414L7.586 19H3v-2z" /></svg>
                Shuffle
              </button>
              <button
                onClick={downloadAll}
                disabled={!tracks.length || downloadCount > 0}
                className="btn-ghost px-4 py-2 text-sm flex items-center gap-2 text-gray-700 dark:text-gray-200 disabled:opacity-50"
                title="Download this playlist as MP3, with lyrics"
              >
                {downloadCount > 0 ? (
                  <>
                    <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Downloading {downloadCount}
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Download
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-0.5">
        {tracks.map((t, i) => (
          <TrackRow key={t.videoId + '-' + i} track={t} queue={tracks} sourceMeta={sourceMeta} index={i} />
        ))}
      </div>

      {loadingMore && (
        <div className="flex justify-center py-4">
          <svg viewBox="0 0 24 24" className="w-6 h-6 animate-spin text-yt-red" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
            <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {data?.continuation && !loadingMore && (
        <div className="flex justify-center py-4">
          <button onClick={loadMore} className="btn-ghost px-5 py-2 text-sm text-gray-600 dark:text-gray-300">Load more</button>
        </div>
      )}

      {data && !tracks.length && !data.error && (
        <p className="text-sm text-gray-500">No tracks found here.</p>
      )}
    </div>
  )
}
