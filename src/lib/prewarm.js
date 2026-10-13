// Debounced hover prewarm: resolves a video's stream URLs (innertube/yt-dlp)
// while the user is still deciding, so clicking the card skips the wait.
// Main-process side already dedupes inflight work and caches URLs for 3.5h,
// so this only needs to avoid spamming IPC on fast mouse sweeps.

const requested = new Set()
let timer = null

export function prewarmOnHover(videoId) {
  if (!videoId || requested.has(videoId) || !window.electronAPI?.ytPrewarm) return
  clearTimeout(timer)
  // Only prewarm once the pointer LINGERS (~200ms) — a fast sweep across the
  // grid shouldn't spawn resolution for every card it crosses.
  timer = setTimeout(() => {
    if (requested.has(videoId)) return
    requested.add(videoId)
    window.electronAPI.ytPrewarm(videoId).catch(() => {})
  }, 200)
}

export function cancelPrewarmHover() {
  clearTimeout(timer)
  timer = null
}
