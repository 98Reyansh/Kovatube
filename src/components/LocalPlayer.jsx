import { useState, useEffect, useRef, useCallback } from 'react'

function fmt(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Cinematic full-screen player for locally downloaded files.
export default function LocalPlayer({ url, title, onClose }) {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const hideTimer = useRef(null)

  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [speed, setSpeed] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [loading, setLoading] = useState(true)

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  const onSeek = (e) => {
    const v = videoRef.current
    const el = e.currentTarget
    if (!v || !isFinite(v.duration)) return
    const rect = el.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    v.currentTime = pct * v.duration
  }

  const toggleFullscreen = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}) }
    else { el.requestFullscreen().catch(() => {}) }
  }, [])

  const adjustVolume = (delta) => {
    const v = videoRef.current
    if (!v) return
    let vol = v.volume + delta
    vol = Math.max(0, Math.min(1, vol))
    v.volume = vol
    v.muted = vol === 0
  }

  // Auto-hide controls
  const pokeControls = useCallback(() => {
    setShowControls(true)
    clearTimeout(hideTimer.current)
    if (!videoRef.current?.paused) {
      hideTimer.current = setTimeout(() => setShowControls(false), 3000)
    }
  }, [])

  useEffect(() => {
    if (playing) setShowControls(true)
  }, [playing])

  const menuBtn = 'flex items-center justify-center w-10 h-10 rounded-full text-white/90 hover:bg-white/15 transition hover-ring'

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const v = videoRef.current
      if (!v) return
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break
        case 'ArrowLeft': e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); break
        case 'ArrowRight': e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); break
        case 'ArrowUp': e.preventDefault(); adjustVolume(0.05); break
        case 'ArrowDown': e.preventDefault(); adjustVolume(-0.05); break
        case 'f': case 'F': toggleFullscreen(); break
        case 'Escape': if (!document.fullscreenElement) onClose(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  // Track fullscreen state (so we know when to allow Escape to exit)
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Stand down when the music player starts.
  useEffect(() => {
    const onMusicPlay = () => { const v = videoRef.current; if (v && !v.paused) v.pause() }
    window.addEventListener('yt-music-play', onMusicPlay)
    return () => window.removeEventListener('yt-music-play', onMusicPlay)
  }, [])

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-fade-in"
      onMouseMove={pokeControls}
      onClick={() => { if (document.fullscreenElement) return; setShowControls(o => !o) }}
    >
      {/* close overlay — click anywhere outside the video to exit */}
      <div
        className="absolute inset-0 z-[0]"
        onClick={() => { if (!document.fullscreenElement) onClose() }}
      />

      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70vw] h-[70vw] max-w-[900px] max-h-[900px] bg-yt-red/20 blur-[140px] rounded-full" />
      </div>

      <div className="relative z-10 w-full max-w-5xl px-4 sm:px-8 animate-zoom-in">
        {/* top chrome */}
        <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl px-4 sm:px-8 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3 pointer-events-none'}`}>
          <div className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3 shrink-0 glass-dark rounded-full pl-1.5 pr-4 py-1.5">
              <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-yt-red to-pink-500 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold truncate">{title || 'Local Video'}</p>
                <p className="text-white/40 text-xs">Playing local file</p>
              </div>
            </div>
          </div>
        </div>

        {/* video */}
        <div className="relative aspect-video bg-black rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl">        
          <video
            ref={videoRef}
            src={url}
            autoPlay
            playsInline
            crossOrigin="anonymous"
            preload="metadata"
            className="w-full h-full bg-black"
            style={{ hardwareAcceleration: 'auto', videoDecodeAcceleration: 'auto' }}
            onPlay={() => { setPlaying(true); window.dispatchEvent(new Event('yt-video-play')) }}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration || 0); setLoading(false) }}
            onWaiting={() => setLoading(true)}
            onPlaying={() => setLoading(false)}
            onCanPlay={() => setLoading(false)}
            onVolumeChange={(e) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted) }}
          />

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="w-12 h-12 rounded-full border-4 border-yt-red/25 border-t-yt-red animate-spin" />
            </div>
          )}

          {/* always-visible close button */}
          <button
            onClick={(e) => { e.stopPropagation(); onClose() }}
            className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full glass-dark hover:bg-yt-red text-white shadow-lg flex items-center justify-center transition-transform active:scale-90"
            aria-label="Close player"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          {/* center play button */}
          {!playing && !loading && (
            <button onClick={togglePlay} className="absolute inset-0 flex items-center justify-center group">
              <span className="w-20 h-20 rounded-full glass-dark hover:bg-yt-red/90 flex items-center justify-center transition-all active:scale-95 animate-scale-in">
                <svg className="w-9 h-9 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </button>
          )}

          {/* bottom controls */}
          <div className={`absolute inset-x-0 bottom-0 px-4 pb-3 pt-24 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            {/* seek bar */}
            <div
              className="group relative h-1.5 rounded-full bg-white/25 cursor-pointer mb-3"
              onClick={(e) => { e.stopPropagation(); onSeek(e) }}
              onMouseMove={(e) => { if (e.buttons === 1) { e.stopPropagation(); onSeek(e) } }}
            >
              <div className="absolute inset-y-0 left-0 rounded-full bg-yt-red" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-yt-red shadow opacity-0 group-hover:opacity-100 transition" style={{ left: `calc(${duration ? (currentTime / duration) * 100 : 0}% - 7px)` }} />
            </div>
            <div className="flex items-center gap-2">
              <button className={menuBtn} onClick={(e) => { e.stopPropagation(); togglePlay() }}>
                {playing
                  ? <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                  : <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
              </button>
              <button className={menuBtn} onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) v.muted = !v.muted }}>
                {muted || volume === 0
                  ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12a4.5 4.5 0 00-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                  : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06c5.12-.51 9-4.8 9-9.77s-3.88-9.26-9-9.77z" /></svg>}
              </button>
              <span className="text-[13px] text-white/85 font-medium tabular-nums">{fmt(currentTime)} / {fmt(duration)}</span>
              <div className="flex-1" />
              <div className="hidden sm:flex items-center gap-0.5 mr-1">
                {[0.5, 1, 1.25, 1.5, 2].map((s) => (
                  <button key={s} onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) v.playbackRate = s; setSpeed(s) }}
                    className={`px-2 py-1 rounded text-xs font-medium transition ${speed === s ? 'bg-yt-red text-white' : 'text-white/70 hover:bg-white/10'}`}>
                    {s}x
                  </button>
                ))}
              </div>
              <button className={menuBtn} onClick={(e) => { e.stopPropagation(); toggleFullscreen() }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* keyboard shortcut hint */}
        <div className={`text-center text-white/35 text-xs mt-4 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
          Space to play/pause · ← → to seek · ↑ ↓ volume · F fullscreen
        </div>
      </div>
    </div>
  )
}
