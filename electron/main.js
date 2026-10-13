const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, session, protocol, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { spawn, execFile } = require('child_process')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

// Keep the Chromium profile (~/.config/kovatube) separate from the app's own
// data dir (~/.config/Kovatube), and stable between dev and packaged builds.
app.setPath('userData', path.join(app.getPath('appData'), 'kovatube'))

protocol.registerSchemesAsPrivileged([
  { scheme: 'ytfile', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
])

process.on('uncaughtException', (err) => {
  console.error('[App] Uncaught exception:', err && err.message ? err.message : err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[App] Unhandled rejection:', reason && reason.message ? reason.message : reason)
})

const CONFIG_DIR = path.join(os.homedir(), '.config', 'Kovatube')
const DOWNLOADS_DIR = path.join(CONFIG_DIR, 'downloads')
const THUMBS_DIR = path.join(CONFIG_DIR, 'thumbs')
const STREAM_CACHE_DIR = path.join(CONFIG_DIR, 'cache')

let visitorData = ''

// Session cache for search results so repeated FYP / Home loads don't re-hit the
// network for the same query. Keyed by normalized query, cleared on refresh.
const SEARCH_CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const searchCache = new Map() // query -> { ts, videos, shorts }

async function cachedSearchYouTube(query, vData) {
  const key = (query || '').trim().toLowerCase()
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL) {
    return { videos: hit.videos, shorts: hit.shorts, error: null }
  }
  const r = await searchYouTube(query, vData)
  if (r && !r.error && (r.videos?.length || r.shorts?.length)) {
    searchCache.set(key, { ts: Date.now(), videos: r.videos || [], shorts: r.shorts || [] })
  }
  return r
}

function clearSearchCache() {
  searchCache.clear()
}

function ensureDirectories() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })
  if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true })
  if (!fs.existsSync(STREAM_CACHE_DIR)) fs.mkdirSync(STREAM_CACHE_DIR, { recursive: true })
}

// ─── YouTube Innertube API ───────────────────────────────────────────────────

const YOUTUBE_SEARCH_URL = 'https://www.youtube.com/youtubei/v1/search'
const YOUTUBE_BROWSE_URL = 'https://www.youtube.com/youtubei/v1/browse'
const YOUTUBE_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player'
const YOUTUBE_OEMBED_URL = 'https://www.youtube.com/oembed'
const YOUTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const WEB_CLIENT = { clientName: 'WEB', clientVersion: '2.20231219.04.00', hl: 'en', gl: 'US' }
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function ytPost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function ytGet(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function ytGetText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: 'SOCS=CAI' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}

// ─── Google/YouTube sign-in: capture authenticated cookies + personalized feed ──
// The app signs the user into Google via a child BrowserWindow. Because that
// window shares session.defaultSession, the resulting auth cookies land in the
// same session the app uses. We harvest them, persist them (encrypted when
// possible), and replay them against the innertube "browse" (FEED_HOME) endpoint
// with a SAPISIDHASH signature to retrieve the user's REAL personalized feed.
// Cookies rotate/expire, so when a request 4xxs we invalidate auth and fall back.

const AUTH_PATH = path.join(CONFIG_DIR, 'auth.bin')

// The minimal set of cookies required for an authenticated innerTube session.
const AUTH_COOKIE_KEYS = [
  '__Secure-1PSID', '__Secure-3PSID', 'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
  '__Secure-1PAPISID', '__Secure-3PAPISID', 'SIDCC', '__Secure-3PSIDCC', 'LOGIN_INFO',
  'PREF', 'VISITOR_INFO1_LIVE', 'CONSENT', 'SOCS',
]

const auth = {
  cookies: '',        // "k=v; k2=v2; ..." header string
  cookiesByKey: {},   // key -> last cookie value (used for SASAPISIDHASH + account)
  account: null,      // { name, channelId, avatar, handle }
  updatedAt: 0,
}

function persistAuth() {
  const payload = JSON.stringify({ cookies: auth.cookies, account: auth.account, updatedAt: Date.now() })
  try {
    let data = Buffer.from(payload, 'utf-8')
    if (safeStorage.isEncryptionAvailable()) {
      data = Buffer.concat([Buffer.from('ENC1'), safeStorage.encryptString(payload)])
    }
    fs.writeFileSync(AUTH_PATH, data)
  } catch (e) {
    console.error('[Auth] persist error:', e.message)
  }
}

function loadAuth() {
  try {
    if (!fs.existsSync(AUTH_PATH)) return false
    const buf = fs.readFileSync(AUTH_PATH)
    let payload = null
    if (buf.slice(0, 4).toString('utf-8') === 'ENC1') {
      const enc = buf.slice(4)
      if (safeStorage.isEncryptionAvailable()) payload = safeStorage.decryptString(enc)
    } else {
      payload = buf.toString('utf-8')
    }
    if (!payload) return false
    const saved = JSON.parse(payload)
    auth.cookies = saved.cookies || ''
    auth.account = saved.account || null
    auth.updatedAt = saved.updatedAt || 0
    rebuildAuthKeys()
    return true
  } catch (e) {
    console.error('[Auth] load error:', e.message)
    auth.cookies = ''
    auth.account = null
    return false
  }
}

function rebuildAuthKeys() {
  auth.cookiesByKey = {}
  for (const part of auth.cookies.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) auth.cookiesByKey[k] = v
  }
}

function clearAuth() {
  auth.cookies = ''
  auth.cookiesByKey = {}
  auth.account = null
  auth.updatedAt = 0
  signedSubsCache = { ts: 0, subscriptions: [] }
  signedFeedCache = { ts: 0, videos: [], continuation: '', hasMore: true }
  channelInfoCache.clear()
  try { if (fs.existsSync(AUTH_PATH)) fs.unlinkSync(AUTH_PATH) } catch (e) { /* ignore */ }
}

// A single hidden BrowserWindow used to run authenticated innertube requests
// from inside a real youtube.com page. Because it shares session.defaultSession
// with the sign-in child window, Chromium attaches the correct cookies and the
// SAPISIDHASH authorization automatically — exactly like a real logged-in
// browser tab. This is far more reliable than reconstructing cookie/auth headers
// manually or via net.fetch, both of which were rejected by YouTube.
let authedWin = null
let authedWinPromise = null
async function ensureAuthedWindow() {
  if (authedWinPromise) return authedWinPromise
  authedWinPromise = (async () => {
    if (authedWin && !authedWin.isDestroyed()) {
      const url = authedWin.webContents.getURL()
      if (url && url.includes('youtube.com')) return authedWin
      try { await authedWin.loadURL('https://www.youtube.com/') } catch (e) { /* retry below */ }
      return authedWin
    }
    authedWin = new BrowserWindow({
      show: false,
      width: 900, height: 1200,
      webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
    })
    authedWin.on('closed', () => { authedWin = null })
    try { authedWin.webContents.setBackgroundThrottling(false) } catch (e) { /* ignore */ }
    try { await authedWin.loadURL('https://www.youtube.com/') } catch (e) { /* ignore */ }
    return authedWin
  })().finally(() => { authedWinPromise = null })
  return authedWinPromise
}

// Handle an authenticated POST to the innertube browse endpoint by running fetch
// inside the hidden youtube.com page. We pull the page's own live ytcfg client
// info so the clientVersion is never stale/blacklisted, and we mirror the real
// page's request headers (X-YouTube-Client-*) so YouTube accepts the call. The
// page context also makes Chromium attach cookies + SAPISIDHASH automatically.
async function authedBrowse(body) {
  const win = await ensureAuthedWindow()
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      try {
        const cfg = (window.ytcfg && window.ytcfg.get) ? window.ytcfg.get('INNERTUBE_CONTEXT') || {} : {}
        const client = cfg.client || {}
        const clientName = client.clientName || 'WEB'
        const clientVersion = client.clientVersion || '2.20231219.04.00'
        const apiKey = (window.ytcfg && window.ytcfg.get && window.ytcfg.get('INNERTUBE_API_KEY')) || ${JSON.stringify(YOUTUBE_KEY)}
        let body = JSON.parse(${JSON.stringify(JSON.stringify(body))})
        // Merge the page's real INNERTUBE_CONTEXT (visitorData, device, userAgent…)
        // so continuation/session endpoints return the full personalized feed
        // instead of 0 items. Keeps any caller-supplied context/client fields on top.
        if (!body.context) body.context = {}
        body.context = Object.assign({}, cfg, body.context)
        if (body.context.client && typeof body.context.client === 'object') {
          body.context.client = Object.assign({}, cfg.client || {}, body.context.client)
        } else {
          body.context.client = cfg.client || {}
        }
        if (!body.context.client.clientName) body.context.client.clientName = 'WEB'
        if (!body.context.client.clientVersion) body.context.client.clientVersion = '2.20231219.04.00'
        const res = await fetch(${JSON.stringify(YOUTUBE_BROWSE_URL + '?prettyPrint=false')} + '&key=' + encodeURIComponent(apiKey), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': clientVersion,
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com/',
          },
          credentials: 'include',
          body: JSON.stringify(body),
        })
        const text = await res.text()
        return { ok: res.ok, status: res.status, text: text }
      } catch (e) {
        return { ok: false, status: 0, text: String(e && e.message || e) }
      }
    })()
  `).then(v => v && v.value !== undefined ? v.value : v, err => {
    console.error('[Auth] executeJavaScript error:', err.message)
    return { ok: false, status: 0, text: '' }
  })
  return {
    ok: !!(result && result.ok),
    status: (result && result.status) || 0,
    text: async () => (result && result.text) || '',
    json: async () => { try { return JSON.parse((result && result.text) || '') } catch (e) { return null } },
  }
}

// Parse the account_menu innertube response into { name, avatar, handle,
// channelId, email }. Structure varies between YouTube versions so we (1) walk
// the accountMenuHeaderRenderer subtree, (2) generic-walk the whole JSON for any
// displayName/accountName/email/channelId shapes, and (3) fall back to regexes.
function parseAccountMenu(parsed) {
  const acc = { name: '', avatar: '', handle: '', channelId: '', email: '' }
  const pickText = (v) => {
    if (!v) return ''
    if (typeof v === 'string') return v
    if (typeof v.content === 'string') return v.content
    if (typeof v.simpleText === 'string') return v.simpleText
    if (Array.isArray(v.runs)) return v.runs.map(r => r.text).join('')
    return ''
  }
  try {
    const head = parsed && parsed.accountMenuHeaderRenderer
    const list = head && head.content && head.content.accountSectionListRenderer && head.content.accountSectionListRenderer.contents
    if (Array.isArray(list)) {
      for (const item of list) {
        const header = item && item.accountItemSectionHeaderRenderer
        if (!header) continue
        if (!acc.name) acc.name = pickText(header.displayName)
        if (!acc.email) acc.email = pickText(header.email)
        const imgs = header.contentImages || []
        for (const im of imgs) {
          const srcs = (im && im.accountPhoto && im.accountPhoto.image && im.accountPhoto.image.sources) || []
          if (srcs.length && srcs[srcs.length - 1] && srcs[srcs.length - 1].url) acc.avatar = srcs[srcs.length - 1].url
        }
        const items = header.accountItem || []
        for (const it of items) {
          const r = it && it.accountItemRenderer
          if (!r) continue
          if (!acc.channelId && /^UC[A-Za-z0-9_-]+$/.test(r.channelId || '')) acc.channelId = r.channelId
          if (!acc.name) acc.name = pickText(r.displayName)
          if (!acc.name) acc.name = pickText(r.title)
          const thumbs = (r.accountPhoto && r.accountPhoto.thumbnails) || []
          if (thumbs.length && thumbs[thumbs.length - 1] && thumbs[thumbs.length - 1].url) acc.avatar = thumbs[thumbs.length - 1].url
        }
      }
    }
  } catch (e) { console.log('[Auth] parseAccountMenu walk error:', e.message) }

  // Generic deep walk of the whole response: YouTube's menu shape (and field
  // names) shifts between versions, so grab the first string values that look
  // like an account display name / email / channel id that we find.
  if (!acc.name || !acc.avatar || !acc.channelId || !acc.email) {
    const seen = { name: acc.name, email: acc.email, channelId: acc.channelId }
    try {
      const visit = (node) => {
        if (!node || typeof node !== 'object') return
        if (!seen.name && typeof node.displayName === 'object') {
          seen.name = pickText(node.displayName)
        }
        if (!seen.name && typeof node.accountName === 'object') {
          seen.name = pickText(node.accountName)
        }
        if (!seen.name && typeof node.displayName === 'string' && node.displayName.indexOf('@') !== 0) {
          seen.name = node.displayName
        }
        if (!seen.email && (typeof node.email === 'object' || typeof node.email === 'string')) {
          const t = pickText(node.email)
          if (t && t.indexOf('@') > 0) seen.email = t
        }
        if (!seen.channelId && typeof node.channelId === 'string' && /^UC[A-Za-z0-9_-]+$/.test(node.channelId)) {
          seen.channelId = node.channelId
        }
        for (const k of Object.keys(node)) {
          const v = node[k]
          if (v && typeof v === 'object') visit(v)
        }
      }
      visit(parsed)
      acc.name = seen.name || acc.name
      acc.email = seen.email || acc.email
      acc.channelId = seen.channelId || acc.channelId
    } catch (e) { console.log('[Auth] parseAccountMenu deep walk error:', e.message) }
  }

  // Failsafe regexes against the raw JSON in case the subtree shape changes.
  try {
    const raw = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
    if (!acc.avatar) {
      const m = raw.match(/"accountPhoto":\{"image":\{"sources":\[\{"url":"(https:[^"]+)"/) ||
                raw.match(/"accountPhoto":\{"sources":\[\{"url":"(https:[^"]+)"/) ||
                raw.match(/"accountPhoto":\{"thumbnails":\[\{"url":"(https:[^"]+)"/)
      if (m) acc.avatar = m[1]
    }
    if (!acc.name) {
      const m = raw.match(/"displayName":\{"content":"([^"]+)"/) ||
                raw.match(/"displayName":\{"simpleText":"([^"]+)"/) ||
                raw.match(/"accountName":\{"content":"([^"]+)"/) ||
                raw.match(/"name":"([^"]+)"/)
      if (m) acc.name = m[1]
    }
    if (!acc.handle) {
      const m = raw.match(/"title":"(@[^"]+)"/) || raw.match(/"displayName":"(@[^"]+)"/)
      if (m) acc.handle = m[1]
    }
    if (!acc.channelId) {
      const m = raw.match(/"channelId":"(UC[^"]+?)"/)
      if (m) acc.channelId = m[1]
    }
  } catch (e) { /* ignore */ }
  return acc
}

// Query the signed-in account's name/photo/handle via the same innertube
// account_menu endpoint the topbar chrome uses. Runs inside the hidden youtube
// page so Chromium attaches cookies + SAPISIDHASH automatically, exactly like
// authedBrowse(). This is the authoritative source for the profile picture and
// the @username — the homepage DOM alone does not expose them reliably.
async function authedAccountMenu(win) {
  if (!win) win = await ensureAuthedWindow()
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      try {
        const cfg = (window.ytcfg && window.ytcfg.get) ? window.ytcfg.get('INNERTUBE_CONTEXT') || {} : {}
        const client = cfg.client || {}
        const clientName = client.clientName || 'WEB'
        const clientVersion = client.clientVersion || '2.20231219.04.00'
        const apiKey = (window.ytcfg && window.ytcfg.get && window.ytcfg.get('INNERTUBE_API_KEY')) || ${JSON.stringify(YOUTUBE_KEY)}
        const res = await fetch('https://www.youtube.com/youtubei/v1/account/account_menu?key=' + encodeURIComponent(apiKey), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': clientVersion,
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com/',
          },
          credentials: 'include',
          body: JSON.stringify({ context: Object.assign({}, cfg, { client: Object.assign({ clientName: clientName, clientVersion: clientVersion, hl: 'en', gl: 'US' }, client) }) }),
        })
        const text = await res.text()
        return { ok: res.ok, status: res.status, text }
      } catch (e) {
        return { ok: false, status: 0, text: String(e && e.message || e) }
      }
    })()
  `).then(v => v && v.value !== undefined ? v.value : v, err => {
    console.error('[Auth] account_menu executeJavaScript error:', err.message)
    return { ok: false, status: 0, text: '' }
  })

  if (!result || !result.ok) {
    console.log('[Auth] account_menu HTTP', result && result.status || 0)
    return { error: 'account_menu failed' }
  }
  try {
    const parsed = JSON.parse(result.text)
    const acc = parseAccountMenu(parsed)
    if (!acc.name && !acc.avatar && !acc.channelId) {
      console.log('[Auth] account_menu returned no account fields. Top keys:', Object.keys(parsed || {}).slice(0, 12).join(','), '| sample:', String(result.text).slice(0, 200))
    }
    return acc
  } catch (e) {
    console.log('[Auth] account_menu parse error:', e.message, '| sample:', String(result.text).slice(0, 200))
    return { error: 'account_menu parse error' }
  }
}

// Tear down the hidden auth window (e.g. on sign-out).
function destroyAuthedWindow() {
  try { if (authedWin && !authedWin.isDestroyed()) authedWin.destroy() } catch (e) { /* ignore */ }
  authedWin = null
}

// Read the logged-in cookies out of Electron's default session and store them.
async function captureCookiesFromSession() {
  try {
    const all = await session.defaultSession.cookies.get({ domain: '.youtube.com' })
    if (!all || !all.length) {
      // Try the broader google.com set too (accounts.google.com).
      const google = await session.defaultSession.cookies.get({})
      const merged = all.concat(google)
      return bakeCookies(merged)
    }
    return bakeCookies(all)
  } catch (e) {
    console.error('[Auth] cookie capture error:', e.message)
    return false
  }
}

function bakeCookies(cookies) {
  const byKey = {}
  for (const c of cookies) {
    const key = c.name
    if (AUTH_COOKIE_KEYS.includes(key) && !byKey[key]) byKey[key] = c.value
    if (key === 'SAPISID' || key === '__Secure-1PSID' || key === 'SID') byKey[key] = c.value
  }
  const haveAuth = !!(byKey['SAPISID'] && (byKey['__Secure-1PSID'] || byKey['SID'] || byKey['HSID']))
  if (!haveAuth) return false
  auth.cookiesByKey = byKey
  auth.cookies = Object.entries(byKey).map(([k, v]) => `${k}=${v}`).join('; ')
  auth.updatedAt = Date.now()
  return true
}

// Open a Google sign-in window. The Google login itself only sets google.com
// cookies; YouTube's innertube feed additionally needs the session established
// on the youtube.com domain. So we: 1) let the user log in to Google, 2) once a
// Google session cookie appears, redirect the window to youtube.com to complete
// the YouTube side of the session (this sets the youtube.com-domain cookies),
// 3) wait for that page to finish loading, 4) harvest the cookies, and 5) verify
// them with a real innertube probe before considering the login a success.
function openSignInWindow() {
  return new Promise((resolve) => {
    let done = false
    let redirectedToYouTube = false
    const finish = (ok) => { if (!done) { done = true; resolve(ok) } }
    const win = new BrowserWindow({
      width: 480, height: 640, minWidth: 360, minHeight: 480,
      parent: mainWindow || undefined,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    win.loadURL('https://accounts.google.com/')

    // After the user has finished Google login and the child window has
    // redirected to youtube.com (which loads successfully and sets the YouTube
    // session cookies), treat the presence of those session cookies as the
    // definitive "signed in" signal — the same test YouTube's own UI uses. We
    // scrape the account name/avatar straight off this window (it is already on
    // youtube.com) without bouncing to a separate probe navigation, so the
    // login finishes the moment the page is usable.
    async function verifyAndFinish() {
      const cookies = await captureCookiesFromSession()
      if (!cookies) {
        console.log('[Auth] no usable youtube session cookies yet')
        return false
      }
      // Give the page a moment to hydrate ytInitialData before scraping.
      const deadline = Date.now() + 6000
      while (Date.now() < deadline) {
        if (await pageReady(win)) break
        await new Promise(r => setTimeout(r, 250))
      }
      try {
        const res = await scrapeSignedAccount(win)
        let menuAcc = {}
        try {
          menuAcc = await authedAccountMenu(win)
          console.log('[Auth] sign-in account_menu result:', JSON.stringify(menuAcc))
        } catch (e) { console.log('[Auth] sign-in account_menu error:', e.message) }
        const prev = auth.account || {}
        auth.account = {
          name: res.displayName || menuAcc.name || prev.name || '',
          avatar: res.avatarUrl || menuAcc.avatar || prev.avatar || '',
channelId: menuAcc.channelId || result.channelId || prev.channelId || '',
          handle: menuAcc.handle || res.displayName || prev.handle || '',
          email: menuAcc.email || prev.email || '',
        }
        console.log('[Auth] sign-in account:', JSON.stringify(auth.account))
      } catch (e) {
        console.log('[Auth] sign-in account scrape error:', e.message)
      }
      persistAuth()
      finish(true)
      setTimeout(() => { try { win.close() } catch (e) {} }, 400)
      return true
    }

    const poll = setInterval(async () => {
      if (done) return
      // Step 1: wait for a Google session cookie to appear after login.
      if (!redirectedToYouTube) {
        const g = await session.defaultSession.cookies.get({ domain: '.google.com' })
        const hasGoogle = g && g.some(c => c.name === 'SAPISID' || c.name === '__Secure-1PSID' || c.name === 'SID')
        if (hasGoogle) {
          redirectedToYouTube = true
          try { await win.loadURL('https://www.youtube.com/feed/subscriptions') } catch (e) { /* ignore */ }
        }
        return
      }
      // Step 2: after the youtube.com page has loaded, verify the session works.
      if (await verifyAndFinish()) clearInterval(poll)
    }, 800)

    // Re-verify once the youtube.com page has finished loading.
    win.webContents.on('did-finish-load', async () => {
      if (done || !redirectedToYouTube) return
      const url = win.webContents.getURL()
      if (url && url.includes('youtube.com')) {
        if (await verifyAndFinish()) clearInterval(poll)
      }
    })

    win.on('closed', () => {
      clearInterval(poll)
      finish(!!(auth.cookiesByKey['SAPISID'] && auth.cookiesByKey['__Secure-3PSID']))
    })
    win.on('page-title-updated', (_e, t) => win.setTitle(t || 'Sign in with Google'))
  })
}

// Light probe that the stored session still authenticates us. The decisive
// signal is the presence of a logged-in YouTube session cookie in the browser
// jar; we then try a lightweight browse to pull account name/avatar from the
// response. (The FEED_HOME browseId is rejected by YouTube, so we use a channel
// browse — that endpoint does work.)
// Scrape account name/avatar from a loaded, signed-in youtube.com page. Precise
// topbar selectors run first, then the authoritative account photo/name embedded
// in ytInitialData, and only as a last resort a broad scan of ggpht images — so
// a recommendation channel's avatar can never win over the real account photo.
async function scrapeSignedAccount(win) {
  const scrape = await win.webContents.executeJavaScript(`(async () => {
    try {
      const out = { avatarUrl: '', displayName: '', handle: '', channelId: '', email: '' }

      const pickImg = (sel) => {
        try {
          const el = document.querySelector(sel)
          if (!el) return ''
          let s = el.getAttribute('src') || el.currentSrc || el.src || el.getAttribute('srcset') || ''
          if (!s) return ''
          s = String(s).trim()
          if (s.startsWith('data:') || s.startsWith('blob:')) return ''
          return s.split(' ')[0]
        } catch (e) { return '' }
      }
      const avatarSelectors = [
        'button#avatar-btn img',
        'ytd-topbar-menu-button-renderer img',
        'ytd-topbar-menu-button-renderer yt-img-shadow img',
        'yt-img-shadow#avatar img',
        '#avatar img',
        'img.yt-spec-avatar-shape__avatar',
      ]
      for (const sel of avatarSelectors) {
        const s = pickImg(sel)
        if (s) { out.avatarUrl = s; break }
      }

      // Authoritative-ish account photo/name straight from the page's embedded
      // data (object traversal — no regex so nothing can be mangled by escaping).
      try {
        let photo = '', name = ''
        const walk = (node) => {
          if (!node || typeof node !== 'object') return
          if (!photo && node.accountPhotoRenderer) {
            const ap = node.accountPhotoRenderer
            const srcs = (ap.photo && ap.photo.image && ap.photo.image.sources) ||
                         (ap.photo && ap.photo.thumbnails) ||
                         (ap.accountPhoto && ap.accountPhoto.thumbnails) || []
            if (srcs.length) photo = srcs[srcs.length - 1].url || ''
          }
          if (!name && node.accountNameRenderer) name = node.accountNameRenderer.name || ''
          for (const k of Object.keys(node)) {
            const v = node[k]
            if (v && typeof v === 'object') walk(v)
          }
        }
        walk(window.ytInitialData)
        if (!out.avatarUrl && photo) out.avatarUrl = photo
        if (name) out.displayName = name
      } catch (e) {}

      // Fallback name selectors that are present without opening the menu.
      if (!out.displayName) {
        for (const sel of ['#text.ytd-account-name', 'yt-formatted-string#account-name', 'yt-formatted-string.ytd-account-name']) {
          try {
            const el = document.querySelector(sel)
            if (el) { const t = (el.textContent || '').trim(); if (t) { out.displayName = t; break } }
          } catch (e) {}
        }
      }

      // Last resort: open the account menu overlay and read the name/handle/photo
      // the way the YouTube UI itself displays them, then close it again.
      if (!out.displayName || !out.avatarUrl || !out.handle) {
        try {
          const btn = document.querySelector('button#avatar-btn') ||
                      document.querySelector('ytd-topbar-menu-button-renderer button') ||
                      document.querySelector('#avatar-btn')
          if (btn) btn.click()
          await new Promise(r => setTimeout(r, 900))
          const menu = document.querySelector('ytd-account-menu-renderer, tp-yt-paper-listbox#items, ytd-multi-page-menu-renderer')
          if (menu) {
            if (!out.displayName) {
              for (const sel of ['#account-name', 'yt-formatted-string#account-name', '#channel-handle', 'yt-formatted-string#channel-handle', 'ytd-active-account-header-renderer #account-name']) {
                const el = menu.querySelector(sel)
                if (el) { const t = (el.textContent || '').trim(); if (t) { out.displayName = t; break } }
              }
            }
            if (!out.handle) {
              const h = menu.querySelector('#channel-handle, yt-formatted-string#channel-handle')
              if (h) out.handle = (h.textContent || '').trim()
            }
            if (!out.avatarUrl) {
              const im = menu.querySelector('img')
              if (im) {
                const s = im.getAttribute('src') || ''
                if (s && !s.startsWith('data:') && !s.startsWith('blob:')) out.avatarUrl = s
              }
            }
            // "Your channel" link → channel id / handle path for the fallback fetch.
            if (!out.channelId && !out.handle) {
              const cl = menu.querySelector('a[href*="/channel/UC"]') || menu.querySelector('a[href^="/@"]')
              if (cl) {
                const href = cl.getAttribute('href') || ''
                if (href.indexOf('/channel/UC') >= 0) {
                  const seg = href.split('/channel/')[1] || ''
                  out.channelId = (seg.split('?')[0] || '').split('/')[0]
                } else if (href.indexOf('/@') === 0) {
                  out.handle = href.split('?')[0] || ''
                }
              }
            }
            // Casting/keep the avatar button pressed state clean.
            try {
              const open = document.querySelector('ytd-account-menu-renderer[aria-hidden="false"], ytd-account-menu-renderer:not([aria-hidden])')
              if (open) {
                const esc = document.createEvent('KeyboardEvent')
                try { esc.initEvent('keydown', true, true); Object.defineProperty(esc, 'key', { value: 'Escape' }); document.body.dispatchEvent(esc) } catch (e2) {}
              }
            } catch (e3) {}
          }
          if (btn) btn.click()
        } catch (e) {}
      }

      // If still nothing, we intentionally DON'T scan all page images for ggpht
      // URLs — that picks up video thumbnails / recommendation avatars and causes
      // the PFP to cycle randomly. The authoritative sources are:
      // 1) topbar DOM selectors, 2) ytInitialData accountPhotoRenderer,
      // 3) account_menu overlay, 4) account_menu innertube endpoint,
      // 5) own channel page fallback.

      try { out.loggedIn = !!(window.ytcfg && window.ytcfg.get && window.ytcfg.get('LOGGED_IN')) } catch (e) {}
      out.pageTitle = document.title || ''
      out.url = location.href
      return out
    } catch (e) { return { avatarUrl: '', displayName: '', error: String(e && e.message || e) } }
  })()`, true).catch(e => {
    console.log('[Auth] scrapeSignedAccount: executeJavaScript error:', e.message)
    return { avatarUrl: '', displayName: '', error: e.message }
  })
  return (scrape && scrape.value !== undefined ? scrape.value : scrape) || {}
}

// Light probe that the stored session still authenticates us. The decisive
// signal is the presence of a logged-in YouTube session cookie in the browser
// jar; we then scrape the account name/avatar off the signed-in homepage.
// When `background` is set the account is persisted too, so the PFP shows
// instantly on the next launch without waiting on this probe.
async function probeAuth({ background = false } = {}) {
  try {
    const ytCookies = await session.defaultSession.cookies.get({ domain: '.youtube.com' })
    const have = ytCookies && ytCookies.some(c =>
      c.name === '__Secure-1PSID' || c.name === 'SAPISID' || c.name === 'LOGIN_INFO' || c.name === 'SID')
    if (!have) { console.log('[Auth] probeAuth: no auth cookies'); return { signedIn: false, account: auth.account || null } }
    console.log(`[Auth] probeAuth: found auth cookies${background ? ' (background)' : ''}`)

    const win = await getSignedHomepage()

    // Poll the scrape until the topbar account is actually on screen — ytInitialData
    // can be ready before the header DOM (and the avatar <img>) finishes rendering.
    let result = {}
    const glanceDeadline = Date.now() + 6000
    while (Date.now() < glanceDeadline) {
      try {
        result = await scrapeSignedAccount(win)
      } catch (e) {
        console.log('[Auth] probeAuth scrape error, retrying:', e.message)
        result = {}
      }
      if (result && (result.avatarUrl || result.displayName)) break
      await new Promise(r => setTimeout(r, 400))
    }
    console.log('[Auth] probeAuth DOM scrape result:', JSON.stringify(result))

    // Authoritative account name/@handle/photo from the account_menu endpoint the
    // topbar itself uses. Fills any gaps the DOM scrape left (username especially).
    let menuAcc = {}
    try {
      menuAcc = await authedAccountMenu()
      console.log('[Auth] probeAuth account_menu result:', JSON.stringify(menuAcc))
    } catch (e) {
      console.log('[Auth] account_menu probe error:', e.message)
    }

    const prev = auth.account || {}
    const account = {
      name: result.displayName || menuAcc.name || prev.name || '',
      avatar: result.avatarUrl || menuAcc.avatar || prev.avatar || '',
      channelId: menuAcc.channelId || prev.channelId || '',
      handle: menuAcc.handle || result.handle || prev.handle || '',
      email: menuAcc.email || prev.email || '',
    }

    // Final authority when the DOM/menu left gaps: fetch the account's own channel
    // page (name, avatar, @handle are guaranteed on it) and fill what's missing.
    if ((!account.name || !account.avatar) && (account.channelId || account.handle)) {
      try {
        const path = account.channelId
          ? '/channel/' + account.channelId
          : ((account.handle || '').indexOf('/') === 0 ? account.handle : '/' + (account.handle || ''))
        const own = await getChannelInfoByPath(path)
        if (own) {
          if (!account.name) account.name = own.name || ''
          if (!account.avatar) account.avatar = own.avatar || ''
          if (!account.handle) account.handle = own.handle || ''
          if (!account.channelId) account.channelId = own.channelId || ''
        }
      } catch (e) {
        console.log('[Auth] probeAuth own-channel fallback error:', e.message)
      }
    }

    if (account.name || account.avatar) {
      const changed = account.name !== prev.name || account.avatar !== prev.avatar || account.handle !== prev.handle
      auth.account = account
      // Persist whenever we run in the background so the PFP/name is available
      // instantly on future launches (no probe round-trip needed).
      if (changed || background) persistAuth()
    }
    console.log('[Auth] probeAuth final account:', JSON.stringify(account))
    return { signedIn: true, account }
  } catch (e) {
    console.error('[Auth] probe error:', e.message)
    return { signedIn: false, account: auth.account || null }
  }
}

// Extract the signed-in account's channel handle/name/avatar from a browse response.
function parseAccountFromBrowse(data) {
  try {
    let channelId = ''
    let avatar = ''
    let name = ''
    const raw = JSON.stringify(data)

    // 1) accountHeaderRenderer carries the logged-in Google account (name + photo).
    const ahr = data?.accountHeader?.accountHeaderRenderer ||
                findKey(data, 'accountHeaderRenderer')
    if (ahr) {
      const an = ahr.accountName?.accountNameRenderer
      if (an) {
        if (an.name) name = an.name
        if (an.channelId) channelId = an.channelId
      }
      const ar = ahr.accountPhoto?.accountPhotoRenderer ||
                 ahr.photo?.accountPhotoRenderer
      const src = ar?.photo?.image?.sources || ar?.photo?.thumbnails || ar?.thumbnails
      if (src && src.length) avatar = src[src.length - 1].url || src[0].url || ''
    }

    // 2) The channel header (when navigating to /account or a channel browse).
    if (!name || !avatar) {
      const header = data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel ||
                     data?.header?.c4TabbedHeaderRenderer
      if (header) {
        if (!name) name = header.pageTitle?.content || header.title || ''
        if (!avatar) {
          const a = header.avatar?.image?.sources?.[0]?.url || header.avatar?.thumbnails?.[0]?.url || ''
          if (a) avatar = a
        }
      }
    }

    // 3) Channel id from navigation endpoints anywhere in the tree
    if (!channelId) {
      const m = raw.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/)
      if (m) channelId = m[1]
    }
    if (!name) {
      const nm = raw.match(/"canonicalBaseUrl":"\/@([^"]+)"/)
      if (nm) name = '@' + nm[1]
    }

    // 4) Avatar fallback: first plausible image that looks like a profile picture.
    if (!avatar) {
      const av = raw.match(/"accountPhotoRenderer":\{"photo":\{"image":\{"sources":\[\{"url":"(https:[^"]+)"\}/)
      if (av) avatar = av[1]
    }

    return { name, channelId, avatar, handle: name || channelId || 'Google Account' }
  } catch (e) {
    return null
  }
}

// Deep-search for the first object with the given key in a parsed JSON tree.
function findKey(node, key) {
  if (!node || typeof node !== 'object') return null
  if (node[key]) return node[key]
  for (const k of Object.keys(node)) {
    const r = findKey(node[k], key)
    if (r) return r
  }
  return null
}

// Extract plain text from a lockup metadata part (channel, views, date).
function lockupText(part) {
  if (!part) return ''
  return part.text?.content || part.text?.contentText || ''
}

// Parse a lockupViewModel (YouTube's current home/feed item format) into a flat
// video object using the same field names as parseSearchResults. Returns null if
// the node isn't a video lockup.
function parseLockupVideo(lvm) {
  if (!lvm || typeof lvm !== 'object') return null
  if (lvm.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null

  // Video ID: prefer contentId, fall back to the watch endpoint in the tap command.
  let id = lvm.contentId || ''
  const tapCmd = lvm.rendererContext?.commandContext?.onTap?.innertubeCommand
  if (!id && tapCmd?.watchEndpoint?.videoId) id = tapCmd.watchEndpoint.videoId
  if (!id) return null

  const meta = lvm.metadata?.lockupMetadataViewModel
  const title = (meta?.title?.content || meta?.title?.contentText || '').replace(/[\u200b\u200c\u200d\s]+/g, ' ').trim()
  if (!title) return null

  // Thumbnail from contentImage.thumbnailViewModel.image.sources
  let thumbnail = ''
  const sources = lvm.contentImage?.thumbnailViewModel?.image?.sources || []
  if (sources.length) thumbnail = sources[sources.length - 1].url || sources[0].url || ''

  // Duration from the bottom overlay badge(s) on the thumbnail. The badges live
  // on thumbnailViewModel.overlays (the "L1" level), not under image.
  let duration = ''
  const tv = lvm.contentImage?.thumbnailViewModel || {}
  const overlayLists = [tv.overlays || [], tv.image?.overlays || []]
  for (const list of overlayLists) {
    for (const ov of list) {
      const badge = ov?.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel
      if (badge?.text) { duration = badge.text; break }
    }
    if (duration) break
  }

  // Channel / views / published from metadata rows.
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || []
  let channel = ''
  let views = ''
  let publishedTime = ''
  for (let i = 0; i < rows.length; i++) {
    const parts = rows[i]?.metadataParts || []
    const texts = parts.map(lockupText).filter(Boolean)
    if (i === 0 && texts.length) {
      channel = texts[0]
    } else if (i >= 1) {
      for (const t of texts) {
        if (/views?/i.test(t)) views = t
        else if (/(ago|today|yesterday|now|Streamed|Premiered|\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago)/i.test(t)) publishedTime = t
      }
    }
  }
  if (!views && rows[1]) views = lockupText(rows[1].metadataParts?.[0]) || ''
  const isShort = false

  return {
    id,
    title,
    channel,
    views,
    duration,
    thumbnail,
    publishedTime,
    isShort,
    url: `https://www.youtube.com/watch?v=${id}`,
  }
}

// Parse a signed-in home ("FEED_HOME") browse response into flat video objects,
// reusing the same field names as parseSearchResults. Handles both the legacy
// videoRenderer items and YouTube's newer lockupViewModel format.
function parseHomeFeedResults(data) {
  const videos = []
  const seen = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    // Legacy videoRenderer
    const vr = node.videoRenderer
    if (vr && vr.videoId) {
      const thumbs = vr.thumbnail?.thumbnails || []
      const isShort = isShortResult(vr)
      if (!seen.has(vr.videoId)) {
        seen.add(vr.videoId)
        videos.push({
          id: vr.videoId,
          title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || '',
          channel: vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || '',
          views: vr.viewCountText?.simpleText || vr.viewCountText?.runs?.map(r => r.text).join('') || '',
          duration: vr.lengthText?.simpleText || '',
          thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
          publishedTime: vr.publishedTimeText?.simpleText || '',
          isShort,
          url: `https://www.youtube.com/watch?v=${vr.videoId}`,
        })
      }
    }
    // New lockupViewModel (current YouTube home feed format)
    if (node.lockupViewModel) {
      const v = parseLockupVideo(node.lockupViewModel)
      if (v && !seen.has(v.id)) {
        seen.add(v.id)
        videos.push(v)
      }
    }
    // Recurse
    const keys = Object.keys(node)
    for (const k of keys) {
      const v = node[k]
      if (v && typeof v === 'object') walk(v)
      else if (Array.isArray(v)) v.forEach(walk)
    }
  }
  if (data?.contents?.twoColumnBrowseResultsRenderer?.tabs) {
    for (const tab of data.contents.twoColumnBrowseResultsRenderer.tabs) {
      walk(tab)
    }
  } else {
    walk(data)
  }
  return videos
}

// Extract continuation from the innertube continuation response (appendContinuationItemsAction)
function extractContinuationFromResponse(data) {
  try {
    const actions = data?.onResponseReceivedActions || []
    for (const action of actions) {
      const items = action?.appendContinuationItemsAction?.continuationItems || []
      for (const item of items) {
        const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
        if (token) return token
      }
    }
    // Also check top-level continuations
    const walk = (node) => {
      if (!node || typeof node !== 'object') return null
      if (node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
        return node.continuationItemRenderer.continuationEndpoint.continuationCommand.token
      }
      for (const k of Object.keys(node)) {
        const v = node[k]
        if (v && typeof v === 'object') {
          const r = walk(v)
          if (r) return r
        } else if (Array.isArray(v)) {
          for (const item of v) {
            const r = walk(item)
            if (r) return r
          }
        }
      }
      return null
    }
    return walk(data)
  } catch (e) { return '' }
}

// Wait for a navigation inside the hidden auth window to finish loading.
function authedNavDone(win) {
  return new Promise((resolve) => {
    const to = setTimeout(() => resolve(), 15000)
    win.webContents.once('did-finish-load', () => { clearTimeout(to); resolve() })
    win.webContents.once('did-fail-load', () => { clearTimeout(to); resolve() })
  })
}

// ─── Shared signed-in homepage loader ────────────────────────────────────────
// Both probeAuth (account scrape) and signedHomeFeed (feed scrape) need the
// signed-in homepage in the hidden authed window. If the window is already on
// youtube.com with ytInitialData present we reuse it; otherwise we navigate once
// and poll for readiness (no fixed 2s sleep). Concurrent callers share a single
// in-flight load instead of navigating back-to-back.
let signedHomeInFlight = null

async function pageReady(win) {
  return await win.webContents.executeJavaScript(
    `!!(window.ytInitialData && Object.keys(window.ytInitialData).length)`,
  ).catch(() => false)
}

// The personalized home feed lives only at the bare site root. Every other
// youtube.com route (feed/channels, watch, search, ...) has its own
// ytInitialData, so the reusable homepage loader must never mistake those for it.
function isSignedHomeUrl(url) {
  return !!url && !!/^https:\/\/www\.youtube\.com(\/|\?|#|$)/i.exec(url)
}

// Shared loader for a fully-loaded, signed-in home feed page. Dedupes concurrent
// requests (signedHomeInFlight) and reuses an already-loaded home page so the
// feed + account are scrape-able without another navigation.
async function getSignedHomepage() {
  const win = await ensureAuthedWindow()
  if (signedHomeInFlight) return signedHomeInFlight
  const url = win.webContents.getURL()
  if (isSignedHomeUrl(url) && (await pageReady(win))) {
    console.log('[Auth] getSignedHomepage: reusing already-loaded page')
    return win
  }

  signedHomeInFlight = (async () => {
    win.webContents.stop()
    const done = authedNavDone(win)
    win.loadURL('https://www.youtube.com/')
    await done
    // Poll for ytInitialData instead of a fixed wait so it is scraped the moment
    // the personalized feed is usable.
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await pageReady(win)) break
      await new Promise(r => setTimeout(r, 250))
    }
    console.log('[Auth] getSignedHomepage: page URL:', win.webContents.getURL())
    // Correct a race where another task steered this window elsewhere mid-load.
    if (!isSignedHomeUrl(win.webContents.getURL()) && (await pageReady(win))) {
      console.log('[Auth] getSignedHomepage: page is not the home feed, reloading root')
      win.webContents.stop()
      const done2 = authedNavDone(win)
      win.loadURL('https://www.youtube.com/')
      await done2
      const deadline2 = Date.now() + 10000
      while (Date.now() < deadline2) {
        if (await pageReady(win)) break
        await new Promise(r => setTimeout(r, 250))
      }
    }
    return win
  })()
  const result = await signedHomeInFlight
  signedHomeInFlight = null
  return result
}

// Read the signed-in user's home feed out of the loaded page's embedded
// ytInitialData. YouTube's FEED_HOME browse endpoint rejects bare innertube
// calls ("invalid argument"), but a real page load handles everything.
async function readSignedHomeData(win) {
  const raw = await win.webContents.executeJavaScript(`(() => {
    const data = window.ytInitialData
    if (!data) return null
    // Return a diagnostic summary + the full data
    const summary = {
      topKeys: Object.keys(data),
      hasContents: !!data.contents,
      totalVideoRenderers: 0,
      tabsCount: 0,
      firstTabTitle: '',
      richGridItemsCount: 0,
    }
    try {
      const tcr = data.contents?.twoColumnBrowseResultsRenderer
      if (tcr) {
        summary.tabsCount = (tcr.tabs || []).length
        const first = tcr.tabs?.[0]?.tabRenderer
        if (first) {
          summary.firstTabTitle = first.title || ''
          const rgr = first.content?.richGridRenderer
          if (rgr) {
            summary.richGridItemsCount = (rgr.contents || []).length
            summary.hasContinuations = !!rgr.continuations
          }
        }
      }
    } catch (e) { summary.parseError = e.message }

    // Count all videoRenderers in the full tree
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (node.videoRenderer) summary.totalVideoRenderers++
      for (const k of Object.keys(node)) {
        const v = node[k]
        if (v && typeof v === 'object') walk(v)
      }
    }
    walk(data)
    return { summary, fullData: data }
  })()`).catch(err => {
    console.error('[Auth] readSignedHomeData: ytInitialData read error:', err.message)
    return null
  })
  if (raw) {
    console.log('[Auth] readSignedHomeData ytInitialData summary:', JSON.stringify(raw.summary))
  } else {
    console.log('[Auth] readSignedHomeData: ytInitialData is NULL')
  }
  if (raw && raw.fullData) return raw.fullData
  return raw || null
}

// Load the personalized home feed. `continuation` drives infinite scroll.
// The first page is scraped from the real homepage's ytInitialData (a genuine
// page load, so YouTube serves the personalized feed); subsequent pages use the
// innertube browse endpoint with a continuation token, which YouTube does accept.
// A short-lived cache makes revisits instant; `force` bypasses it (manual refresh
// / background re-sync).
const SIGNED_FEED_TTL = 5 * 60 * 1000
let signedFeedCache = { ts: 0, videos: [], continuation: '', hasMore: true }

async function signedHomeFeed({ continuation = '', seen = [], force = false } = {}) {
  try {
    const ytCookies = await session.defaultSession.cookies.get({ domain: '.youtube.com' })
    const haveAuth = ytCookies && ytCookies.some(c =>
      c.name === '__Secure-1PSID' || c.name === 'SAPISID' || c.name === 'LOGIN_INFO' || c.name === 'SID')
    if (!haveAuth) return { ok: false, reason: 'not-signed-in', videos: [], continuation: '', hasMore: false }

    const seenSet = new Set(seen || [])
    let data = null
    let domVideos = []
    let win = null

    if (continuation) {
      const body = {
        context: { client: { ...WEB_CLIENT } },
        continuation,
      }
      const r = await authedBrowse(body)
      if (!r.ok) {
        const status = r.status || 0
        const reason = (status === 401 || status === 403 || status === 429) ? 'expired' : 'request-error'
        console.log(`[Auth] home continuation HTTP ${status} → ${reason}`)
        return { ok: false, reason, videos: [], continuation: '', hasMore: false }
      }
      data = await r.json()
    } else {
      win = await getSignedHomepage()
      data = await readSignedHomeData(win)
      if (!data || typeof data !== 'object') {
        console.log('[Auth] could not read ytInitialData from the home page')
        return { ok: false, reason: 'request-error', videos: [], continuation: '', hasMore: false }
      }
      // Aggressive scroll to trigger rich grid lazy-loading.
      // Real wheel input events (sendInputEvent) produce genuine scrolls that fire
      // the IntersectionObservers even in the hidden window, appending lazy-loaded
      // chunks beyond the initial ~20 videos. We also collect DOM videos at multiple
      // scroll depths since cards may unload as we go.
      try {
        const wheel = { type: 'mouseWheel', x: 450, y: 700, deltaX: 0, deltaY: 1800, canScroll: true }
        const allDomVideos = []
        const seenDomIds = new Set()
        // Phase 1: initial parse
        let batch = await collectDomFeedVideos(win)
        for (const dv of batch) {
          if (dv && dv.id && !seenDomIds.has(dv.id)) {
            seenDomIds.add(dv.id)
            allDomVideos.push(dv)
          }
        }
        // Phase 2: deep scroll in bursts, collecting after each burst
        const beats = [2, 2, 2, 3, 3, 2, 2, 1, 1, 1]
        for (const reps of beats) {
          for (let k = 0; k < reps; k++) {
            try { win.webContents.sendInputEvent(wheel) } catch (e) { /* ignore */ }
          }
          await new Promise(r => setTimeout(r, 600))
          batch = await collectDomFeedVideos(win)
          for (const dv of batch) {
            if (dv && dv.id && !seenDomIds.has(dv.id)) {
              seenDomIds.add(dv.id)
              allDomVideos.push(dv)
            }
          }
          if (allDomVideos.length > 100) break
        }
        await win.webContents.executeJavaScript(`window.scrollTo(0, 0); true`).catch(() => {})
        domVideos = allDomVideos
      } catch (e) { console.log('[Auth] feed scroll error:', e.message) }
      console.log(`[Auth] signedHomeFeed: DOM grid has ${domVideos.length} videos`)
    }

    const all = parseHomeFeedResults(data)
    // Merge DOM-rendered cards (ids the ytInitialData batch didn't include) so
    // the feed shows far more than the initial ~20 videos.
    try {
      const seenIds = new Set(all.map(v => v.id))
      for (const dv of domVideos) {
        if (!dv || !dv.id || seenIds.has(dv.id)) continue
        seenIds.add(dv.id)
        all.push({
          id: dv.id,
          title: dv.title || '',
          thumbnail: dv.thumbnail || '',
          duration: dv.duration || '',
          channel: dv.channel || '',
          live: /live|streamed|premiered/i.test(dv.duration),
        })
      }
    } catch (e) { /* ignore */ }
    const fresh = all.filter(v => v.id && !seenSet.has(v.id))
    fresh.forEach(v => seenSet.add(v.id))
    // Use different extraction logic for initial load vs continuation
    const nextCont = toastHomeContinuationSafe(continuation
      ? extractContinuationFromResponse(data)
      : extractHomeContinuation(data, win))
    if (!continuation) signedFeedCache = { ts: Date.now(), videos: all, continuation: nextCont, hasMore: !!nextCont }
    console.log(`[Auth] signedHomeFeed: parsed ${all.length} videos, ${fresh.length} fresh, hasMore: ${!!nextCont}, contLen: ${(nextCont || '').length}`)
    if (fresh.length === 0 && all.length === 0) {
      console.log('[Auth] signedHomeFeed: ZERO videos found in data. Top keys:', Object.keys(data || {}))
      try {
        const tcr = data?.contents?.twoColumnBrowseResultsRenderer
        if (tcr) {
          console.log('[Auth] tabs:', (tcr.tabs || []).map(t => t.tabRenderer?.title || Object.keys(t)[0]))
          const firstTab = tcr.tabs?.[0]?.tabRenderer
          if (firstTab?.content) {
            console.log('[Auth] firstTab content keys:', Object.keys(firstTab.content))
            const rgr = firstTab.content?.richGridRenderer
            if (rgr) {
              console.log('[Auth] richGrid contents count:', (rgr.contents || []).length)
              console.log('[Auth] richGrid first item keys:', rgr.contents?.[0] ? Object.keys(rgr.contents[0]) : 'empty')
            }
          }
        }
      } catch (e) { console.log('[Auth] feed debug error:', e.message) }
    }
    return { ok: true, reason: null, videos: fresh, continuation: nextCont, hasMore: !!nextCont, cached: false }
  } catch (e) {
    console.error('[Auth] signedHomeFeed error:', e.message)
    return { ok: false, reason: 'request-error', videos: [], continuation: '', hasMore: false }
  }
}

// Collect every rendered video card from the loaded home page DOM. After the
// page has been scrolled, the rich grid contains far more items than the initial
// ytInitialData batch. Selectors are kept loose across current (<yt-lockup-view-
// model> inside <ytd-rich-item-renderer>) and legacy (<ytd-video-renderer>)
// rendering so a YouTube layout change can't wipe out the whole feed.
async function collectDomFeedVideos(win) {
  const raw = await win.webContents.executeJavaScript(`(() => {
    try {
      const out = []
      const seen = new Set()
      const cards = document.querySelectorAll('#content ytd-rich-item-renderer, #content yt-rich-item-renderer, #content ytd-grid-video-renderer')
      for (const card of cards) {
        let a = card.querySelector('a#video-title-link, a#video-title, a[href^="/watch"], a[href*="/watch?v="]')
        if (!a) continue
        const href = a.getAttribute('href') || ''
        const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(href)
        if (!m) continue
        const id = m[1]
        if (seen.has(id)) continue
        seen.add(id)
        const img = card.querySelector('img[src*="ytimg"], img[src*="ggpht"]')
        let duration = ''
        const badge = card.querySelector('ytd-thumbnail-overlay-time-status-renderer span, span.ytd-thumbnail-overlay-time-status-renderer, ytd-badge-shape .yt-core-badge-shape__label, ytd-badge-shape span')
        if (badge) duration = badge.textContent.trim()
        let channel = ''
        const ch = card.querySelector('ytd-channel-name, yt-channel-name, #channel-name a, a.ytd-channel-name')
        if (ch) channel = ch.textContent.replace(/\\s+/g, ' ').trim()
        out.push({
          id,
          title: (a.getAttribute('title') || a.textContent || '').replace(/\\s+/g, ' ').trim(),
          thumbnail: img ? (img.getAttribute('src') || img.getAttribute('data-thumb') || '') : '',
          duration,
          channel,
        })
      }
      return out
    } catch (e) { return [] }
  })()`).then(v => v && v.value !== undefined ? v.value : v, () => [])
  return Array.isArray(raw) ? raw : []
}

function extractHomeContinuation(data, win) {
  let token = ''
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.nextContinuationData?.continuation) {
      token = node.nextContinuationData.continuation
      return
    }
    if (node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
      token = node.continuationItemRenderer.continuationEndpoint.continuationCommand.token
      return
    }
    if (node.continuationCommand?.token) { token = node.continuationCommand.token; return }
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (v && typeof v === 'object') { if (!token) walk(v) }
      else if (Array.isArray(v)) { if (!token) v.forEach(walk) }
    }
  }
  walk(data)

  // If not found in ytInitialData, try to extract from the DOM (continuation
  // tokens can be embedded in the rich grid after lazy-loading)
  if (!token && win) {
    try {
      const domToken = win.webContents.executeJavaScript(`(() => {
        try {
          // Look for continuation tokens in various DOM locations
          const scripts = document.querySelectorAll('script')
          for (const s of scripts) {
            const m = s.textContent?.match(/"continuationCommand":\{"token":"([^"]+)"/) ||
                           s.textContent?.match(/"nextContinuationData":\{"continuation":"([^"]+)"/)
            if (m) return m[1]
          }
          // Also check ytInitialData if it was updated
          if (window.ytInitialData) {
            const walk = (node) => {
              if (!node || typeof node !== 'object') return null
              if (node.nextContinuationData?.continuation) return node.nextContinuationData.continuation
              if (node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) return node.continuationItemRenderer.continuationEndpoint.continuationCommand.token
              if (node.continuationCommand?.token) return node.continuationCommand.token
              for (const k of Object.keys(node)) {
                const v = node[k]
                if (v && typeof v === 'object') {
                  const r = walk(v)
                  if (r) return r
                } else if (Array.isArray(v)) {
                  for (const item of v) {
                    const r = walk(item)
                    if (r) return r
                  }
                }
              }
              return null
            }
            return walk(window.ytInitialData)
          }
        } catch (e) {}
        return ''
      })()`).catch(() => '')
      if (domToken) token = domToken
    } catch (e) { /* ignore */ }
  }

  return token
}

function toastHomeContinuationSafe(t) {
  // Guard against accidentally using a search/other token
  return t || ''
}

// Load the signed-in user's YouTube channel subscriptions by navigating the
// hidden authed window to the real "All subscriptions" grid (/feed/channels)
// and scraping it — the same page-load approach that works for the signed-in
// feed. Scrolling lazy-loads any extra rows, so the whole list is captured.
const SUBS_SYNC_TTL = 10 * 60 * 1000 // 10 minutes
let signedSubsCache = { ts: 0, subscriptions: [] }

// A dedicated hidden window for subscription sync, kept separate from the shared
// authed window that services the home feed + account probe. The two must not
// share a webContents: the /feed/channels navigation would race the home page
// load and leave the wrong page cached as "the home feed".
let subsScrapeWin = null
let subsScrapeWinPromise = null
async function ensureSubsWindow() {
  if (subsScrapeWinPromise) return subsScrapeWinPromise
  subsScrapeWinPromise = (async () => {
    if (subsScrapeWin && !subsScrapeWin.isDestroyed()) return subsScrapeWin
    subsScrapeWin = new BrowserWindow({
      show: false,
      width: 800, height: 600,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    subsScrapeWin.on('closed', () => { subsScrapeWin = null })
    try { await subsScrapeWin.loadURL('https://www.youtube.com/feed/channels') } catch (e) { /* retried below */ }
    return subsScrapeWin
  })().finally(() => { subsScrapeWinPromise = null })
  return subsScrapeWinPromise
}

async function loadSignedSubscriptions() {
  try {
    const ytCookies = await session.defaultSession.cookies.get({ domain: '.youtube.com' })
    const haveAuth = ytCookies && ytCookies.some(c =>
      c.name === '__Secure-1PSID' || c.name === 'SAPISID' || c.name === 'LOGIN_INFO' || c.name === 'SID')
    if (!haveAuth) return { ok: false, reason: 'not-signed-in', subscriptions: [] }

    // Cache-first: a recent sync is reused verbatim (no expensive /feed/channels
    // navigation + scrolling); `yt-auth-subscriptions` can force a refresh later.
    if (signedSubsCache.subscriptions.length && Date.now() - signedSubsCache.ts < SUBS_SYNC_TTL) {
      console.log(`[Auth] loadSignedSubscriptions: serving cached sync (${signedSubsCache.subscriptions.length} channels)`)
      return { ok: true, reason: null, subscriptions: signedSubsCache.subscriptions, cached: true }
    }

    const win = await ensureSubsWindow()
    win.webContents.stop()
    const done = authedNavDone(win)
    win.loadURL('https://www.youtube.com/feed/channels')
    await done
    await new Promise(r => setTimeout(r, 2500))
    console.log('[Auth] loadSignedSubscriptions: page URL:', win.webContents.getURL())

    // Scroll to the bottom so the grid lazy-loads every subscription row.
    for (let i = 0; i < 8; i++) {
      await win.webContents.executeJavaScript(`window.scrollTo(0, document.body.scrollHeight); true`).catch(() => {})
      await new Promise(r => setTimeout(r, 700))
    }

    const raw = await win.webContents.executeJavaScript(`(() => {
      try {
        const out = []
        const seen = new Set()
        const abs = (u) => (u || '').replace(/^\\/\\//, 'https://')
        const pushEntry = (name, id, thumb) => {
          const key = (name || '').toLowerCase()
          if (!name) return
          if (seen.has(key)) return
          seen.add(key)
          out.push({ name: name.replace(/\\s+/g, ' ').trim(), channelId: id || '', thumbnail: abs(thumb) })
        }
        const walk = (node) => {
          if (!node || typeof node !== 'object') return
          if (node.channelRenderer) {
            const cr = node.channelRenderer
            const t = cr.title?.simpleText || cr.title?.runs?.map(r => r.text).join('') || ''
            const thumbs = cr.thumbnail?.thumbnails || []
            pushEntry(t, cr.channelId || '', thumbs.length ? thumbs[thumbs.length - 1].url : '')
          }
          for (const k of Object.keys(node)) { const v = node[k]; if (v && typeof v === 'object') walk(v) }
        }
        const d = window.ytInitialData
        if (d) walk(d)
        if (out.length === 0) {
          const nodes = document.querySelectorAll('ytd-channel-renderer')
          for (const n of nodes) {
            const a = n.querySelector('#channel-title-link') || n.querySelector('#additional-link') || n.querySelector('a#main-link')
            const name = (a && a.textContent) ? a.textContent.replace(/\\s+/g, ' ').trim() : ''
            pushEntry(name, '', (n.querySelector('img') || {}).src || '')
          }
        }
        return out
      } catch (e) { return [] }
    })()`, true).catch(e => {
      console.error('[Auth] loadSignedSubscriptions scrape error:', e.message)
      return []
    })

    const list = (raw && raw.value !== undefined ? raw.value : raw) || []
    console.log('[Auth] loadSignedSubscriptions: got', list.length, 'channels')
    if (Array.isArray(list)) signedSubsCache = { ts: Date.now(), subscriptions: list }
    // Release the dedicated window; a later sync (after the 10 min TTL) re-creates it.
    setTimeout(() => { try { if (subsScrapeWin && !subsScrapeWin.isDestroyed()) subsScrapeWin.destroy() } catch (e) { /* ignore */ } }, 1000)
    return { ok: true, reason: null, subscriptions: Array.isArray(list) ? list : [] }
  } catch (e) {
    console.error('[Auth] loadSignedSubscriptions error:', e.message)
    return { ok: false, reason: 'request-error', subscriptions: [] }
  }
}

// Merge the signed-in account's YouTube subscriptions into the app's local
// subscription list and persist. Returns the merged channel-name list.
function syncGoogleSubscriptions(subs) {
  if (!Array.isArray(subs) || !subs.length) return prefs.subscriptions
  for (const s of subs) {
    const name = (typeof s === 'string' ? s : (s && s.name)) || ''
    if (name && !prefs.subscriptions.some(c => c.toLowerCase() === name.toLowerCase())) prefs.subscriptions.push(name)
  }
  savePrefs()
  newVideosCache = { ts: 0, key: '', data: null }
  return prefs.subscriptions
}

function fmtDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function isShortResult(vr) {
  const overlayShort = (vr.thumbnailOverlayTimeStatusRenderer || {}).style === 'SHORTS'
  if (overlayShort) return true
  const rawDuration = vr.lengthText?.simpleText || ''
  if (rawDuration) {
    const hms = rawDuration.trim().split(':').map(Number)
    if (hms.some(isNaN) || hms.length === 0) return false
    let seconds = 0
    for (let i = 0; i < hms.length; i++) seconds = seconds * 60 + (hms[i] || 0)
    if (seconds > 0 && seconds < 60) return true
  }
  const thumbs = vr.thumbnail?.thumbnails || []
  const big = thumbs[thumbs.length - 1]
  if (big && big.width && big.height) {
    const ratio = big.width / big.height
    if (ratio > 0 && ratio < 0.8) return true
  }
  return false
}

function parseSearchResults(data) {
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
  const results = []
  for (const section of sections) {
    for (const item of (section?.itemSectionRenderer?.contents || [])) {
      const vr = item.videoRenderer
      if (!vr) continue
      const thumbs = vr.thumbnail?.thumbnails || []
      const isShort = isShortResult(vr)
      results.push({
        id: vr.videoId || '',
        title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || '',
        channel: vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || '',
        views: vr.viewCountText?.simpleText || vr.viewCountText?.runs?.map(r => r.text).join('') || '',
        duration: vr.lengthText?.simpleText || '',
        thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
        publishedTime: vr.publishedTimeText?.simpleText || '',
        isShort,
        url: `https://www.youtube.com/watch?v=${vr.videoId}`,
      })
    }
  }
  return results
}

async function searchYouTube(query, vData) {
  if (!query?.trim()) return { videos: [], shorts: [], error: null }
  try {
    const ctx = { client: { ...WEB_CLIENT } }
    if (vData) ctx.client.visitorData = vData
    const data = await ytPost(`${YOUTUBE_SEARCH_URL}?prettyPrint=false`, { context: ctx, query: query.trim() })
    const nd = data?.responseContext?.visitorData || vData || ''
    const all = parseSearchResults(data)
    return { videos: all.filter(r => !r.isShort), shorts: all.filter(r => r.isShort), visitorData: nd, error: null }
  } catch (e) {
    console.error('[Search]', e.message)
    return { videos: [], shorts: [], error: e.message }
  }
}

const HOME_QUERIES = ['trending music', 'popular videos', 'viral videos', 'top gaming', 'funny shorts', 'dance shorts']

async function loadHomeFeed(vData) {
  const combined = { videos: [], shorts: [], visitorData: vData || '', error: null }
  const seenVideos = new Set()
  const seenShorts = new Set()
  let launched = 0
  let running = 0
  const concurrency = Math.min(3, Math.max(2, getFypConcurrency()))

  const processQuery = async (q) => {
    try {
      const r = await cachedSearchYouTube(q, combined.visitorData || vData)
      if (r.visitorData) combined.visitorData = r.visitorData
      if (r.error && !combined.error) combined.error = r.error
      for (const v of r.videos || []) {
        if (!seenVideos.has(v.id)) { seenVideos.add(v.id); combined.videos.push(v) }
      }
      for (const s of r.shorts || []) {
        if (!seenShorts.has(s.id)) { seenShorts.add(s.id); combined.shorts.push(s) }
      }
    } catch { /* continue with next query */ }
  }

  const launch = () => {
    while (running < concurrency) {
      if (combined.videos.length >= 12 && combined.shorts.length > 0) break
      if (launched >= HOME_QUERIES.length) break
      const q = HOME_QUERIES[launched++]
      running++
      processQuery(q).finally(() => { running--; launch() })
    }
  }
  launch()

  await new Promise((resolve) => {
    const check = () => {
      if ((combined.videos.length >= 12 && combined.shorts.length > 0)) return resolve()
      if (launched >= HOME_QUERIES.length && running === 0) return resolve()
      setTimeout(check, 20)
    }
    check()
  })

  return combined
}

const SHORTS_QUERIES = ['#shorts', 'funny shorts', 'dance shorts', 'gaming shorts', 'lifehacks shorts', 'cooking shorts', 'sports shorts', 'meme shorts']

// ─── Preferences: Watch History + Subscriptions (persisted) ────────────────

const PREFS_PATH = path.join(CONFIG_DIR, 'prefs.json')

let prefs = { history: [], subscriptions: [] }

function loadPrefs() {
  try {
    if (fs.existsSync(PREFS_PATH)) {
      const p = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'))
      prefs = { history: Array.isArray(p.history) ? p.history : [], subscriptions: Array.isArray(p.subscriptions) ? p.subscriptions : [] }
    }
  } catch (e) { console.error('[Prefs] load error:', e.message) }
  return { history: prefs.history, subscriptions: prefs.subscriptions }
}

function savePrefs() {
  try { fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2), 'utf-8') } catch (e) { console.error('[Prefs] save error:', e.message) }
}

function recordWatch(v) {
  if (!v || !v.id) return prefs.history
  const entry = { id: v.id, title: v.title || '', channel: v.channel || '', thumbnail: v.thumbnail || '', duration: v.duration || '', ts: Date.now() }
  prefs.history = prefs.history.filter(h => h.id !== entry.id)
  prefs.history.unshift(entry)
  if (prefs.history.length > 200) prefs.history = prefs.history.slice(0, 200)
  savePrefs()
  return prefs.history
}

function subscribe(channel) {
  const name = (channel || '').trim()
  if (name && !prefs.subscriptions.some(c => c.toLowerCase() === name.toLowerCase())) prefs.subscriptions.push(name)
  savePrefs()
  newVideosCache = { ts: 0, key: '', data: null }
  return prefs.subscriptions
}

function unsubscribe(channel) {
  prefs.subscriptions = prefs.subscriptions.filter(c => c.toLowerCase() !== (channel || '').toLowerCase())
  savePrefs()
  newVideosCache = { ts: 0, key: '', data: null }
  return prefs.subscriptions
}

const normChannel = (s) => (s || '').toLowerCase().trim()

// Simple English stopwords to derive interest keywords from watched titles
const STOPWORDS = new Set(['the','a','an','and','or','of','to','in','on','for','with','is','it','this','that','i','my','your','you','me','we','us','from','by','as','at','be','are','was','were','do','does','did','have','has','had','not','but','so','if','then','than','too','very','just','get','gets','got','can','will','would','should','make','makes','making','using','use','vs','ft','feat','official','lyrics','music','video','new','best','top','watch','full','part','ep','episode','how','why','what','when','where','who','them','they','there','here','one','two','more','most','over','under','about','into','out','off','up','down'])

function extractKeywords(text, limit = 6) {
  const words = (text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const freq = {}
  for (const w of words) { if (w.length >= 4 && !STOPWORDS.has(w)) freq[w] = (freq[w] || 0) + 1 }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, limit).map(e => e[0])
}

async function loadShortsFeed(vData) {
  const combined = { shorts: [], visitorData: vData || '', error: null }
  const seen = new Set()
  for (const q of SHORTS_QUERIES) {
    try {
      const r = await searchYouTube(q, combined.visitorData || vData)
    if (r.visitorData) combined.visitorData = r.visitorData
      if (r.error && !combined.error) combined.error = r.error
      for (const s of r.shorts || []) {
        if (s.id && !seen.has(s.id)) { seen.add(s.id); combined.shorts.push(s) }
      }
    } catch { /* continue with next query */ }
    if (combined.shorts.length >= 20) break
  }
  return combined
}


// Build a pool of search queries for the For You feed.
// Mixes: subscribed channels (new uploads/their videos) + "similar" videos from
// watched history (by title keywords and channels) + trending/explore queries
// so the feed is NEVER limited to just subscribed channels.
function buildFypPool() {
  const pool = []
  const seenQ = new Set()
  const push = (q) => {
    if (!q) return
    const k = q.toLowerCase()
    if (!seenQ.has(k)) { seenQ.add(k); pool.push(q) }
  }

  // Subscribed channels first (their uploads are the strongest signal)
  for (const ch of prefs.subscriptions) push(ch)

  // "Similar videos": keyword queries derived from watched titles (recency-weighted via slice)
  const recent = prefs.history.slice(0, 12)
  for (const h of recent) {
    for (const kw of extractKeywords(h.title, 3)) push(`${kw}`)
  }

  // Channels you actually watched
  for (const h of recent) push(h.channel)

  // Trending / discovery to keep the feed fresh
  for (const q of HOME_QUERIES) push(q)

  return pool
}

// Score a video for intra-batch ranking (prefer subs + watched channels + popular)
function fypScore(v) {
  let s = 0
  if (prefs.subscriptions.some(c => normChannel(c) === normChannel(v.channel))) s += 100
  for (const h of prefs.history.slice(0, 30)) if (normChannel(h.channel) === normChannel(v.channel)) s += 12
  const views = parseInt(String(v.views || '').replace(/[^0-9]/g, ''), 10) || 0
  if (views) s += Math.min(25, Math.log10(views) * 4)
  return s
}

// Load the next page of the infinite For You feed.
// `cursor` = position in the query pool where we left off (0 for a fresh feed).
// `seen`   = video ids already shown (so we never repeat within a session).
async function loadFypMore({ cursor = 0, seen = [] } = {}) {
  const pool = buildFypPool()
  const seenSet = new Set(seen || [])
  const result = {
    videos: [],
    nextCursor: cursor,
    hasMore: pool.length > 0,
    error: null,
    history: prefs.history,
    subscriptions: prefs.subscriptions,
  }
  if (!pool.length) { result.hasMore = false; return result }

  const MAX_VIDEOS = 24          // target cards per load
  let vd = visitorData

  const runSearch = async (q) => {
    try {
      const r = await cachedSearchYouTube(q, vd)
      if (r.visitorData) vd = r.visitorData
      if (r.error && !result.error) result.error = r.error
      // collect fresh (non-seen) videos into the result as they arrive
      for (const v of (r.videos || [])) {
        if (v.id && v.isShort === false && !seenSet.has(v.id)) {
          seenSet.add(v.id)
          result.videos.push(v)
        }
      }
    } catch {
      // ignore errored search, keep going
    }
  }

  // Run the query pool concurrently (2-3 in flight). We walk the pool starting at
  // `cursor` (as the old sequential loop did), but launch up to `concurrency`
  // searches at once, stopping once MAX_VIDEOS fresh videos arrive or the pool
  // (relative to cursor) is exhausted.
  const startIdx = Number(cursor) || 0
  const concurrency = Math.min(3, Math.max(2, getFypConcurrency()))
  const totalQueries = pool.length
  let idx = startIdx
  let launched = 0
  let running = 0

  const launch = () => {
    while (running < concurrency) {
      if (result.videos.length >= MAX_VIDEOS) break
      if (launched >= totalQueries) break
      const q = pool[idx % pool.length]
      idx++
      launched++
      running++
      runSearch(q).finally(() => { running--; launch() })
    }
  }
  launch()

  // Wait/resolve once we have enough videos or every query has been attempted.
  await new Promise((resolve) => {
    const check = () => {
      if (result.videos.length >= MAX_VIDEOS) return resolve()
      if (launched >= totalQueries && running === 0) return resolve()
      setTimeout(check, 25)
    }
    check()
  })

  // If a full cycle through every query produced zero new videos, we're exhausted
  if (launched >= totalQueries && result.videos.length === 0) result.hasMore = false

  // Sort this batch so subscribed/watched/popular content bubbles to the top,
  // while still interleaving fresh "similar" videos from every query.
  result.videos.sort((a, b) => fypScore(b) - fypScore(a))
  result.nextCursor = idx % pool.length
  // If we couldn't fill the page because the pool ran dry, stop paging
  if (result.videos.length === 0) result.hasMore = false
  return result
}


async function getVideoInfo(videoId) {
  if (!videoId) return { info: null, error: 'No video ID' }
  // oembed (title/channel/thumbnail) and the watch page (duration/description/
  // views) are independent — fetch them in parallel instead of back-to-back.
  const [oembedRes, htmlRes] = await Promise.allSettled([
    ytGet(`${YOUTUBE_OEMBED_URL}?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`),
    ytGetText(`https://www.youtube.com/watch?v=${videoId}`),
  ])
  const oembed = oembedRes.status === 'fulfilled' ? oembedRes.value : null
  const html = htmlRes.status === 'fulfilled' ? htmlRes.value : null
  if (oembed) {
    let duration = '', description = '', viewCount = ''
    try {
      if (html) {
        const dm = html.match(/"lengthSeconds":"(\d+)"/)
        if (dm) duration = fmtDuration(parseInt(dm[1]))
        const dsc = html.match(/"shortDescription":"([\s\S]*?)","is/)
        if (dsc) { try { description = JSON.parse(`"${dsc[1]}"`) } catch { description = dsc[1].replace(/\\n/g, '\n') } }
        const vm = html.match(/"viewCount":"(\d+)"/)
        if (vm) viewCount = Number(vm[1]).toLocaleString()
      }
    } catch { /* oembed still usable */ }
    return { info: { id: videoId, title: oembed.title || '', channel: oembed.author_name || '', views: viewCount, duration, description, thumbnail: oembed.thumbnail_url || '' }, error: null }
  }
  // oembed failed → the innertube player endpoint has every field anyway.
  try {
    const data = await ytPost(`${YOUTUBE_PLAYER_URL}?key=${YOUTUBE_KEY}`, { context: { client: WEB_CLIENT }, videoId })
    const vd = data.videoDetails || {}
    const t = vd.thumbnail?.thumbnails || []
    return { info: { id: videoId, title: vd.title || '', channel: vd.author || '', views: vd.viewCount ? Number(vd.viewCount).toLocaleString() : '', duration: vd.lengthSeconds ? fmtDuration(parseInt(vd.lengthSeconds)) : '', description: vd.shortDescription || '', thumbnail: t.length ? t[t.length - 1].url : '' }, error: null }
  } catch (e) { return { info: null, error: (oembedRes.reason && oembedRes.reason.message) || e.message } }
}

// ─── Channel page (videos + description from one profile) ──────────────────

// Find the canonical channel URL (e.g. /@handle or /channel/UC...) for a channel name.
async function resolveChannel(channelName) {
  if (!channelName?.trim()) return null
  // Find a channelRenderer from a raw search of the web client response.
  try {
    const raw = await ytPost(`${YOUTUBE_SEARCH_URL}?prettyPrint=false`, {
      context: { client: { ...WEB_CLIENT, visitorData } },
      query: channelName.trim(),
    })
    const items = raw?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
    const want = channelName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    const found = []
    for (const section of items) {
      for (const item of (section?.itemSectionRenderer?.contents || [])) {
        const cr = item.channelRenderer
        if (!cr) continue
        const name = cr.title?.simpleText || cr.title?.runs?.map(x => x.text).join('') || ''
        const handle = ((cr.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '').replace(/^\//, '').replace(/^channel\/[^/]+/, '').replace(/^@/, '') || '').toLowerCase()
        found.push({
          name,
          channelId: cr.channelId || '',
          canonicalBaseUrl: cr.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || `/channel/${cr.channelId}`,
          avatar: (cr.thumbnail?.thumbnails || [])[0]?.url || '',
          subscribers: cr.subscriberCountText?.simpleText || cr.subscriberCountText?.runs?.map(x => x.text).join('') || '',
          videoCount: cr.videoCountText?.simpleText || cr.videoCountText?.runs?.map(x => x.text).join('') || '',
          description: cr.descriptionSnippet?.runs?.map(x => x.text).join('') || '',
          nameKey: name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
          handleKey: handle.replace(/[^a-z0-9]+/g, ' ').trim(),
          handle,
        })
      }
    }
    if (!found.length) return null
    // 1) exact name match
    let hit = found.find(f => f.nameKey === want)
    // 2) handle match
    if (!hit) hit = found.find(f => f.handle === want.replace(/ /g, '') || f.nameKey.includes(want) || want.includes(f.nameKey))
    // 3) first result as best guess
    if (!hit) hit = found[0]
    return {
      name: hit.name,
      channelId: hit.channelId,
      canonicalBaseUrl: hit.canonicalBaseUrl,
      avatar: hit.avatar,
      subscribers: hit.subscribers,
      videoCount: hit.videoCount,
      description: hit.description,
    }
  } catch (e) { console.error('[Channel] resolve error:', e.message) }
  return null
}

function extractYtInitialData(html) {
  const patterns = [
    /var ytInitialData = ([\s\S]*?);\s*<\/script>/,
    /window\.ytInitialData = ([\s\S]*?);\s*<\/script>/,
  ]
  for (const p of patterns) {
    const m = html.match(p)
    if (m) { try { return JSON.parse(m[1]) } catch {} }
  }
  const m = html.match(/ytInitialData"?\]?\s*=\s*(\{[\s\S]*?\});\s*\n?\s*<\/script>/)
  if (m) { try { return JSON.parse(m[1]) } catch {} }
  return null
}

function collectVideoRenderers(grid, out = []) {
  const list = grid?.contents || grid?.richGridRenderer?.contents || grid?.itemSectionRenderer?.contents || grid?.shelfRenderer?.content?.verticalListRenderer?.items || []
  if (!Array.isArray(list)) return out
  for (const c of list) {
    const content = c.richItemRenderer?.content || c
    if (content.videoRenderer) { out.push({ kind: 'videoRenderer', raw: content.videoRenderer }); continue }
    if (content.lockupViewModel) { out.push({ kind: 'lockup', raw: content.lockupViewModel }); continue }
    if (content.gridVideoRenderer) { out.push({ kind: 'videoRenderer', raw: content.gridVideoRenderer }); continue }
    if (content.compactVideoRenderer) { out.push({ kind: 'videoRenderer', raw: content.compactVideoRenderer }); continue }
    if (c.richItemRenderer || c.itemSectionRenderer || c.shelfRenderer || c.sectionListRenderer || c.richGridRenderer) collectVideoRenderers(c, out)
  }
  return out
}

// Parse one rendered video into the standard shape. `defaultChannel` is the page's channel name.
function videoItemToObject(entry, defaultChannel) {
  if (entry.kind === 'videoRenderer') {
    const vr = entry.raw
    const thumbs = vr.thumbnail?.thumbnails || []
    const views = vr.viewCountText?.simpleText || vr.viewCountText?.runs?.map(x => x.text).join('') || ''
    return {
      id: vr.videoId || '',
      title: vr.title?.runs?.map(x => x.text).join('') || vr.title?.simpleText || '',
      channel: vr.ownerText?.runs?.map(x => x.text).join('') || vr.shortBylineText?.runs?.map(x => x.text).join('') || defaultChannel || '',
      views,
      duration: vr.lengthText?.simpleText || '',
      publishedTime: vr.publishedTimeText?.simpleText || '',
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
      url: vr.videoId ? `https://www.youtube.com/watch?v=${vr.videoId}` : '',
    }
  }
  if (entry.kind === 'lockup') {
    const lk = entry.raw
    const id = lk.contentId || ''
    const sources = lk.contentImage?.thumbnailViewModel?.image?.sources || []
    const thumbs = sources.map(s => s.url).filter(Boolean)
    // duration badge
    let duration = ''
    for (const ov of (lk.contentImage?.thumbnailViewModel?.overlays || [])) {
      const badges = ov.thumbnailBottomOverlayViewModel?.badges || ov.thumbnailOverlayBadgeViewModel?.thumbnailBadges || []
      for (const b of badges) {
        const t = b.thumbnailBadgeViewModel?.text || ''
        if (t && t.includes(':')) { duration = t; break }
      }
      if (duration) break
    }
    // views + publishedTime from metadata parts
    const parts = ((lk.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [])[0]?.metadataParts) || []
    const texts = parts.map(p => p?.text?.content || '').filter(Boolean)
    return {
      id,
      title: lk.metadata?.lockupMetadataViewModel?.title?.content || '',
      channel: defaultChannel || '',
      views: texts[0] === '' ? undefined : texts.filter(t => /views?$/i.test(t))[0] || '',
      publishedTime: texts.filter(t => /ago$|days?$|weeks?$|months?$|years?$/i.test(t))[0] || '',
      duration,
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1] : '',
      url: id ? `https://www.youtube.com/watch?v=${id}` : '',
    }
  }
  return null
}

function parseChannelJson(data) {
  const meta = data?.metadata?.channelMetadataRenderer || {}
  const browse = data?.contents?.twoColumnBrowseResultsRenderer || {}
  const tabs = browse.tabs || []
  const videos = []
  let name = ''
  let avatar = ''
  let banner = ''
  let subscriber = ''
  let videoCount = ''
  let handle = ''
  let fullDescription = meta.description || ''

  // New layout: pageHeaderRenderer
  const vm = data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel
  if (vm) {
    name = vm.title?.dynamicTextViewModel?.text?.content || vm.title?.dynamicTextViewModel?.text || ''
    const avSrcs = vm.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources || []
    if (avSrcs.length) avatar = avSrcs[avSrcs.length - 1].url || ''
    const bnSrcs = vm.banner?.imageBannerViewModel?.image?.sources || []
    if (bnSrcs.length) banner = bnSrcs[bnSrcs.length - 1].url || ''
    const rows = vm.metadata?.contentMetadataViewModel?.metadataRows || []
    for (const row of rows) {
      const parts = (row?.metadataParts || []).map(p => p?.text?.content || '').filter(Boolean)
      for (const t of parts) {
        if (!handle && t.startsWith('@')) handle = t
        if (/subscriber/i.test(t)) subscriber = t
        if (/videos?$/i.test(t)) videoCount = t
      }
    }
    // full description from channel metadata, fall back to preview snippet
    if (!fullDescription) {
      fullDescription = vm.description?.descriptionPreviewViewModel?.description?.content || ''
    }
  }

  // Legacy layout: c4TabbedHeaderRenderer
  const hdr = data?.header?.c4TabbedHeaderRenderer || {}
  if (!name) name = hdr.title || meta.title || ''
  if (!avatar) {
    const avList = hdr.avatar?.thumbnails || meta.avatar?.thumbnails || []
    if (avList.length) avatar = avList[avList.length - 1].url || ''
  }
  if (!banner && hdr.banner?.thumbnails?.length) banner = hdr.banner.thumbnails[hdr.banner.thumbnails.length - 1].url || ''
  if (!subscriber) subscriber = hdr.subscriberCountText?.simpleText || hdr.subscriberCountText?.runs?.map(x => x.text).join('') || ''
  if (!videoCount) videoCount = (hdr.videoCountText?.runs?.map(x => x.text).join('')) || (hdr.videoCountText?.simpleText) || ''
  if (!handle) handle = hdr.channelHandleText?.runs?.map(x => x.text).join('') || ''

  // Videos tab
  for (const tab of tabs) {
    const tr = tab.tabRenderer || tab.expandableTabRenderer
    if (!tr) continue
    const title = (tr.title && typeof tr.title === 'string') ? tr.title : tr.title?.runs?.map(x => x.text).join('') || ''
    if (String(title).toLowerCase() !== 'videos') continue
    const grid = tr?.content?.richGridRenderer || tr?.content?.sectionListRenderer
    if (grid) {
      for (const entry of collectVideoRenderers(grid)) {
        const obj = videoItemToObject(entry, name)
        if (obj && obj.id) videos.push(obj)
      }
    }
    break
  }

  return {
    name,
    channelId: meta.channelId || '',
    description: fullDescription,
    avatar,
    banner,
    subscribers: subscriber,
    videoCount,
    handle,
    videos,
  }
}

const CHANNEL_INFO_TTL = 15 * 60 * 1000 // 15 minutes
const channelInfoCache = new Map()

// Fetch a channel page directly by id (/channel/UC...) or handle path (/@name).
// Used to resolve the signed-in account's own display name + avatar, which the
// homepage DOM doesn't reliably expose.
async function getChannelInfoByPath(path) {
  if (!path) return null
  const url = 'https://www.youtube.com' + (path.startsWith('/') ? path : '/' + path)
  const key = 'path:' + path
  const hit = channelInfoCache.get(key)
  if (hit && Date.now() - hit.ts < CHANNEL_INFO_TTL) return hit.channel
  try {
    const html = await ytGetText(url)
    const data = extractYtInitialData(html)
    if (!data) return null
    const parsed = parseChannelJson(data)
    channelInfoCache.set(key, { ts: Date.now(), channel: parsed })
    return parsed
  } catch (e) {
    console.log('[Auth] getChannelInfoByPath error:', e.message)
    return null
  }
}

async function getChannelInfo(channelName) {
  if (!channelName?.trim()) return { channel: null, error: 'No channel name' }
  const key = String(channelName).trim().toLowerCase()
  const hit = channelInfoCache.get(key)
  if (hit && Date.now() - hit.ts < CHANNEL_INFO_TTL) {
    console.log(`[Channel] serve cached info for "${channelName}"`)
    return { channel: hit.channel, error: null, cached: true }
  }
  let baseUrl = null
  try {
    const resolved = await resolveChannel(channelName)
    if (resolved) baseUrl = resolved.canonicalBaseUrl
  } catch (e) {
    console.error('[Channel] resolve error:', e.message)
  }
  if (!baseUrl) return { channel: null, error: `Could not find channel "${channelName}"` }

  try {
    const html = await ytGetText(`https://www.youtube.com${baseUrl}/videos`)
    const data = extractYtInitialData(html)
    if (!data) return { channel: null, error: 'Could not load channel page' }
    const parsed = parseChannelJson(data)
    if (!parsed.name) parsed.name = channelName.trim()
    parsed.nextToken = extractVideosContinuationToken(data)
    channelInfoCache.set(key, { ts: Date.now(), channel: parsed })
    console.log(`[Channel] fetched + cached info for "${channelName}"`)
    return { channel: parsed, error: null }
  } catch (e) {
    console.error('[Channel] page error:', e.message)
    return { channel: null, error: e.message }
  }
}

// Pull the "load more" continuation token from the Videos tab of a channel page.
function extractVideosContinuationToken(data) {
  const tabs = (data?.contents?.twoColumnBrowseResultsRenderer || {}).tabs || []
  for (const tab of tabs) {
    const tr = tab.tabRenderer || tab.expandableTabRenderer
    if (!tr) continue
    const title = (tr.title && typeof tr.title === 'string') ? tr.title : tr.title?.runs?.map(x => x.text).join('') || ''
    if (String(title).toLowerCase() !== 'videos') continue
    const grid = tr?.content?.richGridRenderer || tr?.content?.sectionListRenderer || {}
    const contents = grid?.contents || []
    for (let i = contents.length - 1; i >= 0; i--) {
      const token = contents[i]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
      if (token) return token
    }
    break
  }
  return ''
}

// Parse a continuation (append items) response into more videos + next token.
function parseMoreChannelVideos(data, channelName) {
  const videos = []
  let nextToken = ''
  const actions = data?.onResponseReceivedActions || []
  for (const action of actions) {
    const items = action?.appendContinuationItemsAction?.continuationItems || []
    for (let i = items.length - 1; i >= 0; i--) {
      const token = items[i]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
      if (token) { nextToken = token; break }
    }
    for (const entry of collectVideoRenderers({ contents: items })) {
      const obj = videoItemToObject(entry, channelName)
      if (obj && obj.id) videos.push(obj)
    }
  }
  return { videos, nextToken }
}

// Fetch the next batch of videos for a channel given a continuation token.
async function getMoreChannelVideos(continuationToken, channelName) {
  if (!continuationToken) return { videos: [], nextToken: '', error: null }
  try {
    const res = await ytPost(`${YOUTUBE_BROWSE_URL}?prettyPrint=false`, {
      context: { client: { ...WEB_CLIENT, visitorData } },
      continuation: continuationToken,
    })
    return { ...parseMoreChannelVideos(res, channelName || ''), error: null }
  } catch (e) {
    console.error('[Channel] continuation error:', e.message)
    return { videos: [], nextToken: '', error: e.message }
  }
}

// ─── New Videos From Subscribed Channels ────────────────────────────────────

const NEW_VIDEOS_TTL = 5 * 60 * 1000 // 5 minutes
let newVideosCache = { ts: 0, key: '', data: null }

// Fetch recent uploads from every subscribed channel, deduped and grouped.
// Reuses getChannelInfo() so resolution + page parsing stays consistent.
async function getNewChannelVideos() {
  const subs = prefs.subscriptions || []
  if (!subs.length) return { groups: [], videos: [], error: null }

  const key = JSON.stringify(subs)
  if (newVideosCache.data && newVideosCache.key === key && Date.now() - newVideosCache.ts < NEW_VIDEOS_TTL) {
    return newVideosCache.data
  }

  const groups = []
  const seen = new Set()
  const allVideos = []
  const concurrency = Math.min(4, subs.length)
  let idx = 0
  let running = 0

  const processChannel = async (channelName) => {
    try {
      const { channel } = await getChannelInfo(channelName)
      const videos = (channel?.videos || []).filter(v => v && v.id)
      if (videos.length) groups.push({ channel: channel.name || channelName, videos })
    } catch (e) {
      console.error('[NewVideos] channel error for', channelName, ':', e.message)
    }
  }

  const launch = () => {
    while (running < concurrency && idx < subs.length) {
      const ch = subs[idx++]
      running++
      processChannel(ch).finally(() => { running--; launch() })
    }
  }
  launch()

  await new Promise((resolve) => {
    const check = () => { if (idx >= subs.length && running === 0) return resolve(); setTimeout(check, 25) }
    check()
  })

  // Flatten + dedupe across channels (a video could appear in multiple channels).
  for (const g of groups) {
    for (const v of g.videos) {
      if (!seen.has(v.id)) { seen.add(v.id); allVideos.push(v) }
    }
  }

  const data = { groups, videos: allVideos, error: null }
  newVideosCache = { ts: Date.now(), key, data }
  return data
}

// ─── YouTube Music (music.youtube.com innertube) ───────────────────────────
// The Music section talks to music.youtube.com's own innertube endpoint with
// the WEB_REMIX client. Home shelves, charts, search (with its filter chips),
// albums, playlists and — when signed in — the user's library are each one
// browse/search POST away. Track playback reuses the app's existing stream
// resolver; the innertube audio URL plays directly in an <audio> element
// (verified: audio/mp4, Accept-Ranges, head/mid/tail all 206), so music needs
// no ffmpeg relay and starts in the ~300-600ms the resolver takes.

const YOUTUBE_MUSIC_BASE = 'https://music.youtube.com/youtubei/v1'
const MUSIC_CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20240318.01.00', hl: 'en', gl: 'US' }
const MUSIC_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Search filter params. The live search response advertises its own chip params
// (harvested below) so these stay valid if Google rotates them; they are only
// the fallback for the very first call.
const MUSIC_FILTER_PARAMS = {
  songs: 'EgWKAQIIAWoSEAUQAxAJEA4QERAQEAoQBBAV',
  albums: 'EgWKAQIYAWoSEAUQAxAJEA4QERAQEAoQBBAV',
  artists: 'EgWKAQIgAWoSEAUQAxAJEA4QERAQEAoQBBAV',
  playlists: 'EgeKAQQoADgBahIQBRADEAkQDhAREBAQChAEEBU%3D',
}

async function musicPost(endpoint, body) {
  const r = await fetch(`${YOUTUBE_MUSIC_BASE}/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': MUSIC_UA,
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/',
      'X-YouTube-Client-Name': '67',
      'X-YouTube-Client-Version': MUSIC_CLIENT.clientVersion,
    },
    body: JSON.stringify({ context: { client: { ...MUSIC_CLIENT } }, ...body }),
    signal: AbortSignal.timeout(12000),
  })
  if (!r.ok) throw new Error(`Music API HTTP ${r.status}`)
  return r.json()
}

// ── Music renderer helpers ──────────────────────────────────────────────────
// Music responses are deeply nested; these small walkers pull the renderers we
// care about without hard-coding whole response paths.

function musicWalk(node, key, out = [], limit = 400) {
  if (!node || typeof node !== 'object' || out.length >= limit) return out
  if (Array.isArray(node)) { for (const v of node) musicWalk(v, key, out, limit); return out }
  for (const [k, v] of Object.entries(node)) {
    if (k === key) out.push(v)
    else musicWalk(v, key, out, limit)
    if (out.length >= limit) break
  }
  return out
}

function musicFirst(node, key) {
  const r = musicWalk(node, key, [], 1)
  return r.length ? r[0] : null
}

// Join an innertube text node ({ runs } or { simpleText }) into a plain string.
function musicText(node) {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (typeof node.simpleText === 'string') return node.simpleText
  if (Array.isArray(node.runs)) return node.runs.map(r => r.text || '').join('')
  return ''
}

// Best (largest) thumbnail in a renderer subtree.
function musicThumb(node) {
  const r = musicFirst(node, 'musicThumbnailRenderer')
  const list = (r && r.thumbnail && r.thumbnail.thumbnails) || musicFirst(node, 'thumbnails') || []
  const thumbs = (Array.isArray(list) ? list : []).filter(t => t && typeof t.url === 'string')
  if (!thumbs.length) return ''
  return thumbs.reduce((best, t) => ((t.width || 0) >= (best.width || 0) ? t : best), thumbs[0]).url
}

// Classify a browse endpoint / page type into the shape the UI switches on.
function musicKind(pageType, browseId, videoId) {
  if (videoId) return 'track'
  if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') return 'album'
  if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' || pageType === 'MUSIC_PAGE_TYPE_USER_CHANNEL') return 'artist'
  if (pageType === 'MUSIC_PAGE_TYPE_PLAYLIST') return 'playlist'
  if (typeof browseId === 'string') {
    if (browseId.startsWith('MPREb_')) return 'album'
    if (browseId.startsWith('VL') || browseId.startsWith('RD')) return 'playlist'
    if (browseId.startsWith('UC')) return 'artist'
  }
  return 'card'
}

// A playlist/album/artist card (musicTwoRowItemRenderer or a navigation button).
function musicCardFrom(item) {
  if (!item) return null
  const title = musicText(item.title)
  if (!title) return null
  const browse = (item.navigationEndpoint && item.navigationEndpoint.browseEndpoint) || {}
  const watch = (item.navigationEndpoint && item.navigationEndpoint.watchEndpoint) || {}
  const browseId = browse.browseId || ''
  const videoId = watch.videoId || ''
  if (!browseId && !videoId) return null
  const pageType = (browse.browseEndpointContextSupportedConfigs
    && browse.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig
    && browse.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType) || ''
  return {
    kind: musicKind(pageType, browseId, videoId),
    id: videoId || browseId,
    videoId, browseId, pageType,
    title,
    subtitle: musicText(item.subtitle),
    thumbnail: musicThumb(item),
  }
}

// A list row — a track (watchEndpoint) or an album/artist/playlist row
// (browseEndpoint), all sharing musicResponsiveListItemRenderer.
function musicListItem(item) {
  if (!item) return null
  const cols = item.flexColumns || []
  const colText = (i) => musicText(cols[i] && cols[i].musicResponsiveListItemFlexColumnRenderer
    && cols[i].musicResponsiveListItemFlexColumnRenderer.text)
  const title = colText(0)
  if (!title) return null

  const nav0 = (cols[0] && cols[0].musicResponsiveListItemFlexColumnRenderer
    && cols[0].musicResponsiveListItemFlexColumnRenderer.text
    && cols[0].musicResponsiveListItemFlexColumnRenderer.text.runs
    && cols[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0]
    && cols[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].navigationEndpoint) || {}
  // Tracks carry their watch target on the title run; album/artist/playlist
  // rows put theirs on the row itself, so fall back to item.navigationEndpoint.
  const itemNav = item.navigationEndpoint || {}
  const videoId = (nav0.watchEndpoint && nav0.watchEndpoint.videoId)
    || (itemNav.watchEndpoint && itemNav.watchEndpoint.videoId)
    || musicFirst(item, 'videoId') || ''
  const browse = nav0.browseEndpoint || itemNav.browseEndpoint || {}
  const browseId = browse.browseId || ''
  const pageType = (browse.browseEndpointContextSupportedConfigs
    && browse.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig
    && browse.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType) || ''
  const kind = musicKind(pageType, browseId, videoId)
  if (!videoId && !browseId) return null

  const parts = []
  for (let i = 1; i < cols.length; i++) {
    const t = colText(i)
    if (t) parts.push(t)
  }
  const meta = parts.join(' • ').split(' • ').map(s => s.trim()).filter(Boolean)

  let duration = (item.lengthText && item.lengthText.simpleText) || ''
  if (!duration) {
    const fixed = item.fixedColumns && item.fixedColumns[0]
    duration = musicText(fixed && fixed.musicResponsiveListItemFixedColumnRenderer
      && fixed.musicResponsiveListItemFixedColumnRenderer.text)
  }
  if (!duration) duration = meta.find(p => /^\d+:\d{2}$/.test(p)) || ''

  // Leading metadata that isn't a person/album (play counts, views).
  const isStat = (s) => /^[\d.,]+[KMB]? (plays|views|subscribers|songs|likes|monthly listeners)$/i.test(s)
  const content = meta.filter(p => p !== duration && !isStat(p))

  return {
    kind,
    id: videoId || browseId,
    videoId, browseId, pageType,
    title,
    subtitle: parts.join(' • '),
    duration,
    // For tracks: first non-stat part is the artist, the rest (usually the
    // album) is the secondary line. For albums/artists/playlists: subtitle.
    artist: kind === 'track' ? (content[0] || '') : '',
    album: kind === 'track' ? content.slice(1).join(' • ') : '',
    thumbnail: musicThumb(item),
  }
}

// All shelves in a browse response, in document order (home, charts, library).
function musicShelves(data) {
  const sections = []
  for (const c of musicWalk(data, 'musicCarouselShelfRenderer', [], 40)) {
    const title = musicText(c.header && c.header.musicCarouselShelfBasicHeaderRenderer
      && c.header.musicCarouselShelfBasicHeaderRenderer.title)
    sections.push({
      title,
      items: (c.contents || []).map(x =>
        x.musicTwoRowItemRenderer ? musicCardFrom(x.musicTwoRowItemRenderer)
          : x.musicResponsiveListItemRenderer ? musicListItem(x.musicResponsiveListItemRenderer)
          : null).filter(Boolean),
    })
  }
  for (const s of musicWalk(data, 'musicShelfRenderer', [], 40)) {
    const title = musicText(s.title)
    sections.push({
      title,
      items: (s.contents || []).map(x =>
        x.musicResponsiveListItemRenderer ? musicListItem(x.musicResponsiveListItemRenderer)
          : x.musicTwoRowItemRenderer ? musicCardFrom(x.musicTwoRowItemRenderer)
          : null).filter(Boolean),
    })
  }
  for (const g of musicWalk(data, 'gridRenderer', [], 10)) {
    sections.push({
      title: '',
      items: (g.items || []).map(x =>
        x.musicTwoRowItemRenderer ? musicCardFrom(x.musicTwoRowItemRenderer)
          : x.musicResponsiveListItemRenderer ? musicListItem(x.musicResponsiveListItemRenderer)
          : null).filter(Boolean),
    })
  }
  return sections.filter(s => s.items.length)
}

// Continuation token for "load more". Playlists carry their track continuation
// on a section-reload token in frameworkUpdates, so prefer it over the
// page-level nextContinuationData (which would only reload other sections).
function musicContinuation(data) {
  const cmd = musicFirst(data, 'continuationCommand')
  if (cmd && cmd.token) return cmd.token
  const reload = musicFirst(data, 'reloadContinuationData')
  if (reload && reload.continuation) return reload.continuation
  const next = musicFirst(data, 'nextContinuationData')
  if (next && next.continuation) return next.continuation
  return ''
}

// Album / playlist detail: header + ordered, de-duplicated tracks.
function musicBrowseResult(data) {
  const h = musicFirst(data, 'musicResponsiveHeaderRenderer')
    || musicFirst(data, 'musicDetailHeaderRenderer')
    || musicFirst(data, 'musicEditablePlaylistDetailHeaderRenderer')
  const header = h ? {
    title: musicText(h.title),
    subtitle: musicText(h.subtitle),
    // Album/playlist owner lives on the strapline; the track rows often omit it.
    artist: musicText(h.straplineTextOne),
    thumbnail: musicThumb(h),
  } : null

  const shelf = musicFirst(data, 'musicPlaylistShelfRenderer')
  const rows = shelf && Array.isArray(shelf.contents) ? shelf.contents
    : (musicFirst(data, 'musicShelfRenderer') || {}).contents
  const tracks = (Array.isArray(rows) && rows.length ? rows : musicWalk(data, 'musicResponsiveListItemRenderer', [], 300))
    .map(x => musicListItem(x.musicResponsiveListItemRenderer || x))
    .filter(t => t && t.videoId)
  const seen = new Set()
  const unique = tracks.filter(t => { if (seen.has(t.videoId)) return false; seen.add(t.videoId); return true })
  if (header && header.artist) {
    for (const t of unique) if (!t.artist) t.artist = header.artist
  }
  return { header, tracks: unique, continuation: musicContinuation(data) }
}

// Harvest the live search chip params so our filter labels always map to what
// the API currently expects.
function harvestMusicFilters(data) {
  for (const c of musicWalk(data, 'chipCloudChipRenderer', [], 20)) {
    const label = musicText(c.text).toLowerCase()
    const p = c.navigationEndpoint && c.navigationEndpoint.searchEndpoint && c.navigationEndpoint.searchEndpoint.params
    if (!p) continue
    if (label.includes('song')) MUSIC_FILTER_PARAMS.songs = p
    else if (label.includes('album')) MUSIC_FILTER_PARAMS.albums = p
    else if (label.includes('artist')) MUSIC_FILTER_PARAMS.artists = p
    else if (label.includes('playlist') && !MUSIC_FILTER_PARAMS._playlistSet) {
      MUSIC_FILTER_PARAMS.playlists = p
      MUSIC_FILTER_PARAMS._playlistSet = true
    }
  }
}

// ── Music data fetchers ─────────────────────────────────────────────────────

let musicHomeCache = { ts: 0, data: null }

async function getMusicHome() {
  if (musicHomeCache.data && Date.now() - musicHomeCache.ts < 10 * 60 * 1000) return musicHomeCache.data
  const j = await musicPost('browse', { browseId: 'FEmusic_home' })
  const data = { shelves: musicShelves(j), error: null }
  musicHomeCache = { ts: Date.now(), data }
  return data
}

async function getMusicCharts() {
  const j = await musicPost('browse', { browseId: 'FEmusic_charts' })
  return { shelves: musicShelves(j), error: null }
}

async function musicSearch(query, filter) {
  if (!query || !query.trim()) return { items: [], continuation: '', error: null }
  const params = filter && MUSIC_FILTER_PARAMS[filter] ? MUSIC_FILTER_PARAMS[filter] : ''
  const j = await musicPost('search', { query: query.trim(), ...(params ? { params } : {}) })
  harvestMusicFilters(j)
  const items = musicWalk(j, 'musicResponsiveListItemRenderer', [], 200).map(musicListItem).filter(Boolean)
  const seen = new Set()
  const unique = items.filter(t => { if (!t.id || seen.has(t.id)) return false; seen.add(t.id); return true })
  return { items: unique, continuation: musicContinuation(j), error: null }
}

async function musicBrowse(browseId) {
  if (!browseId) return { header: null, tracks: [], continuation: '', error: 'Missing browse id' }
  const j = await musicPost('browse', { browseId })
  return { ...musicBrowseResult(j), error: null }
}

async function musicBrowseMore(continuation) {
  if (!continuation) return { tracks: [], continuation: '', error: null }
  const j = await musicPost('browse', { continuation })
  // Continuation responses may nest under continuationContents.
  return { ...musicBrowseResult(j), error: null }
}

// ── Lyrics ──────────────────────────────────────────────────────────────────
// YouTube Music's own lyrics come back as a single untimed text blob, so there
// is nothing to sync to. For the "follow the song" view we fetch timestamped
// (LRC) lyrics from LRCLIB, a free community lyrics API, matched by
// title/artist/duration. When no synced match is found we still return
// YouTube's plain lyrics.

const LRCLIB_BASE = 'https://lrclib.net/api'
const LRCLIB_UA = 'YoutubePlayerDesktop/1.0 (https://github.com/yt-desktop)'

// Parse LRC text into lines with per-word timings:
//   [{ t, text, words: [{ t, w }] }]
// Handles multiple timestamps per line and enhanced (word-level) <mm:ss.xx>
// tags. Most LRCLIB entries are line-level only, so when a line has no word
// timings we interpolate them across the line so the UI can still highlight
// word by word as it is sung.
function parseLrc(lrc) {
  const lines = []
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g)]
    if (!stamps.length) continue
    const body = raw.replace(/\[[^\]]*\]/g, '').trim()
    // Enhanced LRC word tags: <mm:ss.xx>word
    const words = []
    const wre = /<(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)>\s*([^<]*)/g
    let wm
    while ((wm = wre.exec(body))) {
      const w = wm[3].trim()
      if (w) words.push({ t: parseInt(wm[1], 10) * 60 + parseFloat(wm[2]), w })
    }
    const text = body.replace(/<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/g, '').trim()
    for (const s of stamps) {
      lines.push({
        t: parseInt(s[1], 10) * 60 + parseFloat(s[2]),
        text,
        words: words.length ? words.map((w) => ({ ...w })) : null,
      })
    }
  }
  lines.sort((a, b) => a.t - b.t)

  // Interpolate word timings for line-level lyrics. Weights favour syllables
  // (with a little for word length) so long words hold the highlight longer,
  // which tracks singing more closely than a flat per-character split.
  const syllables = (w) => {
    const m = String(w).toLowerCase().match(/[aeiouy]+/g)
    return Math.max(1, m ? m.length : 1)
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.words || !line.text) continue
    const tokens = line.text.split(/\s+/).filter(Boolean)
    if (!tokens.length) continue
    const next = lines[i + 1]
    const gap = next ? Math.max(0.3, next.t - line.t) : 4
    const weights = tokens.map((w) => syllables(w) + w.length * 0.15)
    const total = weights.reduce((n, x) => n + x, 0) || 1
    const est = total * 0.26 + 0.35 // rough time to sing the line
    const dur = Math.min(gap, Math.max(est, 0.7))
    let acc = 0
    line.words = tokens.map((w, k) => {
      const t = line.t + (dur * acc) / total
      acc += weights[k]
      return { t, w }
    })
  }
  return lines
}

function cleanTrackName(s) {
  return String(s || '')
    .replace(/\s*[\(\[][^\)\]]*(?:feat\.?|ft\.?|with|official|lyric|audio|video|remaster|edit|version|mix|live|explicit)[^\)\]]*[\)\]]/gi, ' ')
    .replace(/[\(\[][^\)\]]*[\)\]]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function cleanArtistName(s) {
  return String(s || '')
    .replace(/[\(\[][^\)\]]*[\)\]]/g, ' ')
    .split(/\s*(?:,|&|feat\.?|ft\.?|with|\bx\b)\s+/i)[0]
    .replace(/\s{2,}/g, ' ')
    .trim()
}

async function lrclibRequest(path, params) {
  const url = `${LRCLIB_BASE}/${path}?${new URLSearchParams(params)}`
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': LRCLIB_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (r.status === 404) return []
      if (r.status === 429 || r.status === 503) { await new Promise((s) => setTimeout(s, 800 * (attempt + 1))); continue }
      if (!r.ok) { lastErr = new Error(`LRCLIB HTTP ${r.status}`); continue }
      const data = await r.json()
      return Array.isArray(data) ? data : [data]
    } catch (e) { lastErr = e }
  }
  if (lastErr) throw lastErr
  return []
}

// Prefer a synced candidate whose duration is closest to ours, then a title match.
// Demote remixes/live/instrumental cuts so we don't sync to the wrong edit.
function bestSyncedCandidate(cands, { track, duration }) {
  const want = String(track || '').toLowerCase()
  let best = null
  let bestScore = -Infinity
  for (const c of cands) {
    if (!c || !c.syncedLyrics) continue
    const cTitle = String(c.trackName || '').toLowerCase()
    let score = 0
    if (duration && c.duration) score -= Math.abs(c.duration - duration) / 8
    if (cTitle === want) score += 6
    else if (want && (cTitle.includes(want) || want.includes(cTitle))) score += 2
    if (/(remix|live|instrumental|karaoke|cover|extended|acoustic|sped up|slowed|nightcore)/i.test(c.trackName || '')) score -= 5
    if (c.instrumental) score -= 8
    if (score > bestScore) { bestScore = score; best = c }
  }
  return best
}

async function getSyncedLyrics(track, artist, duration) {
  const name = cleanTrackName(track)
  if (!name) return null
  const by = cleanArtistName(artist)
  const params = by ? { track_name: name, artist_name: by } : { track_name: name }
  let cands = await lrclibRequest('search', params)
  if (!cands.length && by) cands = await lrclibRequest('search', { q: `${name} ${by}` })
  if (!cands.length) cands = await lrclibRequest('search', { q: name })
  const best = bestSyncedCandidate(cands, { track: name, duration })
  if (!best) return null
  const lines = parseLrc(best.syncedLyrics)
  if (lines.length < 2) return null
  return { lines, matched: { title: best.trackName, artist: best.artistName, duration: best.duration } }
}

// YouTube's own lyrics. They sit behind a two-step flow: `next` returns the
// watch tabs (one of which is "Lyrics", carrying a MPLYt_* browse id), and
// browsing that id returns a musicDescriptionShelfRenderer holding the text.
// Songs without lyrics answer with a messageRenderer ("Lyrics not available")
// instead, which we surface as the reason. Lyrics are public, so the
// sessionless musicPost is enough (no sign-in required).
async function getYtMusicLyrics(videoId) {
  if (!videoId) return { ok: false, reason: 'No video ID' }
  const next = await musicPost('next', {
    videoId,
    isAudioOnly: true,
    tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
  })
  const tabs = musicWalk(next, 'tabRenderer', [], 20)
  const lyricsTab = tabs.find((t) => {
    const bid = t.endpoint && t.endpoint.browseEndpoint && t.endpoint.browseEndpoint.browseId
    // The Lyrics tab id is always MPLYt_*; the title check is a locale fallback.
    return (bid && bid.startsWith('MPLYt_')) || /lyric/i.test(musicText(t.title))
  })
  const browseId = lyricsTab && lyricsTab.endpoint && lyricsTab.endpoint.browseEndpoint
    && lyricsTab.endpoint.browseEndpoint.browseId
  if (!browseId) return { ok: false, reason: 'No lyrics for this track' }

  const data = await musicPost('browse', { browseId })
  const shelf = musicFirst(data, 'musicDescriptionShelfRenderer')
  const lyrics = shelf ? musicText(shelf.description) : ''
  const message = musicFirst(data, 'messageRenderer')
  if (lyrics) {
    return { ok: true, lyrics, footer: musicText(shelf.footer), source: 'ytmusic' }
  }
  return { ok: false, reason: (message && musicText(message.text)) || 'Lyrics not available' }
}

// Combined: plain lyrics from YouTube Music + timed lines from LRCLIB.
async function getMusicLyrics({ videoId, title, artist, duration } = {}) {
  const yt = await getYtMusicLyrics(videoId)
  let synced = null
  try {
    const s = await getSyncedLyrics(title, artist, duration)
    if (s) synced = s.lines
  } catch (e) { console.warn('[Music] synced lyrics', e.message) }
  return { ...yt, synced, ok: !!(synced && synced.length) || !!yt.ok }
}

// ── Signed-in library (reuses the app's hidden authed window) ───────────────

let musicAuthedWin = null
let musicAuthedWinPromise = null

async function ensureMusicAuthedWindow() {
  if (musicAuthedWinPromise) return musicAuthedWinPromise
  musicAuthedWinPromise = (async () => {
    if (musicAuthedWin && !musicAuthedWin.isDestroyed()) {
      const url = musicAuthedWin.webContents.getURL()
      if (url && url.includes('music.youtube.com')) return musicAuthedWin
      try { await musicAuthedWin.loadURL('https://music.youtube.com/') } catch (e) { /* retry below */ }
      return musicAuthedWin
    }
    musicAuthedWin = new BrowserWindow({
      show: false,
      width: 900, height: 1200,
      webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
    })
    musicAuthedWin.on('closed', () => { musicAuthedWin = null })
    try { musicAuthedWin.webContents.setBackgroundThrottling(false) } catch (e) { /* ignore */ }
    try { await musicAuthedWin.loadURL('https://music.youtube.com/') } catch (e) { /* ignore */ }
    return musicAuthedWin
  })().finally(() => { musicAuthedWinPromise = null })
  return musicAuthedWinPromise
}

function destroyMusicAuthedWindow() {
  try { if (musicAuthedWin && !musicAuthedWin.isDestroyed()) musicAuthedWin.destroy() } catch (e) { /* ignore */ }
  musicAuthedWin = null
}

// Run a music browse inside the music.youtube.com page so Chromium attaches the
// account cookies, and add the SAPISIDHASH authorization the WEB_REMIX innertube
// expects for signed-in calls (cookies alone are treated as anonymous here).
async function authedMusicBrowse(body) {
  const win = await ensureMusicAuthedWindow()
  const sapisid = auth.cookiesByKey['__Secure-3PAPISID'] || auth.cookiesByKey['SAPISID'] || auth.cookiesByKey['__Secure-1PAPISID'] || ''
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      try {
        const cfg = (window.ytcfg && window.ytcfg.get) ? window.ytcfg.get('INNERTUBE_CONTEXT') || {} : {}
        const client = cfg.client || {}
        const clientVersion = client.clientVersion || ${JSON.stringify(MUSIC_CLIENT.clientVersion)}
        const apiKey = (window.ytcfg && window.ytcfg.get && window.ytcfg.get('INNERTUBE_API_KEY')) || ${JSON.stringify(YOUTUBE_KEY)}
        let body = JSON.parse(${JSON.stringify(JSON.stringify(body))})
        if (!body.context) body.context = {}
        body.context = Object.assign({}, cfg, body.context)
        body.context.client = Object.assign({}, cfg.client || {}, body.context.client || {})
        if (!body.context.client.clientName) body.context.client.clientName = 'WEB_REMIX'
        if (!body.context.client.clientVersion) body.context.client.clientVersion = ${JSON.stringify(MUSIC_CLIENT.clientVersion)}
        const sapisid = ${JSON.stringify(sapisid)}
        let authHeaders = {}
        if (sapisid) {
          const ts = Math.floor(Date.now() / 1000)
          const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ts + ' ' + sapisid + ' https://music.youtube.com'))
          const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
          authHeaders = {
            'Authorization': 'SAPISIDHASH ' + ts + '_' + hex,
            'X-Origin': 'https://music.youtube.com',
            'X-Goog-AuthUser': '0',
          }
        }
        const res = await fetch(${JSON.stringify(YOUTUBE_MUSIC_BASE + '/browse?prettyPrint=false')} + '&key=' + encodeURIComponent(apiKey), {
          method: 'POST',
          headers: Object.assign({
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': '67',
            'X-YouTube-Client-Version': clientVersion,
            'Origin': 'https://music.youtube.com',
            'Referer': 'https://music.youtube.com/',
          }, authHeaders),
          credentials: 'include',
          body: JSON.stringify(body),
        })
        const text = await res.text()
        return { ok: res.ok, status: res.status, text: text }
      } catch (e) {
        return { ok: false, status: 0, text: String(e && e.message || e) }
      }
    })()
  `).then(v => (v && v.value !== undefined ? v.value : v), err => {
    console.error('[MusicAuth] executeJavaScript error:', err.message)
    return { ok: false, status: 0, text: '' }
  })
  try { return JSON.parse((result && result.text) || '') } catch (e) { return null }
}

function musicSignedIn() {
  return !!(auth.cookies && (auth.cookiesByKey['SAPISID'] || auth.cookiesByKey['__Secure-1PSID'] || auth.cookiesByKey['SID'] || auth.cookiesByKey['HSID']))
}

async function getMusicLibrary() {
  if (!musicSignedIn()) return { signedIn: false, shelves: [], items: [], error: null }
  try {
    const j = await authedMusicBrowse({ browseId: 'FEmusic_library_landing' })
    if (!j) return { signedIn: true, shelves: [], items: [], error: 'Library unavailable' }
    const shelves = musicShelves(j)
    const items = shelves.flatMap(s => s.items)
    return { signedIn: true, shelves, items, error: null }
  } catch (e) {
    console.error('[Music] library error:', e.message)
    return { signedIn: true, shelves: [], items: [], error: e.message }
  }
}

// ── Audio-only stream resolution (no ffmpeg) ────────────────────────────────
// getMediaUrls already races innertube vs yt-dlp and caches by videoId; for
// music we only need the audio URL, which plays directly.
async function getAudioStream(videoId) {
  if (!videoId) return { ok: false, reason: 'No video ID' }
  const r = await getMediaUrls(videoId, 'auto')
  if (!r || !r.ok || !r.audioUrl) return { ok: false, reason: (r && r.reason) || 'No audio stream' }
  return { ok: true, audioUrl: r.audioUrl, source: r.source || 'unknown' }
}

// ─── In-App Video Streaming (yt-dlp + ffmpeg HLS relay) ────────────────────

const streamProcesses = new Map() // videoId -> { ffmpeg, ytdlp, dir }
const streamUrlCache = new Map() // videoId -> { ts, videoUrl, audioUrl } (DASH URLs expire ~6h)
const streamUrlInflight = new Map() // videoId -> Promise (shared while resolving)

// ── Stream URL resolution ───────────────────────────────────────────────────
// Two strategies race on a cache miss:
//   1. innertube fast path — one player-API POST per client, bootstrapping a
//      visitor session from the response itself (~0.3-0.7s total) reading
//      plain googlevideo URLs straight out of streamingData;
//   2. yt-dlp -g (~1.5-5s) — handles everything else (ciphers, odd formats,
//      live, anything the fast path can't verify).
// Whichever returns a valid pair first wins and the loser is discarded, so the
// fast path can only ever speed things up — a miss degrades to today's behavior.

// Innertube clients whose player responses carry plain (unciphered) URLs.
// New uploads harden stream URLs: without a visitor session the player API
// answers LOGIN_REQUIRED (VISIONOS) or hands out "teaser-capped" URLs that
// only serve the first ~third of the file (IOS/ANDROID). With the session
// (ytVisitorData below — yt-dlp gets the same value from the watch page),
// VISIONOS returns fully readable URLs on both new and old videos, so it
// leads; ANDROID_VR stays as fast fallback for old videos. verifyPairReadable
// deep-probes every pair so a capped URL can never win the race and stall
// playback mid-video.
const INNERTUBE_STREAM_CLIENTS = [
  {
    label: 'visionos',
    clientNameNum: '101',
    client: { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en', gl: 'US', timeZone: 'UTC', utcOffsetMinutes: 0 },
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  },
  {
    label: 'android_vr',
    clientNameNum: '28',
    client: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', hl: 'en', gl: 'US', timeZone: 'UTC', utcOffsetMinutes: 0 },
    ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19',
  },
]

// Pick an avc1/mp4 video URL + m4a audio URL with no signature cipher, capped
// at the requested height (mirrors the yt-dlp format selector below). Anything
// uncertain (ciphered, PO-token gated, live/HLS-only) returns null → yt-dlp.
function pickInnertubePair(data, quality) {
  if (data?.playabilityStatus?.status !== 'OK') return null
  const adaptive = data?.streamingData?.adaptiveFormats
  if (!Array.isArray(adaptive) || !adaptive.length) return null
  const maxH = quality && quality !== 'auto' ? parseInt(quality, 10) : 1080
  const cap = Number.isFinite(maxH) ? maxH : 1080
  const plain = (f) => typeof f.url === 'string' && !f.signatureCipher && !f.cipher
  const vids = adaptive
    .filter((f) => plain(f) && (f.mimeType || '').startsWith('video/') && f.mimeType.includes('avc1') && f.mimeType.includes('mp4') && (f.height || 0) <= cap)
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0))
  const auds = adaptive
    .filter((f) => plain(f) && (f.mimeType || '').startsWith('audio/') && (f.mimeType || '').includes('mp4a'))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  if (!vids.length || !auds.length) return null
  return { videoUrl: vids[0].url, audioUrl: auds[0].url, height: vids[0].height }
}

// Visitor session for the player API: new uploads only hand fully readable
// stream URLs when the call carries one. Conveniently, the LOGIN_REQUIRED
// response itself returns a usable visitorData — so the first player call of
// a session bootstraps it for free (no watch-page fetch). It's also harvested
// from every OK response and kept for the session; if the API ever answers
// LOGIN_REQUIRED again the fresh value from that response is retried once.
// This mirrors what yt-dlp does with the watch-page ytcfg, minus the page.
let ytVisitorData = null

async function innertubePlayer(c, videoId) {
  const call = async (vd) => {
    const client = { ...c.client }
    if (vd) client.visitorData = vd
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': c.ua,
      Origin: 'https://www.youtube.com',
      'X-YouTube-Client-Name': c.clientNameNum,
      'X-YouTube-Client-Version': c.client.clientVersion,
    }
    if (vd) headers['X-Goog-Visitor-Id'] = vd
    const r = await fetch(`${YOUTUBE_PLAYER_URL}?key=${YOUTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ context: { client }, videoId, contentCheckOk: true, racyCheckOk: true }),
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return { http: r.status, data: null }
    return { http: 200, data: await r.json() }
  }
  let res = await call(ytVisitorData)
  if (res.data?.playabilityStatus?.status === 'LOGIN_REQUIRED') {
    const fresh = res.data?.responseContext?.visitorData
    if (fresh && fresh !== ytVisitorData) {
      ytVisitorData = fresh
      res = await call(fresh)
    }
  }
  const respVd = res.data?.responseContext?.visitorData
  if (respVd) ytVisitorData = respVd
  return res
}

// New uploads only serve the first ~third of a stream URL's file unless the
// request looks like a browser session; a pair that starts fine but dies at
// the cap would stall playback mid-video, so both files must prove they're
// readable deep into the body (tiny range GET near the end: 206 = full file,
// 403 = teaser-capped → reject the pair).
async function verifyPairReadable(pair) {
  const deepProbe = async (u) => {
    try {
      const clen = parseInt(new URL(u).searchParams.get('clen'), 10)
      if (!Number.isFinite(clen) || clen < 4096) return false
      const start = Math.floor(clen * 0.9)
      const r = await fetch(u, { headers: { Range: `bytes=${start}-${start + 2047}` }, signal: AbortSignal.timeout(4000) })
      await r.body?.cancel().catch(() => {})
      return r.status === 206
    } catch { return false }
  }
  const [vOk, aOk] = await Promise.all([deepProbe(pair.videoUrl), deepProbe(pair.audioUrl)])
  return vOk && aOk
}

async function resolveInnertube(videoId, quality) {
  for (const c of INNERTUBE_STREAM_CLIENTS) {
    const t0 = Date.now()
    try {
      const res = await innertubePlayer(c, videoId)
      if (res.http !== 200) {
        console.log(`[stream] innertube ${c.label}: HTTP ${res.http} (${Date.now() - t0}ms)`)
        continue
      }
      const data = res.data
      const pair = pickInnertubePair(data, quality)
      if (pair) {
        if (await verifyPairReadable(pair)) {
          console.log(`[stream] innertube ${c.label} hit ${Date.now() - t0}ms h=${pair.height} (readable)`)
          return { ok: true, ...pair }
        }
        console.log(`[stream] innertube ${c.label} rejected ${Date.now() - t0}ms (teaser-capped URLs)`)
        continue
      }
      console.log(`[stream] innertube ${c.label} miss ${Date.now() - t0}ms (${data?.playabilityStatus?.status || data?.error?.message || 'no usable URLs'})`)
    } catch (e) {
      console.log(`[stream] innertube ${c.label} error ${Date.now() - t0}ms: ${e.message}`)
    }
  }
  return { ok: false, reason: 'innertube fast path missed' }
}

// yt-dlp resolution, refactored to expose a kill handle so the race below can
// discard it when the fast path wins first.
function startYtDlpResolve(videoId, quality) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  // Force H.264 (avc1) video: AV1/VP9 won't mux into MPEG-TS as a real video
  // track with `-c copy` (becomes bin_data), so playback fails. Chromium handles
  // H.264 + AAC, so constrain to avc1/m4a.
  const vcodec = '[vcodec^=avc1]'
  const format = quality && quality !== 'auto'
    ? `bestvideo${vcodec}[height<=${parseInt(quality)}][ext=mp4]+bestaudio[ext=m4a]/bestvideo${vcodec}[height<=${parseInt(quality)}]+bestaudio`
    : `bestvideo${vcodec}[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo${vcodec}[height<=1080]+bestaudio`
  let proc = null
  let exited = false
  const promise = new Promise((resolve) => {
    proc = spawn('yt-dlp', [
      '--js-runtimes', 'node',
      '-g', '-f', format, '--no-playlist', '--skip-download',
      '--no-colors', videoUrl,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let out = ''
    proc.stdout.on('data', (c) => { out += c.toString() })
    proc.on('error', (e) => { exited = true; resolve({ ok: false, reason: e.message }) })
    proc.on('close', (code) => {
      exited = true
      const urls = out.split('\n').map(s => s.trim()).filter(Boolean)
      if (code !== 0 || urls.length < 2) {
        resolve({ ok: false, reason: `yt-dlp could not resolve streams (code ${code})` })
        return
      }
      resolve({ ok: true, videoUrl: urls[0], audioUrl: urls[1] })
    })
  })
  return {
    promise,
    kill: () => { try { if (!exited && proc && !proc.killed) proc.kill('SIGKILL') } catch { /* already gone */ } },
  }
}

function raceResolveMediaUrls(videoId, quality) {
  const ytdlp = startYtDlpResolve(videoId, quality)
  return new Promise((resolve) => {
    let done = false
    let ytdlpFailed = null
    let innertubeMissed = false
    const finish = (r) => {
      if (done) return
      done = true
      ytdlp.kill() // no-op when the winner was yt-dlp itself (already exited)
      resolve(r)
    }
    const settleIfBothMissed = () => {
      if (done || !innertubeMissed || !ytdlpFailed) return
      done = true
      resolve(ytdlpFailed)
    }
    ytdlp.promise.then((r) => {
      if (r.ok) finish({ ...r, source: 'ytdlp' })
      else { ytdlpFailed = r; settleIfBothMissed() }
    })
    resolveInnertube(videoId, quality).then((r) => {
      if (r.ok) finish({ ...r, source: 'innertube' })
      else { innertubeMissed = true; settleIfBothMissed() }
    })
  })
}

async function getMediaUrls(videoId, quality, opts = {}) {
  // A previous innertube result failed relay startup: skip cache + fast path
  // and resolve cleanly with yt-dlp (registered as inflight so prewarm shares it).
  if (opts.forceYtDlp) {
    const p = startYtDlpResolve(videoId, quality).promise
      .then((r) => {
        if (r.ok) streamUrlCache.set(videoId, { ts: Date.now(), videoUrl: r.videoUrl, audioUrl: r.audioUrl, source: 'ytdlp' })
        return { ...r, source: 'ytdlp' }
      })
      .finally(() => { if (streamUrlInflight.get(videoId) === p) streamUrlInflight.delete(videoId) })
    streamUrlInflight.set(videoId, p)
    return p
  }

  const cached = streamUrlCache.get(videoId)
  if (cached && Date.now() - cached.ts < 3.5 * 3600 * 1000) {
    console.log('[stream] using cached URLs for', videoId, `(${cached.source || 'ytdlp'})`)
    return { ok: true, videoUrl: cached.videoUrl, audioUrl: cached.audioUrl, source: 'cache' }
  }
  // Dedupe concurrent resolution (e.g. prewarm racing the actual stream start).
  const inflight = streamUrlInflight.get(videoId)
  if (inflight) return inflight

  const p = raceResolveMediaUrls(videoId, quality)
    .then((r) => {
      if (r.ok) streamUrlCache.set(videoId, { ts: Date.now(), videoUrl: r.videoUrl, audioUrl: r.audioUrl, source: r.source })
      return r
    })
    .finally(() => { if (streamUrlInflight.get(videoId) === p) streamUrlInflight.delete(videoId) })
  streamUrlInflight.set(videoId, p)
  return p
}

function startHlsRelay(videoId, videoUrl, audioUrl, cb) {
  const dir = path.join(STREAM_CACHE_DIR, videoId)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(dir, { recursive: true })
  const m3u8 = path.join(dir, 'index.m3u8')
  const args = [
    '-y',
    '-i', videoUrl,
    '-i', audioUrl,
    '-c', 'copy',
    '-f', 'hls',
    '-hls_time', '1',
    '-hls_list_size', '0',
    '-hls_flags', 'independent_segments',
    '-hls_segment_type', 'mpegts',
    '-start_number', '0',
    m3u8,
  ]
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  let errLog = ''
  proc.stderr.on('data', (c) => { errLog += c.toString() })
  proc.on('error', (e) => { console.error('[stream] ffmpeg spawn error:', e.message); stopStream(videoId); cb({ ok: false, reason: e.message }) })
  proc.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[stream] ffmpeg exited code=${code}:`, errLog.slice(-1200))
      stopStream(videoId)
      cb({ ok: false, reason: `ffmpeg exited with code ${code}` })
    }
  })
  streamProcesses.set(videoId, { ffmpeg: proc, dir })
  cb({ ok: true, dir })
}

function stopStream(videoId) {
  const entry = streamProcesses.get(videoId)
  if (entry) {
    if (entry.ffmpeg && !entry.ffmpeg.killed) entry.ffmpeg.kill('SIGKILL')
    streamProcesses.delete(videoId)
  }
}

function streamUrlFor(videoId) {
  return `http://127.0.0.1:${staticServerPort}/stream/${videoId}/index.m3u8`
}

async function startRelayAndWait(videoId, urls, phase) {
  const dir = path.join(STREAM_CACHE_DIR, videoId)
  const m3u8 = path.join(dir, 'index.m3u8')
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(dir, { recursive: true })

  let relayError = null
  phase('starting')
  await new Promise((resolve) => {
    startHlsRelay(videoId, urls.videoUrl, urls.audioUrl, (res) => {
      if (!res.ok) relayError = res.reason
      resolve()
    })
  })
  if (relayError) return { ok: false, reason: relayError }

  // Wait until ffmpeg has actually produced a playable playlist before telling
  // the renderer the URL is ready. Otherwise hls.js 404s on the first request.
  const deadline = Date.now() + 20000
  phase('buffering')
  const ready = await new Promise((resolveReady) => {
    const check = () => {
      const running = streamProcesses.has(videoId)
      let hasPlaylist = false
      try {
        if (fs.existsSync(m3u8)) {
          const body = fs.readFileSync(m3u8, 'utf8')
          hasPlaylist = body.includes('#EXTINF')
        }
      } catch {}
      if (hasPlaylist) return resolveReady(true)
      if (!running || Date.now() > deadline) return resolveReady(false)
      setTimeout(check, 150)
    }
    check()
  })
  if (!ready) {
    stopStream(videoId)
    return { ok: false, reason: 'Stream timed out while starting' }
  }
  return { ok: true }
}

async function startPlaybackStream(videoId, quality, onPhase) {
  const t0 = Date.now()
  const phase = (label) => { if (onPhase) { try { onPhase(label) } catch {} } }
  phase('resolving')
  let urls = await getMediaUrls(videoId, quality)
  if (!urls.ok) return { ok: false, reason: urls.reason }
  const tResolve = Date.now() - t0
  let source = urls.source || 'ytdlp'

  const tRelay = Date.now()
  let relay = await startRelayAndWait(videoId, urls, phase)
  // Safety net: if the innertube fast path produced URLs ffmpeg can't use
  // (dead/throttled/odd codec), invalidate them and retry once with yt-dlp only.
  if (!relay.ok && source === 'innertube') {
    console.log(`[stream] innertube relay failed (${relay.reason}) — retrying with yt-dlp`)
    streamUrlCache.delete(videoId)
    phase('resolving')
    urls = await getMediaUrls(videoId, quality, { forceYtDlp: true })
    if (!urls.ok) return { ok: false, reason: urls.reason }
    source = 'ytdlp'
    relay = await startRelayAndWait(videoId, urls, phase)
  }
  if (!relay.ok) return { ok: false, reason: relay.reason }

  console.log(`[stream-timing] id=${videoId} source=${source} resolve=${tResolve}ms relay=${Date.now() - tRelay}ms total=${Date.now() - t0}ms`)
  return { ok: true, url: streamUrlFor(videoId) }
}

async function prepareLocalPlayback(filePath) {
  if (!filePath || typeof filePath !== 'string') return null
  const normalized = path.normalize(filePath)
  if (!fs.existsSync(normalized)) return null
  // Build a proper ytfile:// URL. The scheme is "standard" so a host is required,
  // but the filesystem path must live in the pathname (slash-by-slash encoded).
  const encodedPath = normalized.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  return `ytfile://localhost${encodedPath}`
}

// ─── Settings (persisted to settings.json) ──────────────────────────────────

const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json')

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accentColor: 'red',
  autoplay: true,
  defaultQuality: 'auto',
  defaultDownloadFormat: 'mp4',
  downloadDir: DOWNLOADS_DIR,
  showDescriptions: true,
  reduceMotion: false,
  playbackMode: 'inApp', // 'inApp' | 'iframe'
  smartDlClipboard: false, // smart-download from clipboard is OFF by default; FYP feed is the default source
  smartDlLimit: 10,        // max smart downloads in total (0 = unlimited)
  smartDlConcurrency: 2,   // max concurrent smart downloads
  smartDlCount: 0,         // persistent total count of smart downloads started
  smartDlInterval: 60,     // minutes between auto-download checks
  fypSource: 'auto',       // 'auto' (personalized when signed in) | 'signedIn' | 'anon'
}

let settingsCache = { ...DEFAULT_SETTINGS }

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
      settingsCache = { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch (e) {
    console.error('[Settings] Failed to load:', e.message)
  }
  return { ...settingsCache }
}

function saveSettings(patch) {
  settingsCache = { ...settingsCache, ...patch }
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settingsCache, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Settings] Failed to save:', e.message)
  }
  return { ...settingsCache }
}

// ─── YTDown.to Conversion Service ────────────────────────────────────────────

const YTDOWN_BASE = 'https://app.ytdown.to/en38'
const YTDOWN_ENDPOINTS = ['/api/convert', '/api/info', '/api/resolve', '/api/video']

function extractVideoId(url) {
  if (!url) return null
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : (url.match(/^([a-zA-Z0-9_-]{11})$/) || [])[1] || null
}

async function tryYtdownConversion(videoUrl) {
  for (const ep of YTDOWN_ENDPOINTS) {
    let tmr = null
    try {
      const ctrl = new AbortController()
      tmr = setTimeout(() => ctrl.abort(), 10000)
      const r = await fetch(`${YTDOWN_BASE}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: YTDOWN_BASE, Referer: `${YTDOWN_BASE}/` },
        body: JSON.stringify({ url: videoUrl }),
        signal: ctrl.signal,
      })
      clearTimeout(tmr)
      tmr = null
      if (!r.ok) continue
      const ct = r.headers.get('content-type') || ''
      if (!ct.includes('json')) continue
      const d = await r.json()
      const formats = []
      if (Array.isArray(d?.formats)) {
        d.formats.forEach(f => formats.push({ quality: f.quality || f.label || 'Unknown', format: f.format || f.ext || 'mp4', url: f.url || f.download_url || '', size: f.size || f.filesize || '', type: f.type || 'video' }))
      }
      if (d?.links) {
        Object.entries(d.links).forEach(([q, ld]) => { const l = Array.isArray(ld) ? ld[0] : ld; if (l?.url) formats.push({ quality: q, format: l.ext || 'mp4', url: l.url, size: l.size || '', type: 'video' }) })
      }
      if (formats.length) return { source: 'ytdown', title: d.title || '', formats }
    } catch { if (tmr) clearTimeout(tmr); continue }
  }
  return null
}

async function getConversionFormats(videoUrl) {
  const ytdown = await tryYtdownConversion(videoUrl)
  if (ytdown?.formats?.length) return ytdown

  const vid = extractVideoId(videoUrl)
  if (!vid) return { source: 'unavailable', formats: [], error: 'Could not extract video ID' }
  return {
    source: 'ytdown-pending', videoId: vid, error: null,
    formats: [
      ...['1080p (Full HD)', '720p (HD)', '480p', '360p'].map(q => ({ quality: q, format: 'mp4', url: '', size: '', type: 'video', pending: true })),
      ...['MP3 (Audio)', 'M4A (Audio)'].map(q => ({ quality: q, format: q.includes('MP3') ? 'mp3' : 'm4a', url: '', size: '', type: 'audio', pending: true })),
    ],
  }
}

// ─── Download Manager ────────────────────────────────────────────────────────

const activeDownloads = new Map()
let downloadIdCounter = 0

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().substring(0, 200)
}

function resolveDownloadUrl(videoId, quality, format) {
  const qualityNum = quality.match(/(\d+)p/)?.[1] || '720'
  const urlMap = {
    '1080': `https://app.ytdown.to/en38/?url=https://www.youtube.com/watch?v=${videoId}&q=1080&f=mp4`,
    '720': `https://app.ytdown.to/en38/?url=https://www.youtube.com/watch?v=${videoId}&q=720&f=mp4`,
    '480': `https://app.ytdown.to/en38/?url=https://www.youtube.com/watch?v=${videoId}&q=480&f=mp4`,
    '360': `https://app.ytdown.to/en38/?url=https://www.youtube.com/watch?v=${videoId}&q=360&f=mp4`,
  }
  return urlMap[qualityNum] || urlMap['720']
}

function streamDownload(downloadId) {
  const dl = activeDownloads.get(downloadId)
  if (!dl) return

  const url = dl.url
  const client = url.startsWith('https') ? https : http

  const request = client.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      dl.url = response.headers.location
      streamDownload(downloadId)
      return
    }

    if (response.statusCode !== 200) {
      dl.status = 'failed'
      dl.error = `HTTP ${response.statusCode}`
      sendToRenderer('download-progress', { id: downloadId, status: 'failed', error: dl.error })
      return
    }

    dl.totalBytes = parseInt(response.headers['content-length']) || 0
    dl.contentType = response.headers['content-type'] || ''

    if (!dl.fileName) {
      const disposition = response.headers['content-disposition'] || ''
      const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (match) dl.fileName = sanitizeFilename(match[1].replace(/['"]/g, ''))
      else dl.fileName = sanitizeFilename(`${dl.title || dl.videoId}_${dl.quality}`) + (dl.format === 'mp3' ? '.mp3' : '.mp4')
    }

    dl.filePath = path.join(DOWNLOADS_DIR, dl.fileName)
    dl.status = 'downloading'
    dl.startTime = Date.now()

    sendToRenderer('download-progress', {
      id: downloadId, status: 'downloading', fileName: dl.fileName,
      totalBytes: dl.totalBytes, transferredBytes: 0, progress: 0, speed: 0, eta: 'Calculating...',
    })

    const fileStream = fs.createWriteStream(dl.filePath)
    dl.fileStream = fileStream
    dl.response = response

    let lastBytes = 0
    let lastTime = Date.now()

    response.on('data', (chunk) => {
      if (dl.status === 'cancelled') {
        response.destroy()
        fileStream.end()
        try { fs.unlinkSync(dl.filePath) } catch {}
        return
      }

      dl.transferredBytes += chunk.length
      fileStream.write(chunk)

      const now = Date.now()
      const elapsed = (now - lastTime) / 1000
      if (elapsed >= 0.5) {
        const bytesPerSec = (dl.transferredBytes - lastBytes) / elapsed
        dl.speed = bytesPerSec
        lastBytes = dl.transferredBytes
        lastTime = now

        const progress = dl.totalBytes > 0 ? Math.min((dl.transferredBytes / dl.totalBytes) * 100, 100) : 0
        const remaining = dl.totalBytes > 0 ? dl.totalBytes - dl.transferredBytes : 0
        const etaSec = bytesPerSec > 0 ? Math.ceil(remaining / bytesPerSec) : 0
        const eta = etaSec > 3600 ? `${Math.floor(etaSec / 3600)}h ${Math.floor((etaSec % 3600) / 60)}m`
          : etaSec > 60 ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s`
          : etaSec > 0 ? `${etaSec}s` : 'Almost done...'

        dl.progress = progress
        sendToRenderer('download-progress', {
          id: downloadId, status: 'downloading', progress, speed: bytesPerSec,
          transferredBytes: dl.transferredBytes, totalBytes: dl.totalBytes, eta,
        })
      }
    })

    response.on('end', () => {
      fileStream.end(() => {
        if (dl.status === 'cancelled') return
        dl.status = 'completed'
        dl.progress = 100
        dl.speed = 0
        try {
          const stat = fs.statSync(dl.filePath)
          dl.totalBytes = stat.size
        } catch {}
        sendToRenderer('download-complete', {
          id: downloadId, fileName: dl.fileName, filePath: dl.filePath,
          totalBytes: dl.totalBytes, videoId: dl.videoId, title: dl.title,
          thumbnail: dl.thumbnail, quality: dl.quality, format: dl.format,
          completedAt: new Date().toISOString(),
        })
      })
    })

    response.on('error', (err) => {
      dl.status = 'failed'
      dl.error = err.message
      fileStream.end()
      try { fs.unlinkSync(dl.filePath) } catch {}
      sendToRenderer('download-progress', { id: downloadId, status: 'failed', error: err.message })
    })
  })

  request.on('error', (err) => {
    dl.status = 'failed'
    dl.error = err.message
    sendToRenderer('download-progress', { id: downloadId, status: 'failed', error: err.message })
  })

  dl.request = request
}

// Thumbnails: download the remote poster to disk so it persists offline and
// loads through the local ytfile:// protocol instead of the network.
function fileToYtUrl(filePath) {
  const encodedPath = path.normalize(filePath).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
  return `ytfile://localhost${encodedPath}`
}

function thumbPathFor(videoId) {
  if (!videoId) return null
  return path.join(THUMBS_DIR, `${videoId}.jpg`)
}

function thumbUrlFor(videoId) {
  const p = thumbPathFor(videoId)
  if (!p || !fs.existsSync(p)) return ''
  return fileToYtUrl(p)
}

// Fetch the remote thumbnail and save it to THUMBS_DIR/{videoId}.jpg.
function persistThumbnail(videoId, url) {
  if (!videoId || !url || !/^https?:\/\//i.test(url)) return Promise.resolve('')
  if (url.startsWith('ytfile://')) return Promise.resolve(url)
  const dest = thumbPathFor(videoId)
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve('') }
      const tmp = dest + '.tmp'
      const ws = fs.createWriteStream(tmp)
      res.pipe(ws)
      ws.on('finish', () => {
        ws.close(() => {
          try { fs.renameSync(tmp, dest) } catch { try { fs.unlinkSync(tmp) } catch {} }
          resolve(dest)
        })
      })
      ws.on('error', () => { try { fs.unlinkSync(tmp) } catch {}; resolve('') })
    }).on('error', () => resolve(''))
  })
}

async function startDownload(videoId, quality, format, title, thumbnail, audio) {
  const dlId = `dl_${++downloadIdCounter}`

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  const fileName = sanitizeFilename(`${title || videoId}_${quality}`) + ((format === 'mp3' || audio) ? '.mp3' : '.mp4')

  const dl = {
    id: dlId, videoId, quality, format, title, thumbnail, audio: !!audio,
    fileName, filePath: '', url: videoUrl,
    status: 'downloading', progress: 0, speed: 0,
    transferredBytes: 0, totalBytes: 0,
    startTime: Date.now(), error: null,
    fileStream: null, response: null, request: null,
    process: null,
  }
  activeDownloads.set(dlId, dl)

  // Save the thumbnail locally so completed downloads have a persistent poster.
  persistThumbnail(videoId, dl.thumbnail).then((p) => {
    if (p && fs.existsSync(p)) dl.thumbnail = fileToYtUrl(p)
  }).catch(() => {})

  if (ytdlpAvailable !== false) {
    startManualYtDlp(dlId)
  } else {
    // Fall back to HTTP streaming via ytdown when yt-dlp is absent
    try {
      const ytdown = await tryYtdownConversion(videoUrl)
      if (ytdown?.formats?.length) {
        const num = quality?.match?.(/(\d+)/)?.[1] || '720'
        const target = ytdown.formats.find(f => f.quality?.includes(num))
        if (target?.url) dl.url = target.url
      }
    } catch {}
    if (!dl.url || dl.url === videoUrl) {
      dl.url = `https://app.ytdown.to/en38/${videoId}`
    }
    streamDownload(dlId)
  }

  return dlId
}

function startManualYtDlp(dlId) {
  const dl = activeDownloads.get(dlId)
  if (!dl) return

  const qualityNum = (dl.quality?.match(/(\d+)/)?.[1]) ? parseInt(dl.quality.match(/(\d+)/)[1]) : 720
  const height = Math.min(qualityNum || 720, 1080)
  const isAudio = dl.audio || dl.format === 'mp3' || dl.format === 'm4a' || (dl.quality || '').toLowerCase().includes('audio')

  const outputTemplate = path.join(DOWNLOADS_DIR, '%(title)s [%(id)s].%(ext)s')

  const args = []
  if (isAudio) {
    args.push('-f', 'bestaudio/best', '--extract-audio', '--audio-format', (dl.format === 'mp4' || !dl.format || dl.audio) ? 'mp3' : (dl.format === 'mp3' ? 'mp3' : 'm4a'), '--audio-quality', '0')
  } else {
    args.push('-f', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best[height<=${height}]`)
    args.push('--merge-output-format', 'mp4')
  }

  args.push('--no-playlist', '--newline', '--no-colors', '--progress', '-o', outputTemplate, dl.url)

  console.log(`[Download] Starting yt-dlp (${dl.quality}, ${dl.format}): ${dl.url}`)

  let proc
  try {
    proc = spawn('yt-dlp', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
  } catch (e) {
    dl.status = 'failed'
    dl.error = e.message
    console.error(`[Download] Failed to spawn yt-dlp: ${e.message}`)
    sendToRenderer('download-progress', { id: dlId, status: 'failed', error: e.message })
    return
  }

  dl.process = proc
  dl.status = 'downloading'

  sendToRenderer('download-progress', {
    id: dlId, status: 'downloading', fileName: dl.fileName,
    totalBytes: 0, transferredBytes: 0, progress: 0, speed: 0, eta: 'Starting...',
  })

  let buffer = ''

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parsed = parseYtdlpProgress(trimmed)
      if (!parsed) continue

      if (parsed.type === 'dest') {
        dl.fileName = parsed.fileName
      } else if (parsed.type === 'merge' || parsed.type === 'already') {
        dl.fileName = parsed.fileName
        dl.progress = 99
        sendToRenderer('download-progress', {
          id: dlId, status: 'downloading', fileName: dl.fileName,
          totalBytes: dl.totalBytes, transferredBytes: dl.transferredBytes,
          progress: 99, speed: 0, eta: 'Finalizing...',
        })
      } else if (parsed.type === 'progress') {
        dl.progress = parsed.percent
        const sizeParts = (parsed.totalSize || '').match(/[\d.,]+/)
        if (sizeParts) {
          dl.totalBytes = parseFloat(sizeParts[1].replace(/,/g, '')) * 1024 * 1024
        }
        const speedNum = parsed.speed?.match(/^([\d.]+)([KMG]?)\/s/)
        let speedBytes = 0
        if (speedNum) {
          const mult = { '': 1, K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 }[speedNum[2]] || 1
          speedBytes = parseFloat(speedNum[1]) * mult
        }
        dl.speed = speedBytes
        dl.eta = parsed.eta
        dl.transferredBytes = dl.totalBytes > 0 ? Math.round((dl.progress / 100) * dl.totalBytes) : 0

        sendToRenderer('download-progress', {
          id: dlId, status: 'downloading', fileName: dl.fileName,
          totalBytes: dl.totalBytes, transferredBytes: dl.transferredBytes,
          progress: dl.progress, speed: speedBytes, eta: dl.eta,
        })
      }
    }
  })

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('[info]')) {
      const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/)
      if (titleMatch && !dl.title) dl.title = titleMatch[1]
    }
  })

  proc.on('close', (code) => {
    if (dl.status === 'cancelled') return

    if (code === 0) {
      dl.status = 'completed'
      dl.progress = 100
      dl.speed = 0

      const candidates = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.includes(dl.videoId))
      if (candidates.length > 0) {
        dl.fileName = candidates[0]
        dl.filePath = path.join(DOWNLOADS_DIR, candidates[0])
      } else if (dl.fileName) {
        dl.filePath = path.join(DOWNLOADS_DIR, dl.fileName)
      }

      try {
        if (dl.filePath && fs.existsSync(dl.filePath)) {
          dl.totalBytes = fs.statSync(dl.filePath).size
        }
      } catch {}

      console.log(`[Download] Completed: ${dl.fileName || dl.title || dl.videoId}`)

      sendToRenderer('download-complete', {
        id: dlId, fileName: dl.fileName, filePath: dl.filePath,
        totalBytes: dl.totalBytes, videoId: dl.videoId, title: dl.title,
        thumbnail: dl.thumbnail && dl.thumbnail.startsWith('ytfile://') ? dl.thumbnail : (thumbUrlFor(dl.videoId) || dl.thumbnail),
        quality: dl.quality, format: dl.format,
        completedAt: new Date().toISOString(),
      })
    } else {
      dl.status = 'failed'
      dl.error = `yt-dlp exited with code ${code}`
      console.error(`[Download] Failed (code ${code})`)
      sendToRenderer('download-progress', { id: dlId, status: 'failed', error: dl.error })
    }
  })

  proc.on('error', (err) => {
    dl.status = 'failed'
    dl.error = err.message
    console.error(`[Download] Process error: ${err.message}`)
    sendToRenderer('download-progress', { id: dlId, status: 'failed', error: err.message })
  })
}


function cancelDownload(downloadId) {
  const dl = activeDownloads.get(downloadId)
  if (!dl) return false
  dl.status = 'cancelled'
  if (dl.process && !dl.process.killed) dl.process.kill('SIGTERM')
  if (dl.response) dl.response.destroy()
  if (dl.request) dl.request.destroy()
  if (dl.fileStream) dl.fileStream.end()
  try { if (dl.filePath && fs.existsSync(dl.filePath)) fs.unlinkSync(dl.filePath) } catch {}
  activeDownloads.delete(downloadId)
  return true
}

function getActiveDownloads() {
  const list = []
  activeDownloads.forEach((dl, id) => {
    if (dl.status === 'downloading') {
      list.push({
        id, videoId: dl.videoId, title: dl.title, thumbnail: dl.thumbnail,
        fileName: dl.fileName, quality: dl.quality, format: dl.format,
        progress: dl.progress || 0, speed: dl.speed || 0,
        transferredBytes: dl.transferredBytes, totalBytes: dl.totalBytes,
        status: dl.status,
      })
    }
  })
  return list
}

function getCompletedDownloads() {
  const completed = []
  activeDownloads.forEach((dl, id) => {
    if (dl.status === 'completed') {
      completed.push({
        id, videoId: dl.videoId, title: dl.title,
        thumbnail: dl.thumbnail && dl.thumbnail.startsWith('ytfile://') ? dl.thumbnail : (thumbUrlFor(dl.videoId) || dl.thumbnail),
        fileName: dl.fileName, filePath: dl.filePath, quality: dl.quality, format: dl.format,
        totalBytes: dl.totalBytes, status: 'completed',
      })
    }
  })

  try {
    const files = fs.readdirSync(DOWNLOADS_DIR)
    for (const f of files) {
      const fp = path.join(DOWNLOADS_DIR, f)
      const stat = fs.statSync(fp)
      if (stat.isFile()) {
        const existsInActive = completed.some(c => c.fileName === f)
        if (!existsInActive && !activeDownloads.has(`fs_${f}`)) {
          // Recover the video id from yt-dlp filenames: "Title [ID].ext"
          const idMatch = f.match(/\[([a-zA-Z0-9_-]{11})\]\.[^.]+$/)
          const videoId = idMatch ? idMatch[1] : ''
          const localThumb = videoId ? thumbUrlFor(videoId) : ''
          completed.push({
            id: `fs_${f}`, videoId, title: f.replace(/\[[a-zA-Z0-9_-]{11}\]\.[^.]+$/, '').trim() || f.replace(/\.[^.]+$/, ''),
            thumbnail: localThumb, fileName: f, filePath: fp,
            quality: '', format: path.extname(f),
            totalBytes: stat.size, status: 'completed',
          })
        }
      }
    }
  } catch {}

  return completed
}

// ─── Smart Download (Clipboard Watcher + yt-dlp) ─────────────────────────────

const YT_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/

let smartDlEnabled = false
let smartDlClipboard = false
let clipboardTimer = null
let fypDlTimer = null
let lastClipboardText = ''
const processedUrls = new Map()
const smartDownloads = new Map()
let smartDlIdCounter = 0
let ytdlpAvailable = null

function checkYtdlpBinary() {
  return new Promise((resolve) => {
    execFile('which', ['yt-dlp'], (err, stdout) => {
      if (err || !stdout.trim()) {
        ytdlpAvailable = false
        resolve(false)
      } else {
        ytdlpAvailable = true
        resolve(true)
      }
    })
  })
}

function checkYtdlpVersion() {
  return new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], (err, stdout) => {
      if (err) { resolve(null); return }
      resolve(stdout.trim())
    })
  })
}

function startYtdlpUpdateCheck() {
  console.log('[SmartDL] Checking for yt-dlp updates...')
  const proc = spawn('yt-dlp', ['-U'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  let output = ''
  proc.stdout.on('data', (chunk) => { output += chunk.toString() })
  proc.stderr.on('data', (chunk) => { output += chunk.toString() })
  proc.on('close', (code) => {
    if (output.includes('is up to date')) {
      console.log('[SmartDL] yt-dlp is up to date')
      sendToRenderer('toast', { type: 'info', message: `yt-dlp is up to date (${output.trim().split('\n').pop()})`, duration: 4000 })
    } else if (output.includes('Updated') || output.includes('yt-dlp to')) {
      console.log('[SmartDL] yt-dlp updated:', output.trim())
      sendToRenderer('toast', { type: 'success', message: 'yt-dlp has been updated to the latest version', duration: 5000 })
    } else {
      console.log('[SmartDL] yt-dlp update check completed (code', code, ')')
    }
  })
  proc.on('error', (e) => {
    console.error('[SmartDL] yt-dlp update check failed:', e.message)
  })
}

function extractYouTubeId(text) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  const m = trimmed.match(YT_URL_REGEX)
  return m ? { id: m[1], url: trimmed } : null
}

function fireNotify(summary, body) {
  try {
    execFile('notify-send', ['-a', 'Kovatube', '-u', 'normal', summary, body || ''], (err) => {
      if (err) console.error('[SmartDL] notify-send failed:', err.message)
    })
  } catch (e) {
    console.error('[SmartDL] notify-send error:', e.message)
  }
}

function parseYtdlpProgress(line) {
  const percentMatch = line.match(/\[download\]\s+([\d.]+)%/)
  const speedMatch = line.match(/at\s+([\d.]+\S*\/s)/)
  const etaMatch = line.match(/ETA\s+(\S+)/)
  const sizeMatch = line.match(/of\s+([\d.]+\S+)/)
  const destMatch = line.match(/\[download\]\s+Destination:\s+(.+)/)
  const mergeMatch = line.match(/\[Merger\]\s+Merging formats into "(.+)"/)
  const alreadyMatch = line.match(/\[download\]\s+(.+\.(?:mp4|mkv|webm|mp3|m4a))\s+has already been downloaded/)

  if (destMatch) return { type: 'dest', fileName: path.basename(destMatch[1].trim()) }
  if (mergeMatch) return { type: 'merge', fileName: path.basename(mergeMatch[1].trim()) }
  if (alreadyMatch) return { type: 'already', fileName: path.basename(alreadyMatch[1].trim()) }
  if (percentMatch) {
    return {
      type: 'progress',
      percent: parseFloat(percentMatch[1]),
      speed: speedMatch ? speedMatch[1] : '',
      eta: etaMatch ? etaMatch[1] : '',
      totalSize: sizeMatch ? sizeMatch[1] : '',
    }
  }
  return null
}

function startSmartDownload(videoId, url, onDone) {
  if (ytdlpAvailable === false) {
    console.error('[SmartDL] yt-dlp not available, cannot start download')
    sendToRenderer('toast', { type: 'error', message: 'yt-dlp is not installed. Smart downloads disabled.', duration: 6000 })
    return null
  }

  const dlId = `smart_${++smartDlIdCounter}`
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
  const outputTemplate = path.join(DOWNLOADS_DIR, '%(title)s [%(id)s].%(ext)s')

  const args = [
    '-f', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--newline',
    '--no-colors',
    '--progress',
    '-o', outputTemplate,
    videoUrl,
  ]

  console.log(`[SmartDL] Starting download: ${videoUrl}`)

  const proc = spawn('yt-dlp', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })

  const dl = {
    id: dlId, videoId, url, status: 'starting',
    title: '', fileName: '', filePath: '',
    progress: 0, speed: '', eta: '', totalSize: '',
    process: proc, startedAt: Date.now(),
  }

  smartDownloads.set(dlId, dl)

  sendToRenderer('smart-dl-progress', {
    id: dlId, videoId, status: 'starting', title: '', progress: 0,
    speed: '', eta: '', totalSize: '', fileName: '',
  })

  let titleResolveBuffer = ''

  proc.stdout.on('data', (chunk) => {
    titleResolveBuffer += chunk.toString()
    const lines = titleResolveBuffer.split('\n')
    titleResolveBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const parsed = parseYtdlpProgress(trimmed)
      if (!parsed) continue

      if (parsed.type === 'dest') {
        dl.fileName = parsed.fileName
        dl.status = 'downloading'
      } else if (parsed.type === 'merge') {
        dl.fileName = parsed.fileName
        dl.status = 'merging'
        dl.progress = 99
        sendToRenderer('smart-dl-progress', {
          id: dlId, videoId: dl.videoId, status: 'merging', title: dl.title,
          progress: 99, speed: '', eta: '', totalSize: dl.totalSize, fileName: dl.fileName,
        })
      } else if (parsed.type === 'already') {
        dl.fileName = parsed.fileName
        dl.status = 'completed'
        dl.progress = 100
      } else if (parsed.type === 'progress') {
        dl.progress = parsed.percent
        dl.speed = parsed.speed
        dl.eta = parsed.eta
        dl.totalSize = parsed.totalSize
        dl.status = 'downloading'

        if (!dl.title && dl.fileName) {
          dl.title = dl.fileName.replace(/\s*\[[a-zA-Z0-9_-]+\]\.\w+$/, '')
        }

        sendToRenderer('smart-dl-progress', {
          id: dlId, videoId: dl.videoId, status: 'downloading',
          title: dl.title || dl.fileName, progress: dl.progress,
          speed: dl.speed, eta: dl.eta, totalSize: dl.totalSize, fileName: dl.fileName,
        })
      }
    }
  })

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('[info]')) {
      const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/)
      if (titleMatch && !dl.title) {
        dl.title = titleMatch[1]
      }
    }
    console.log('[SmartDL]', text.trim())
  })

  proc.on('close', (code) => {
    if (dl.status === 'cancelled') return

    if (code === 0) {
      dl.status = 'completed'
      dl.progress = 100
      dl.speed = ''

      const candidates = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.includes(videoId))
      if (candidates.length > 0) {
        dl.fileName = candidates[0]
        dl.filePath = path.join(DOWNLOADS_DIR, candidates[0])
      } else if (dl.fileName) {
        dl.filePath = path.join(DOWNLOADS_DIR, dl.fileName)
      }

      try {
        if (dl.filePath && fs.existsSync(dl.filePath)) {
          const stat = fs.statSync(dl.filePath)
          dl.totalBytes = stat.size
        }
      } catch {}

      if (!dl.title && dl.fileName) {
        dl.title = dl.fileName.replace(/\s*\[[a-zA-Z0-9_-]+\]\.\w+$/, '')
      }

      console.log(`[SmartDL] Completed: ${dl.title || dl.fileName}`)
      fireNotify('Smart Download Complete', dl.title || dl.fileName || 'Download finished')

      sendToRenderer('smart-dl-complete', {
        id: dlId, videoId: dl.videoId, title: dl.title,
        fileName: dl.fileName, filePath: dl.filePath,
        totalBytes: dl.totalBytes, completedAt: new Date().toISOString(),
      })
      if (onDone) onDone()
    } else {
      dl.status = 'failed'
      dl.error = `yt-dlp exited with code ${code}`
      console.error(`[SmartDL] Failed (code ${code}): ${dl.title || dl.videoId}`)
      fireNotify('Smart Download Failed', `${dl.title || dl.videoId}: exit code ${code}`)

      sendToRenderer('smart-dl-progress', {
        id: dlId, videoId: dl.videoId, status: 'failed',
        title: dl.title, progress: 0, error: dl.error,
      })
      if (onDone) onDone()
    }
  })

  proc.on('error', (err) => {
    dl.status = 'failed'
    dl.error = err.message
    console.error(`[SmartDL] Process error: ${err.message}`)
    fireNotify('Smart Download Error', err.message)

    sendToRenderer('smart-dl-progress', {
      id: dlId, videoId: dl.videoId, status: 'failed',
      title: dl.title, progress: 0, error: err.message,
    })
    if (onDone) onDone()
  })

  if (dl.title) {
    fireNotify('Smart Download Started', dl.title)
  } else {
    ytGet(`${YOUTUBE_OEMBED_URL}?url=${encodeURIComponent(videoUrl)}&format=json`)
      .then(data => {
        dl.title = data.title || ''
        if (data.thumbnail_url) persistThumbnail(videoId, data.thumbnail_url)
        fireNotify('Smart Download Started', dl.title || videoId)
        sendToRenderer('smart-dl-progress', {
          id: dlId, videoId: dl.videoId, status: dl.status,
          title: dl.title, progress: dl.progress, speed: dl.speed,
          eta: dl.eta, totalSize: dl.totalSize, fileName: dl.fileName,
        })
      })
      .catch(() => {
        dl.title = videoId
        fireNotify('Smart Download Started', videoId)
      })
  }

  return dlId
}

function cancelSmartDownload(dlId) {
  const dl = smartDownloads.get(dlId)
  if (!dl) return false
  dl.status = 'cancelled'
  if (dl.process && !dl.process.killed) {
    dl.process.kill('SIGTERM')
    setTimeout(() => {
      if (dl.process && !dl.process.killed) dl.process.kill('SIGKILL')
    }, 3000)
  }
  smartDownloads.delete(dlId)
  sendToRenderer('smart-dl-cancelled', { id: dlId })
  return true
}

function checkClipboard() {
  if (!smartDlEnabled || !smartDlClipboard) return

  let text = ''
  try {
    text = clipboard.readText()
  } catch {
    return
  }

  if (!text || text === lastClipboardText) return
  lastClipboardText = text

  const match = extractYouTubeId(text)
  if (!match) return

  const { id, url } = match

  const alreadyActive = [...smartDownloads.values()].some(d => d.videoId === id && d.status !== 'failed' && d.status !== 'cancelled')
  if (alreadyActive) return

  // Respect the persistent total cap; reserve a slot or skip.
  if (!reserveSmartDlSlot(id)) return

  console.log(`[SmartDL] Detected YouTube URL in clipboard: ${url}`)
  startSmartDownload(id, url)
}

function startClipboardWatcher() {
  if (!smartDlClipboard) return
  if (clipboardTimer) return
  lastClipboardText = clipboard.readText() || ''
  clipboardTimer = setInterval(checkClipboard, 2000)
  console.log('[SmartDL] Clipboard watcher started (2s interval)')
}

function stopClipboardWatcher() {
  if (clipboardTimer) {
    clearInterval(clipboardTimer)
    clipboardTimer = null
  }
  console.log('[SmartDL] Clipboard watcher stopped')
}

// ─── Smart Download: For You recommendations (default source) ───────────────

// True if a video id is already on disk (as a downloaded file) — we never
// re-download something we already have.
function isAlreadyDownloaded(videoId) {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR)
    return files.some(f => f.includes(`[${videoId}]`))
  } catch {
    return false
  }
}

function isActiveSmartDownload(videoId) {
  return [...smartDownloads.values()].some(d => d.videoId === videoId && d.status !== 'failed' && d.status !== 'cancelled')
}

// Concurrency + total limit are configured via settings (smartDlConcurrency,
// smartDlLimit). smartDlCount is a PERSISTENT counter of smart downloads started
// across all sessions, so the total number of smart downloads can never exceed
// the chosen limit (it is not reset per session).
const fypQueued = []          // videoIds waiting to be downloaded
const fypActive = new Set()   // videoIds currently downloading
let lastFypCursor = 0
const fypSeen = new Set()     // ids we've already queued/downloaded this session

function getFypLimit() {
  const n = parseInt(settingsCache.smartDlLimit, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function getFypConcurrency() {
  const n = parseInt(settingsCache.smartDlConcurrency, 10)
  return Number.isFinite(n) && n > 0 ? Math.min(5, n) : 1
}

// Total smart downloads started so far (persisted across sessions).
function getSmartDlCount() {
  const n = parseInt(settingsCache.smartDlCount, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// True if the total smart-download cap has been reached.
function smartDlLimitReached() {
  const limit = getFypLimit()
  return limit > 0 && getSmartDlCount() >= limit
}

// Reserve one slot against the persistent total cap. Only one reservation may
// be made per video id; returns true if the download is allowed to proceed.
function reserveSmartDlSlot(videoId) {
  if (smartDlLimitReached()) return false
  if (processedUrls.has(videoId)) return false
  processedUrls.set(videoId, { via: 'smart', detectedAt: Date.now() })
  saveSettings({ smartDlCount: getSmartDlCount() + 1 })
  console.log(`[SmartDL] Reserved slot (total ${getSmartDlCount()}) for: ${videoId}`)
  return true
}

function pumpFypQueue() {
  const maxConcurrent = getFypConcurrency()
  while (fypQueued.length > 0 && fypActive.size < maxConcurrent) {
    const videoId = fypQueued.shift()
    fypActive.add(videoId)
    const handled = startSmartDownload(videoId, `https://www.youtube.com/watch?v=${videoId}`, () => {
      fypActive.delete(videoId)
      pumpFypQueue()
    })
    if (handled === null) {
      // Couldn't start (e.g. yt-dlp unavailable) — release the slot immediately.
      fypActive.delete(videoId)
    }
  }
}

function queueFypVideo(videoId) {
  if (smartDlLimitReached()) return
  if (fypSeen.has(videoId)) return
  if (isAlreadyDownloaded(videoId)) return
  if (fypActive.has(videoId) || isActiveSmartDownload(videoId)) return
  if (processedUrls.has(videoId)) return
  if (!reserveSmartDlSlot(videoId)) return
  fypSeen.add(videoId)
  fypQueued.push(videoId)
  console.log(`[SmartDL] Queued FYP recommendation: ${videoId}`)
  pumpFypQueue()
}

async function checkFypRecommendations() {
  if (!smartDlEnabled) return
  try {
    const seen = [...fypSeen]
    const data = await loadFypMore({ cursor: lastFypCursor, seen })
    const vids = (data && data.videos) || []
    for (const v of vids) {
      if (v && v.id && v.isShort === false) queueFypVideo(v.id)
    }
    if (data) lastFypCursor = data.nextCursor || lastFypCursor
  } catch (e) {
    console.error('[SmartDL] FYP poll error:', e && e.message ? e.message : e)
  }
}

// Smart downloader checks the For You feed on a configurable interval.
function getFypRefreshMs() {
  const min = parseInt(settingsCache.smartDlInterval, 10)
  return (Number.isFinite(min) && min > 0 ? min : 60) * 60 * 1000
}

function startFypDownloader() {
  if (fypDlTimer) return
  checkFypRecommendations() // kick off immediately
  fypDlTimer = setInterval(checkFypRecommendations, getFypRefreshMs())
  console.log(`[SmartDL] For You recommendation downloader started (${getFypRefreshMs() / 60000}min refresh interval)`)
}

function stopFypDownloader() {
  if (fypDlTimer) {
    clearInterval(fypDlTimer)
    fypDlTimer = null
  }
  console.log('[SmartDL] For You recommendation downloader stopped')
}

function getSmartDlStatus() {
  const active = []
  smartDownloads.forEach((dl, id) => {
    if (dl.status === 'downloading' || dl.status === 'starting' || dl.status === 'merging') {
      active.push({
        id, videoId: dl.videoId, title: dl.title, fileName: dl.fileName,
        progress: dl.progress, speed: dl.speed, eta: dl.eta,
        totalSize: dl.totalSize, status: dl.status, startedAt: dl.startedAt,
      })
    }
  })
  return { enabled: smartDlEnabled, clipboard: smartDlClipboard, active }
}

function getSmartDlHistory() {
  const history = []
  smartDownloads.forEach((dl, id) => {
    if (dl.status === 'completed' || dl.status === 'failed') {
      history.push({
        id, videoId: dl.videoId, title: dl.title, fileName: dl.fileName,
        filePath: dl.filePath, status: dl.status, error: dl.error || null,
        totalBytes: dl.totalBytes || 0, startedAt: dl.startedAt,
      })
    }
  })
  return history
}

// ─── IPC Setup ───────────────────────────────────────────────────────────────

let mainWindow
let staticServer
let staticServerPort = 0

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mpd': 'application/dash+xml',
}

function setupFileProtocol() {
  protocol.handle('ytfile', (request) => {
    try {
      // The filesystem path is always placed in the pathname; the host is a
      // fixed placeholder required by the "standard" scheme registration.
      const { pathname } = new URL(request.url)
      const decoded = decodeURIComponent(pathname)
      const filePath = path.normalize(decoded)
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return new Response('Not found', { status: 404 })
      }
      const ext = path.extname(filePath).toLowerCase()
      const stat = fs.statSync(filePath)
      const mime = MIME[ext] || 'application/octet-stream'
      const rangeHeader = request.headers.get('Range')
      const headers = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-store',
      }
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
        if (match) {
          let start = match[1] ? parseInt(match[1], 10) : 0
          let end = match[2] ? parseInt(match[2], 10) : stat.size - 1
          if (isNaN(start)) start = 0
          if (isNaN(end) || end >= stat.size) end = stat.size - 1
          if (start > end || start >= stat.size) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` },
            })
          }
          const stream = fs.createReadStream(filePath, { start, end })
          return new Response(stream, {
            status: 206,
            headers: {
              ...headers,
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            },
          })
        }
      }
      const stream = fs.createReadStream(filePath)
      return new Response(stream, { status: 200, headers })
    } catch (e) {
      console.error('[ytfile] Error:', e.message)
      return new Response('Error', { status: 500 })
    }
  })
}

function startStaticServer() {
  const boundary = path.join(__dirname, '..', 'dist')
  staticServer = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      let served
      if (urlPath.startsWith('/stream/')) {
        const rel = path.normalize(urlPath.slice('/stream/'.length))
        const streamFile = path.normalize(path.join(STREAM_CACHE_DIR, rel))
        if (!streamFile.startsWith(STREAM_CACHE_DIR)) { res.writeHead(403); res.end('Forbidden'); return }
        served = streamFile
      } else {
        if (urlPath === '/' || urlPath === '') urlPath = '/index.html'
        let filePath = path.normalize(path.join(boundary, urlPath))
        if (!filePath.startsWith(boundary)) { res.writeHead(403); res.end('Forbidden'); return }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          if (!fs.existsSync(filePath)) {
            filePath = path.join(boundary, 'index.html')
          }
        }
        served = filePath
      }
      if (!fs.existsSync(served)) {
        if (urlPath.startsWith('/stream/')) console.log(`[stream] 404 ${req.url} -> ${served}`)
        res.writeHead(404); res.end('Not found'); return
      }
      const ext = path.extname(served).toLowerCase()
      if (urlPath.startsWith('/stream/')) console.log(`[stream] 200 ${req.url}`)
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      })
      fs.createReadStream(served).pipe(res)
    } catch (e) {
      res.writeHead(500); res.end('Server error')
    }
  })
  return new Promise((resolve) => {
    staticServer.listen(0, '127.0.0.1', () => {
      staticServerPort = staticServer.address().port
      resolve()
    })
  })
}

function setupSession() {
  const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.youtube.com/*', '*://*.ytimg.com/*', '*://*.googlevideo.com/*'] }, (details, callback) => {
    const headers = details.requestHeaders
    headers['User-Agent'] = CHROME_UA
    if (details.url.includes('/embed/') || details.url.includes('/watch')) {
      headers['Referer'] = 'https://www.youtube.com/'
    }
    callback({ requestHeaders: headers })
  })
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(true))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      hardwareAcceleration: true,
      webgl: true,
      allowRunningInsecureContent: false,
    },
    icon: path.join(__dirname, '../public/icon.svg'),
    titleBarStyle: 'default', backgroundColor: '#0f0f0f',
    autoHideMenuBar: true,
  })
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else if (staticServerPort) {
    mainWindow.loadURL(`http://127.0.0.1:${staticServerPort}/index.html`)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[App] Load failed (${code}) ${desc} for ${url}`)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`[App] Window loaded: ${mainWindow.webContents.getURL()}`)
  })
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log(`[Renderer:${level}] ${message}`)
  })
}

function setupIPC() {
  ipcMain.handle('get-app-path', () => CONFIG_DIR)
  ipcMain.handle('get-downloads-path', () => DOWNLOADS_DIR)

  ipcMain.handle('get-downloads-list', async () => {
    try { return fs.readdirSync(DOWNLOADS_DIR).map(f => ({ name: f, path: path.join(DOWNLOADS_DIR, f), size: fs.statSync(path.join(DOWNLOADS_DIR, f)).size, modified: fs.statSync(DOWNLOADS_DIR, f).mtime })) }
    catch { return [] }
  })

  ipcMain.handle('select-directory', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], defaultPath: DOWNLOADS_DIR })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('save-file', async (_e, { fileName, data }) => {
    try { const p = path.join(DOWNLOADS_DIR, fileName); fs.writeFileSync(p, Buffer.from(data)); return { success: true, path: p } }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('yt-search', async (_e, query) => {
    console.log('[IPC] yt-search:', query)
    const r = await searchYouTube(query, visitorData)
    if (r.visitorData) visitorData = r.visitorData
    return r
  })

  ipcMain.handle('yt-home-feed', async () => {
    console.log('[IPC] yt-home-feed')
    const r = await loadHomeFeed(visitorData)
    if (r.visitorData) visitorData = r.visitorData
    return r
  })

  ipcMain.handle('yt-shorts-feed', async () => {
    console.log('[IPC] yt-shorts-feed')
    const r = await loadShortsFeed(visitorData)
    if (r.visitorData) visitorData = r.visitorData
    return r
  })

  ipcMain.handle('yt-fyp-page', async (_e, args) => {
    console.log('[IPC] yt-fyp-page', JSON.stringify(args || {}))
    try {
      const a = args || {}
      // A fresh page (cursor 0) is a manual refresh — drop the session search cache
      if (!a.cursor) clearSearchCache()
      return await loadFypMore(a)
    } catch (e) {
      console.error('[Fyp] ', e.message)
      return { videos: [], nextCursor: 0, hasMore: false, error: e.message, history: prefs.history, subscriptions: prefs.subscriptions }
    }
  })

  ipcMain.handle('yt-prefs', () => loadPrefs())
  ipcMain.handle('yt-record-watch', (_e, v) => recordWatch(v))
  ipcMain.handle('yt-subscribe', (_e, channel) => subscribe(channel))
  ipcMain.handle('yt-unsubscribe', (_e, channel) => unsubscribe(channel))

  // ─── Google/YouTube sign-in ─────────────────────────────────────────────
  ipcMain.handle('yt-auth-status', async () => {
    // Instant: report the persisted session state straight from the on-disk
    // auth backup (loaded at startup), no page navigation. A background probe
    // then re-validates the session and pushes a fresh account (name/PFP).
    const signedInCached = !!(auth.cookies && (auth.cookiesByKey['SAPISID'] || auth.cookiesByKey['__Secure-1PSID'] || auth.cookiesByKey['SID'] || auth.cookiesByKey['HSID']))
    probeAuth({ background: true }).then(st => {
      if (st.account && (st.account.name || st.account.avatar)) auth.account = st.account
      const state = { signedIn: st.signedIn, account: auth.account || null, reason: st.signedIn ? null : 'expired' }
      console.log('[Auth] background probe done:', JSON.stringify(state))
      sendToRenderer('auth-updated', state)
    }).catch(e => console.error('[Auth] background probe error:', e.message))
    return { signedIn: signedInCached, account: auth.account || null, cached: true }
  })

  ipcMain.handle('yt-auth-signin', async () => {
    console.log('[IPC] yt-auth-signin')
    const ok = await openSignInWindow()
    if (ok) {
      persistAuth()
      // Don't block the UI on a re-probe: the sign-in window already scraped the
      // account. Refresh it in the background so the PFP is guaranteed fresh.
      probeAuth({ background: true }).then(st => {
        if (st.account && (st.account.name || st.account.avatar)) { auth.account = st.account; persistAuth() }
        sendToRenderer('auth-updated', { signedIn: true, account: auth.account || null })
      }).catch(() => {})
      return { ok: true, account: auth.account || null }
    }
    return { ok: false, account: null }
  })

  ipcMain.handle('yt-auth-signout', async () => {
    console.log('[IPC] yt-auth-signout')
    clearAuth()
    destroyAuthedWindow()
    destroyMusicAuthedWindow()
    try { await session.defaultSession.clearStorageData({ storages: ['cookies'] }) } catch (e) { /* ignore */ }
    return { ok: true }
  })

  ipcMain.handle('yt-auth-account', async () => {
    const signedInCached = !!(auth.cookies && (auth.cookiesByKey['SAPISID'] || auth.cookiesByKey['__Secure-1PSID'] || auth.cookiesByKey['SID'] || auth.cookiesByKey['HSID']))
    return { signedIn: signedInCached, account: auth.account || null, cached: true }
  })

  ipcMain.handle('yt-auth-home-page', async (_e, args) => {
    const a = args || {}
    return await signedHomeFeed({ continuation: a.continuation || '', seen: a.seen || [], force: !!a.force })
  })

  ipcMain.handle('yt-auth-subscriptions', async (_e, args) => {
    console.log('[IPC] yt-auth-subscriptions')
    const force = !!(args && args.force)
    if (force) signedSubsCache = { ts: 0, subscriptions: [] }
    const res = await loadSignedSubscriptions()
    if (res.ok) {
      const merged = syncGoogleSubscriptions(res.subscriptions)
      return { ok: true, reason: null, subscriptions: merged, count: merged.length, synced: res.subscriptions.length, cached: !!res.cached }
    }
    return { ok: false, reason: res.reason, subscriptions: prefs.subscriptions }
  })

  ipcMain.handle('yt-video-info', async (_e, videoId) => {
    console.log('[IPC] yt-video-info:', videoId)
    return getVideoInfo(videoId)
  })

  ipcMain.handle('yt-channel', async (_e, channelName) => {
    console.log('[IPC] yt-channel:', channelName)
    return getChannelInfo(channelName)
  })

  ipcMain.handle('yt-channel-more', async (_e, token, channelName) => {
    console.log('[IPC] yt-channel-more (token len ' + (token || '').length + ')')
    return getMoreChannelVideos(token, channelName)
  })

  ipcMain.handle('yt-new-videos', async () => {
    console.log('[IPC] yt-new-videos')
    try {
      return await getNewChannelVideos()
    } catch (e) {
      console.error('[NewVideos]', e.message)
      return { groups: [], videos: [], error: e.message }
    }
  })

  ipcMain.handle('yt-convert-formats', async (_e, videoUrl) => {
    console.log('[IPC] yt-convert:', videoUrl)
    return getConversionFormats(videoUrl)
  })

  ipcMain.handle('yt-extract-id', (_e, url) => extractVideoId(url))

  // Streaming (native in-app player)
  ipcMain.handle('yt-stream', async (event, videoId, quality) => {
    console.log('[IPC] yt-stream:', videoId, 'quality=', quality || 'auto')
    if (!videoId) return { ok: false, reason: 'No video ID' }
    const r = await startPlaybackStream(videoId, quality || settingsCache.defaultQuality || 'auto', (phase) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('stream-phase', { videoId, phase })
      }
    })
    if (r.ok) {
      r.id = videoId
    }
    return r
  })

  ipcMain.handle('yt-stream-stop', (_e, videoId) => {
    stopStream(videoId)
    return true
  })

  // Resolve a video's stream URLs ahead of playback so the slow yt-dlp call is
  // done by the time the user hits play (fills streamUrlCache, no ffmpeg started).
  ipcMain.handle('yt-prewarm', async (_e, videoId) => {
    if (!videoId) return { ok: false, reason: 'No video ID' }
    const urls = await getMediaUrls(videoId, settingsCache.defaultQuality || 'auto')
    return urls
  })

  // ─── YouTube Music ──────────────────────────────────────────────────────
  ipcMain.handle('yt-music-home', async () => {
    console.log('[IPC] yt-music-home')
    try { return await getMusicHome() } catch (e) { console.error('[Music] home', e.message); return { shelves: [], error: e.message } }
  })

  ipcMain.handle('yt-music-charts', async () => {
    console.log('[IPC] yt-music-charts')
    try { return await getMusicCharts() } catch (e) { console.error('[Music] charts', e.message); return { shelves: [], error: e.message } }
  })

  ipcMain.handle('yt-music-search', async (_e, args) => {
    const { query, filter } = args || {}
    console.log('[IPC] yt-music-search:', query, 'filter=', filter || 'all')
    try { return await musicSearch(query, filter) } catch (e) { console.error('[Music] search', e.message); return { items: [], continuation: '', error: e.message } }
  })

  ipcMain.handle('yt-music-browse', async (_e, browseId) => {
    console.log('[IPC] yt-music-browse:', browseId)
    try { return await musicBrowse(browseId) } catch (e) { console.error('[Music] browse', e.message); return { header: null, tracks: [], continuation: '', error: e.message } }
  })

  ipcMain.handle('yt-music-more', async (_e, continuation) => {
    console.log('[IPC] yt-music-more (token len ' + (continuation || '').length + ')')
    try { return await musicBrowseMore(continuation) } catch (e) { console.error('[Music] more', e.message); return { tracks: [], continuation: '', error: e.message } }
  })

  ipcMain.handle('yt-music-library', async () => {
    console.log('[IPC] yt-music-library')
    try { return await getMusicLibrary() } catch (e) { console.error('[Music] library', e.message); return { signedIn: false, shelves: [], items: [], error: e.message } }
  })

  ipcMain.handle('yt-music-lyrics', async (_e, args) => {
    const a = typeof args === 'string' ? { videoId: args } : (args || {})
    console.log('[IPC] yt-music-lyrics:', a.videoId, a.title || '', a.duration || '')
    try { return await getMusicLyrics(a) } catch (e) { console.error('[Music] lyrics', e.message); return { ok: false, reason: e.message } }
  })

  // Audio-only stream URL for the music player (no ffmpeg relay).
  ipcMain.handle('yt-audio-stream', async (_e, videoId) => {
    console.log('[IPC] yt-audio-stream:', videoId)
    try { return await getAudioStream(videoId) } catch (e) { return { ok: false, reason: e.message } }
  })

  ipcMain.handle('yt-audio-prewarm', async (_e, videoId) => {
    if (!videoId) return { ok: false, reason: 'No video ID' }
    try { return await getAudioStream(videoId) } catch (e) { return { ok: false, reason: e.message } }
  })

  // Settings
  ipcMain.handle('settings-get', () => loadSettings())
  ipcMain.handle('settings-set', (_e, patch) => {
    const oldInterval = settingsCache.smartDlInterval
    const oldEnabled = settingsCache.smartDlEnabled
    const result = saveSettings(patch)
    // Restart FYP downloader if interval changed and smart download is enabled
    if (patch.smartDlInterval !== undefined && patch.smartDlInterval !== oldInterval && smartDlEnabled) {
      stopFypDownloader()
      startFypDownloader()
    }
    // Start/stop FYP downloader when master toggle changes
    if (patch.smartDlEnabled !== undefined && patch.smartDlEnabled !== oldEnabled) {
      if (patch.smartDlEnabled) {
        smartDlEnabled = true
        startFypDownloader()
      } else {
        smartDlEnabled = false
        stopFypDownloader()
        stopClipboardWatcher()
      }
    }
    // Toggle clipboard watcher when clipboard setting changes
    if (patch.smartDlClipboard !== undefined && patch.smartDlClipboard !== settingsCache.smartDlClipboard) {
      if (smartDlEnabled) {
        if (patch.smartDlClipboard) startClipboardWatcher()
        else stopClipboardWatcher()
      }
    }
    return result
  })

  // Convert a filesystem path to a ytfile:// URL for in-app playback
  ipcMain.handle('prepare-playback', (_e, filePath) => prepareLocalPlayback(filePath))

  // Download pipeline IPC
  ipcMain.handle('dl-start', async (_e, { videoId, quality, format, title, thumbnail, audio }) => {
    console.log('[IPC] dl-start:', videoId, quality, format, 'audio=', !!audio)
    return startDownload(videoId, quality, format, title, thumbnail, audio)
  })

  ipcMain.handle('dl-cancel', (_e, downloadId) => {
    console.log('[IPC] dl-cancel:', downloadId)
    return cancelDownload(downloadId)
  })

  ipcMain.handle('dl-active', () => getActiveDownloads())
  ipcMain.handle('dl-completed', () => getCompletedDownloads())

  ipcMain.handle('dl-play', async (_e, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      await shell.openPath(filePath)
      return true
    }
    return false
  })

  ipcMain.handle('dl-show-in-folder', (_e, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
      return true
    }
    return false
  })

  // Smart Download IPC
  ipcMain.handle('smart-dl-toggle', async (_e, enabled) => {
    console.log('[IPC] smart-dl-toggle:', enabled)
    if (enabled) {
      const available = await checkYtdlpBinary()
      if (!available) {
        sendToRenderer('toast', {
          type: 'error',
          message: 'yt-dlp is not installed. Install it with: sudo pip install yt-dlp',
          duration: 8000,
        })
        return { enabled: false, clipboard: smartDlClipboard, ytdlpMissing: true }
      }
    }
    smartDlEnabled = !!enabled
    if (smartDlEnabled) {
      startFypDownloader()              // For You recommendations are the default source
      if (smartDlClipboard) startClipboardWatcher()
    } else {
      stopFypDownloader()
      stopClipboardWatcher()
    }
    return { enabled: smartDlEnabled, clipboard: smartDlClipboard }
  })

  // Toggle the clipboard source (OFF by default; FYP feed is the default source).
  ipcMain.handle('smart-dl-clipboard-toggle', async (_e, enabled) => {
    const val = enabled !== undefined ? !!enabled : !smartDlClipboard
    if (val && !smartDlEnabled) {
      // Clipboard is an extra source; still require the master switch to be on.
      return { enabled: smartDlEnabled, clipboard: false }
    }
    smartDlClipboard = val
    saveSettings({ smartDlClipboard })
    if (smartDlEnabled) {
      if (smartDlClipboard) startClipboardWatcher()
      else stopClipboardWatcher()
    }
    console.log('[IPC] smart-dl-clipboard-toggle:', smartDlClipboard)
    return { enabled: smartDlEnabled, clipboard: smartDlClipboard }
  })

  ipcMain.handle('smart-dl-status', () => getSmartDlStatus())
  ipcMain.handle('smart-dl-history', () => getSmartDlHistory())

  ipcMain.handle('smart-dl-cancel', (_e, dlId) => {
    console.log('[IPC] smart-dl-cancel:', dlId)
    return cancelSmartDownload(dlId)
  })
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  ensureDirectories()
  loadSettings()
  smartDlClipboard = !!settingsCache.smartDlClipboard
  loadPrefs()
  loadAuth()
  setupSession()
  setupFileProtocol()
  setupIPC()
  try { await startStaticServer() } catch (e) { console.error('[App] static server failed', e.message) }
  createWindow()
  const ytdlpOk = await checkYtdlpBinary()
  if (ytdlpOk) {
    const ver = await checkYtdlpVersion()
    console.log(`[App] yt-dlp found: ${ver || 'unknown version'}`)
    startYtdlpUpdateCheck()
  } else {
    console.warn('[App] yt-dlp not found - smart downloads will be unavailable')
    sendToRenderer('toast', {
      type: 'warning',
      message: 'yt-dlp not found. Smart downloads unavailable. Install: sudo pip install yt-dlp',
      duration: 8000,
    })
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})
app.on('window-all-closed', () => { stopClipboardWatcher(); if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  stopClipboardWatcher()
  destroyMusicAuthedWindow()
  streamProcesses.forEach((entry) => { if (entry.ffmpeg && !entry.ffmpeg.killed) entry.ffmpeg.kill('SIGKILL') })
  smartDownloads.forEach((dl) => { if (dl.process && !dl.process.killed) dl.process.kill('SIGTERM') })
  activeDownloads.forEach((dl) => { if (dl.process && !dl.process.killed) dl.process.kill('SIGTERM') })
  try { fs.rmSync(STREAM_CACHE_DIR, { recursive: true, force: true }) } catch {}
})
