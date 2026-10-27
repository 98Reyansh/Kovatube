import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Hls from 'hls.js'
import { pushMediaFocus } from '../mediaFocus'

const PRELOAD_COUNT = 5
const SHORTS_QUALITY = '720'

export function shortsPreloadWindow(shorts, index, count = PRELOAD_COUNT) {
  if (!shorts.length) return []
  const i = Math.max(0, Math.min(index, shorts.length - 1))
  let from = Math.max(0, i - 1)
  let to = Math.min(shorts.length, from + count)
  if (to - from < count) from = Math.max(0, to - count)
  return shorts.slice(from, to)
}

function ShortView({ short, active, muted, onMuted, onReady }) {
  const [streamUrl, setStreamUrl] = useState(null)
  const [streamError, setStreamError] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const readySent = useRef(false)

  const signalReady = () => {
    if (readySent.current) return
    readySent.current = true
    onReady && onReady(short.id)
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!window.electronAPI) { setStreamError('No stream API'); signalReady(); return }
      let r = await window.electronAPI.ytStream(short.id, SHORTS_QUALITY).catch(e => ({ ok: false, reason: e.message }))
      if (!r?.ok) {
        r = await window.electronAPI.ytStream(short.id, 'auto').catch(e => ({ ok: false, reason: e.message }))
      }
      if (cancelled) return
      if (r?.ok && r.url) setStreamUrl(r.url)
      else setStreamError(r?.reason || 'Unable to load stream')
      signalReady()
    }
    load()

    return () => {
      cancelled = true
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
      if (window.electronAPI) window.electronAPI.ytStreamStop(short.id).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [short.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        maxBufferLength: 12,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 200,
        manifestLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 200,
        fragLoadingTimeOut: 20000,
      })
      hlsRef.current = hls
      hls.loadSource(streamUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad(-1)
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
        else { hls.destroy(); hlsRef.current = null; setStreamError('Stream playback error') }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl
    } else {
      setStreamError('HLS playback not supported')
    }
    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !active || muted
    if (!streamUrl) return
    if (active) video.play().catch(() => {})
    else video.pause()
  }, [active, muted, streamUrl])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }, [streamUrl])

  useEffect(() => {
    if (!active) return
    const onToggle = () => togglePlay()
    window.addEventListener('shorts-toggle', onToggle)
    return () => window.removeEventListener('shorts-toggle', onToggle)
  }, [active, togglePlay])

  useEffect(() => {
    const onMusicPlay = () => { const v = videoRef.current; if (v && !v.paused) v.pause() }
    window.addEventListener('yt-music-play', onMusicPlay)
    return () => window.removeEventListener('yt-music-play', onMusicPlay)
  }, [])

  const fmt = (s) => {
    if (!isFinite(s)) return '0:00'
    const m = Math.floor(s / 60); const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0

  return (
    <div
      className="relative w-full h-full bg-black overflow-hidden select-none"
      onClick={active ? togglePlay : undefined}
    >
      <video
        ref={videoRef}
        playsInline
        loop
        preload="auto"
        className="w-full h-full object-contain"
        onPlay={() => { setPlaying(true); if (active) window.dispatchEvent(new Event('yt-video-play')) }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => { if (active) setCurrentTime(e.currentTarget.currentTime) }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
      />

      <div className="absolute top-0 inset-x-0 h-1 bg-white/20 pointer-events-none">
        <div className="h-full bg-yt-red" style={{ width: `${progress}%` }} />
      </div>

      {!streamUrl && !streamError && active && (
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          <div className="w-14 h-14 rounded-full border-4 border-yt-red/25 border-t-yt-red animate-spin" />
        </div>
      )}

      {streamError && active && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center">
          <svg className="w-12 h-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-white/80 text-sm font-medium">This short can't play</p>
          <p className="text-white/50 text-xs max-w-sm">{streamError}</p>
        </div>
      )}

      {active && !playing && streamUrl && !streamError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-16 h-16 rounded-full glass-dark flex items-center justify-center animate-scale-in">
            <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </div>
      )}

      {active && (
        <div className="absolute bottom-0 inset-x-0 p-4 pb-5 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yt-red to-pink-500 flex items-center justify-center text-white text-sm font-medium shrink-0">
              {(short.channel || '?').charAt(0).toUpperCase()}
            </div>
            <span className="text-white text-sm font-medium truncate">{short.channel}</span>
            <span className="text-[10px] uppercase tracking-wider text-white/50 bg-white/10 px-2 py-0.5 rounded">Short</span>
          </div>
          <p className="text-white text-sm font-medium line-clamp-2 drop-shadow">{short.title}</p>
          <p className="text-white/70 text-xs mt-0.5">{short.views}</p>
        </div>
      )}

      {active && (
        <div className="absolute bottom-24 right-3 flex flex-col gap-3 pointer-events-auto">
          <button
            onClick={(e) => { e.stopPropagation(); onMuted(!muted) }}
            className="w-10 h-10 rounded-full glass-dark hover:bg-black/60 flex items-center justify-center text-white transition hover-ring"
            title="Mute"
          >
            {muted
              ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12a4.5 4.5 0 00-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
              : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06c5.12-.51 9-4.8 9-9.77s-3.88-9.26-9-9.77z" /></svg>}
          </button>
          <span className="text-center text-white/80 text-xs tabular-nums">{fmt(currentTime)}</span>
        </div>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="w-10 h-10 rounded-full border-4 border-yt-red/25 border-t-yt-red animate-spin" />
      <p className="text-white/50 text-sm mt-4">Loading Shorts...</p>
    </div>
  )
}

export default function ShortsFeed() {
  const navigate = useNavigate()
  const [shorts, setShorts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const [moved, setMoved] = useState(false)
  const [muted, setMuted] = useState(false)
  const [started, setStarted] = useState([])
  const wheelLock = useRef(0)
  const indexRef = useRef(0)
  const shortsRef = useRef(shorts)
  const readyIds = useRef(new Set())
  indexRef.current = index
  shortsRef.current = shorts

  const mergeShorts = useCallback((list) => {
    if (!list?.length) return
    setShorts((prev) => {
      const seen = new Set(prev.map((s) => s.id))
      const next = [...prev]
      for (const s of list) {
        if (s?.id && !seen.has(s.id)) {
          seen.add(s.id)
          next.push(s)
        }
      }
      return next.length === prev.length ? prev : next
    })
    setLoading(false)
  }, [])

  const loadFeed = useCallback(async () => {
    if (!window.electronAPI) { setError('Electron API not available'); setLoading(false); return }
    const data = await window.electronAPI.ytShortsFeed().catch(() => null)
    if (data?.shorts?.length) mergeShorts(data.shorts)
    else setError((err) => err || data?.error || 'Could not load Shorts')
    setLoading(false)
  }, [mergeShorts])

  useEffect(() => {
    let cancelled = false
    const onMore = (data) => { if (!cancelled) mergeShorts(data?.shorts) }
    window.electronAPI?.onShortsFeedMore?.(onMore)
    loadFeed()
    return () => {
      cancelled = true
      window.electronAPI?.removeShortsFeedMoreListeners?.()
    }
  }, [loadFeed, mergeShorts])

  const armWindow = useCallback(() => {
    const ids = shortsPreloadWindow(shortsRef.current, indexRef.current).map((s) => s.id)
    setStarted(ids)
  }, [])

  useEffect(() => {
    const id = shorts[index]?.id
    if (!id) return
    setStarted((prev) => (prev.includes(id) ? prev : [...prev, id]))
    if (readyIds.current.has(id)) armWindow()
  }, [shorts, index, armWindow])

  const markReady = useCallback((id) => {
    readyIds.current.add(id)
    if (id === shortsRef.current[indexRef.current]?.id) {
      setReady(true)
      armWindow()
    }
  }, [armWindow])

  const step = useCallback((dir) => {
    const cur = indexRef.current
    const nextIndex = cur + dir
    if (nextIndex < 0 || nextIndex >= shortsRef.current.length) return
    setMoved(true)
    setReady(readyIds.current.has(shortsRef.current[nextIndex]?.id))
    setIndex(nextIndex)
  }, [])

  const next = useCallback(() => step(1), [step])
  const prev = useCallback(() => step(-1), [step])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const now = Date.now()
    if (now - wheelLock.current < 500) return
    if (Math.abs(e.deltaY) < 20) return
    wheelLock.current = now
    if (e.deltaY > 0) next()
    else prev()
  }, [next, prev])

  useEffect(() => {
    const releaseFocus = pushMediaFocus('shorts')
    const onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); next() }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); prev() }
      else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); window.dispatchEvent(new Event('shorts-toggle')) }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); releaseFocus() }
  }, [next, prev])

  const short = shorts[index]
  const mounted = shortsPreloadWindow(shorts, index).filter((s) => started.includes(s.id))

  const retry = () => {
    setError(null)
    setLoading(true)
    setShorts([])
    setIndex(0)
    setReady(false)
    setStarted([])
    readyIds.current = new Set()
    loadFeed()
  }

  return (
    <div className="flex items-center justify-center w-full h-full bg-black overflow-hidden relative" onWheel={handleWheel}>
      {loading && shorts.length === 0 ? (
        <Skeleton />
      ) : error && shorts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 text-center px-6">
          <svg className="w-14 h-14 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p className="text-white/80 font-medium">Shorts couldn't load</p>
          <p className="text-white/50 text-sm max-w-sm">{error}</p>
          <button
            onClick={retry}
            className="mt-2 px-4 py-2 text-sm rounded-lg bg-yt-red hover:bg-yt-red-hover text-white transition"
          >
            Retry
          </button>
        </div>
      ) : short ? (
        <>
          <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-3">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-full glass-dark hover:bg-black/60 text-white transition hover-ring"
              title="Back"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-2 text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.3 10.9l-1.5-5.3-2.6 1.5 1 3.1-3.9-2L9.5 9.3 13 11.6l-.7 3.6 3.9-3 .6 2.7 1.2-.6-1.2-3.5 3.4 1.5.9-2.2-3.8-1.2zM20.5 3.5l-1 2.6 2.5 1-2.6 1-1 2.7-1.3-2.5-2.5 1.3.9-2.6-2.7-1 2.7-.9L20.5 3.5zM12 2c-.2.6.9 1 1.4.6l.3-.2c.5-.4 1.3 0 1.6.5l.6 1c.3.5.9.7 1.4.6l.5-.1c.6-.1 1.1.4 1 1v.5c0 .5.3 1 .8 1.2l.8.3c.6.2.9.8.7 1.4l-.3.8c-.2.5 0 1.1.4 1.4l.6.5c.5.4.6 1.1.2 1.6l-.5.7c-.4.5-.2 1.2.1 1.6l.4.6c.4.5.2 1.2-.3 1.5l-.7.5c-.5.3-.8.9-.7 1.4l.1.8c.1.6-.4 1.1-1 1h-.7c-.5 0-1 .3-1.2.8l-.3.8c-.2.6-.8.9-1.4.7l-.9-.4c-.5-.2-1.1-.1-1.4.4l-.4.6c-.3.5-1 .7-1.5.3l-.7-.5c-.5-.3-1.1-.3-1.6 0l-.7.5c-.5.4-1.2.2-1.5-.3l-.4-.6c-.3-.5-.9-.6-1.4-.4l-.9.4c-.6.2-1.2-.1-1.4-.7l-.3-.8c-.2-.5-.7-.8-1.2-.8h-.7c-.6 0-1.1-.4-1-1l.1-.8c.1-.5-.2-1.1-.7-1.4l-.7-.5c-.5-.3-.7-1-.3-1.5l.4-.6c.3-.5.2-1.1-.2-1.6l-.5-.7c-.4-.5-.3-1.2.2-1.6l.6-.5c.4-.3.6-.9.4-1.4l-.3-.8c-.2-.6.1-1.2.7-1.4l.8-.3c.5-.2.8-.7.8-1.2v-.5c-.1-.6.4-1.1 1-1l.5.1c.5.1 1.1-.1 1.4-.6l.6-1c.3-.5 1.1-.9 1.6-.5l.3.2c.5.4 1.6 0 1.4-.6z"/></svg>
              Shorts
              <span className="text-xs text-white/50">{index + 1}/{shorts.length}</span>
            </div>
            <div className="w-10" />
          </div>

          <div
            className="relative rounded-xl overflow-hidden shadow-2xl aspect-[9/16] bg-black"
            style={{ height: 'min(100%, calc(100vw * 0.56))', maxHeight: '100%' }}
          >
            {mounted.map((item) => (
              <div
                key={item.id}
                className={`absolute inset-0 ${item.id === short.id ? 'visible' : 'invisible pointer-events-none'}`}
              >
                <ShortView
                  short={item}
                  active={item.id === short.id}
                  muted={muted}
                  onMuted={setMuted}
                  onReady={markReady}
                />
              </div>
            ))}
          </div>

          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3">
            <button
              onClick={prev}
              disabled={index === 0}
              className="w-11 h-11 rounded-full glass-dark hover:bg-black/60 text-white flex items-center justify-center transition hover-ring disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={next}
              disabled={index === shorts.length - 1}
              className="w-11 h-11 rounded-full glass-dark hover:bg-black/60 text-white flex items-center justify-center transition hover-ring disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {ready && !moved && index < shorts.length - 1 && (
            <div className="absolute bottom-4 inset-x-0 z-20 flex justify-center pointer-events-none">
              <span className="text-white/70 text-xs glass-dark px-3 py-1.5 rounded-full animate-fade-in">
                Scroll, or press ↓, for the next short
              </span>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
