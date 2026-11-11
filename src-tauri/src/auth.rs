use crate::state::{AppState, FetchOut};
use crate::youtube::{self, UA};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const SERVICE: &str = "kovatube";
const ORIGIN: &str = "https://www.youtube.com";

pub fn sapisid_hash(sapisid: &str, origin: &str) -> String {
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let raw = format!("{ts} {sapisid} {origin}");
    let mut hasher = Sha1::new();
    hasher.update(raw.as_bytes());
    format!("SAPISIDHASH {ts}_{}", hex::encode(hasher.finalize()))
}

const WEB_UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

pub fn ensure_window(app: &AppHandle, label: &str) {
    if app.get_webview_window(label).is_some() {
        return;
    }
    let (title, url) = if label == "music" {
        ("YouTube Music", "https://music.youtube.com/")
    } else {
        ("YouTube", "https://www.youtube.com/")
    };
    let Ok(parsed) = url.parse() else { return };
    let _ = WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed))
        .title(title)
        .user_agent(WEB_UA)
        .inner_size(900.0, 700.0)
        .visible(false)
        .build();
}

pub async fn sign_in(app: &AppHandle) -> Result<Value, String> {
    if let Some(existing) = app.get_webview_window("signin") {
        let _ = existing.set_focus();
    } else {
        let url = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/";
        WebviewWindowBuilder::new(app, "signin", WebviewUrl::External(url.parse().map_err(|e: url::ParseError| e.to_string())?))
            .title("Sign in to YouTube")
            .user_agent(WEB_UA)
            .inner_size(480.0, 720.0)
            .build()
            .map_err(|e| e.to_string())?;
    }
    for _ in 0..180 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if let Some(window) = app.get_webview_window("session").or_else(|| app.get_webview_window("signin")) {
            if has_session(&window) {
                let _ = app.get_webview_window("signin").and_then(|w| w.close().ok());
                persist_cookies(app);
                let status = status_value(app);
                let _ = app.emit("auth-updated", status.clone());
                return Ok(status);
            }
        }
    }
    Err("Sign-in timed out".into())
}

fn has_session(window: &tauri::WebviewWindow) -> bool {
    cookie_map(window).iter().any(|(name, _)| {
        matches!(name.as_str(), "SAPISID" | "__Secure-3PAPISID" | "LOGIN_INFO" | "SID" | "__Secure-1PSID")
    })
}

fn cookie_map(window: &tauri::WebviewWindow) -> Vec<(String, String)> {
    let Ok(url) = "https://www.youtube.com/".parse() else { return Vec::new() };
    let Ok(cookies) = window.cookies_for_url(url) else { return Vec::new() };
    cookies.into_iter().map(|c| (c.name().to_string(), c.value().to_string())).collect()
}

fn persist_cookies(app: &AppHandle) {
    let Some(window) = app.get_webview_window("session").or_else(|| app.get_webview_window("signin")) else { return };
    let pairs = cookie_map(&window);
    if pairs.is_empty() {
        return;
    }
    let payload = serde_json::to_string(&pairs).unwrap_or_default();
    if let Ok(entry) = keyring::Entry::new(SERVICE, "youtube-cookies") {
        if entry.set_password(&payload).is_ok() {
            return;
        }
    }
    if let Some(dir) = dirs::config_dir() {
        let path = dir.join("Kovatube").join("cookies.jar");
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).write(true).truncate(true).open(&path) {
            use std::io::Write;
            let _ = file.write_all(payload.as_bytes());
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
}

fn stored_cookies() -> Vec<(String, String)> {
    if let Ok(entry) = keyring::Entry::new(SERVICE, "youtube-cookies") {
        if let Ok(raw) = entry.get_password() {
            if let Ok(pairs) = serde_json::from_str::<Vec<(String, String)>>(&raw) {
                return pairs;
            }
        }
    }
    Vec::new()
}

pub fn clear_session(app: &AppHandle) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, "youtube-cookies") {
        let _ = entry.delete_credential();
    }
    if let Some(dir) = dirs::config_dir() {
        let _ = std::fs::remove_file(dir.join("Kovatube").join("cookies.jar"));
    }
    for label in ["session", "music", "signin"] {
        if let Some(window) = app.get_webview_window(label) {
            if let Ok(url) = "https://www.youtube.com/".parse() {
                if let Ok(cookies) = window.cookies_for_url(url) {
                    for cookie in cookies {
                        let _ = window.delete_cookie(cookie);
                    }
                }
            }
        }
    }
}

pub fn status_value(_app: &AppHandle) -> Value {
    let signed = stored_cookies().iter().any(|(n, _)| n == "SAPISID" || n == "SID" || n == "LOGIN_INFO");
    json!({
        "signedIn": signed,
        "account": if signed { json!({ "name": "", "handle": "" }) } else { json!(null) }
    })
}

fn header_value(cookies: &[(String, String)], origin: &str) -> String {
    cookies
        .iter()
        .find(|(n, _)| n == "__Secure-3PAPISID" || n == "SAPISID" || n == "__Secure-1PAPISID")
        .map(|(_, v)| sapisid_hash(v, origin))
        .unwrap_or_default()
}

fn cookie_header(cookies: &[(String, String)]) -> String {
    cookies.iter().map(|(n, v)| format!("{n}={v}")).collect::<Vec<_>>().join("; ")
}

pub async fn authed_post(app: &AppHandle, state: &AppState, window_label: &str, endpoint: &str, body: &Value, origin: &str) -> Result<Value, String> {
    ensure_window(app, window_label);
    let url = format!("{origin}/youtubei/v1/{endpoint}?key={}&prettyPrint=false", youtube::KEY);
    let window = app.get_webview_window(window_label);
    let cookies = window.as_ref().map(cookie_map).filter(|c| !c.is_empty()).unwrap_or_else(stored_cookies);
    let auth = header_value(&cookies, origin);
    if let Some(window) = window {
        if let Ok(value) = eval_fetch(app, state, &window, &url, &auth, body).await {
            return Ok(value);
        }
    }
    let mut req = state
        .http
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", UA)
        .header("Origin", origin)
        .header("Referer", format!("{origin}/"))
        .header("Cookie", cookie_header(&cookies))
        .json(body);
    if !auth.is_empty() {
        req = req.header("Authorization", auth);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

async fn eval_fetch(app: &AppHandle, state: &AppState, window: &tauri::WebviewWindow, url: &str, auth: &str, body: &Value) -> Result<Value, String> {
    let id = state.next_id("fetch_");
    let (tx, rx) = tokio::sync::oneshot::channel();
    state.fetches.lock().map_err(|e| e.to_string())?.insert(id.clone(), tx);
    let js = format!(
        r#"(async () => {{
            const id = {id};
            try {{
                const headers = {{ 'Content-Type': 'application/json', 'Origin': {origin}, 'X-Origin': {origin} }};
                const auth = {auth};
                if (auth) headers.Authorization = auth;
                const response = await fetch({url}, {{ method: 'POST', credentials: 'include', headers, body: {body} }});
                const text = await response.text();
                await window.__TAURI_INTERNALS__.invoke('auth_fetch_result', {{ id, status: response.status, body: text, error: '' }});
            }} catch (error) {{
                await window.__TAURI_INTERNALS__.invoke('auth_fetch_result', {{ id, status: 0, body: '', error: String(error) }});
            }}
        }})()"#,
        id = serde_json::to_string(&id).unwrap_or_default(),
        origin = serde_json::to_string(if url.contains("music.youtube") { "https://music.youtube.com" } else { ORIGIN }).unwrap_or_default(),
        auth = serde_json::to_string(auth).unwrap_or_default(),
        url = serde_json::to_string(url).unwrap_or_default(),
        body = serde_json::to_string(&body.to_string()).unwrap_or_default(),
    );
    window.eval(&js).map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(Duration::from_secs(12), rx).await.map_err(|_| "signed-in request timed out".to_string())?.map_err(|_| "signed-in request cancelled".to_string())?;
    let _ = app;
    if !result.error.is_empty() {
        return Err(result.error);
    }
    if result.status == 0 || result.status >= 400 {
        return Err(format!("HTTP {}", result.status));
    }
    serde_json::from_str(&result.body).map_err(|e| e.to_string())
}

pub fn deliver_fetch(state: &AppState, id: String, status: u16, body: String, error: String) {
    if let Ok(mut map) = state.fetches.lock() {
        if let Some(tx) = map.remove(&id) {
            let _ = tx.send(FetchOut { status, body, error });
        }
    }
}

pub fn open_signin_window(app: &AppHandle) {
    if app.get_webview_window("signin").is_some() {
        return;
    }
    let url = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/";
    let Ok(parsed) = url.parse() else { return };
    let _ = WebviewWindowBuilder::new(app, "signin", WebviewUrl::External(parsed))
        .title("Sign in to YouTube")
        .user_agent(WEB_UA)
        .inner_size(480.0, 720.0)
        .build();
}

pub async fn probe_page(app: &AppHandle) -> Value {
    let Some(window) = app.get_webview_window("session") else {
        return json!({ "opened": false });
    };
    let title = window.title().unwrap_or_default();
    let cookies = cookie_map(&window).len();
    json!({ "opened": true, "title": title, "cookieCount": cookies, "signedIn": has_session(&window) })
}
