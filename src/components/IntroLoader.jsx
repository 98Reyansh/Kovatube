import { useEffect, useRef } from 'react'

// Full-screen intro loader rendered only on the initial app launch while the
// For You feed loads. Every frame is driven by requestAnimationFrame so the
// animation runs at the display's native refresh rate (up to 120Hz on a 120Hz
// panel) rather than a fixed low step size — this keeps it perfectly smooth.
export default function IntroLoader() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const DPR = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    let raf = 0
    const start = performance.now()
    const DURATION = 2.5 // seconds - slightly longer for a more premium feel

    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.floor(w * DPR)
      canvas.height = Math.floor(h * DPR)
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // Rising ambient particles.
    const PARTICLE_COUNT = 120
    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.8 + Math.random() * 2.5,
      speed: 0.01 + Math.random() * 0.025,
      drift: (Math.random() - 0.5) * 0.0012,
      alpha: 0.04 + Math.random() * 0.15,
      red: Math.random() < 0.45,
      hue: Math.random() * 15 - 7.5, // slight color variation
    }))

    // Background floating orbs for depth
    const orbs = Array.from({ length: 6 }, () => ({
      x: 0.1 + Math.random() * 0.8,
      y: 0.15 + Math.random() * 0.7,
      r: 60 + Math.random() * 120,
      speed: 0.003 + Math.random() * 0.006,
      alpha: 0.02 + Math.random() * 0.05,
      hue: 350 + (Math.random() - 0.5) * 20, // red-ish hues
    }))

    const easeOutBack = (x) => {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
    }
    const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
    const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3)
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

    const roundRect = (x, y, wd, ht, r) => {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + wd, y, x + wd, y + ht, r)
      ctx.arcTo(x + wd, y + ht, x, y + ht, r)
      ctx.arcTo(x, y + ht, x, y, r)
      ctx.arcTo(x, y, x + wd, y, r)
      ctx.closePath()
    }

    const isDark = () => document.documentElement.classList.contains('dark')

    const drawBackground = (t) => {
      // Theme-aware vertical gradient with subtle animated shift
      const shift = Math.sin(t * 0.3) * 0.02
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      if (isDark()) {
        grad.addColorStop(0, '#0a0a0a')
        grad.addColorStop(0.5 + shift, '#111111')
        grad.addColorStop(1, '#181818')
      } else {
        grad.addColorStop(0, '#ffffff')
        grad.addColorStop(0.5 + shift, '#f7f7f7')
        grad.addColorStop(1, '#ededed')
      }
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }

    const drawOrbs = (t) => {
      for (const o of orbs) {
        const oy = (o.y + Math.sin(t * o.speed + o.x * 10) * 0.02) * h
        const ox = o.x * w
        const grd = ctx.createRadialGradient(ox, oy, 0, ox, oy, o.r)
        grd.addColorStop(0, `hsla(${o.hue}, 85%, 55%, ${o.alpha})`)
        grd.addColorStop(1, `hsla(${o.hue}, 85%, 55%, 0)`)
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(ox, oy, o.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const drawParticles = (t) => {
      for (const p of particles) {
        const x = (p.x + t * p.drift) % 1
        const y = (p.y - t * p.speed * 0.3) % 1
        const yy = y < 0 ? y + 1 : y
        ctx.beginPath()
        ctx.arc(x * w, yy * h, p.r, 0, Math.PI * 2)
        if (p.red) {
          ctx.fillStyle = `rgba(255, 59, 59, ${p.alpha})`
        } else {
          const hue = 220 + p.hue
          ctx.fillStyle = isDark()
            ? `hsla(${hue}, 60%, 85%, ${p.alpha * 0.8})`
            : `hsla(${hue}, 40%, 25%, ${p.alpha * 0.6})`
        }
        ctx.fill()
      }
    }

    const drawLogo = (t, cx, cy, size) => {
      // Scale-in with elastic overshoot, then subtle pulse
      const intro = easeOutBack(clamp01(t / 0.9))
      const pulse = 1 + Math.sin(t * 2.5) * 0.012
      const scale = intro * pulse
      const s = size * scale
      const logoW = s * 1.55
      const logoH = s
      const x = cx - logoW / 2
      const y = cy - logoH / 2
      const rot = (s / Math.abs(logoW)) * 6
      const rad = rot * (Math.PI / 180)

      // Outer soft glow that breathes (guard radii: t can start slightly
      // negative on the first rAF, which would make glowR < 0)
      const glowR = Math.max(2, s * 1.8 + Math.sin(t * 1.5) * 15)
      const glowR0 = Math.min(Math.max(0, s * 0.3), glowR * 0.5)
      const glowH = ctx.createRadialGradient(cx, cy, glowR0, cx, cy, glowR)
      glowH.addColorStop(0, `rgba(255, 30, 30, ${0.22 + Math.sin(t * 1.5) * 0.06})`)
      glowH.addColorStop(0.5, `rgba(255, 80, 80, ${0.08 + Math.sin(t * 1.5) * 0.03})`)
      glowH.addColorStop(1, 'rgba(255, 30, 30, 0)')
      ctx.fillStyle = glowH
      ctx.beginPath()
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
      ctx.fill()

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rad)
      ctx.translate(-cx, -cy)

      // Red rounded rectangle with subtle gradient
      roundRect(x, y, logoW, logoH, logoH * 0.28)
      const logoGrad = ctx.createLinearGradient(x, y, x + logoW, y + logoH)
      logoGrad.addColorStop(0, '#ff1a1a')
      logoGrad.addColorStop(0.5, '#ff0000')
      logoGrad.addColorStop(1, '#cc0000')
      ctx.fillStyle = logoGrad
      ctx.fill()

      // Subtle inner highlight
      ctx.beginPath()
      roundRect(x + 2, y + 2, logoW - 4, logoH - 4, logoH * 0.26)
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.lineWidth = 1
      ctx.stroke()

      // White play triangle
      const tw = logoW * 0.34
      const th = logoH * 0.5
      const tx = cx + logoW * 0.04
      const ty = cy
      ctx.beginPath()
      ctx.moveTo(tx - tw * 0.35, ty - th / 2)
      ctx.lineTo(tx - tw * 0.35, ty + th / 2)
      ctx.lineTo(tx + tw * 0.6, ty)
      ctx.closePath()
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.25)'
      ctx.shadowBlur = 4
      ctx.shadowOffsetY = 1
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0

      void glowR
      ctx.restore()
    }

    const drawProgress = (t, cx, cy, radius) => {
      const period = 2.0
      const progress = easeInOut(clamp01((t % period) / period))
      const a0 = -Math.PI / 2
      const sweep = progress * Math.PI * 2 * 0.9

      ctx.lineWidth = 3.5
      ctx.lineCap = 'round'

      // Track
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
      ctx.stroke()

      // Sweeping arc with gradient tail
      const segs = 50
      for (let i = 0; i < segs; i++) {
        const f0 = (i / segs) * sweep
        const f1 = ((i + 1) / segs) * sweep
        const alpha = 0.2 + (i / segs) * 0.8
        const hue = 358 - (i / segs) * 15 // red to slightly orange
        ctx.beginPath()
        ctx.arc(cx, cy, radius, a0 + f0, a0 + f1)
        ctx.strokeStyle = `hsla(${hue}, 90%, 55%, ${alpha})`
        ctx.stroke()
      }

      // Small leading dot
      const leadAngle = a0 + sweep
      const lx = cx + Math.cos(leadAngle) * radius
      const ly = cy + Math.sin(leadAngle) * radius
      ctx.beginPath()
      ctx.arc(lx, ly, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = '#ff1a1a'
      ctx.shadowColor = '#ff1a1a'
      ctx.shadowBlur = 12
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }

    const drawCaption = (t) => {
      const appear = clamp01((t - 0.6) / 0.5)
      const breather = 1 + Math.sin(t * 2.8) * 0.035
      ctx.save()
      ctx.globalAlpha = appear
      ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)'
      ctx.font = '13px Roboto, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Loading your feed…', w / 2, h / 2 + 100 * breather)
      ctx.restore()
    }

    const drawBrand = (t) => {
      const appear = clamp01((t - 1.2) / 0.6)
      if (appear <= 0) return
      ctx.save()
      ctx.globalAlpha = appear * 0.6
      ctx.fillStyle = isDark() ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)'
      ctx.font = '11px Roboto, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.letterSpacing = '0.15em'
      ctx.fillText('YOUTUBE DESKTOP', w / 2, h - 48)
      ctx.restore()
    }

    let last = start
    const frame = (now) => {
      const dt = (now - last) / 1000
      last = now
      const t = Math.max(0, (now - start) / 1000)
      ctx.clearRect(0, 0, w, h)

      drawBackground(t)
      drawOrbs(t)
      drawParticles(t)

      const cx = w / 2
      const cy = h / 2 - 12
      const baseSize = Math.min(w, h) * 0.11
      drawLogo(t, cx, cy, baseSize)
      drawProgress(t, cx, cy, baseSize * 1.45)
      drawCaption(t)
      drawBrand(t)
      void dt

      // Auto-dismiss after animation completes
      if (t > DURATION) {
        // The parent component will unmount this when ready
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-white dark:bg-[#0a0a0a]">
      <canvas ref={canvasRef} className="w-full h-full" aria-label="Loading your feed" />
    </div>
  )
}