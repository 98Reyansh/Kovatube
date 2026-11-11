import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

function isTauri() {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
}

const bags = new Map()

function subscribe(event, cb) {
  let bag = bags.get(event)
  if (!bag) {
    bag = { cbs: new Set() }
    bags.set(event, bag)
    listen(event, (e) => {
      for (const fn of bag.cbs) {
        try { fn(e.payload) } catch { /* a listener should not break the rest */ }
      }
    }).catch(() => {})
  }
  bag.cbs.add(cb)
  return () => bag.cbs.delete(cb)
}

function clearEvent(event) {
  bags.get(event)?.cbs.clear()
}

function tauriApi() {
  return {
    getAppPath: () => invoke('get_app_path'),
    appVersion: () => invoke('app_version'),
    checkForUpdate: () => invoke('update_check'),
    updateInstall: () => invoke('update_install'),
    onUpdateAvailable: (cb) => { subscribe('update-available', cb) },
    onUpdateProgress: (cb) => { subscribe('update-progress', cb) },
    onUpdateDownloaded: (cb) => { subscribe('update-downloaded', cb) },
    onUpdateError: (cb) => { subscribe('update-error', cb) },
    removeUpdateListeners: () => {
      clearEvent('update-available')
      clearEvent('update-progress')
      clearEvent('update-downloaded')
      clearEvent('update-error')
    },
    getDownloadsPath: () => invoke('get_downloads_path'),
    getDownloadPaths: () => invoke('get_download_paths'),
    getDownloadsList: () => invoke('get_downloads_list'),
    selectDirectory: () => invoke('select_directory'),
    saveFile: (data) => invoke('save_file', { data }),
    netProbe: () => invoke('net_probe'),
    onNetworkError: (cb) => { subscribe('network-error', cb) },
    removeNetworkErrorListeners: () => { clearEvent('network-error') },

    ytSearch: (query) => invoke('yt_search', { query }),
    ytHomeFeed: () => invoke('yt_home_feed'),
    ytShortsFeed: () => invoke('yt_shorts_feed'),
    onShortsFeedMore: (cb) => { subscribe('shorts-feed-more', cb) },
    removeShortsFeedMoreListeners: () => { clearEvent('shorts-feed-more') },
    ytFypPage: (args) => invoke('yt_fyp_page', { args: args || {} }),
    ytPrefs: () => invoke('yt_prefs'),
    ytRecordWatch: (v) => invoke('yt_record_watch', { video: v }),
    ytSubscribe: (channel) => invoke('yt_subscribe', { channel }),
    ytUnsubscribe: (channel) => invoke('yt_unsubscribe', { channel }),
    ytVideoInfo: (videoId) => invoke('yt_video_info', { videoId }),
    ytCaptions: (args) => invoke('yt_captions', { args: args || {} }),
    ytComments: (args) => invoke('yt_comments', { args: args || {} }),
    ytCommentCreate: (args) => invoke('yt_comment_create', { args: args || {} }),
    ytChannel: (channelName) => invoke('yt_channel', { channelName }),
    ytChannelAvatar: (channelName) => invoke('yt_channel_avatar', { channelName }),
    ytChannelMore: (token, channelName) => invoke('yt_channel_more', { token, channelName }),
    ytNewVideos: () => invoke('yt_new_videos'),
    ytConvertFormats: (videoUrl) => invoke('yt_convert_formats', { videoUrl }),
    ytExtractId: (url) => invoke('yt_extract_id', { url }),
    ytStream: (videoId, quality, relay) => invoke('yt_stream', { videoId, quality, relay: !!relay }),
    ytStreamStop: (videoId) => invoke('yt_stream_stop', { videoId }),
    ytPrewarm: (videoId) => invoke('yt_prewarm', { videoId }),
    coverPalette: (url) => invoke('cover_palette', { url }),
    coverImage: (url) => invoke('cover_image', { url }),
    onStreamPhase: (cb) => { subscribe('stream-phase', cb) },
    removeStreamPhaseListeners: () => { clearEvent('stream-phase') },
    onStreamCapped: (cb) => subscribe('stream-capped', cb),

    ytMusicHome: () => invoke('yt_music_home'),
    ytMusicCharts: () => invoke('yt_music_charts'),
    ytMusicSearch: (args) => invoke('yt_music_search', { args: args || {} }),
    ytMusicBrowse: (browseId) => invoke('yt_music_browse', { browseId }),
    ytMusicMore: (continuation) => invoke('yt_music_more', { continuation }),
    ytMusicLibrary: () => invoke('yt_music_library'),
    ytMusicLikedIds: () => invoke('yt_music_liked_ids'),
    ytMusicRate: (args) => invoke('yt_music_rate', { args: args || {} }),
    ytMusicLyrics: (args) => invoke('yt_music_lyrics', { args: args || {} }),
    ytAudioStream: (videoId, opts) => invoke('yt_audio_stream', { videoId, opts: opts || null }),
    audioKeepalive: (on) => invoke('audio_keepalive', { on: !!on }),
    ytAudioPrewarm: (videoId) => invoke('yt_audio_prewarm', { videoId }),

    settingsGet: () => invoke('settings_get'),
    settingsSet: (patch) => invoke('settings_set', { patch }),

    ytAuthStatus: () => invoke('yt_auth_status'),
    ytAuthSignIn: () => invoke('yt_auth_signin'),
    ytAuthSignOut: () => invoke('yt_auth_signout'),
    ytAuthAccount: () => invoke('yt_auth_account'),
    ytAuthHomePage: (args) => invoke('yt_auth_home_page', { args: args || {} }),
    ytAuthSubscriptions: () => invoke('yt_auth_subscriptions'),
    onAuthUpdated: (cb) => { subscribe('auth-updated', cb) },
    removeAuthUpdatedListeners: () => { clearEvent('auth-updated') },

    preparePlayback: (filePath) => invoke('prepare_playback', { filePath }),

    dlStart: (opts) => invoke('dl_start', { opts: opts || {} }),
    dlPlaylist: (opts) => invoke('dl_playlist', { opts: opts || {} }),
    dlCancel: (downloadId) => invoke('dl_cancel', { downloadId }),
    dlActive: () => invoke('dl_active'),
    dlCompleted: () => invoke('dl_completed'),
    dlPlaylists: () => invoke('dl_playlists'),
    dlPlaylistAutoSync: (id, enabled) => invoke('dl_playlist_autosync', { id, enabled }),
    dlPlaylistSync: (id) => invoke('dl_playlist_sync', { id }),
    dlSyncAll: () => invoke('dl_sync_all'),
    dlPlay: (filePath) => invoke('dl_play', { filePath }),
    dlShowInFolder: (filePath) => invoke('dl_show_in_folder', { filePath }),
    onDownloadProgress: (cb) => { subscribe('download-progress', cb) },
    onDownloadComplete: (cb) => { subscribe('download-complete', cb) },
    onPlaylistUpdate: (cb) => { subscribe('playlist-update', cb) },
    onPlaylistSync: (cb) => { subscribe('playlist-sync', cb) },
    removeDownloadListeners: () => {
      clearEvent('download-progress')
      clearEvent('download-complete')
    },
    removePlaylistUpdateListeners: () => { clearEvent('playlist-update') },
    removePlaylistSyncListeners: () => { clearEvent('playlist-sync') },

    smartDlToggle: (enabled) => invoke('smart_dl_toggle', { enabled }),
    smartDlClipboardToggle: (enabled) => invoke('smart_dl_clipboard_toggle', { enabled }),
    smartDlStatus: () => invoke('smart_dl_status'),
    smartDlResetCounts: () => invoke('smart_dl_reset_counts'),
    smartDlHistory: () => invoke('smart_dl_history'),
    smartDlCancel: (dlId) => invoke('smart_dl_cancel', { dlId }),
    onSmartDlProgress: (cb) => { subscribe('smart-dl-progress', cb) },
    onSmartDlComplete: (cb) => { subscribe('smart-dl-complete', cb) },
    onSmartDlCancelled: (cb) => { subscribe('smart-dl-cancelled', cb) },
    removeSmartDlListeners: () => {
      clearEvent('smart-dl-progress')
      clearEvent('smart-dl-complete')
      clearEvent('smart-dl-cancelled')
    },

    onToast: (cb) => { subscribe('toast', cb) },
    removeToastListeners: () => { clearEvent('toast') },
  }
}

export const api = isTauri()
  ? tauriApi()
  : (typeof window !== 'undefined' ? window.electronAPI : null)

export function installBridge() {
  if (typeof window === 'undefined') return
  if (isTauri()) window.electronAPI = api
}
