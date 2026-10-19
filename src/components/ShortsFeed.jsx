import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Hls from 'hls.js'
import { pushMediaFocus } from '../mediaFocus'

function ShortView({ short, onReady }) {
  const [streamUrl, setStreamUrl] = useState(null)
  const [streamError, setStreamError] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)

  const videoRef = useRef(null)
  const hlsRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!window.electronAPI) { setStreamError('No stream API'); return }
      const r = await window.electronAPI.ytStream(short.id, 'auto').catch(e => ({ ok: false, reason: e.message }))
      if (cancelled) return
      if (r?.ok && r.url) {
        setStreamUrl(r.url)
        onReady && onReady()
      } else {
        setStreamError(r?.reason || 'Unable to load stream')
        onReady && onReady()
      }
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
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 300,
        manifestLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 300,
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
      video.play().catch(() => {})
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl
      video.play().catch(() => {})
    } else {
      setStreamError('HLS playback not supported')
    }
    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) { video.play().catch(() => {}); setPlaying(true) }
    else { video.pause(); setPlaying(false) }
  }

  // Music and video share the speakers: stand down when the music player takes over.
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
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-contain"
        onPlay={() => { setPlaying(true); window.dispatchEvent(new Event('yt-video-play')) }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onVolumeChange={(e) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted) }}
      />

      {/* Top progress bar */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-2/3 h-1 rounded-full bg-white/20 overflow-hidden pointer-events-none">
        <div className="h-full bg-yt-red" style={{ width: `${progress}%` }} />
      </div>

      {/* Loading state */}
      {!streamUrl && !streamError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          <div className="relative">
            <div className="w-14 h-14 rounded-full border-4 border-yt-red/25 border-t-yt-red animate-spin" />
          </div>
        </div>
      )}

      {streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center">
          <svg className="w-12 h-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-white/80 text-sm font-medium">This short can't play</p>
          <p className="text-white/50 text-xs max-w-sm">{streamError}</p>
        </div>
      )}

      {/* Center play button when paused */}
      {!playing && streamUrl && !streamError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-16 h-16 rounded-full glass-dark flex items-center justify-center animate-scale-in">
            <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </div>
      )}

      {/* Bottom info panel */}
      <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none">
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

      {/* Mute + time (right side, above nav) */}
      <div className="absolute bottom-24 right-3 flex flex-col gap-3 pointer-events-auto">
        <button
          onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) v.muted = !v.muted }}
          className="w-10 h-10 rounded-full glass-dark hover:bg-black/60 flex items-center justify-center text-white transition hover-ring"
          title="Mute"
        >
          {muted || volume === 0
            ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12a4.5 4.5 0 00-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
            : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06c5.12-.51 9-4.8 9-9.77s-3.88-9.26-9-9.77z" /></svg>}
        </button>
        <span className="text-center text-white/80 text-xs tabular-nums">{fmt(currentTime)}</span>
      </div>
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
  const wheelLock = useRef(0)
  const indexRef = useRef(0)
  indexRef.current = index

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!window.electronAPI) { setError('Electron API not available'); setLoading(false); return }
      const data = await window.electronAPI.ytShortsFeed().catch(() => null)
      if (cancelled) return
      if (data?.shorts?.length) setShorts(data.shorts)
      else if (data?.error) setError(data.error)
      else setError('Could not load Shorts')
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  const step = useCallback((dir) => {
    const cur = indexRef.current
    const next = cur + dir
    if (next < 0 || next >= shorts.length) return
    setReady(false)
    setIndex(next)
  }, [shorts.length])

  const next = useCallback(() => step(1), [step])
  const prev = useCallback(() => step(-1), [step])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const now = Date.now()
    if (now - wheelLock.current < 800) return
    if (Math.abs(e.deltaY) < 20) return
    wheelLock.current = now
    if (e.deltaY > 0) next()
    else prev()
  }, [next, prev])

  useEffect(() => {
    // The feed owns the arrow keys while it is on screen, so the music
    // player's always-on shortcuts stand down here.
    const releaseFocus = pushMediaFocus('shorts')
    const onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); next() }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); releaseFocus() }
  }, [next, prev])

  const short = shorts[index]

  return (
    <div className="flex items-center justify-center w-full h-full bg-black overflow-hidden relative" onWheel={handleWheel}>
      {loading ? (
        <Skeleton />
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 text-center px-6">
          <svg className="w-14 h-14 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p className="text-white/80 font-medium">Shorts couldn't load</p>
          <p className="text-white/50 text-sm max-w-sm">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); setShorts([]); (async () => { const d = await window.electronAPI.ytShortsFeed(); if (d?.shorts?.length) setShorts(d.shorts); else setError(d?.error || 'Could not load Shorts'); setLoading(false) })() }}
            className="mt-2 px-4 py-2 text-sm rounded-lg bg-yt-red hover:bg-yt-red-hover text-white transition"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Top bar */}
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

          {/* The current short */}
          <div
            key={short.id}
            className="relative rounded-xl overflow-hidden shadow-2xl aspect-[9/16]"
            style={{ height: 'min(78vh, calc(100vw * 16 / 9))' }}
          >
            <ShortView short={short} onReady={() => setReady(true)} />
          </div>

          {/* Right side navigation */}
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

          {/* Scroll hint */}
          {!ready && index < shorts.length - 1 && (
            <div className="absolute bottom-4 inset-x-0 z-20 flex justify-center">
              <span className="text-white/70 text-xs glass-dark px-3 py-1.5 rounded-full animate-fade-in">
                Scroll or press ↓ for next
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
