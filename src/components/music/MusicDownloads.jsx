import { useDownloads } from '../../context/DownloadContext'
import { isAudioDownload } from '../../lib/media'
import { ActiveDownloadCard } from '../Downloads'
import DownloadsTabs from '../DownloadsTabs'
import DownloadedMusic from './DownloadedMusic'

// The music counterpart of the video Downloads page: songs in progress, then the
// saved playlists and tracks (with their lyrics).
export default function MusicDownloads() {
  const { activeDownloads } = useDownloads()
  const activeMusic = activeDownloads.filter((d) => isAudioDownload(d))

  return (
    <div className="max-w-5xl mx-auto space-y-8 page-enter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium tracking-tight">Music downloads</h1>
        </div>
        <DownloadsTabs active="music" />
      </div>

      {activeMusic.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Downloading
                <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">{activeMusic.length}</span>
              </h2>
            </div>
          </div>
          <div className="reveal-grid grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            {activeMusic.map((dl) => <ActiveDownloadCard key={dl.id} download={dl} />)}
          </div>
        </section>
      )}

      <DownloadedMusic />
    </div>
  )
}
