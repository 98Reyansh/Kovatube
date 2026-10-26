// Shared helpers for telling downloaded songs from downloaded videos.

export const AUDIO_RE = /\.(mp3|m4a|aac|opus|ogg|oga|flac|wav)$/i

const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'opus', 'ogg', 'oga', 'flac', 'wav']

// True for a completed/active download record that holds music rather than video.
// Covers the audio flag, an audio file extension, and the "audio"/mp3/m4a
// quality labels the download UI uses.
export function isAudioDownload(download) {
  if (!download) return false
  if (download.isAudio) return true
  if (AUDIO_RE.test(download.fileName || '')) return true
  const ext = String(download.format || '').replace(/^\./, '').toLowerCase()
  if (AUDIO_EXTS.includes(ext)) return true
  const quality = String(download.quality || '').toLowerCase()
  return quality.includes('audio') || quality.includes('mp3') || quality.includes('m4a')
}
