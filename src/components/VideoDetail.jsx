import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import Hls from 'hls.js'
import { useDownloads } from '../context/DownloadContext'
import { useSettings } from '../context/SettingsContext'
import { useSubscriptions } from '../context/SubscriptionsContext'
import { useWatchLater } from '../context/WatchLaterContext'
import { useToast } from '../context/ToastContext'
import { pushMediaFocus } from '../mediaFocus'
import VideoMenu from './VideoMenu'
import Comments from './Comments'
import LocalPlayer from './LocalPlayer'
import { prewarmNow, prewarmOnHover } from '../lib/prewarm'

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

const EMPTY_CAPTIONS = []

function captionTrackKey(track) {
  if (!track) return ''
  return track.kind === 'asr' ? `${track.languageCode}:asr` : track.languageCode
}

function applyCaptionCues(video, cues) {
  if (!video || typeof video.addTextTrack !== 'function') return
  let track = null
  for (const item of video.textTracks) {
    if (item.label === 'Kovatube captions') { track = item; break }
  }
  if (!track) track = video.addTextTrack('subtitles', 'Kovatube captions', 'en')
  const existing = track.cues ? [...track.cues] : []
  for (const cue of existing) {
    try { track.removeCue(cue) } catch { /* the cue was already removed */ }
  }
  for (const cue of cues || []) {
    if (!(cue.end > cue.start) || !cue.text) continue
    try { track.addCue(new VTTCue(cue.start, cue.end, cue.text)) } catch { /* skip a cue the browser rejects */ }
  }
  track.mode = cues && cues.length ? 'showing' : 'disabled'
}

function NativePlayer({ id, autoPlay, knownDuration = 0, title = '', theater = false, onToggleTheater, captions = EMPTY_CAPTIONS, captionLang = '', onCaptionLang }) {
  const [streamUrl, setStreamUrl] = useState(null)
  const [direct, setDirect] = useState(null)
  const [streamError, setStreamError] = useState(null)
  const [loadingStream, setLoadingStream] = useState(true)
  const [quality, setQuality] = useState('auto')
  const [reloadToken, setReloadToken] = useState(0)

  const videoRef = useRef(null)
  const audioRef = useRef(null)
  const directRef = useRef(false)
  const relayRef = useRef(false)
  const hlsRef = useRef(null)
  const containerRef = useRef(null)
  const seekToRef = useRef(null)
  const knownRef = useRef(0)
  knownRef.current = knownDuration > 0 ? knownDuration : 0
  const [playing, setPlaying] = useState(autoPlay)
  const wantAutoRef = useRef(autoPlay !== false)
  useEffect(() => { wantAutoRef.current = autoPlay !== false }, [id, autoPlay])
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [seekable, setSeekable] = useState(0)
  const [volume, setVolume] = useState(1)
  const [speed, setSpeed] = useState(1)
  const [boosting, setBoosting] = useState(false)
  const [muted, setMuted] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [settingsPage, setSettingsPage] = useState(null) // null | 'root' | 'quality' | 'speed' | 'captions'
  const [hoverTime, setHoverTime] = useState(null)
  const [seeking, setSeeking] = useState(false)
  const theaterToggleRef = useRef(onToggleTheater)
  theaterToggleRef.current = onToggleTheater
  const [captionLoading, setCaptionLoading] = useState(false)
  const [captionError, setCaptionError] = useState('')
  const captionCuesRef = useRef([])
  const captionsRef = useRef(captions)
  const captionLangRef = useRef(captionLang)
  const onCaptionLangRef = useRef(onCaptionLang)
  const lastCaptionRef = useRef(captionLang)
  captionsRef.current = captions
  captionLangRef.current = captionLang
  onCaptionLangRef.current = onCaptionLang
  if (captionLang) lastCaptionRef.current = captionLang
  const hideTimer = useRef(null)
  // Click-to-play timing marks (see [play-timing] logs) — reset per load.
  const timingRef = useRef({ t0: 0, manifest: false, firstFrame: false })

  const QUALITIES = ['auto', '1080', '720', '480', '360']
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

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
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
  }

  useEffect(() => { relayRef.current = false }, [id])

  // A capped googlevideo URL starts, then dies. Switch this video to the remux.
  useEffect(() => {
    if (!window.electronAPI?.onStreamCapped) return undefined
    return window.electronAPI.onStreamCapped(({ videoId }) => {
      if (videoId !== id || relayRef.current) return
      relayRef.current = true
      setReloadToken((n) => n + 1)
    })
  }, [id])

  // Main load: (re)start a stream at the chosen quality
  useEffect(() => {
    let cancelled = false
    const prevVideo = videoRef.current
    if (prevVideo && !prevVideo.paused && isFinite(prevVideo.currentTime) && prevVideo.currentTime > 1) {
      seekToRef.current = prevVideo.currentTime
    }
    setStreamUrl(null)
    setDirect(null)
    directRef.current = false
    setStreamError(null)
    setLoadingStream(true)
    setCurrentTime(0)
    setDuration(0)
    setSeekable(0)
    timingRef.current = { t0: Date.now(), manifest: false, firstFrame: false }

    stopCurrent()

    const load = async () => {
      if (!window.electronAPI) { setStreamError('No stream API'); setLoadingStream(false); return }
      const r = await window.electronAPI.ytStream(id, quality, relayRef.current).catch(e => ({ ok: false, reason: e.message }))
      if (cancelled) return
      if (r?.ok && r.direct && r.videoUrl && r.audioUrl) {
        directRef.current = true
        setDirect({ videoUrl: r.videoUrl, audioUrl: r.audioUrl })
        console.log(`[play-timing] ${id} direct-ready=${Date.now() - timingRef.current.t0}ms quality=${quality}`)
      } else if (r?.ok && r.url) {
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
  }, [id, quality, reloadToken])

  // Wire the hls.js player to the <video>
  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return undefined
    let hlsOnce = null
    video.crossOrigin = 'anonymous'
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
        applyCaptionCues(video, captionCuesRef.current)
        if (wantAutoRef.current) video.play().catch(() => {})
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
      const disarm = armAutoplay(video)
      hlsOnce = disarm
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl
      hlsOnce = armAutoplay(video)
    } else {
      setStreamError('HLS playback not supported')
    }
    return () => {
      if (hlsOnce) hlsOnce()
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, autoPlay])

  // Picture and sound are separate files. Play them together so a click doesn't
  // wait for ffmpeg to remux a playlist. The video element stays silent.
  useEffect(() => {
    const video = videoRef.current
    const audio = audioRef.current
    if (!video || !audio || !direct) return undefined
    let failed = false
    const giveUp = () => {
      if (failed || relayRef.current) return
      failed = true
      relayRef.current = true
      directRef.current = false
      setDirect(null)
      setReloadToken((n) => n + 1)
    }
    video.removeAttribute('crossorigin')
    video.src = direct.videoUrl
    audio.src = direct.audioUrl
    video.muted = true
    audio.volume = volume
    audio.muted = muted
    const align = () => {
      if (video.seeking) return
      if (Math.abs((audio.currentTime || 0) - (video.currentTime || 0)) > 0.35) {
        try { audio.currentTime = video.currentTime } catch { /* not ready */ }
      }
      if (audio.playbackRate !== video.playbackRate) audio.playbackRate = video.playbackRate
    }
    const onPlay = () => { audio.play().catch(() => {}) }
    const onPause = () => { audio.pause() }
    const onSeek = () => { try { audio.currentTime = video.currentTime } catch { /* not ready */ } }
    const onRate = () => { audio.playbackRate = video.playbackRate }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeking', onSeek)
    video.addEventListener('seeked', onSeek)
    video.addEventListener('ratechange', onRate)
    video.addEventListener('timeupdate', align)
    video.addEventListener('error', giveUp)
    audio.addEventListener('error', giveUp)
    const disarm = armAutoplay(video, audio)
    return () => {
      disarm()
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeking', onSeek)
      video.removeEventListener('seeked', onSeek)
      video.removeEventListener('ratechange', onRate)
      video.removeEventListener('timeupdate', align)
      video.removeEventListener('error', giveUp)
      audio.removeEventListener('error', giveUp)
      audio.pause()
    }
    // volume and muted are applied below so a slider move doesn't reload the file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direct, autoPlay])

  useEffect(() => {
    const audio = audioRef.current
    if (!direct || !audio) return
    audio.volume = volume
    audio.muted = muted
    if (videoRef.current) videoRef.current.muted = true
  }, [direct, volume, muted])

  // Captions are fetched only after the user turns a language on. yt-dlp takes
  // a few seconds, so a video with captions off never starts that download.
  useEffect(() => {
    let cancelled = false
    const track = (captions || []).find((item) => captionTrackKey(item) === captionLang)
    if (!track || !window.electronAPI?.ytCaptions) {
      captionCuesRef.current = []
      setCaptionError('')
      setCaptionLoading(false)
      applyCaptionCues(videoRef.current, [])
      return undefined
    }
    setCaptionLoading(true)
    setCaptionError('')
    window.electronAPI.ytCaptions({ videoId: id, languageCode: track.languageCode, kind: track.kind }).then((res) => {
      if (cancelled) return
      const cues = res?.cues || []
      if (res?.error || !cues.length) {
        captionCuesRef.current = []
        setCaptionError(res?.error || "Couldn't load captions")
        applyCaptionCues(videoRef.current, [])
        return
      }
      captionCuesRef.current = cues
      setCaptionError('')
      applyCaptionCues(videoRef.current, cues)
    }).catch(() => {
      if (!cancelled) {
        captionCuesRef.current = []
        setCaptionError("Couldn't load captions")
        applyCaptionCues(videoRef.current, [])
      }
    }).finally(() => {
      if (!cancelled) setCaptionLoading(false)
    })
    return () => { cancelled = true }
  }, [id, captionLang, captions])

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
    if (video.paused) { wantAutoRef.current = true; video.play().catch(() => {}); setPlaying(true) }
    else { wantAutoRef.current = false; video.pause(); setPlaying(false) }
  }

  // play() right as the src is assigned often rejects. Keep trying until the
  // media can actually start, and stop if the viewer hits pause.
  const armAutoplay = (video, audio) => {
    if (!video || autoPlay === false) return () => {}
    const kick = () => {
      if (!wantAutoRef.current) return
      if (!video.paused) {
        if (audio && audio.paused) audio.play().catch(() => {})
        return
      }
      video.play().then(() => { if (audio) audio.play().catch(() => {}) }).catch(() => {})
    }
    kick()
    video.addEventListener('loadeddata', kick)
    video.addEventListener('canplay', kick)
    return () => {
      video.removeEventListener('loadeddata', kick)
      video.removeEventListener('canplay', kick)
    }
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
    if (directRef.current && audioRef.current) {
      const audio = audioRef.current
      const cur = audio.muted ? 0 : audio.volume
      const next = Math.min(1, Math.max(0, cur + delta))
      audio.volume = next
      audio.muted = next === 0
      setVolume(next)
      setMuted(next === 0)
      return
    }
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
    if ((!streamUrl && !direct) || loadingStream) return
    // Claim the keyboard while a video is loaded so the music player's
    // always-on shortcuts stand down on this page.
    const releaseFocus = pushMediaFocus('video')
    const hold = { timer: 0, active: false, prev: 1, down: 0 }
    const typingTarget = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return true
      if (t && t.closest && t.closest('button, [role="switch"]')) return true
      return false
    }
    const endBoost = (toggleIfTap) => {
      clearTimeout(hold.timer)
      hold.timer = 0
      const wasDown = hold.down
      const wasActive = hold.active
      hold.down = 0
      if (wasActive) {
        const video = videoRef.current
        if (video) video.playbackRate = hold.prev || 1
        hold.active = false
        setBoosting(false)
        return
      }
      if (toggleIfTap && wasDown) togglePlay()
    }
    const onKeyUp = (e) => {
      if (e.key !== ' ' && e.code !== 'Space') return
      if (!hold.down && !hold.active) return
      e.preventDefault()
      endBoost(true)
    }
    const onKey = (e) => {
      if ((e.key === ' ' || e.code === 'Space') && (hold.down || hold.active)) {
        e.preventDefault()
        return
      }
      if (typingTarget(e)) return
      const video = videoRef.current
      if (!video) return

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        if (e.repeat) return
        hold.down = Date.now()
        if (!video.paused) {
          hold.timer = setTimeout(() => {
            const current = videoRef.current
            if (!current || current.paused || !hold.down) return
            hold.prev = current.playbackRate || 1
            hold.active = true
            current.playbackRate = 2
            setBoosting(true)
          }, 220)
        }
        return
      }
      if (e.key === 'k' || e.key === 'K') { togglePlay(); return }
      if (e.key === 'm' || e.key === 'M') {
        if (directRef.current && audioRef.current) {
          const audio = audioRef.current
          audio.muted = !audio.muted
          setMuted(audio.muted)
          return
        }
        const v = videoRef.current
        if (v) v.muted = !v.muted
        return
      }
      if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); return }
      if (e.key === 't' || e.key === 'T') { theaterToggleRef.current?.(); return }
      if (e.key === 'c' || e.key === 'C') {
        const list = captionsRef.current || []
        const current = captionLangRef.current || ''
        if (list.some((item) => captionTrackKey(item) === current)) {
          onCaptionLangRef.current?.('')
          return
        }
        const next = list.find((item) => captionTrackKey(item) === lastCaptionRef.current)
          || list.find((item) => item.languageCode === 'en' && item.kind !== 'asr')
          || list.find((item) => String(item.languageCode || '').toLowerCase().startsWith('en'))
          || list[0]
        if (next) onCaptionLangRef.current?.(captionTrackKey(next))
        return
      }
      if (e.key === 'i' || e.key === 'I') {
        const pip = videoRef.current
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
        else pip?.requestPictureInPicture?.().catch(() => {})
        return
      }
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
    const onBlur = () => endBoost(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      endBoost(false)
      releaseFocus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, direct, loadingStream])

  // Auto-hide controls when playing
  useEffect(() => {
    const poke = () => {
      setShowControls(true)
      clearTimeout(hideTimer.current)
      if (!videoRef.current?.paused) {
        hideTimer.current = setTimeout(() => { setShowControls(false); setSettingsPage(null) }, 2800)
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

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const iconBtn = 'grid h-10 w-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10'
  const captionsOn = (captions || []).some((item) => captionTrackKey(item) === captionLang)

  const setPlaybackRate = (s) => {
    const video = videoRef.current
    if (video) video.playbackRate = s
    setSpeed(s)
    setSettingsPage(null)
  }

  const togglePip = () => {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
    else video.requestPictureInPicture?.().catch(() => {})
  }

  const totalDuration = fullDuration(knownDuration, duration)
  const playedPct = totalDuration ? Math.min(100, (currentTime / totalDuration) * 100) : 0
  const bufferedPct = totalDuration ? Math.min(100, (Math.max(seekable, isFinite(duration) ? duration : 0) / totalDuration) * 100) : 0

  return (
    <div
      ref={containerRef}
      key={id}
      className="relative w-full aspect-video bg-black overflow-hidden group"
      onMouseMove={() => { setShowControls(true); clearTimeout(hideTimer.current); if (playing) hideTimer.current = setTimeout(() => setShowControls(false), 2800) }}
      onMouseLeave={() => { if (playing) { setShowControls(false); setSettingsPage(null); setHoverTime(null) } }}
      onClick={handleContainerClick}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        autoPlay={autoPlay}
        playsInline
        preload="auto"
        poster={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
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
        onVolumeChange={(e) => {
          if (directRef.current) return
          setVolume(e.currentTarget.volume)
          setMuted(e.currentTarget.muted)
        }}
      />
      <audio ref={audioRef} preload="auto" className="hidden" />

      {(loadingStream && !streamUrl && !direct) && !streamError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full border-4 border-white/30 border-t-white animate-spin" />
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

      {!loadingStream && !streamError && (streamUrl || direct) && (
        <>
          {boosting && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <span className="rounded-md bg-black/75 px-3 py-1.5 text-sm font-semibold tracking-wide text-white">2x</span>
            </div>
          )}
          {isFullscreen && title && (
            <div className={`pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
              <p className="truncate text-[15px] font-medium text-white">{title}</p>
            </div>
          )}

          <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/35 to-transparent pt-16 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
            <div className={`relative ${showControls ? 'pointer-events-auto' : ''}`}>
            {settingsPage && (
              <div data-no-toggle className="absolute bottom-full right-2 z-20 mb-1 w-[260px] overflow-hidden rounded-xl bg-[#212121]/95 py-1.5 text-[13px] text-white shadow-xl">
                {settingsPage === 'root' && (
                  <>
                    <button type="button" onClick={() => setSettingsPage('quality')} className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-white/10">
                      <span>Quality</span>
                      <span className="text-white/70">{quality === 'auto' ? 'Auto' : `${quality}p`} ›</span>
                    </button>
                    <button type="button" onClick={() => setSettingsPage('speed')} className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-white/10">
                      <span>Playback speed</span>
                      <span className="text-white/70">{speed === 1 ? 'Normal' : `${speed}`} ›</span>
                    </button>
                  </>
                )}
                {settingsPage === 'quality' && (
                  <>
                    <button type="button" onClick={() => setSettingsPage('root')} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-white/10">‹ Quality</button>
                    {QUALITIES.map((q) => (
                      <button key={q} type="button" onClick={() => { setQuality(q); setSettingsPage(null) }} className={`flex w-full items-center justify-between px-4 py-2 text-left hover:bg-white/10 ${quality === q ? 'text-white' : 'text-white/80'}`}>
                        <span>{q === 'auto' ? 'Auto' : `${q}p`}</span>
                        {quality === q && <span className="text-yt-red">●</span>}
                      </button>
                    ))}
                  </>
                )}
                {settingsPage === 'speed' && (
                  <>
                    <button type="button" onClick={() => setSettingsPage('root')} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-white/10">‹ Playback speed</button>
                    {SPEEDS.map((s) => (
                      <button key={s} type="button" onClick={() => setPlaybackRate(s)} className={`flex w-full items-center justify-between px-4 py-2 text-left hover:bg-white/10 ${speed === s ? 'text-white' : 'text-white/80'}`}>
                        <span>{s === 1 ? 'Normal' : s}</span>
                        {speed === s && <span className="text-yt-red">●</span>}
                      </button>
                    ))}
                  </>
                )}
                {settingsPage === 'captions' && (
                  <>
                    <button type="button" onClick={() => { onCaptionLang?.(''); setSettingsPage(null) }} className={`flex w-full items-center justify-between px-4 py-2 text-left hover:bg-white/10 ${captionsOn ? 'text-white/80' : 'text-white'}`}>
                      <span>Off</span>
                      {!captionsOn && <span className="text-yt-red">●</span>}
                    </button>
                    {captions.length === 0 && (
                      <p className="px-4 py-3 text-white/80">No captions for this video</p>
                    )}
                    {captions.map((track) => {
                      const key = captionTrackKey(track)
                      const selected = key === captionLang
                      return (
                        <button key={key} type="button" onClick={() => { onCaptionLang?.(key); setSettingsPage(null) }} className={`flex w-full items-center justify-between px-4 py-2 text-left hover:bg-white/10 ${selected ? 'text-white' : 'text-white/80'}`}>
                          <span className="truncate pr-3">{track.name || track.languageCode}</span>
                          {selected && <span className="text-yt-red">●</span>}
                        </button>
                      )
                    })}
                    {captionLoading && <p className="px-4 py-2 text-white/60">Loading captions…</p>}
                    {captionError && <p className="px-4 py-2 text-white/70">{captionError}</p>}
                  </>
                )}
              </div>
            )}

            <div
              data-no-toggle
              className="group/seek relative flex h-4 cursor-pointer items-end"
              onClick={(e) => { onSeek(e); setSeeking(false) }}
              onMouseMove={(e) => {
                if (e.buttons === 1) onSeek(e)
                const rect = e.currentTarget.getBoundingClientRect()
                const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
                const total = fullDuration(knownRef.current, videoRef.current ? videoRef.current.duration : duration)
                setHoverTime({ x: e.clientX - rect.left, label: fmt(frac * (total || 0)) })
              }}
              onMouseLeave={() => { setHoverTime(null); setSeeking(false) }}
            >
              {hoverTime && (
                <div className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[12px] text-white" style={{ left: hoverTime.x }}>
                  {hoverTime.label}
                </div>
              )}
              <div className="relative h-[3px] w-full bg-white/30 transition-[height] group-hover/seek:h-[5px]">
                <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: `${bufferedPct}%` }} />
                <div className="absolute inset-y-0 left-0 bg-yt-red" style={{ width: `${playedPct}%` }} />
                <div className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-yt-red" style={{ left: `calc(${playedPct}% - 6px)` }} />
              </div>
            </div>

            <div data-no-toggle className="flex h-11 items-center px-1.5">
              <button type="button" className={iconBtn} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                {playing
                  ? <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                  : <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
              </button>
              <div className="group/vol flex items-center">
                <button type="button" className={iconBtn} aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'} onClick={() => {
                  if (directRef.current && audioRef.current) {
                    const audio = audioRef.current
                    audio.muted = !audio.muted
                    setMuted(audio.muted)
                    return
                  }
                  const v = videoRef.current
                  if (v) v.muted = !v.muted
                }}>
                  {muted || volume === 0
                    ? <svg className="h-[22px] w-[22px]" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12a4.5 4.5 0 00-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 003.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                    : volume < 0.5
                      ? <svg className="h-[22px] w-[22px]" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12z" /></svg>
                      : <svg className="h-[22px] w-[22px]" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06c5.12-.51 9-4.8 9-9.77s-3.88-9.26-9-9.77z" /></svg>}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={muted ? 0 : volume}
                  aria-label="Volume"
                  className="yt-vol"
                  onChange={(e) => {
                    const next = parseFloat(e.target.value)
                    if (directRef.current && audioRef.current) {
                      audioRef.current.volume = next
                      audioRef.current.muted = next === 0
                      setVolume(next)
                      setMuted(next === 0)
                      return
                    }
                    const video = videoRef.current
                    if (!video) return
                    video.volume = next
                    video.muted = next === 0
                    setVolume(next)
                    setMuted(next === 0)
                  }}
                />
              </div>
              <span className="ml-1 select-none text-[13px] font-medium tabular-nums text-white">
                {fmt(currentTime)}
                <span className="text-white/70"> / {fmt(totalDuration)}</span>
              </span>
              <div className="flex-1" />
              <button type="button" className={`${iconBtn} ${captionsOn ? 'bg-white/15' : ''}`} title="Captions" aria-label="Captions" aria-pressed={captionsOn} onClick={() => setSettingsPage(settingsPage === 'captions' ? null : 'captions')}>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7.5H9.5v-.75h-2v3.5h2V13H11v1.25A1.25 1.25 0 019.75 15.5h-3.5A1.25 1.25 0 015 14.25v-4.5A1.25 1.25 0 016.25 8.5h3.5A1.25 1.25 0 0111 9.75V11zm7 0h-1.5v-.75h-2v3.5h2V13H18v1.25a1.25 1.25 0 01-1.25 1.25h-3.5A1.25 1.25 0 0112 14.25v-4.5A1.25 1.25 0 0113.25 8.5h3.5A1.25 1.25 0 0118 9.75V11z" /></svg>
              </button>
              <button type="button" className={iconBtn} title="Settings" aria-label="Settings" onClick={() => setSettingsPage(settingsPage && settingsPage !== 'captions' ? null : 'root')}>
                <svg className="h-[22px] w-[22px]" fill="currentColor" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 00.12-.61l-1.92-3.32a.5.5 0 00-.59-.22l-2.39.96a7.2 7.2 0 00-1.63-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 00-.59.22L2.74 8.87a.5.5 0 00.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 00-.12.61l1.92 3.32c.13.22.39.31.61.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.09.48 0 .61-.22l1.92-3.32a.5.5 0 00-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z" /></svg>
              </button>
              <button type="button" className={iconBtn} title="Mini player" aria-label="Mini player" onClick={togglePip}>
                <svg className="h-[22px] w-[22px]" fill="currentColor" viewBox="0 0 24 24"><path d="M19 7H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2zm0 10H5V9h14v8z" /><path d="M13 12h5v4h-5z" /></svg>
              </button>
              <button type="button" className={iconBtn} title={theater ? 'Default view' : 'Theater mode'} aria-label={theater ? 'Default view' : 'Theater mode'} onClick={() => onToggleTheater?.()}>
                {theater
                  ? <svg className="h-[22px] w-[22px]" fill="currentColor" viewBox="0 0 24 24"><path d="M19 5H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2zm-4 12H5V7h10v10zm4 0h-2V7h2v10z" /></svg>
                  : <svg className="h-[22px] w-[22px]" fill="currentColor" viewBox="0 0 24 24"><path d="M19 6H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2zm0 10H5V8h14v8z" /></svg>}
              </button>
              <button type="button" className={iconBtn} title="Fullscreen" aria-label="Fullscreen" onClick={toggleFullscreen}>
                {isFullscreen
                  ? <svg className="h-[22px] w-[22px]" fill="currentColor" viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
                  : <svg className="h-[22px] w-[22px]" fill="currentColor" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>}
              </button>
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

function DescriptionBox({ text }) {
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const clampRef = useRef(null)
  const fullRef = useRef(null)

  useEffect(() => { setOpen(false) }, [text])

  useLayoutEffect(() => {
    const full = fullRef.current
    if (!full) return
    const line = parseFloat(getComputedStyle(full).lineHeight) || 22
    setOverflows(full.scrollHeight > line * 2 + 2)
  }, [text])

  return (
    <div className="mt-4 rounded-2xl border border-black/[0.06] dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] px-4 py-3">
      <div className="relative">
        <p
          ref={clampRef}
          className={`text-sm leading-relaxed text-gray-600 dark:text-gray-300 ${open ? 'whitespace-pre-line' : 'line-clamp-2'}`}
        >
          {text}
        </p>
        <p
          ref={fullRef}
          aria-hidden
          className="pointer-events-none invisible absolute inset-x-0 top-0 text-sm leading-relaxed whitespace-pre-line"
        >
          {text}
        </p>
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-2 text-sm font-medium text-gray-900 dark:text-white"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function DownloadProgress({ items, onCancel }) {
  if (!items.length) return null
  return (
    <div className="space-y-2 rounded-xl border border-yt-red/20 bg-yt-red/5 px-3 py-3">
      <p className="text-sm font-medium flex items-center gap-2">
        <svg className="w-4 h-4 animate-spin text-yt-red" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Downloading
      </p>
      {items.map((dl) => (
        <div key={dl.id} className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{dl.quality}</span>
            <span>{Math.round(dl.progress || 0)}%</span>
          </div>
          <div className="h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-yt-red" style={{ width: `${Math.min(100, dl.progress || 0)}%` }} />
          </div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{dl.eta}</span>
            <button type="button" onClick={() => onCancel(dl.id)} className="text-red-500 hover:text-red-400">
              Cancel
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function RecommendedRow({ video }) {
  return (
    <Link
      to={`/video/${video.id}`}
      onPointerDown={() => prewarmNow(video.id)}
      onMouseEnter={() => prewarmOnHover(video.id)}
      className="flex gap-3 rounded-xl p-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
    >
      <div className="relative w-[148px] shrink-0 aspect-video overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-900">
        {video.thumbnail ? (
          <img src={video.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="h-full w-full" />
        )}
        {video.duration && (
          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[11px] text-white">{video.duration}</span>
        )}
      </div>
      <div className="min-w-0 py-0.5">
        <p className="text-sm font-medium leading-snug line-clamp-2">{video.title}</p>
        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{video.channel}</p>
        <p className="truncate text-xs text-gray-500 dark:text-gray-500">
          {[video.views, video.publishedTime].filter(Boolean).join(' · ')}
        </p>
      </div>
    </Link>
  )
}

export default function VideoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { startDownload, activeDownloads, completedDownloads, playFile, cancelDownload } = useDownloads()
  const { settings, updateSetting } = useSettings()
  const { recordWatch } = useSubscriptions()
  const { isInWatchLater, toggleWatchLater } = useWatchLater()
  const { addToast } = useToast()
  const [theater, setTheater] = useState(false)
  const [videoInfo, setVideoInfo] = useState(null)
  const [formats, setFormats] = useState([])
  const [loadingInfo, setLoadingInfo] = useState(true)
  const [loadingFormats, setLoadingFormats] = useState(true)
  const [infoError, setInfoError] = useState(null)
  const [formatError, setFormatError] = useState(null)
  const [playingLocal, setPlayingLocal] = useState(null)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [videosDir, setVideosDir] = useState('')
  useEffect(() => {
    window.electronAPI?.getDownloadPaths?.().then((paths) => {
      if (paths?.videos) setVideosDir(paths.videos)
    }).catch(() => {})
  }, [])
  const [related, setRelated] = useState([])
  const [loadingRelated, setLoadingRelated] = useState(false)
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
      setDownloadOpen(false)
      setRelated([])

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

  useEffect(() => {
    const query = (videoInfo?.title || videoInfo?.channel || '').trim()
    if (!query || !window.electronAPI?.ytSearch) return
    let cancelled = false
    setLoadingRelated(true)
    window.electronAPI.ytSearch(query)
      .then((result) => {
        if (cancelled) return
        const videos = (result?.videos || []).filter((video) => video.id && video.id !== id).slice(0, 12)
        setRelated(videos)
      })
      .catch(() => { if (!cancelled) setRelated([]) })
      .finally(() => { if (!cancelled) setLoadingRelated(false) })
    return () => { cancelled = true }
  }, [videoInfo, id])

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

  const videoFormats = formats.filter((format) => format.type !== 'audio')
  const audioFormats = formats.filter((format) => format.type === 'audio')

  return (
    <div className={`watch-layout ${theater ? 'is-theater' : 'max-w-7xl mx-auto'}`}>
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 min-w-0">
          <div>
              <div className={theater && !playingLocal && settings.playbackMode === 'inApp'
                ? 'watch-player is-theater'
                : 'watch-player relative aspect-video bg-black rounded-xl overflow-hidden shadow-xl ring-1 ring-white/10'}>
                {playingLocal ? (
                  <LocalPlayer url={playingLocal} title={videoInfo?.title || 'Local preview'} onClose={closeLocalPlayer} />
                ) : settings.playbackMode === 'inApp' ? (
                  <NativePlayer
                    id={id}
                    autoPlay={settings.autoplay}
                    knownDuration={clockToSeconds(videoInfo?.duration)}
                    title={videoInfo?.title || ''}
                    theater={theater}
                    onToggleTheater={() => setTheater((on) => !on)}
                    captions={videoInfo?.captions || EMPTY_CAPTIONS}
                    captionLang={settings.captionLang || ''}
                    onCaptionLang={(value) => updateSetting('captionLang', value)}
                  />
                ) : loadingInfo ? (
                  <SkeletonPlayer />
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

              <h1 className="text-xl md:text-2xl font-semibold leading-snug tracking-tight mt-4">{videoInfo?.title || 'Video'}</h1>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {videoInfo?.channel && (
                    <button
                      onClick={() => navigate(`/channel/${encodeURIComponent(videoInfo.channel)}`)}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/[0.06] text-sm text-gray-700 dark:bg-white/10 dark:text-gray-200"
                      title={`View ${videoInfo.channel}`}
                      aria-label={`View ${videoInfo.channel}`}
                    >
                      {videoInfo.channel.charAt(0).toUpperCase()}
                    </button>
                  )}
                  <div className="min-w-0">
                    {videoInfo?.channel && (
                      <button
                        onClick={() => navigate(`/channel/${encodeURIComponent(videoInfo.channel)}`)}
                        className="block truncate text-sm font-medium hover:text-yt-red"
                      >
                        {videoInfo.channel}
                      </button>
                    )}
                    {videoInfo && (
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {[
                          videoInfo.views
                            ? (/views?$/i.test(String(videoInfo.views)) ? videoInfo.views : `${videoInfo.views} views`)
                            : '',
                          videoInfo.duration,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {videoInfo && (
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
                      className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                        isInWatchLater(id)
                          ? 'border-current text-gray-900 dark:text-white'
                          : 'border-black/10 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {isInWatchLater(id) ? 'In Watch later' : 'Watch later'}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-expanded={downloadOpen}
                    onClick={() => setDownloadOpen((open) => !open)}
                    className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white ${
                      downloadOpen ? 'bg-yt-red-hover' : 'bg-yt-red hover:bg-yt-red-hover'
                    }`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    {activeForVideo.length ? 'Downloading' : 'Download'}
                  </button>
                  {videoInfo?.channel && (
                    <VideoMenu video={{ id, title: videoInfo?.title || '', thumbnail: videoInfo?.thumbnail || '', channel: videoInfo.channel, duration: videoInfo.duration || '' }} />
                  )}
                </div>
              </div>

              {settings.showDescriptions && videoInfo?.description && (
                <DescriptionBox text={videoInfo.description} />
              )}

              {downloadOpen && (
                <div className="mt-3 rounded-2xl border border-black/[0.06] dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-3 space-y-3">
                  <DownloadProgress items={activeForVideo} onCancel={cancelDownload} />
                  {loadingFormats ? (
                    <SkeletonFormats />
                  ) : formatError && formats.length === 0 ? (
                    <div className="rounded-xl bg-black/[0.03] dark:bg-black/20 px-4 py-5 text-center">
                      <p className="text-sm text-gray-500">Could not load format info</p>
                      <p className="mt-1 text-xs text-gray-400">{formatError}</p>
                      <a
                        href={`https://app.ytdown.to/en38/?url=https://www.youtube.com/watch?v=${id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-block rounded-full bg-yt-red px-4 py-2 text-sm font-medium text-white hover:bg-yt-red-hover"
                      >
                        Try on YTDown
                      </a>
                    </div>
                  ) : formats.length === 0 ? (
                    <p className="px-1 py-3 text-sm text-gray-500">No download formats for this video.</p>
                  ) : (
                    <>
                      {videoFormats.length > 0 && (
                        <div className="space-y-2">
                          <p className="px-1 text-xs font-medium text-gray-500 dark:text-gray-400">Video</p>
                          {videoFormats.map((format, i) => (
                            <FormatButton key={`v-${i}`} format={format} onDownload={handleDownload} isDownloading={isDownloading(format)} />
                          ))}
                        </div>
                      )}
                      {audioFormats.length > 0 && (
                        <div className="space-y-2">
                          <p className="px-1 text-xs font-medium text-gray-500 dark:text-gray-400">Audio</p>
                          {audioFormats.map((format, i) => (
                            <FormatButton key={`a-${i}`} format={format} onDownload={handleDownload} isDownloading={isDownloading(format)} />
                          ))}
                        </div>
                      )}
                      <p className="text-center text-xs text-gray-400 dark:text-gray-500">
                        {videosDir ? `Videos save to ${videosDir}` : 'Videos save to the downloads folder'}
                      </p>
                    </>
                  )}
                </div>
              )}

              {!downloadOpen && activeForVideo.length > 0 && (
                <div className="mt-3">
                  <DownloadProgress items={activeForVideo} onCancel={cancelDownload} />
                </div>
              )}
              <Comments videoId={id} />
            </div>
        </div>

        <div className="lg:w-[22.5rem] shrink-0">
          <div className="lg:sticky lg:top-4">
            <h2 className="mb-2 px-1.5 text-sm font-medium">Recommended</h2>
            {loadingRelated ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="flex gap-3 p-1.5">
                    <div className="aspect-video w-[148px] shrink-0 rounded-lg skeleton" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3.5 skeleton rounded w-full" />
                      <div className="h-3.5 skeleton rounded w-2/3" />
                      <div className="h-3 skeleton rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : related.length === 0 ? (
              <p className="px-1.5 text-sm text-gray-500 dark:text-gray-400">No recommendations for this video yet.</p>
            ) : (
              <div className="space-y-1">
                {related.map((video) => (
                  <RecommendedRow key={video.id} video={video} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
