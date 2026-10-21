import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Hls from 'hls.js'
import { useDownloads } from '../context/DownloadContext'
import { useSettings } from '../context/SettingsContext'
import { useSubscriptions } from '../context/SubscriptionsContext'
import { useWatchLater } from '../context/WatchLaterContext'
import { useToast } from '../context/ToastContext'
import { pushMediaFocus } from '../mediaFocus'
import VideoMenu from './VideoMenu'
import LocalPlayer from './LocalPlayer'

// "m:ss" or "h:mm:ss" from the video page. 0 when the length isn't known yet.
function clockToSeconds(text) {
  if (!text || typeof text !== 'string') return 0
  const parts = text.trim().split(':').map(Number)
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0
  return parts.reduce((total, n) => total * 60 + n, 0)
}

function seekableEnd(video) {
  try {
    if (video.seekable && video.seekable.length) {
      return video.seekable.end(video.seekable.length - 1)
    }
  } catch { /* seekable can throw while the media is resetting */ }
  const d = video.duration
  return isFinite(d) && d > 0 ? d : 0
}

// The HLS relay writes the playlist as it muxes, so the media element reports a
// length that grows during playback. Prefer the known full length until the
// stream has actually caught up to it.
function fullDuration(known, media) {
  const knownSec = isFinite(known) && known > 0 ? known : 0
  const mediaSec = isFinite(media) && media > 0 ? media : 0
  if (knownSec > mediaSec + 1.5) return knownSec
  return mediaSec || knownSec
}

function NativePlayer({ id, autoPlay, knownDuration = 0 }) {
  const [streamUrl, setStreamUrl] = useState(null)
  const [streamError, setStreamError] = useState(null)
  const [loadingStream, setLoadingStream] = useState(true)
  const [phase, setPhase] = useState('resolving')
  const [quality, setQuality] = useState('auto')

  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const containerRef = useRef(null)
  const seekToRef = useRef(null)
  const knownRef = useRef(0)
  knownRef.current = knownDuration > 0 ? knownDuration : 0
  const [playing, setPlaying] = useState(autoPlay)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [seekable, setSeekable] = useState(0)
  const [volume, setVolume] = useState(1)
  const [speed, setSpeed] = useState(1)
  const [muted, setMuted] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(null) // 'quality' | 'speed' | null
  const [seeking, setSeeking] = useState(false)
  const hideTimer = useRef(null)
  // Click-to-play timing marks (see [play-timing] logs) — reset per load.
  const timingRef = useRef({ t0: 0, manifest: false, firstFrame: false })

  const QUALITIES = ['auto', '1080', '720', '480', '360']
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

  // Listen for stream-phase progress events from main
  useEffect(() => {
    if (!window.electronAPI?.onStreamPhase) return
    const off = window.electronAPI.onStreamPhase(({ videoId, phase: p }) => {
      if (videoId === id) setPhase(p)
    })
    return () => { if (window.electronAPI?.removeStreamPhaseListeners) window.electronAPI.removeStreamPhaseListeners() }
  }, [id])

  // Prewarm: kick off the slow yt-dlp stream-source resolution as soon as the
  // player mounts (paralleling video-info loading). ytStream below then hits the
  // warm cache and skips the ~2-6s yt-dlp call.
  useEffect(() => {
    if (window.electronAPI?.ytPrewarm && id) {
      window.electronAPI.ytPrewarm(id).catch(() => {})
    }
  }, [id])

  const stopCurrent = () => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    if (window.electronAPI) window.electronAPI.ytStreamStop(id).catch(() => {})
  }

  // Main load: (re)start a stream at the chosen quality
  useEffect(() => {
    let cancelled = false
    const prevVideo = videoRef.current
    if (prevVideo && !prevVideo.paused && isFinite(prevVideo.currentTime) && prevVideo.currentTime > 1) {
      seekToRef.current = prevVideo.currentTime
    }
    setStreamUrl(null)
    setStreamError(null)
    setLoadingStream(true)
    setPhase('resolving')
    setCurrentTime(0)
    setDuration(0)
    setSeekable(0)
    timingRef.current = { t0: Date.now(), manifest: false, firstFrame: false }

    stopCurrent()

    const load = async () => {
      if (!window.electronAPI) { setStreamError('No stream API'); setLoadingStream(false); return }
      const r = await window.electronAPI.ytStream(id, quality).catch(e => ({ ok: false, reason: e.message }))
      if (cancelled) return
      if (r?.ok && r.url) {
        setStreamUrl(r.url)
        console.log(`[play-timing] ${id} url-ready=${Date.now() - timingRef.current.t0}ms quality=${quality}`)
      } else {
        setStreamError(r?.reason || 'Unable to load stream')
        console.log(`[play-timing] ${id} stream-failed after=${Date.now() - timingRef.current.t0}ms: ${r?.reason || 'unknown'}`)
      }
      setLoadingStream(false)
    }
    load()

    return () => {
      cancelled = true
      stopCurrent()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, quality])

  // Wire the hls.js player to the <video>
  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        // The playlist has no end tag until ffmpeg finishes, so hls.js would
        // otherwise treat it as live and start at the growing edge.
        startPosition: 0,
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
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        const d = data && data.media && isFinite(data.media.duration) ? data.media.duration : 0
        if (d > 0) setDuration(d)
        if (timingRef.current.t0 && !timingRef.current.manifest) {
          timingRef.current.manifest = true
          console.log(`[play-timing] ${id} manifest=${Date.now() - timingRef.current.t0}ms`)
        }
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad(-1)
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
        } else {
          hls.destroy(); hlsRef.current = null; setStreamError('Stream playback error')
        }
      })
      if (autoPlay) {
        video.play().catch(() => {})
      }
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl
      if (autoPlay) video.play().catch(() => {})
    } else {
      setStreamError('HLS playback not supported')
    }
    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, autoPlay])

  const fmt = (s) => {
    if (!isFinite(s) || s < 0) return '0:00'
    const total = Math.floor(s)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const sec = total % 60
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
    const clock = `${mm}:${String(sec).padStart(2, '0')}`
    return h > 0 ? `${h}:${clock}` : clock
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) { video.play().catch(() => {}); setPlaying(true) }
    else { video.pause(); setPlaying(false) }
  }

  const toggleFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}) }
    else { el.requestFullscreen().catch(() => {}) }
  }

  const onSeek = (e) => {
    const video = videoRef.current
    const total = fullDuration(knownRef.current, video ? video.duration : duration)
    if (!video || !total) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    let t = frac * total
    const end = seekableEnd(video)
    if (end > 0) t = Math.min(t, end)
    if (seeking === false) setSeeking(true)
    setCurrentTime(t)
    video.currentTime = t
  }

  // Clicking anywhere on the player box toggles play (except on controls)
  const handleContainerClick = (e) => {
    if (e.target.closest && e.target.closest('button, input, select, textarea, [role="switch"], a, [data-no-toggle]')) return
    togglePlay()
  }

  const adjustTime = (delta) => {
    const video = videoRef.current
    if (!video || !isFinite(video.duration)) return
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration)
  }

  const adjustVolume = (delta) => {
    const video = videoRef.current
    if (!video) return
    const next = Math.min(1, Math.max(0, video.volume + delta))
    video.volume = next
    if (next > 0 && video.muted) video.muted = false
  }

  const adjustSpeed = (delta) => {
    const video = videoRef.current
    if (!video) return
    const next = Math.min(2, Math.max(0.25, (video.playbackRate || 1) + delta))
    video.playbackRate = next
    setSpeed(next)
  }

  // Official YouTube keyboard shortcuts (Space, k, j, l, m, f, arrows, etc.)
  useEffect(() => {
    if (!streamUrl || loadingStream) return
    // Claim the keyboard while a video is loaded so the music player's
    // always-on shortcuts stand down on this page.
    const releaseFocus = pushMediaFocus('video')
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (t && t.closest && t.closest('button, [role="switch"]')) return
      const video = videoRef.current
      if (!video) return

      if (e.key === ' ') { e.preventDefault(); togglePlay(); return }
      if (e.key === 'k' || e.key === 'K') { togglePlay(); return }
      if (e.key === 'm' || e.key === 'M') { const v = videoRef.current; if (v) v.muted = !v.muted; return }
      if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); return }
      if (e.key === 'j' || e.key === 'J') { adjustTime(-10); return }
      if (e.key === 'l' || e.key === 'L') { adjustTime(10); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); adjustTime(-5); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); adjustTime(5); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); adjustVolume(0.05); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); adjustVolume(-0.05); return }
      if (e.key === 'Home') { e.preventDefault(); if (video) video.currentTime = 0; return }
      if (e.key === 'End') {
        e.preventDefault()
        const end = seekableEnd(video)
        if (end > 0) video.currentTime = end
        return
      }
      if (e.key === '+' || e.key === '=') { adjustVolume(0.05); return }
      if (e.key === '-' || e.key === '_') { adjustVolume(-0.05); return }
      if (e.key === '>' || e.key === '.') { adjustSpeed(0.25); return }
      if (e.key === '<' || e.key === ',') { adjustSpeed(-0.25); return }
      if (/^[0-9]$/.test(e.key)) {
        const pct = parseInt(e.key, 10) / 10
        const total = fullDuration(knownRef.current, video.duration)
        if (total > 0) {
          let t = pct * total
          const end = seekableEnd(video)
          if (end > 0) t = Math.min(t, end)
          video.currentTime = t
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      releaseFocus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, loadingStream])

  // Auto-hide controls when playing
  useEffect(() => {
    const poke = () => {
      setShowControls(true)
      clearTimeout(hideTimer.current)
      if (!videoRef.current?.paused) {
        hideTimer.current = setTimeout(() => { setShowControls(false); setMenuOpen(null) }, 2800)
      }
    }
    if (!playing) { setShowControls(true); return }
    poke()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentTime])

  useEffect(() => {
    if (playing) setShowControls(true)
  }, [playing])

  // Music and video share the speakers: whoever starts last wins. Pause the
  // video when the music player starts, and tell the music player to pause
  // when this video starts.
  useEffect(() => {
    const onMusicPlay = () => { const v = videoRef.current; if (v && !v.paused) v.pause() }
    window.addEventListener('yt-music-play', onMusicPlay)
    return () => window.removeEventListener('yt-music-play', onMusicPlay)
  }, [])

  const controlClass = (visible) => `absolute inset-0 z-10 flex flex-col justify-between bg-gradient-to-b from-black/50 via-transparent to-black/60 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`

  const menuBtn = 'flex items-center justify-center w-9 h-9 rounded-full text-white/90 hover:bg-white/10 transition hover-ring'

  const renderMenu = (menu) => (
    <div className="absolute bottom-14 right-2 z-20 min-w-[130px] glass-dark rounded-xl p-1.5 shadow-xl pop-in pop-in-bottom menu-stagger">
      {menu === 'quality' ? QUALITIES.map((q) => (
        <button key={q} onClick={() => { setQuality(q); setMenuOpen(null) }}
          className={`w-full text-left px-3 py-1.5 rounded-lg text-sm capitalize transition ${quality === q ? 'bg-yt-red text-white' : 'text-white/80 hover:bg-white/10'}`}>
          {q === 'auto' ? 'Auto' : `${q}p`}{q !== 'auto' && ''}
        </button>
      )) : SPEEDS.map((s) => (
        <button key={s} onClick={() => { const video = videoRef.current; if (video) video.playbackRate = s; setSpeed(s); setMenuOpen(null) }}
          className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition ${speed === s ? 'bg-yt-red text-white' : 'text-white/80 hover:bg-white/10'}`}>
          {s}x
        </button>
      ))}
    </div>
  )

  const totalDuration = fullDuration(knownDuration, duration)
  const playedPct = totalDuration ? Math.min(100, (currentTime / totalDuration) * 100) : 0
  const bufferedPct = totalDuration ? Math.min(100, (Math.max(seekable, isFinite(duration) ? duration : 0) / totalDuration) * 100) : 0

  return (
    <div
      ref={containerRef}
      key={id}
      className="relative w-full aspect-video bg-black overflow-hidden group"
      onMouseMove={() => { setShowControls(true); clearTimeout(hideTimer.current); if (playing) hideTimer.current = setTimeout(() => setShowControls(false), 2800) }}
      onMouseLeave={() => { if (playing) { setShowControls(false); setMenuOpen(null) } }}
      onClick={handleContainerClick}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        autoPlay={autoPlay}
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
        className="w-full h-full bg-black"
        style={{ hardwareAcceleration: 'auto', videoDecodeAcceleration: 'auto' }}
        onPlay={() => { setPlaying(true); window.dispatchEvent(new Event('yt-video-play')) }}
        onPlaying={() => {
          if (timingRef.current.t0 && !timingRef.current.firstFrame) {
            timingRef.current.firstFrame = true
            console.log(`[play-timing] ${id} first-frame=${Date.now() - timingRef.current.t0}ms`)
          }
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          setCurrentTime(v.currentTime)
          const end = seekableEnd(v)
          if (end > 0) setSeekable(end)
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (isFinite(d) && d > 0) setDuration(d)
          const end = seekableEnd(e.currentTarget)
          if (end > 0) setSeekable(end)
          if (seekToRef.current) { try { e.currentTarget.currentTime = seekToRef.current } catch (_) {} seekToRef.current = null }
        }}
        onDurationChange={(e) => { const d = e.currentTarget.duration; if (isFinite(d) && d > 0) setDuration(d) }}
        onProgress={(e) => {
          const v = e.currentTarget
          const d = v.duration
          if (isFinite(d) && d > 0 && v.buffered.length) setDuration(d)
          const end = seekableEnd(v)
          if (end > 0) setSeekable(end)
        }}
        onEnded={() => { setPlaying(false); setShowControls(true) }}
        onVolumeChange={(e) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted) }}
      />

      {(loadingStream || !streamUrl) && !streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black">
          <div className="relative">
            <div className="w-14 h-14 rounded-full border-4 border-yt-red/25 border-t-yt-red animate-spin" />
            <svg className="absolute inset-0 m-auto w-5 h-5 text-yt-red" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
          <div className="text-center">
            <p className="text-white/90 text-base font-medium">
              {phase === 'resolving' && 'Resolving stream sources...'}
              {phase === 'starting' && 'Starting stream...'}
              {phase === 'buffering' && 'Buffering video...'}
              {!['resolving','starting','buffering'].includes(phase) && 'Preparing video...'}
            </p>
            <p className="text-white/40 text-xs mt-1">This can take a few seconds on first play</p>
          </div>
        </div>
      )}

      {streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center">
          <svg className="w-12 h-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-white/80 text-sm font-medium">Video can't play in-app</p>
          <p className="text-white/50 text-xs max-w-sm">{streamError}</p>
          <button onClick={() => { setStreamError(null); setQuality(q => (q === 'auto' ? '360' : 'auto')) }}
            className="mt-2 px-4 py-2 text-sm rounded-lg bg-yt-red hover:bg-yt-red-hover transition">
            Retry
          </button>
        </div>
      )}

      {!loadingStream && !streamError && streamUrl && (
        <>
          {/* Center play button overlay */}
          <div className={`absolute inset-0 z-10 flex items-center justify-center pointer-events-none ${playing ? 'opacity-0' : 'opacity-100'}`}>
            <button onClick={togglePlay} className="pointer-events-auto w-20 h-20 rounded-full glass-dark hover:bg-yt-red/80 flex items-center justify-center transition-all active:scale-95 animate-scale-in">
              <svg className="w-9 h-9 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>

          {/* Menu popups */}
          {menuOpen && renderMenu(menuOpen)}

          {/* Control bar */}
          <div className={controlClass(showControls)}>
            {/* top row: fullscreen + menus */}
            <div className="flex items-center justify-between p-3">
              <div className="text-white/90 text-sm font-medium drop-shadow">YT Desktop Player</div>
              <div className="flex items-center gap-1">
                <div className="relative">
                  <button className={menuBtn} title="Quality" onClick={() => setMenuOpen(menuOpen === 'quality' ? null : 'quality')}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </button>
                  <span className="absolute -bottom-0.5 right-2.5 text-[10px] font-semibold text-white/80">{quality === 'auto' ? 'Auto' : `${quality}p`}</span>
                </div>
                <div className="relative">
                  <button className={menuBtn} title="Speed" onClick={() => setMenuOpen(menuOpen === 'speed' ? null : 'speed')}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </button>
                  <span className="absolute -bottom-0.5 right-2.5 text-[10px] font-semibold text-white/80">{speed}x</span>
                </div>
                <button className={menuBtn} title="Fullscreen" onClick={toggleFullscreen}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2" /></svg>
                </button>
              </div>
            </div>

            {/* spacer */}
            <div />

            {/* bottom row */}
            <div className="p-3">
              {/* seek bar */}
              <div
                data-no-toggle
                className="group/seek relative h-1.5 rounded-full bg-white/25 cursor-pointer mb-2"
                onClick={onSeek}
                onMouseMove={(e) => { if (e.buttons === 1) onSeek(e) }}
              >
                <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${bufferedPct}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-yt-red" style={{ width: `${playedPct}%` }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-yt-red opacity-0 group-hover/seek:opacity-100 transition" style={{ left: `calc(${playedPct}% - 7px)` }} />
              </div>
              <div className="flex items-center gap-2">
                <button className={menuBtn} onClick={togglePlay}>
                  {playing
                    ? <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                    : <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
                </button>
                <button className={menuBtn} onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted } }}>
                  {muted || volume === 0
                    ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12a4.5 4.5 0 00-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                    : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06c5.12-.51 9-4.8 9-9.77s-3.88-9.26-9-9.77z" /></svg>}
                </button>
                <span className="text-[13px] text-white/85 font-medium tabular-nums">{fmt(currentTime)} / {fmt(totalDuration)}</span>
                <div className="flex-1" />
                <span className="text-[13px] text-white/85 font-medium capitalize tabular-nums">{quality === 'auto' ? 'Auto' : `${quality}p`} · {speed}x</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SkeletonPlayer() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video bg-gray-200 dark:bg-gray-800 rounded-xl" />
      <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-3/4 mt-4" />
      <div className="flex gap-4 mt-3">
        <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-1/3" />
        <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded-full w-20" />
        <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded-full w-20" />
      </div>
      <div className="flex items-center gap-4 mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-xl">
        <div className="w-12 h-12 bg-gray-300 dark:bg-gray-700 rounded-full" />
        <div className="flex-1">
          <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/3 mb-2" />
          <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-1/4" />
        </div>
      </div>
      <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-xl">
        <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-full mb-2" />
        <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-5/6 mb-2" />
        <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-2/3" />
      </div>
    </div>
  )
}

function SkeletonFormats() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-32" />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 bg-gray-300 dark:bg-gray-700 rounded" />
            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-24" />
          </div>
          <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-16" />
        </div>
      ))}
    </div>
  )
}

function FormatButton({ format, onDownload, isDownloading }) {
  const isAudio = format.type === 'audio'
  return (
    <button
      onClick={() => onDownload(format)}
      disabled={isDownloading}
      className={`w-full group flex items-center justify-between p-3 rounded-xl border transition-all ${
        isDownloading
          ? 'bg-yt-red/10 border-yt-red/30 cursor-not-allowed'
          : 'bg-gray-100 dark:bg-gray-800/80 border-transparent hover:border-yt-red/40 hover:bg-gray-50 dark:hover:bg-gray-700/60 active:scale-[0.98]'
      }`}
    >
      <span className="flex items-center gap-3">
        {isAudio ? (
          <span className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </span>
        ) : (
          <span className="w-8 h-8 rounded-lg bg-yt-red/10 flex items-center justify-center">
            <svg className="w-4 h-4 text-yt-red" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
          </span>
        )}
        <span className="font-medium">{format.quality}</span>
      </span>
      <div className="flex items-center gap-2">
        {format.size && (
          <span className="text-sm text-gray-500 dark:text-gray-400">{format.size}</span>
        )}
        {isDownloading ? (
          <span className="text-xs bg-yt-red text-white px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Downloading
          </span>
        ) : (
          <span className="text-xs font-medium bg-gray-200 dark:bg-gray-700 group-hover:bg-yt-red group-hover:text-white px-3 py-1 rounded-full transition-colors flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </span>
        )}
      </div>
    </button>
  )
}

const EMBED_URL = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`

export default function VideoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { startDownload, activeDownloads, completedDownloads, playFile, cancelDownload } = useDownloads()
  const { settings } = useSettings()
  const { recordWatch } = useSubscriptions()
  const { isInWatchLater, toggleWatchLater } = useWatchLater()
  const { addToast } = useToast()
  const [videoInfo, setVideoInfo] = useState(null)
  const [formats, setFormats] = useState([])
  const [loadingInfo, setLoadingInfo] = useState(true)
  const [loadingFormats, setLoadingFormats] = useState(true)
  const [infoError, setInfoError] = useState(null)
  const [formatError, setFormatError] = useState(null)
  const [playingLocal, setPlayingLocal] = useState(null)
  const iframeRef = useRef(null)

  // Music takes over the speakers: ask the embed (iframe playback mode) to pause.
  useEffect(() => {
    const onMusicPlay = () => {
      const f = iframeRef.current
      if (!f || !f.contentWindow) return
      try {
        f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*')
      } catch { /* cross-origin */ }
    }
    window.addEventListener('yt-music-play', onMusicPlay)
    return () => window.removeEventListener('yt-music-play', onMusicPlay)
  }, [])

  useEffect(() => {
    if (!id) return

    let cancelled = false

    async function loadVideo() {
      setLoadingInfo(true)
      setLoadingFormats(true)
      setInfoError(null)
      setFormatError(null)
      setVideoInfo(null)
      setFormats([])
      setPlayingLocal(null)

      // Info and formats only need the video id — fetch both at once instead of
      // waiting for the info round-trip before starting the formats call.
      const infoJob = (async () => {
        try {
          if (window.electronAPI) {
            const infoResult = await window.electronAPI.ytVideoInfo(id)
            if (cancelled) return

            if (infoResult.error) {
              setInfoError(infoResult.error)
            } else {
              setVideoInfo(infoResult.info)
            }
          } else {
            setInfoError('Electron API not available')
          }
        } catch (err) {
          if (!cancelled) setInfoError(err.message)
        } finally {
          if (!cancelled) setLoadingInfo(false)
        }
      })()

      const formatsJob = (async () => {
        try {
          if (window.electronAPI) {
            const videoUrl = `https://www.youtube.com/watch?v=${id}`
            const fmtResult = await window.electronAPI.ytConvertFormats(videoUrl)
            if (cancelled) return

            if (fmtResult.error && !fmtResult.formats?.length) {
              setFormatError(fmtResult.error)
            } else {
              setFormats(fmtResult.formats || [])
            }
          }
        } catch (err) {
          if (!cancelled) setFormatError(err.message)
        } finally {
          if (!cancelled) setLoadingFormats(false)
        }
      })()

      await Promise.all([infoJob, formatsJob])
    }

    loadVideo()

    return () => { cancelled = true }
  }, [id])

  // Record watch for recommendations once video info loads
  useEffect(() => {
    if (!videoInfo || !videoInfo.channel) return
    recordWatch({
      id,
      title: videoInfo.title || '',
      channel: videoInfo.channel || '',
      thumbnail: videoInfo.thumbnail || '',
      duration: videoInfo.duration || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoInfo && videoInfo.channel])

  const handleDownload = async (format) => {
    if (!id) return
    const fmt = format.format === 'audio' ? null : (format.format || 'mp4')
    const isAudio = format.type === 'audio' || (format.quality || '').toLowerCase().includes('audio') || (format.quality || '').toLowerCase().includes('mp3') || (format.quality || '').toLowerCase().includes('m4a')
    await startDownload({
      videoId: id,
      quality: format.quality || '720p (HD)',
      format: fmt,
      audio: isAudio,
      title: videoInfo?.title || '',
      thumbnail: videoInfo?.thumbnail || '',
    }).catch(() => {})
  }

  const isDownloading = (format) => {
    return activeDownloads.some(d => d.videoId === id && d.quality === format.quality)
  }

  const activeForVideo = activeDownloads.filter(d => d.videoId === id && d.status === 'downloading')
  const localFile = completedDownloads.find(c => c.videoId === id) || null

  const thumbnailUrl = videoInfo?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

  const closeLocalPlayer = () => setPlayingLocal(null)

  const playLocalFile = async (filePath) => {
    if (window.electronAPI) {
      const url = await window.electronAPI.preparePlayback(filePath)
      if (url) { setPlayingLocal(url); return }
    }
    setPlayingLocal(`file://${filePath}`)
  }

  // Prefer a finished local download over streaming: if this video is already on
  // disk (e.g. saved by the background For You downloader), play it instantly.
  useEffect(() => {
    if (!localFile || !localFile.filePath) return
    if (playingLocal) return
    if (settings.playbackMode === 'inApp') {
      playLocalFile(localFile.filePath)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFile && localFile.filePath])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          {loadingInfo ? (
            <SkeletonPlayer />
          ) : (
            <div>
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-xl ring-1 ring-white/10">
                {playingLocal ? (
                  <LocalPlayer url={playingLocal} title={videoInfo?.title || 'Local preview'} onClose={closeLocalPlayer} />
                ) : settings.playbackMode === 'inApp' ? (
                  <NativePlayer id={id} autoPlay={settings.autoplay} knownDuration={clockToSeconds(videoInfo?.duration)} />
                ) : (
                  <iframe
                    key={id}
                    ref={iframeRef}
                    className="w-full h-full"
                    src={EMBED_URL(id)}
                    title={videoInfo?.title || 'Video player'}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                )}
              </div>

              {!playingLocal && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {localFile && (
                    <>
                      <button
                        onClick={() => playLocalFile(localFile.filePath)}
                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors hover-ring"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                        Play Downloaded File
                      </button>
                      <button
                        onClick={() => playFile(localFile.filePath)}
                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium transition-colors hover-ring"
                      >
                        Open in System Player
                      </button>
                    </>
                  )}
                </div>
              )}

              <h1 className="text-xl md:text-2xl font-semibold leading-snug mt-4">{videoInfo?.title || 'Video'}</h1>
              {videoInfo && (
                <div className="flex flex-wrap items-center gap-4 mt-3">
                  <span className="text-gray-600 dark:text-gray-400 text-sm">
                    {videoInfo.views}{videoInfo.duration ? ` views · ${videoInfo.duration}` : ''}
                  </span>
                  <button
                    onClick={() => {
                      const queued = isInWatchLater(id)
                      toggleWatchLater({
                        id,
                        title: videoInfo.title || '',
                        thumbnail: videoInfo.thumbnail || '',
                        channel: videoInfo.channel || '',
                        duration: videoInfo.duration || '',
                      })
                      addToast('success', queued ? 'Removed from Watch later' : 'Added to Watch later', 2500)
                    }}
                    className={`text-[13px] px-3 py-1 rounded-full border transition-colors ${
                      isInWatchLater(id)
                        ? 'border-current text-gray-900 dark:text-white'
                        : 'border-black/15 dark:border-white/20 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    {isInWatchLater(id) ? 'In Watch later' : 'Watch later'}
                  </button>
                  {videoInfo.channel && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigate(`/channel/${encodeURIComponent(videoInfo.channel)}`)}
                        className="w-8 h-8 bg-black/[0.06] dark:bg-white/10 rounded-full flex items-center justify-center text-sm text-gray-700 dark:text-gray-200"
                        title={`View ${videoInfo.channel} channel`}
                        aria-label="View channel"
                      >
                        {videoInfo.channel.charAt(0).toUpperCase()}
                      </button>
                      <button
                        onClick={() => navigate(`/channel/${encodeURIComponent(videoInfo.channel)}`)}
                        className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                      >{videoInfo.channel}</button>
                      <VideoMenu video={{ id, title: videoInfo?.title || '', thumbnail: videoInfo?.thumbnail || '', channel: videoInfo.channel, duration: videoInfo.duration || '' }} />
                    </div>
                  )}
                </div>
              )}
              {settings.showDescriptions && videoInfo?.description && (
                <div className="mt-4 text-gray-600 dark:text-gray-300">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{videoInfo.description}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:w-80 shrink-0">
          <div className="sticky top-4 space-y-4">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Download</h3>

            {activeForVideo.length > 0 && (
              <div className="space-y-2 p-3 bg-yt-red/5 dark:bg-yt-red/10 border border-yt-red/20 rounded-xl">
                <p className="text-sm font-medium flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin text-yt-red" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Downloading
                </p>
                {activeForVideo.map(dl => (
                  <div key={dl.id} className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>{dl.quality}</span>
                      <span>{Math.round(dl.progress || 0)}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yt-red transition-all"
                        style={{ width: `${Math.min(100, dl.progress || 0)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>{dl.eta}</span>
                      <button
                        onClick={() => cancelDownload(dl.id)}
                        className="text-red-500 hover:text-red-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loadingFormats ? (
              <SkeletonFormats />
            ) : formatError && formats.length === 0 ? (
              <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-xl text-center">
                <svg className="w-10 h-10 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm text-gray-500 mb-2">Could not load format info</p>
                <p className="text-xs text-gray-400 mb-3">{formatError}</p>
                <a
                  href={`https://app.ytdown.to/en38/?url=https://www.youtube.com/watch?v=${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-4 py-2 bg-yt-red text-white text-sm font-medium rounded-lg hover:bg-yt-red-hover transition-colors hover-ring"
                >
                  Try on YTDown
                </a>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {formats.filter(f => f.type !== 'audio').map((format, i) => (
                    <FormatButton key={`v-${i}`} format={format} onDownload={handleDownload} isDownloading={isDownloading(format)} />
                  ))}
                </div>
                <div className="pt-2">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Audio</p>
                  <div className="space-y-2">
                    {formats.filter(f => f.type === 'audio').map((format, i) => (
                      <FormatButton key={`a-${i}`} format={format} onDownload={handleDownload} isDownloading={isDownloading(format)} />
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center pt-2">
                  Videos save to ~/.config/Kovatube/downloads/videos
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
