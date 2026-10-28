import { useEffect, useRef } from 'react'
import '@braccato/core/element'
import '@braccato/core/styles/variables.css'
import '@braccato/core/styles/lyrics.css'
import '@braccato/core/styles/instrumental.css'

function lyricTheme(still) {
  return `
:root {
  --blyrics-font-size: clamp(1.45rem, 3.4vw, 2.65rem);
  --blyrics-font-weight: 700;
  --blyrics-line-height: 1.28;
  --blyrics-text-color: #ffffff;
  --blyrics-lyric-active-color: #ffffff;
  --blyrics-lyric-inactive-color: rgb(255 255 255 / 0.34);
  --blyrics-inactive-opacity: 0.34;
  --blyrics-padding-top: 12vh;
  ${still ? `
  --blyrics-animate-line-scale: 0;
  --blyrics-animate-word-wobble: 0;
  --blyrics-animate-highlight-swipe: 0;
  --blyrics-animate-highlight-glow: 0;
  --blyrics-animate-scroll: 0;
  ` : ''}
}
/* blyrics-target-scroll-pos-ratio = 0.42; */
`
}

function linesToLyrics(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.t == null) continue
    const start = Math.round(Number(line.t) * 1000)
    const next = lines[i + 1]
    const end = line.end != null
      ? Math.round(Number(line.end) * 1000)
      : (next && next.t != null ? Math.round(Number(next.t) * 1000) : start + 3500)
    const text = String(line.text || '').trim()
    const words = Array.isArray(line.words) ? line.words : []
    const lyric = {
      startTimeMs: start,
      durationMs: Math.max(80, end - start),
      words: text,
    }
    if (words.length) {
      lyric.parts = words.map((word, j) => {
        const ws = Math.round(Number(word.t) * 1000)
        const nxt = words[j + 1]
        const we = word.end != null
          ? Math.round(Number(word.end) * 1000)
          : (nxt ? Math.round(Number(nxt.t) * 1000) : ws + 180)
        return { startTimeMs: ws, durationMs: Math.max(30, we - ws), words: String(word.w || '') }
      }).filter((part) => part.words)
    }
    if (text || (lyric.parts && lyric.parts.length)) out.push(lyric)
  }
  return out
}

export default function BraccatoLyrics({ ttml, lines, durationMs, offset, audio, onSeek, still, footer }) {
  const ref = useRef(null)
  const seekRef = useRef(onSeek)
  seekRef.current = onSeek

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let dead = false
    el.theme = lyricTheme(!!still)
    el.host = { getScrollElement: () => el }
    el.tickOptions = { lyricOffset: offset || 0, smoothScroll: !still }
    const load = async () => {
      let lyrics = []
      if (ttml) {
        try {
          const mod = await import('@braccato/parsers')
          if (dead) return
          const parsed = mod.parseTTMLContent(ttml, { songDurationMs: durationMs || 0 })
          lyrics = (parsed && parsed.lyrics) || []
        } catch { /* the line timings below still play */ }
      }
      if (!lyrics.length && lines && lines.length) lyrics = linesToLyrics(lines)
      if (dead) return
      el.lyrics = lyrics
      if (audio) el.source = audio
    }
    load()
    const onClick = (event) => {
      const time = event.detail && event.detail.timeS
      if (typeof time === 'number') seekRef.current(time)
    }
    const onScroll = () => { el.renderer?.noteUserScroll() }
    el.addEventListener('braccato:line-click', onClick)
    el.addEventListener('scroll', onScroll, true)
    return () => {
      dead = true
      el.removeEventListener('braccato:line-click', onClick)
      el.removeEventListener('scroll', onScroll, true)
    }
  }, [ttml, lines, durationMs, audio, still])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.tickOptions = { lyricOffset: offset || 0, smoothScroll: !still }
  }, [offset, still])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="lyric-stage relative min-h-0 flex-1 overflow-hidden">
        <braccato-lyrics ref={ref} />
      </div>
      {footer ? (
        <p className="shrink-0 pt-2 text-center text-[10px] uppercase tracking-[0.16em] text-white/40">{footer}</p>
      ) : null}
    </div>
  )
}
