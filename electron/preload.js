const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  getDownloadPaths: () => ipcRenderer.invoke('get-download-paths'),
  getDownloadsList: () => ipcRenderer.invoke('get-downloads-list'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),

  // Connectivity (offline screen)
  netProbe: () => ipcRenderer.invoke('net-probe'),
  onNetworkError: (cb) => { ipcRenderer.on('network-error', () => cb()) },
  removeNetworkErrorListeners: () => { ipcRenderer.removeAllListeners('network-error') },

  ytSearch: (query) => ipcRenderer.invoke('yt-search', query),
  ytHomeFeed: () => ipcRenderer.invoke('yt-home-feed'),
  ytShortsFeed: () => ipcRenderer.invoke('yt-shorts-feed'),
  ytFypPage: (args) => ipcRenderer.invoke('yt-fyp-page', args),
  ytPrefs: () => ipcRenderer.invoke('yt-prefs'),
  ytRecordWatch: (v) => ipcRenderer.invoke('yt-record-watch', v),
  ytSubscribe: (channel) => ipcRenderer.invoke('yt-subscribe', channel),
  ytUnsubscribe: (channel) => ipcRenderer.invoke('yt-unsubscribe', channel),
  ytVideoInfo: (videoId) => ipcRenderer.invoke('yt-video-info', videoId),
  ytChannel: (channelName) => ipcRenderer.invoke('yt-channel', channelName),
  ytChannelMore: (token, channelName) => ipcRenderer.invoke('yt-channel-more', token, channelName),
  ytNewVideos: () => ipcRenderer.invoke('yt-new-videos'),
  ytConvertFormats: (videoUrl) => ipcRenderer.invoke('yt-convert-formats', videoUrl),
  ytExtractId: (url) => ipcRenderer.invoke('yt-extract-id', url),
  ytStream: (videoId, quality) => ipcRenderer.invoke('yt-stream', videoId, quality),
  ytStreamStop: (videoId) => ipcRenderer.invoke('yt-stream-stop', videoId),
  ytPrewarm: (videoId) => ipcRenderer.invoke('yt-prewarm', videoId),
  onStreamPhase: (cb) => { ipcRenderer.on('stream-phase', (_e, data) => cb(data)) },
  removeStreamPhaseListeners: () => { ipcRenderer.removeAllListeners('stream-phase') },

  // YouTube Music
  ytMusicHome: () => ipcRenderer.invoke('yt-music-home'),
  ytMusicCharts: () => ipcRenderer.invoke('yt-music-charts'),
  ytMusicSearch: (args) => ipcRenderer.invoke('yt-music-search', args),
  ytMusicBrowse: (browseId) => ipcRenderer.invoke('yt-music-browse', browseId),
  ytMusicMore: (continuation) => ipcRenderer.invoke('yt-music-more', continuation),
  ytMusicLibrary: () => ipcRenderer.invoke('yt-music-library'),
  ytMusicLyrics: (args) => ipcRenderer.invoke('yt-music-lyrics', args),
  ytAudioStream: (videoId) => ipcRenderer.invoke('yt-audio-stream', videoId),
  ytAudioPrewarm: (videoId) => ipcRenderer.invoke('yt-audio-prewarm', videoId),

  // Settings
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings-set', patch),

  // Google/YouTube sign-in + personalized feed
  ytAuthStatus: () => ipcRenderer.invoke('yt-auth-status'),
  ytAuthSignIn: () => ipcRenderer.invoke('yt-auth-signin'),
  ytAuthSignOut: () => ipcRenderer.invoke('yt-auth-signout'),
  ytAuthAccount: () => ipcRenderer.invoke('yt-auth-account'),
  ytAuthHomePage: (args) => ipcRenderer.invoke('yt-auth-home-page', args),
  ytAuthSubscriptions: () => ipcRenderer.invoke('yt-auth-subscriptions'),
  onAuthUpdated: (cb) => { ipcRenderer.on('auth-updated', (_e, data) => cb(data)) },
  removeAuthUpdatedListeners: () => { ipcRenderer.removeAllListeners('auth-updated') },

  // In-app local playback
  preparePlayback: (filePath) => ipcRenderer.invoke('prepare-playback', filePath),

  // Download pipeline
  dlStart: (opts) => ipcRenderer.invoke('dl-start', opts),
  dlPlaylist: (opts) => ipcRenderer.invoke('dl-playlist', opts),
  dlCancel: (downloadId) => ipcRenderer.invoke('dl-cancel', downloadId),
  dlActive: () => ipcRenderer.invoke('dl-active'),
  dlCompleted: () => ipcRenderer.invoke('dl-completed'),
  dlPlaylists: () => ipcRenderer.invoke('dl-playlists'),
  dlPlaylistAutoSync: (id, enabled) => ipcRenderer.invoke('dl-playlist-autosync', { id, enabled }),
  dlPlaylistSync: (id) => ipcRenderer.invoke('dl-playlist-sync', id),
  dlSyncAll: () => ipcRenderer.invoke('dl-sync-all'),
  dlPlay: (filePath) => ipcRenderer.invoke('dl-play', filePath),
  dlShowInFolder: (filePath) => ipcRenderer.invoke('dl-show-in-folder', filePath),
  onDownloadProgress: (cb) => { ipcRenderer.on('download-progress', (_e, data) => cb(data)) },
  onDownloadComplete: (cb) => { ipcRenderer.on('download-complete', (_e, data) => cb(data)) },
  onPlaylistUpdate: (cb) => { ipcRenderer.on('playlist-update', (_e, data) => cb(data)) },
  onPlaylistSync: (cb) => { ipcRenderer.on('playlist-sync', (_e, data) => cb(data)) },
  removeDownloadListeners: () => { ipcRenderer.removeAllListeners('download-progress'); ipcRenderer.removeAllListeners('download-complete') },
  removePlaylistUpdateListeners: () => { ipcRenderer.removeAllListeners('playlist-update') },
  removePlaylistSyncListeners: () => { ipcRenderer.removeAllListeners('playlist-sync') },

  // Smart Download pipeline
  smartDlToggle: (enabled) => ipcRenderer.invoke('smart-dl-toggle', enabled),
  smartDlClipboardToggle: (enabled) => ipcRenderer.invoke('smart-dl-clipboard-toggle', enabled),
  smartDlStatus: () => ipcRenderer.invoke('smart-dl-status'),
  smartDlResetCounts: () => ipcRenderer.invoke('smart-dl-reset-counts'),
  smartDlHistory: () => ipcRenderer.invoke('smart-dl-history'),
  smartDlCancel: (dlId) => ipcRenderer.invoke('smart-dl-cancel', dlId),
  onSmartDlProgress: (cb) => { ipcRenderer.on('smart-dl-progress', (_e, data) => cb(data)) },
  onSmartDlComplete: (cb) => { ipcRenderer.on('smart-dl-complete', (_e, data) => cb(data)) },
  onSmartDlCancelled: (cb) => { ipcRenderer.on('smart-dl-cancelled', (_e, data) => cb(data)) },
  removeSmartDlListeners: () => {
    ipcRenderer.removeAllListeners('smart-dl-progress')
    ipcRenderer.removeAllListeners('smart-dl-complete')
    ipcRenderer.removeAllListeners('smart-dl-cancelled')
  },

  // Toast notifications from main process
  onToast: (cb) => { ipcRenderer.on('toast', (_e, data) => cb(data)) },
  removeToastListeners: () => { ipcRenderer.removeAllListeners('toast') },
})