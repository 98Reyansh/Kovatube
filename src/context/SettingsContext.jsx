import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const SettingsContext = createContext(null)

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

const DEFAULTS = {
  theme: 'dark', // 'dark' | 'light' | 'amoled' | 'material'
  musicStyle: 'standard', // 'standard' | 'apple'
  accentColor: 'red',
  autoplay: true,
  defaultQuality: 'auto',
  defaultDownloadFormat: 'mp4',
  downloadDir: '',
  showDescriptions: true,
  reduceMotion: false,
  playbackMode: 'inApp',
  smartDlEnabled: false,    // master toggle for smart downloads
  smartDlClipboard: false,  // download from clipboard (separate from FYP auto)
  smartDlLimit: 10,
  smartDlConcurrency: 2,
  smartDlCount: 0,
  smartDlInterval: 60, // minutes between auto-download checks
  fypSource: 'auto', // 'auto' (personalized when signed in) | 'signedIn' | 'anon'
  welcomed: false, // first-launch welcome has been dismissed
  navPosition: 'side', // 'side' | 'top'
  playerBar: 'pill', // 'pill' | 'full'
  lyricAnimation: 'karaoke', // 'karaoke' | 'rise' | 'glow' | 'bounce' | 'fade'
  lyricShader: true, // fluid album-art background on the full player
}

export const ACCENT_PRESETS = {
  red:     { label: 'Red',      accent: '255 0 0',     hover: '185 28 28',   light: '248 113 113' },
  rose:    { label: 'Rose',     accent: '244 63 94',   hover: '190 18 60',   light: '251 113 133' },
  pink:    { label: 'Pink',     accent: '236 72 153',  hover: '190 24 93',   light: '244 114 182' },
  fuchsia: { label: 'Fuchsia',  accent: '217 70 239',  hover: '162 28 175',  light: '232 121 249' },
  purple:  { label: 'Purple',   accent: '168 85 247',  hover: '126 34 206',  light: '192 132 252' },
  violet:  { label: 'Violet',   accent: '139 92 246',  hover: '109 40 217',  light: '167 139 250' },
  indigo:  { label: 'Indigo',   accent: '99 102 241',  hover: '67 56 202',   light: '129 140 248' },
  blue:    { label: 'Blue',     accent: '59 130 246',  hover: '29 78 216',   light: '96 165 250' },
  sky:     { label: 'Sky',      accent: '14 165 233',  hover: '3 105 161',   light: '56 189 248' },
  cyan:    { label: 'Cyan',     accent: '6 182 212',   hover: '8 145 178',   light: '34 211 238' },
  teal:    { label: 'Teal',     accent: '20 184 166',  hover: '13 148 136',  light: '45 212 191' },
  emerald: { label: 'Emerald',  accent: '16 185 129',  hover: '5 150 105',   light: '52 211 153' },
  green:   { label: 'Green',    accent: '34 197 94',   hover: '21 128 61',   light: '74 222 128' },
  lime:    { label: 'Lime',     accent: '132 204 22',  hover: '77 124 15',   light: '163 230 53'  },
  yellow:  { label: 'Yellow',   accent: '234 179 8',   hover: '161 98 7',    light: '250 204 21'  },
  amber:   { label: 'Amber',    accent: '245 158 11',  hover: '180 83 9',    light: '252 211 77'  },
  orange:  { label: 'Orange',   accent: '249 115 22',  hover: '194 65 12',   light: '251 146 60'  },
  slate:   { label: 'Slate',    accent: '100 116 139', hover: '51 65 85',    light: '148 163 184' },
  brown:   { label: 'Brown',    accent: '150 100 60',  hover: '100 60 25',   light: '190 140 100' },
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({ ...DEFAULTS })
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (!window.electronAPI) { setHydrated(true); return }
    window.electronAPI.settingsGet().then(s => {
      if (s) setSettings({ ...DEFAULTS, ...s })
      setHydrated(true)
    }).catch(() => setHydrated(true))
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', settings.theme !== 'light')
    root.classList.toggle('amoled', settings.theme === 'amoled')
    root.classList.toggle('material', settings.theme === 'material')
    root.classList.toggle('music-apple', settings.musicStyle === 'apple')
  }, [settings.theme, settings.musicStyle])

  useEffect(() => {
    const preset = ACCENT_PRESETS[settings.accentColor] || ACCENT_PRESETS.red
    const root = document.documentElement
    root.style.setProperty('--accent', preset.accent)
    root.style.setProperty('--accent-hover', preset.hover)
    root.style.setProperty('--accent-light', preset.light)
  }, [settings.accentColor])

  const updateSetting = useCallback(async (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      if (window.electronAPI) window.electronAPI.settingsSet({ [key]: value }).catch(() => {})
      return next
    })
  }, [])

  const updateSettings = useCallback(async (patch) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      if (window.electronAPI) window.electronAPI.settingsSet(patch).catch(() => {})
      return next
    })
  }, [])

  const toggleTheme = useCallback(async () => {
    setSettings(prev => {
      const order = ['light', 'dark', 'amoled', 'material']
      const nextTheme = order[(order.indexOf(prev.theme) + 1) % order.length] || 'dark'
      if (window.electronAPI) window.electronAPI.settingsSet({ theme: nextTheme }).catch(() => {})
      return { ...prev, theme: nextTheme }
    })
  }, [])

  const isDark = settings.theme !== 'light'

  return (
    <SettingsContext.Provider value={{ settings, isDark, hydrated, updateSetting, updateSettings, toggleTheme }}>
      {children}
    </SettingsContext.Provider>
  )
}
