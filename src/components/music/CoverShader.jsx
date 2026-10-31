import { useEffect, useRef } from 'react'

// One graph for the life of the player. Connecting a media element twice
// throws, and disconnecting it silences playback.
let audioTap = null

function tapAudio(audio) {
  if (!audio) return null
  if (audioTap && audioTap.audio === audio) return audioTap.failed ? null : audioTap
  if (audioTap) return null
  try {
    // captureStream leaves the song on the normal output. Routing the element
    // itself through an AudioContext silences it whenever that context sleeps.
    if (typeof audio.captureStream !== 'function') throw new Error('no captureStream')
    const stream = audio.captureStream()
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)
    const resume = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}) }
    audio.addEventListener('play', resume)
    ctx.addEventListener('statechange', resume)
    audioTap = { audio, ctx, analyser, bins: new Uint8Array(analyser.frequencyBinCount) }
    resume()
    return audioTap
  } catch {
    audioTap = { audio, failed: true }
    return null
  }
}

export default function CoverShader({ url, audio, playing }) {
  const canvasRef = useRef(null)
  const playingRef = useRef(playing)
  playingRef.current = playing

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !url) return undefined
    let dead = false
    let kawarp = null
    let raf = 0

    const fit = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(rect.width * dpr))
      const h = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width === w && canvas.height === h) return
      canvas.width = w
      canvas.height = h
      if (kawarp) kawarp.resize()
    }

    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (!kawarp || dead) return
      const tap = audio ? tapAudio(audio) : null
      if (tap && tap.ctx.state === 'suspended' && playingRef.current) tap.ctx.resume().catch(() => {})
      let energy = 0
      if (tap && playingRef.current) {
        tap.analyser.getByteFrequencyData(tap.bins)
        let sum = 0
        const n = Math.min(10, tap.bins.length)
        for (let i = 0; i < n; i++) sum += tap.bins[i]
        energy = sum / n / 255
      }
      const scale = playingRef.current ? 1.04 + Math.max(0, energy - 0.28) * 0.22 : 1
      const speed = playingRef.current ? 0.85 + energy * 0.9 : 0.28
      kawarp.scale += (scale - kawarp.scale) * 0.12
      kawarp.animationSpeed += (speed - kawarp.animationSpeed) * 0.08
    }

    ;(async () => {
      try {
        const { Kawarp } = await import('@kawarp/core')
        if (dead) return
        kawarp = new Kawarp(canvas, {
          warpIntensity: 1,
          blurPasses: 8,
          animationSpeed: 1,
          saturation: 1.5,
          dithering: 0.008,
          transitionDuration: 900,
          scale: 1.05,
        })
        const dataUrl = await window.electronAPI?.coverImage?.(url)
        if (dead) return
        if (dataUrl) await kawarp.loadImage(dataUrl)
        else kawarp.loadGradient(['#3a2a4a', '#1c1a24', '#2a2038'], 160)
        if (dead) return
        fit()
        kawarp.start()
        raf = requestAnimationFrame(tick)
      } catch { /* the still cover behind this canvas stays visible */ }
    })()

    const onResize = () => fit()
    const parent = canvas.parentElement
    const ro = parent ? new ResizeObserver(onResize) : null
    if (parent && ro) ro.observe(parent)
    const onVis = () => {
      if (!kawarp || dead) return
      if (document.hidden) kawarp.stop()
      else kawarp.start()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      if (ro) ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      if (kawarp) kawarp.dispose()
    }
  }, [url, audio])

  return <canvas ref={canvasRef} className="cover-shader" aria-hidden="true" />
}
