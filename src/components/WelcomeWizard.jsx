import { createContext, useContext, useState } from 'react'
import { ACCENT_PRESETS, useSettings } from '../context/SettingsContext'
import { useAuth } from '../context/AuthContext'

const WELCOME_KEY = 'kovatube_welcomed'

export function hasSeenWelcome() {
  try { return localStorage.getItem(WELCOME_KEY) === '1' } catch { return true }
}

const WelcomeReplayContext = createContext(() => {})

export function WelcomeReplayProvider({ children, openWelcome }) {
  return <WelcomeReplayContext.Provider value={openWelcome}>{children}</WelcomeReplayContext.Provider>
}

export function useReplayWelcome() {
  return useContext(WelcomeReplayContext)
}

const THEMES = [
  { id: 'dark', label: 'Dark', detail: 'The default look' },
  { id: 'light', label: 'Light', detail: 'Bright surfaces' },
  { id: 'amoled', label: 'AMOLED', detail: 'Pure black' },
  { id: 'material', label: 'Material', detail: 'Tonal, rounded surfaces' },
]

export default function WelcomeWizard({ onDone }) {
  const { settings, updateSetting } = useSettings()
  const { signedIn, account, signingIn, signIn } = useAuth()
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)

  const finish = async () => {
    try { localStorage.setItem(WELCOME_KEY, '1') } catch { /* private mode */ }
    updateSetting('welcomed', true)
    if (window.electronAPI?.settingsSet) {
      await window.electronAPI.settingsSet({ welcomed: true }).catch(() => {})
    }
    onDone()
  }

  const go = (next) => {
    setDirection(next > step ? 1 : -1)
    setStep(next)
  }

  return (
    <div className="welcome-backdrop" onMouseDown={finish}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-kicker"
        className="welcome-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p id="welcome-kicker" className="text-[11px] font-medium tracking-[0.16em] uppercase text-gray-400 dark:text-zinc-500">Welcome</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Step {step + 1} of 3</p>
          </div>
          <div className="flex items-center gap-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className={`welcome-dot ${i === step ? 'welcome-dot-on' : ''} ${i < step ? 'bg-yt-red/50' : ''}`} />
            ))}
          </div>
        </div>

        <div key={`${step}-${direction}`} className={direction > 0 ? 'wizard-forward' : 'wizard-back'}>
          {step === 0 && <WelcomeStep />}
          {step === 1 && (
            <SignInStep signedIn={signedIn} account={account} signingIn={signingIn} onSignIn={signIn} />
          )}
          {step === 2 && (
            <LookStep settings={settings} updateSetting={updateSetting} />
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" className="welcome-ghost" onClick={finish}>Close</button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button type="button" className="welcome-ghost" onClick={() => go(step - 1)}>Back</button>
            )}
            {step < 2 ? (
              <button type="button" className="welcome-primary" onClick={() => go(step + 1)}>Continue</button>
            ) : (
              <button type="button" className="welcome-primary" onClick={finish}>Finish</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WelcomeStep() {
  return (
    <div>
      <div className="mt-6 flex items-end gap-3">
        <PreviewCard kicker="For You" title="Your feed" detail="Recommendations, ready when you are." />
        <PreviewCard kicker="Later" title="Watch later" detail="Kept on this device." accent />
        <PreviewCard kicker="Music" title="Now playing" detail="Songs, lyrics, downloads." />
      </div>
      <h2 className="mt-6 text-2xl font-semibold tracking-tight">A quieter desk for video</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-zinc-400">
        For You, music, and downloads live in one dark shell. Your theme, accent, and playback settings stay yours.
      </p>
    </div>
  )
}

function PreviewCard({ kicker, title, detail, accent }) {
  return (
    <div className={`welcome-preview ${accent ? 'welcome-preview-accent' : ''}`}>
      <p className="text-[10px] font-medium tracking-[0.14em] uppercase text-gray-400 dark:text-zinc-500">{kicker}</p>
      <p className="mt-2 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-[11px] leading-snug text-gray-500 dark:text-zinc-500">{detail}</p>
    </div>
  )
}

function SignInStep({ signedIn, account, signingIn, onSignIn }) {
  return (
    <div className="mt-6">
      <h2 className="text-2xl font-semibold tracking-tight">Sign in when you want</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-zinc-400">
        A Google account loads your own For You feed. You can skip this and sign in later from the sidebar.
      </p>
      <div className="mt-5 rounded-2xl border border-black/[0.08] dark:border-white/10 bg-black/[0.03] dark:bg-black/30 px-4 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{signedIn ? (account?.name || 'Signed in') : 'Google account'}</p>
          <p className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">
            {signedIn ? (account?.handle || 'Personalized feed is on') : 'Optional. Nothing is required to browse.'}
          </p>
        </div>
        <button type="button" className="welcome-primary shrink-0" disabled={signingIn || signedIn} onClick={onSignIn}>
          {signedIn ? 'Signed in' : signingIn ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  )
}

function LookStep({ settings, updateSetting }) {
  return (
    <div className="mt-6">
      <h2 className="text-2xl font-semibold tracking-tight">Make it feel like yours</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-zinc-400">
        Theme and accent are saved on this desktop. You can change either one later in Settings.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {THEMES.map((option) => {
          const selected = settings.theme === option.id
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => updateSetting('theme', option.id)}
              className={`welcome-choice ${selected ? 'welcome-choice-on' : ''}`}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="mt-1 block text-[11px] text-gray-500 dark:text-zinc-500">{option.detail}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(ACCENT_PRESETS).map(([id, preset]) => (
          <button
            key={id}
            type="button"
            title={preset.label}
            aria-label={preset.label}
            aria-pressed={settings.accentColor === id}
            onClick={() => updateSetting('accentColor', id)}
            className={`w-7 h-7 rounded-full border-2 ${settings.accentColor === id ? 'border-white dark:border-white scale-110' : 'border-transparent'}`}
            style={{ background: `rgb(${preset.accent})`, transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        ))}
      </div>
      <button
        type="button"
        aria-pressed={settings.autoplay}
        onClick={() => updateSetting('autoplay', !settings.autoplay)}
        className="welcome-choice mt-3 w-full flex items-center justify-between text-left"
      >
        <span>
          <span className="block text-sm font-semibold">Autoplay</span>
          <span className="block text-xs text-gray-500 dark:text-zinc-500">Start the video when you open it.</span>
        </span>
        <span className={`relative h-6 w-11 rounded-full ${settings.autoplay ? 'bg-yt-red' : 'bg-black/15 dark:bg-white/15'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow ${settings.autoplay ? 'translate-x-5' : 'translate-x-0.5'}`} style={{ transition: 'transform 280ms cubic-bezier(0.34, 1.4, 0.64, 1)' }} />
        </span>
      </button>
    </div>
  )
}
