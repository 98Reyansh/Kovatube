import { useSettings, ACCENT_PRESETS } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useSmartDownloads } from '../context/SmartDownloadContext'

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-7 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-yt-red/50 disabled:opacity-50 hover:shadow-md ${
        checked ? 'bg-yt-red' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className="absolute top-1 h-5 w-5 bg-white rounded-full shadow-md"
        style={{
          left: checked ? '26px' : '4px',
          transition: 'left 260ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </button>
  )
}

function SettingRow({ icon, title, description, children }) {
  return (
    <div className="stagger-item flex items-center justify-between gap-4 p-4 bg-white dark:bg-gray-800/80 border border-black/[0.05] dark:border-white/[0.06] rounded-xl hover-lift">
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-10 h-10 rounded-lg bg-yt-red/10 flex items-center justify-center shrink-0 mt-0.5 transition-transform duration-200 group-hover:scale-105">
          {icon}
        </span>
        <div>
          <h3 className="font-medium text-sm">{title}</h3>
          {description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export default function Settings() {
  const { settings, hydrated, updateSetting } = useSettings()
  const { addToast } = useToast()
  const { signedIn, account, signingIn, signIn, signOut } = useAuth()
  const { enabled: smartDlEnabled, clipboard: smartDlClipboard, toggleSmartDownload, toggleClipboard } = useSmartDownloads()

  const handleSignIn = async () => {
    const ok = await signIn()
    addToast(ok ? 'success' : 'error', ok ? 'Signed in to Google' : 'Sign-in cancelled or failed', 3000)
  }

  const handleSignOut = async () => {
    await signOut()
    addToast('info', 'Signed out of Google', 3000)
  }

  const selectDir = async () => {
    if (!window.electronAPI) return
    const picked = await window.electronAPI.selectDirectory()
    if (picked) {
      await updateSetting('downloadDir', picked)
      addToast('success', 'Downloads folder updated', 3000)
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-4 space-y-8 page-enter">
      <div className="flex items-center gap-3">
        <span className="w-1 h-8 bg-yt-red rounded-full" />
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Customize your Kovatube experience</p>
        </div>
      </div>

      {!hydrated ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">YouTube Account</h2>

            <SettingRow
              title={signedIn ? (account?.name || 'Signed in to Google') : 'Sign in to Google'}
              description={signedIn
                ? (account?.handle ? `Signed in as ${account.handle}` : 'Personalized For You feed enabled')
                : 'Connect your Google account to load your real personalized For You feed'}
              icon={
                <svg className="w-5 h-5 text-yt-red" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
              }
            >
              {signedIn ? (
                <button
                  onClick={handleSignOut}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors hover-ring"
                >
                  Sign out
                </button>
              ) : (
                <button
                  onClick={handleSignIn}
                  disabled={signingIn}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-yt-red text-white hover:bg-yt-red-hover transition-colors hover-ring disabled:opacity-50"
                >
                  {signingIn ? 'Signing in…' : 'Sign in'}
                </button>
              )}
            </SettingRow>

            <SettingRow
              title="For You source"
              description={signedIn
                ? 'Choose what powers your For You feed'
                : 'Sign in above to enable the personalized Google feed'}
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              }
            >
              <select
                value={settings.fypSource}
                onChange={(e) => updateSetting('fypSource', e.target.value)}
                className="px-3 py-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-yt-red/50 hover:border-yt-red/40"
              >
                <option value="auto">Auto (personalized when signed in)</option>
                <option value="signedIn">Personalized (Google) always</option>
                <option value="anon">Default (not personalized)</option>
              </select>
            </SettingRow>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Appearance</h2>
            <SettingRow
              title="Theme"
              description="Light, Dark, or pure black AMOLED"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              }
            >
              <select
                value={settings.theme}
                onChange={(e) => updateSetting('theme', e.target.value)}
                className="px-3 py-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-yt-red/50 hover:border-yt-red/40"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="amoled">AMOLED Black</option>
              </select>
            </SettingRow>

            <SettingRow
              title="Accent color"
              description="Color used for buttons, highlights and the play bar"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
              }
            >
              <div className="grid grid-cols-10 gap-2">
                {Object.entries(ACCENT_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    title={preset.label}
                    aria-label={preset.label}
                    onClick={() => updateSetting('accentColor', key)}
                    className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                      settings.accentColor === key ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 scale-110' : ''
                    }`}
                    style={{
                      backgroundColor: `rgb(${preset.accent})`,
                      ...(settings.accentColor === key ? { boxShadow: `0 0 0 2px rgb(${preset.accent})` } : {}),
                    }}
                  />
                ))}
              </div>
            </SettingRow>

            <SettingRow
              title="Reduce motion"
              description="Minimize animations for a calmer experience"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5h2m-1 14v-4l-4-7a1 1 0 011-1h8a1 1 0 011 1l-4 7v4" />
                </svg>
              }
            >
              <Toggle checked={settings.reduceMotion} onChange={(v) => updateSetting('reduceMotion', v)} />
            </SettingRow>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Playback</h2>
            <SettingRow
              title="Autoplay videos"
              description="Start playing videos automatically when you open them"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            >
              <Toggle checked={settings.autoplay} onChange={(v) => updateSetting('autoplay', v)} />
            </SettingRow>

            <SettingRow
              title="Show descriptions"
              description="Display the video description below the player"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              }
            >
              <Toggle checked={settings.showDescriptions} onChange={(v) => updateSetting('showDescriptions', v)} />
            </SettingRow>

            <SettingRow
              title="Default quality"
              description="Preferred resolution for video downloads"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
                </svg>
              }
            >
              <select
                value={settings.defaultQuality}
                onChange={(e) => updateSetting('defaultQuality', e.target.value)}
                className="px-3 py-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-yt-red/50 hover:border-yt-red/40"
              >
                <option value="auto">Auto</option>
                <option value="2160">4K (2160p)</option>
                <option value="1440">2K (1440p)</option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="360">360p</option>
              </select>
            </SettingRow>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Downloads</h2>
            <SettingRow
              title="Downloads folder"
              description={settings.downloadDir || 'Current: ~/.config/Kovatube/downloads'}
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              }
            >
              <button
                onClick={selectDir}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-yt-red text-white hover:bg-yt-red-hover transition-colors hover-ring"
              >
                Change
              </button>
            </SettingRow>

            <SettingRow
              title="Default download format"
              description="File format when downloading video"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              }
            >
              <select
                value={settings.defaultDownloadFormat}
                onChange={(e) => updateSetting('defaultDownloadFormat', e.target.value)}
                className="px-3 py-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-yt-red/50 hover:border-yt-red/40"
              >
                <option value="mp4">MP4</option>
                <option value="mkv">MKV</option>
                <option value="webm">WebM</option>
              </select>
            </SettingRow>

            <SettingRow
              title="Smart Downloads (For You feed)"
              description="Automatically download new videos from your For You page"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              }
            >
              <Toggle checked={smartDlEnabled} onChange={() => { toggleSmartDownload().catch(() => {}) }} />
            </SettingRow>

            <SettingRow
              title="Download from clipboard"
              description="Automatically download YouTube links you copy"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m0 0v3m0-3h2a2 2 0 012 2v2a2 2 0 01-2 2H8a2 2 0 01-2-2V7a2 2 0 012-2z" />
                </svg>
              }
            >
              <Toggle checked={smartDlClipboard} onChange={() => { toggleClipboard().catch(() => {}) }} />
            </SettingRow>

            <SettingRow
              title="Smart download limit"
              description="Max smart downloads in total (0 = unlimited; not reset per session)"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
            >
              <input
                type="number"
                min="0"
                value={settings.smartDlLimit}
                onChange={(e) => updateSetting('smartDlLimit', parseInt(e.target.value || '0', 10))}
                className="w-24 px-3 py-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-yt-red/50 hover:border-yt-red/40"
              />
            </SettingRow>

            <SettingRow
              title="Max concurrent smart downloads"
              description="How many smart downloads run at the same time (1–5)"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              }
            >
              <input
                type="number"
                min="1"
                max="5"
                value={settings.smartDlConcurrency}
                onChange={(e) => updateSetting('smartDlConcurrency', parseInt(e.target.value || '1', 10))}
                className="w-24 px-3 py-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-yt-red/50 hover:border-yt-red/40"
              />
            </SettingRow>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Playback mode</h2>
            <SettingRow
              title="Play downloaded files in-app"
              description="Play completed downloads inside the app instead of opening an external player"
              icon={
                <svg className="w-5 h-5 text-yt-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              }
            >
              <Toggle
                checked={settings.playbackMode === 'inApp'}
                onChange={(v) => updateSetting('playbackMode', v ? 'inApp' : 'iframe')}
              />
            </SettingRow>
          </section>

          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            Settings are saved automatically to ~/.config/Kovatube/settings.json
          </p>
        </>
      )}
    </div>
  )
}
