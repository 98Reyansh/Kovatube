import { useState, useEffect, useRef, useCallback } from 'react'
import { useQueue } from '../context/QueueContext'

function fmt(t) {
  if (!t || !isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const Icon = {
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M6 5h4v14H6zM14 5h4v14h-4z" />,
  prev: <path d="M6 6h2v12H6zm12 0v12l-9-6z" />,
  next: <path d="M16 6h2v12h-2zM6 6l9 6-9 6z" />,
  shuffle: <path d="M17 3h4v4h-2V6.414l-4.293 4.293-1.414-1.414L17.586 5H17V3zM3 5h4.586l3.707 3.707-1.414 1.414L6.586 7H3V5zm14 12h-2v-2h2v-.586l2-2V21h-4v-2h2v-.586l-4.293-4.293 1.414-1.414L17 15.414V17zM3 17h3.586l3.707-3.707 1.414 1.414L7.586 19H3v-2z" />,
  repeat: <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />,
  repeatOne: <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" />,
  volume: <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0014 7.97v8.05A4.47 4.47 0 0016.5 12z" />,
  mute: <path d="M3 10v4h4l5 5V5L7 10H3zm18.5-1.5l-1.5 1.5 1.5 1.5-1 1L19 11l-1.5 1.5-1-1L18 10l-1.5-1.5 1-1L19 9l1.5-1.5z" />,
  chevron: <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />,
}

function Btn({ name, children, onClick, active, label, className = '', tone = 'default' }) {
  const hover = tone === 'onDark' ? 'hover:bg-white/10' : 'hover:bg-black/[0.06] dark:hover:bg-white/10'
  const color = active
    ? 'text-yt-red'
    : tone === 'onDark'
      ? 'text-white/80 hover:text-white'
      : 'text-gray-600 dark:text-gray-300'
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex items-center justify-center rounded-full p-1.5 transition-colors ${hover} ${color} ${className}`}
    >
      {children}
    </button>
  )
}

// Lyrics are compared against the playhead with a tiny lead so a line/word
// flips the instant it is sung rather than a frame late. These stay small
// because the playhead itself is sampled every animation frame.
const LINE_LEAD = 0.06
const WORD_LEAD = 0.02

// Timed-lyrics view. Highlights the line matching the playhead and keeps it
// centred. Falls back to plain (untimed) text when no timing is available.
// `ambient` renders the large, light-on-dark variant used by ambient mode.
//
// The playhead is sampled every animation frame from the live <audio> clock
// (`getTime`) instead of the ~4 Hz `timeupdate` value, so lines and words land
// on the beat rather than stepping in 250 ms jumps. The component re-renders
// only when the active line or the number of sung words actually changes.
// `offset` (seconds) shifts the lyrics later (+) or earlier (−) to line them up
// with a recording whose intro differs from the lyric source.
function LyricsView({ synced, plain, footer, currentTime, getTime, offset = 0, ambient = false }) {
  const boxRef = useRef(null)
  const activeRef = useRef(null)
  const hasSynced = !!(synced && synced.length)

  // Active line = last one whose timestamp has passed; `words` = how many of
  // that line's words have been sung.
  const markFor = useCallback((t) => {
    let line = -1
    if (hasSynced) {
      for (let i = 0; i < synced.length; i++) {
        if (synced[i].t <= t + LINE_LEAD) line = i
        else break
      }
    }
    let words = 0
    const ws = line >= 0 ? synced[line].words : null
    if (ws) {
      for (let j = 0; j < ws.length; j++) {
        if (ws[j].t <= t + WORD_LEAD) words = j + 1
        else break
      }
    }
    return { line, words }
  }, [synced, hasSynced])

  const [mark, setMark] = useState({ line: -1, words: 0 })

  // High-resolution path: follow the live audio clock every frame.
  useEffect(() => {
    if (!hasSynced || !getTime) return
    let raf = 0
    const loop = () => {
      const next = markFor(getTime() - offset)
      setMark((prev) => (prev.line === next.line && prev.words === next.words ? prev : next))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [hasSynced, getTime, markFor, offset])

  // Fallback path when there's no live clock: follow the parent's `currentTime`.
  useEffect(() => {
    if (!hasSynced || getTime) return
    setMark(markFor(currentTime - offset))
  }, [hasSynced, getTime, markFor, offset, currentTime])

  const activeIdx = mark.line

  useEffect(() => {
    const box = boxRef.current
    const el = activeRef.current
    if (!box || !el) return
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
  }, [activeIdx])

  const boxCls = ambient
    ? 'lrc-ambient w-full h-full overflow-y-auto px-1 sm:px-2 py-4 text-left'
    : 'w-full h-56 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/5 dark:border-white/10 overflow-y-auto px-4 py-3 text-left'
  const lineCls = ambient
    ? 'py-2 text-xl sm:text-2xl lg:text-3xl leading-snug'
    : 'py-1 text-sm leading-relaxed'

  if (hasSynced) {
    return (
      <div ref={boxRef} className={boxCls}>
        {synced.map((line, i) => {
          const state = i === activeIdx ? 'active' : i < activeIdx ? 'past' : 'future'
          const words = line.words
          // Only the active line gets per-word spans (cheap + gives the karaoke
          // wipe); other lines render as plain text.
          if (i === activeIdx && words && words.length) {
            return (
              <p key={i} ref={activeRef} className={`lrc-line lrc-line-active ${lineCls}`}>
                {words.map((wd, j) => {
                  const on = j < mark.words
                  const isNow = j === mark.words - 1
                  return (
                    <span key={j}>
                      <span className={`lrc-word${on ? ' lrc-word-on' : ''}${isNow ? ' lrc-word-now' : ''}`}>{wd.w}</span>
                      {j < words.length - 1 ? ' ' : ''}
                    </span>
                  )
                })}
              </p>
            )
          }
          return (
            <p key={i} ref={i === activeIdx ? activeRef : null} className={`lrc-line lrc-line-${state} ${lineCls}`}>
              {line.text || '\u00A0'}
            </p>
          )
        })}
        {footer && <p className={`mt-3 text-xs ${ambient ? 'text-white/40' : 'text-gray-400 dark:text-gray-500'}`}>{footer}</p>}
      </div>
    )
  }

  return (
    <div ref={boxRef} className={boxCls}>
      <p className={`whitespace-pre-line ${ambient ? 'text-base sm:text-lg leading-relaxed text-white/85' : 'text-sm leading-relaxed text-gray-700 dark:text-gray-200'}`}>{plain}</p>
      {footer && <p className={`mt-3 text-xs ${ambient ? 'text-white/40' : 'text-gray-400 dark:text-gray-500'}`}>{footer}</p>}
    </div>
  )
}

// Nudge control for when the lyric source runs a little ahead of or behind the
// recording (different master/intro). Persisted by the parent. Uses functional
// updates so quick successive clicks accumulate correctly.
function SyncControl({ offset, onChange, ambient }) {
  const clamp = (v) => Math.max(-3, Math.min(3, Math.round(v * 100) / 100))
  const btn = ambient
    ? 'bg-white/10 hover:bg-white/20 text-white/80'
    : 'bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.1] dark:hover:bg-white/[0.14] text-gray-600 dark:text-gray-300'
  const txt = ambient ? 'text-white/60' : 'text-gray-400 dark:text-gray-500'
  return (
    <div className={`flex items-center justify-center gap-2 text-[11px] ${txt}`}>
      <span className="uppercase tracking-wider opacity-80">Sync</span>
      <button
        type="button"
        onClick={() => onChange((v) => clamp(v - 0.05))}
        aria-label="Lyrics earlier"
        title="Lyrics earlier"
        className={`w-6 h-6 rounded-full flex items-center justify-center leading-none transition-colors ${btn}`}
      >−</button>
      <span className="tabular-nums w-12 text-center">{offset > 0 ? '+' : ''}{offset.toFixed(2)}s</span>
      <button
        type="button"
        onClick={() => onChange((v) => clamp(v + 0.05))}
        aria-label="Lyrics later"
        title="Lyrics later"
        className={`w-6 h-6 rounded-full flex items-center justify-center leading-none transition-colors ${btn}`}
      >+</button>
    </div>
  )
}

export default function MiniPlayer() {
  const {
    current, source, playing, loading,
    currentTime, duration, volume, shuffle, repeat,
    toggle, next, prev, seek, setVolume, setShuffle, setRepeat, clear,
    getAudioTime,
  } = useQueue()
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState('art') // 'art' | 'lyrics'
  const [ambient, setAmbient] = useState(false)
  const [lyrics, setLyrics] = useState(null) // { forId, loading, ok, text, reason, footer }
  const lyricsCache = useRef(new Map())

  // Lyric sync nudge (seconds) — how far to delay the lyrics relative to the
  // audio. Persisted so the user's calibration sticks across sessions.
  const [lyricOffset, setLyricOffset] = useState(() => {
    const v = parseFloat(localStorage.getItem('yt_lyric_offset') || '0')
    return Number.isFinite(v) ? v : 0
  })
  useEffect(() => {
    try { localStorage.setItem('yt_lyric_offset', String(lyricOffset)) } catch { /* ignore */ }
  }, [lyricOffset])

  // Fetch lyrics on demand (when the Lyrics tab or ambient mode is open),
  // cached per track so flipping back and forth never refetches.
  useEffect(() => {
    const id = current && current.videoId
    if ((view !== 'lyrics' && !ambient) || !id) return
    const cached = lyricsCache.current.get(id)
    if (cached) { setLyrics(cached); return }
    let alive = true
    setLyrics({ forId: id, loading: true })
    Promise.resolve(window.electronAPI?.ytMusicLyrics?.({
      videoId: id,
      title: current && current.title,
      artist: current && current.artist,
      duration: Math.round(duration || 0),
    }))
      .then((r) => {
        const synced = (r && Array.isArray(r.synced) && r.synced.length) ? r.synced : null
        const entry = {
          forId: id,
          loading: false,
          ok: !!(r && r.ok) || !!synced,
          text: (r && r.lyrics) || '',
          reason: (r && r.reason) || 'Lyrics unavailable',
          footer: (r && r.footer) || '',
          synced,
        }
        lyricsCache.current.set(id, entry)
        if (alive) setLyrics(entry)
      })
      .catch(() => { if (alive) setLyrics({ forId: id, loading: false, ok: false, reason: 'Could not load lyrics', footer: '' }) })
    return () => { alive = false }
  }, [view, ambient, current && current.videoId])

  // Esc leaves ambient mode.
  useEffect(() => {
    if (!ambient) return
    const onKey = (e) => { if (e.key === 'Escape') setAmbient(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ambient])

  if (!current) return null

  const pct = duration ? (currentTime / duration) * 100 : 0
  const cycleRepeat = () => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')
  const showLyrics = lyrics && lyrics.forId === current.videoId ? lyrics : null
  const hasSynced = !!(showLyrics && showLyrics.ok && showLyrics.synced && showLyrics.synced.length)

  return (
    <>
      {/* Ambient mode: full-screen cover art + lyrics over a blurred backdrop */}
      {ambient && (
        <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden animate-fade-in">
          {current.thumbnail ? (
            <img
              src={current.thumbnail}
              alt=""
              referrerPolicy="no-referrer"
              className="ambient-img absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-50"
            />
          ) : (
            <div className="absolute inset-0 bg-neutral-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/55 to-black/85" />

          {/* Top bar */}
          <div className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-3">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-white/50">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M12 3l1.6 5.2L19 9.8l-4.3 3.1.9 5.1L12 15.3 8.4 18l.9-5.1L5 9.8l5.4-1.6L12 3z" />
              </svg>
              Ambient
            </span>
            <button
              onClick={() => setAmbient(false)}
              aria-label="Exit ambient mode"
              className="flex items-center justify-center w-9 h-9 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Body: cover art + lyrics */}
          <div className="relative z-10 flex-1 min-h-0 flex flex-col md:flex-row items-center justify-center gap-6 md:gap-14 px-5 sm:px-8 md:px-16 pb-2 w-full max-w-6xl mx-auto">
            <div className="shrink-0 flex flex-col items-center gap-4">
              {current.thumbnail ? (
                <img
                  src={current.thumbnail}
                  alt=""
                  referrerPolicy="no-referrer"
                  className={`ambient-img rounded-2xl object-cover shadow-2xl transition-transform duration-700 ease-out ${playing ? 'scale-100' : 'scale-95 opacity-90'} w-32 h-32 sm:w-48 sm:h-48 md:w-72 md:h-72`}
                />
              ) : (
                <div className="w-32 h-32 sm:w-48 sm:h-48 md:w-72 md:h-72 rounded-2xl bg-white/10" />
              )}
              <div className="text-center max-w-[16rem] md:max-w-[18rem]">
                <p className="text-white font-semibold text-base md:text-lg truncate">{current.title}</p>
                <p className="text-white/60 text-sm truncate">{current.artist || 'Unknown artist'}</p>
              </div>
            </div>

            <div className="flex-1 min-h-0 w-full h-full max-w-2xl">
              {(!showLyrics || showLyrics.loading) ? (
                <div className="h-full flex items-center justify-center gap-2 text-sm text-white/60">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 animate-spin text-yt-red" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                    <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Loading lyrics…
                </div>
              ) : showLyrics.ok ? (
                <LyricsView
                  ambient
                  synced={showLyrics.synced}
                  plain={showLyrics.text}
                  footer={showLyrics.footer}
                  currentTime={currentTime}
                  getTime={getAudioTime}
                  offset={lyricOffset}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-white/50">
                  <svg viewBox="0 0 24 24" className="w-8 h-8" fill="currentColor">
                    <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" />
                  </svg>
                  <p className="text-sm">{showLyrics.reason || 'Lyrics not available'}</p>
                </div>
              )}
            </div>
          </div>

          {hasSynced && (
            <div className="relative z-10 pb-1">
              <SyncControl offset={lyricOffset} onChange={setLyricOffset} ambient />
            </div>
          )}

          {/* Bottom transport */}
          <div className="relative z-10 px-6 pb-6 pt-2 w-full max-w-3xl mx-auto">
            <div className="flex items-center gap-3">
              <span className="text-[11px] tabular-nums text-white/60 w-10 text-right">{fmt(currentTime)}</span>
              <div
                className="relative flex-1 h-1 rounded-full bg-white/15 cursor-pointer"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  if (duration) seek(((e.clientX - rect.left) / rect.width) * duration)
                }}
              >
                <div className="h-full rounded-full bg-yt-red transition-[width] duration-150" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[11px] tabular-nums text-white/60 w-10">{fmt(duration)}</span>
            </div>
            <div className="mt-4 flex items-center justify-center gap-5 sm:gap-7">
              <Btn label="Shuffle" tone="onDark" active={shuffle} onClick={() => setShuffle(s => !s)}>
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">{Icon.shuffle}</svg>
              </Btn>
              <Btn label="Previous" tone="onDark" onClick={prev}>
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">{Icon.prev}</svg>
              </Btn>
              <button
                onClick={toggle}
                aria-label={playing ? 'Pause' : 'Play'}
                className="flex items-center justify-center w-14 h-14 rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-transform"
              >
                {loading ? (
                  <svg viewBox="0 0 24 24" className="w-6 h-6 animate-spin" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                    <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">{playing ? Icon.pause : Icon.play}</svg>
                )}
              </button>
              <Btn label="Next" tone="onDark" onClick={() => next(false)}>
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">{Icon.next}</svg>
              </Btn>
              <Btn label={`Repeat: ${repeat}`} tone="onDark" active={repeat !== 'off'} onClick={cycleRepeat}>
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">{repeat === 'one' ? Icon.repeatOne : Icon.repeat}</svg>
              </Btn>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-40 animate-fade-in-up">
      {/* Expanded "Now Playing" sheet */}
      {expanded && (
        <div className="miniplayer-panel px-4 pt-5 pb-5 animate-slide-up">
          <div className="flex flex-col items-center gap-3 max-w-md mx-auto">
            {view === 'art' ? (
              current.thumbnail ? (
                <img
                  src={current.thumbnail}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-56 h-56 rounded-2xl object-cover shadow-2xl animate-scale-in"
                />
              ) : (
                <div className="w-56 h-56 rounded-2xl bg-black/10 dark:bg-white/10" />
              )
            ) : (!showLyrics || showLyrics.loading) ? (
              <div className="w-full h-56 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/5 dark:border-white/10 flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <svg viewBox="0 0 24 24" className="w-5 h-5 animate-spin text-yt-red" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                  <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Loading lyrics…
              </div>
            ) : showLyrics.ok ? (
              <LyricsView
                synced={showLyrics.synced}
                plain={showLyrics.text}
                footer={showLyrics.footer}
                currentTime={currentTime}
                getTime={getAudioTime}
                offset={lyricOffset}
              />
            ) : (
              <div className="w-full h-56 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/5 dark:border-white/10 flex flex-col items-center justify-center text-center gap-1">
                <svg viewBox="0 0 24 24" className="w-7 h-7 text-gray-300 dark:text-gray-600" fill="currentColor">
                  <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" />
                </svg>
                <p className="text-sm text-gray-500 dark:text-gray-400">{showLyrics.reason || 'Lyrics not available'}</p>
              </div>
            )}
            {view === 'lyrics' && hasSynced && (
              <SyncControl offset={lyricOffset} onChange={setLyricOffset} />
            )}
            <div className="text-center w-full">
              <p className="font-semibold text-lg truncate">{current.title}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {current.artist || 'Unknown artist'}{source?.title ? ` • ${source.title}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.06] rounded-full p-0.5">
              <button
                onClick={() => { setView('art'); setAmbient(false) }}
                className={`px-3.5 py-1 rounded-full text-xs font-medium transition-colors ${view === 'art' && !ambient ? 'bg-white dark:bg-white/15 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
              >
                Artwork
              </button>
              <button
                onClick={() => { setView('lyrics'); setAmbient(false) }}
                className={`px-3.5 py-1 rounded-full text-xs font-medium transition-colors ${view === 'lyrics' && !ambient ? 'bg-white dark:bg-white/15 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
              >
                Lyrics
              </button>
              <button
                onClick={() => setAmbient(true)}
                className={`flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-medium transition-colors ${ambient ? 'bg-white dark:bg-white/15 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
                  <path d="M12 3l1.6 5.2L19 9.8l-4.3 3.1.9 5.1L12 15.3 8.4 18l.9-5.1L5 9.8l5.4-1.6L12 3z" />
                </svg>
                Ambient
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="miniplayer relative">
        <button
          onClick={() => setExpanded(e => !e)}
          className="absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-7 rounded-full miniplayer-handle flex items-center justify-center"
          aria-label={expanded ? 'Collapse player' : 'Expand player'}
        >
          <svg viewBox="0 0 24 24" className={`w-5 h-5 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} fill="currentColor">{Icon.chevron}</svg>
        </button>

        {/* Seek line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-black/5 dark:bg-white/5 group cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            if (duration) seek(((e.clientX - rect.left) / rect.width) * duration)
          }}
        >
          <div className="h-full bg-yt-red transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>

        <div className="flex items-center gap-3 px-3 pt-2 pb-2">
          {current.thumbnail ? (
            <img src={current.thumbnail} alt="" referrerPolicy="no-referrer" className="w-11 h-11 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-11 h-11 rounded-lg bg-black/10 dark:bg-white/10 shrink-0" />
          )}

          <div className="min-w-0 w-[28%] sm:w-[22%]">
            <p className="text-sm font-medium truncate">{current.title}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{current.artist || 'Unknown artist'}</p>
          </div>

          <div className="flex items-center gap-0.5">
            <Btn label="Shuffle" active={shuffle} onClick={() => setShuffle(s => !s)}>
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="currentColor">{Icon.shuffle}</svg>
            </Btn>
            <Btn label="Previous" onClick={prev}>
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">{Icon.prev}</svg>
            </Btn>
            <button
              onClick={toggle}
              aria-label={playing ? 'Pause' : 'Play'}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-yt-red text-white hover:bg-yt-red-hover transition-transform hover:scale-105 active:scale-95"
            >
              {loading ? (
                <svg viewBox="0 0 24 24" className="w-5 h-5 animate-spin" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                  <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">{playing ? Icon.pause : Icon.play}</svg>
              )}
            </button>
            <Btn label="Next" onClick={() => next(false)}>
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">{Icon.next}</svg>
            </Btn>
            <Btn label={`Repeat: ${repeat}`} active={repeat !== 'off'} onClick={cycleRepeat}>
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="currentColor">{repeat === 'one' ? Icon.repeatOne : Icon.repeat}</svg>
            </Btn>
          </div>

          <div className="ml-auto hidden md:flex items-center gap-3">
            <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">{fmt(currentTime)} / {fmt(duration)}</span>
            <Btn label={volume === 0 ? 'Unmute' : 'Mute'} onClick={() => setVolume(volume === 0 ? 1 : 0)}>
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="currentColor">{volume === 0 ? Icon.mute : Icon.volume}</svg>
            </Btn>
            <input
              type="range" min="0" max="1" step="0.01" value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="range-minimal w-20"
              aria-label="Volume"
            />
          </div>

          <Btn label="Close player" onClick={clear} className="ml-1">
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </Btn>
        </div>

        {/* Seek range on mobile (full width under the controls) */}
        <div className="md:hidden px-3 pb-2">
          <input
            type="range" min="0" max={duration || 0} step="0.1" value={currentTime}
            onChange={(e) => seek(parseFloat(e.target.value))}
            className="range-minimal w-full"
            aria-label="Seek"
          />
        </div>
      </div>
      </div>
    </>
  )
}
