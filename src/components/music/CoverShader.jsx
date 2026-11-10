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

// The cover is a 128px blur, and the warp across it is a very slow wave.
// Evaluating that wave on every screen pixel is the GPU cost. Half resolution
// is still several times finer than the artwork, and the finish (grain,
// vignette, color, 60fps) stays at the full screen size, so the picture matches.
function attachHalfResWarp(kawarp) {
  const resizeWarp = () => {
    const width = Math.max(1, kawarp.canvas.width)
    const height = Math.max(1, kawarp.canvas.height)
    const ww = Math.max(1, Math.round(width / 2))
    const hh = Math.max(1, Math.round(height / 2))
    if (kawarp.warpFBO && kawarp.warpFBO.width === ww && kawarp.warpFBO.height === hh) return
    if (kawarp.warpFBO) kawarp.deleteFramebuffer(kawarp.warpFBO)
    kawarp.warpFBO = kawarp.createFramebuffer(ww, hh, true)
  }

  kawarp.resize = resizeWarp

  kawarp.render = function render(time, timestamp = performance.now()) {
    if (this.disposed || !this.hasImage) return
    this.advanceVideoSmoothing(timestamp)
    const gl = this.gl
    const width = Math.max(1, this.canvas.width)
    const height = Math.max(1, this.canvas.height)
    resizeWarp()
    const ww = this.warpFBO.width
    const hh = this.warpFBO.height

    let blendFactor = 1.0
    if (this.isTransitioning) {
      const elapsed = Math.max(0, timestamp - this.transitionStartTime)
      blendFactor = this._transitionDuration > 0
        ? Math.min(1.0, elapsed / this._transitionDuration)
        : 1.0
      if (blendFactor >= 1.0) this.isTransitioning = false
    }

    let currentTexture
    if (this.isTransitioning && blendFactor < 1.0) {
      gl.useProgram(this.blendProgram)
      this.setupAttributes()
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO1.framebuffer)
      gl.viewport(0, 0, this.blurFBO1.width, this.blurFBO1.height)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.currentAlbumFBO.texture)
      gl.uniform1i(this.uniforms.blend.texture1, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.nextAlbumFBO.texture)
      gl.uniform1i(this.uniforms.blend.texture2, 1)
      const easedBlend = 0.5 - 0.5 * Math.cos(blendFactor * Math.PI)
      gl.uniform1f(this.uniforms.blend.blend, easedBlend)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      currentTexture = this.blurFBO1.texture
    } else {
      currentTexture = this.nextAlbumFBO.texture
    }

    gl.useProgram(this.warpProgram)
    this.setupAttributes()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.warpFBO.framebuffer)
    gl.viewport(0, 0, ww, hh)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, currentTexture)
    gl.uniform1i(this.uniforms.warp.texture, 0)
    gl.uniform1f(this.uniforms.warp.time, time)
    gl.uniform1f(this.uniforms.warp.intensity, this._warpIntensity)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    gl.useProgram(this.outputProgram)
    this.setupAttributes()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.bindTexture(gl.TEXTURE_2D, this.warpFBO.texture)
    gl.uniform1i(this.uniforms.output.texture, 0)
    gl.uniform1f(this.uniforms.output.saturation, this._saturation)
    gl.uniform1f(this.uniforms.output.dithering, this._dithering)
    gl.uniform1f(this.uniforms.output.time, time)
    gl.uniform1f(this.uniforms.output.scale, this._scale)
    gl.uniform2f(this.uniforms.output.resolution, width, height)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
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
        fit()
        kawarp = new Kawarp(canvas, {
          warpIntensity: 1,
          blurPasses: 8,
          animationSpeed: 1,
          saturation: 1.5,
          dithering: 0.008,
          transitionDuration: 900,
          scale: 1.05,
        })
        attachHalfResWarp(kawarp)
        const dataUrl = await window.electronAPI?.coverImage?.(url)
        if (dead) return
        let loaded = false
        if (dataUrl) {
          try { await kawarp.loadImage(dataUrl); loaded = true } catch { loaded = false }
        }
        if (!loaded) kawarp.loadGradient(['#3a2a4a', '#1c1a24', '#2a2038'], 160)
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
