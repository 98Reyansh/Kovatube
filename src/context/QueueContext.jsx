import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'

// Persistent music queue + single global <audio> element.
//
// One Audio instance lives here (at app root) so music keeps playing while the
// user browses — the provider never unmounts. Track audio is resolved through
// the main process (innertube fast path) and played straight from the direct
// googlevideo audio URL; the next track's URL is pre-resolved at ~50% so
// transitions are instant.
const QueueContext = createContext(null)
const STORAGE_KEY = 'yt_music_queue'

export function useQueue() {
  const ctx = useContext(QueueContext)
  if (!ctx) throw new Error('useQueue must be used within QueueProvider')
  return ctx
}

function readStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!parsed || !Array.isArray(parsed.tracks)) return null
    return parsed
  } catch {
    return null
  }
}

const trackId = (t) => t && (t.videoId || t.id)

// Index of the next track given the current shuffle/repeat settings.
function pickNext(state, auto) {
  const { tracks, index, shuffle, repeat } = state
  if (!tracks.length) return -1
  if (repeat === 'one' && auto) return index
  if (shuffle) {
    if (tracks.length === 1) return 0
    let n = index
    while (n === index) n = Math.floor(Math.random() * tracks.length)
    return n
  }
  const n = index + 1
  if (n >= tracks.length) return repeat === 'all' ? 0 : -1
  return n
}

export function QueueProvider({ children }) {
  const audioRef = useRef(null)
  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
    audioRef.current.preload = 'auto'
  }

  const stored = useRef(readStored()).current

  const [tracks, setTracks] = useState(stored?.tracks || [])
  const [index, setIndex] = useState(stored?.index ?? -1)
  const [source, setSource] = useState(stored?.source || null) // { title, browseId }
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(stored?.volume ?? 1)
  const [shuffle, setShuffle] = useState(stored?.shuffle ?? false)
  const [repeat, setRepeat] = useState(stored?.repeat || 'off') // off | all | one

  const stateRef = useRef({ tracks, index, shuffle, repeat })
  stateRef.current = { tracks, index, shuffle, repeat }

  const tokenRef = useRef(0)          // guards against out-of-order resolves
  const retriedRef = useRef(new Set()) // audio srcs already retried after an error
  const prefetchedRef = useRef(new Set())
  const playAtRef = useRef(() => {})
  const nextRef = useRef(() => {})
  const prevRef = useRef(() => {})

  const current = index >= 0 && index < tracks.length ? tracks[index] : null

  // Persist queue/position so a relaunch can offer to resume.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tracks, index, volume, shuffle, repeat, source }))
    } catch { /* quota */ }
  }, [tracks, index, volume, shuffle, repeat, source])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  // Resolve a track's audio URL and start playback. `list` is the queue the
  // track belongs to (so a fresh playthrough can be started in one call).
  const playAt = useCallback(async (i, list) => {
    const arr = list || stateRef.current.tracks
    const track = arr[i]
    const audio = audioRef.current
    if (!track || !audio) return
    const id = trackId(track)

    const token = ++tokenRef.current
    setIndex(i)
    setCurrentTime(0)
    setDuration(0)
    setError(null)
    setLoading(true)

    // Downloaded track: play the local file straight from disk (no network
    // resolve). Seeking works because the ytfile:// handler serves ranges.
    if (track.localUrl) {
      try {
        if (audio.src !== track.localUrl) audio.src = track.localUrl
        audio.currentTime = 0
        try { await audio.play() } catch { /* user gesture normally present */ }
        if (token !== tokenRef.current) return
        setPlaying(true)
        console.log(`[audio-timing] ${id} local file`)
      } catch (e) {
        if (token === tokenRef.current) {
          setLoading(false)
          setError(e?.message || 'Playback failed')
        }
      }
      return
    }

    if (!id || !window.electronAPI?.ytAudioStream) { setLoading(false); return }

    const t0 = performance.now()
    try {
      const res = await window.electronAPI.ytAudioStream(id)
      if (token !== tokenRef.current) return
      if (!res || !res.ok || !res.audioUrl) {
        setLoading(false)
        setError(res?.reason || 'Could not load audio')
        return
      }
      audio.src = res.audioUrl
      audio.currentTime = 0
      try { await audio.play() } catch { /* user gesture normally present */ }
      if (token !== tokenRef.current) return
      setPlaying(true)
      console.log(`[audio-timing] ${id} resolved+started in ${Math.round(performance.now() - t0)}ms (${res.source || '?'})`)
    } catch (e) {
      if (token === tokenRef.current) {
        setLoading(false)
        setError(e?.message || 'Playback failed')
      }
    }
  }, [])
  playAtRef.current = playAt

  const next = useCallback((auto = false) => {
    const state = stateRef.current
    const n = pickNext(state, auto)
    if (n < 0) { setPlaying(false); return }
    playAtRef.current(n, state.tracks)
  }, [])
  nextRef.current = next

  const prev = useCallback(() => {
    const audio = audioRef.current
    const state = stateRef.current
    // Restart the song if we're a few seconds in, like every other player.
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return }
    if (!state.tracks.length) return
    if (state.shuffle) {
      let n = state.index
      if (state.tracks.length > 1) { while (n === state.index) n = Math.floor(Math.random() * state.tracks.length) }
      else n = 0
      playAtRef.current(n, state.tracks)
      return
    }
    const p = state.index - 1
    playAtRef.current(p < 0 ? state.tracks.length - 1 : p, state.tracks)
  }, [])
  prevRef.current = prev

  const startQueue = useCallback((list, startIndex = 0, sourceMeta = null) => {
    const clean = (list || []).filter(t => trackId(t))
    if (!clean.length) return
    const idx = Math.max(0, Math.min(startIndex, clean.length - 1))
    retriedRef.current.clear()
    prefetchedRef.current.clear()
    setTracks(clean)
    if (sourceMeta !== null) setSource(sourceMeta)
    playAtRef.current(idx, clean)
  }, [])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.src) { playAtRef.current(stateRef.current.index, stateRef.current.tracks); return }
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [])

  const seek = useCallback((t) => {
    const audio = audioRef.current
    if (!audio || !isFinite(t)) return
    audio.currentTime = t
    setCurrentTime(t)
  }, [])

  const setVolume = useCallback((v) => {
    setVolumeState(Math.max(0, Math.min(1, v)))
  }, [])

  // Live audio clock for frame-accurate consumers (karaoke lyrics). The
  // `timeupdate` event above only fires ~4×/second, which is too coarse to keep
  // word-level highlighting in step with the voice, so those views read this
  // directly on every animation frame instead of relying on `currentTime`.
  const getAudioTime = useCallback(() => {
    const audio = audioRef.current
    return audio ? audio.currentTime || 0 : 0
  }, [])

  const getAudioElement = useCallback(() => audioRef.current, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
    tokenRef.current++
    setPlaying(false)
    setLoading(false)
  }, [])

  const clear = useCallback(() => {
    stop()
    setTracks([])
    setIndex(-1)
    setSource(null)
  }, [stop])

  const playNextOf = useCallback((track, list) => {
    // Insert a track right after the current one (VideoMenu "Play next").
    const arr = list || stateRef.current.tracks
    const state = stateRef.current
    if (!arr.length) { startQueue([track], 0); return }
    const nextArr = arr.slice(0, state.index + 1).concat([track], arr.slice(state.index + 1))
    setTracks(nextArr)
  }, [startQueue])

  const appendToQueue = useCallback((track) => {
    if (!trackId(track)) return
    setTracks(prev => {
      if (prev.some(t => trackId(t) === trackId(track))) return prev
      return [...prev, track]
    })
  }, [])

  // ── Audio element event wiring ───────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => {
      setCurrentTime(audio.currentTime || 0)
      const dur = audio.duration || 0
      if (dur && audio.currentTime / dur > 0.5) {
        const state = stateRef.current
        const n = pickNext(state, true)
        const nt = n >= 0 ? state.tracks[n] : null
        const nid = trackId(nt)
        if (nid && !nt?.localUrl && !prefetchedRef.current.has(nid)) {
          prefetchedRef.current.add(nid)
          window.electronAPI?.ytAudioPrewarm?.(nid).catch(() => {})
        }
      }
    }
    const onDur = () => setDuration(audio.duration || 0)
    const onPlaying = () => {
      setPlaying(true)
      setLoading(false)
      setError(null)
      // Tell the video player to stand down.
      window.dispatchEvent(new Event('yt-music-play'))
    }
    const onPause = () => setPlaying(false)
    const onWaiting = () => setLoading(true)
    const onCanPlay = () => setLoading(false)
    const onEnded = () => nextRef.current(true)
    const onError = () => {
      setLoading(false)
      const state = stateRef.current
      const track = state.tracks[state.index]
      const src = audio.src
      // A googlevideo URL can expire mid-playback; re-resolve once, then skip.
      if (track && src && !retriedRef.current.has(src)) {
        retriedRef.current.add(src)
        playAtRef.current(state.index, state.tracks)
      } else {
        setError('Playback error')
        setTimeout(() => nextRef.current(true), 400)
      }
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('durationchange', onDur)
    audio.addEventListener('loadedmetadata', onDur)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('durationchange', onDur)
      audio.removeEventListener('loadedmetadata', onDur)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [])

  // Pause music when a video starts; pause video-facing state is handled in
  // VideoDetail, which listens for 'yt-music-play'.
  useEffect(() => {
    const onVideoPlay = () => { audioRef.current?.pause() }
    window.addEventListener('yt-video-play', onVideoPlay)
    return () => window.removeEventListener('yt-video-play', onVideoPlay)
  }, [])

  // ── OS media controls (play/pause keys, lockscreen) ─────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    try {
      ms.setActionHandler('play', () => audioRef.current?.play().catch(() => {}))
      ms.setActionHandler('pause', () => audioRef.current?.pause())
      ms.setActionHandler('previoustrack', () => prevRef.current())
      ms.setActionHandler('nexttrack', () => nextRef.current(false))
    } catch { /* unsupported */ }
    return () => {
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
      } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!current) { navigator.mediaSession.metadata = null; return }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title || '',
        artist: current.artist || '',
        album: current.album || source?.title || '',
        artwork: current.thumbnail ? [{ src: current.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
      })
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    } catch { /* ignore */ }
  }, [current, playing, source])

  const value = {
    tracks, index, current, source,
    playing, loading, error,
    currentTime, duration, volume, shuffle, repeat,
    startQueue, playAt, playNextOf, appendToQueue,
    toggle, next, prev, seek, setVolume, stop, clear,
    setShuffle, setRepeat, getAudioTime, getAudioElement,
    isCurrent: (id) => trackId(current) === id,
  }

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>
}
