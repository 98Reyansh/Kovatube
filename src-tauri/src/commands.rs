#![allow(non_snake_case)]

use crate::auth;
use crate::cover;
use crate::downloads;
use crate::paths::{self, Paths};
use crate::state::AppState;
use crate::stream;
use crate::youtube::{self, KEY};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

fn settings_of(state: &AppState) -> Value {
    state.settings.lock().map(|s| s.clone()).unwrap_or(json!({}))
}

fn save_prefs(state: &AppState) {
    if let Ok(prefs) = state.prefs.lock() {
        paths::save_json(&state.paths.prefs, &prefs);
    }
}

#[tauri::command]
pub fn auth_fetch_result(id: String, status: u16, body: String, error: String) {
    let state = crate::state::AppState::global();
    auth::deliver_fetch(&state, id, status, body, error);
}

#[tauri::command]
pub fn spike_report(webgl: Option<bool>, capture: Option<bool>, title: Option<String>, page: Option<String>, text: Option<String>) {
    let payload = json!({
        "webgl": webgl.unwrap_or(false),
        "captureStream": capture.unwrap_or(false),
        "title": title.unwrap_or_default(),
        "page": page.unwrap_or_default(),
        "text": text.unwrap_or_default()
    });
    let _ = std::fs::write("/tmp/kovatube-tauri-spike.json", serde_json::to_string_pretty(&payload).unwrap_or_default());
    println!("[spike] {payload}");
}

#[tauri::command]
pub fn get_app_path() -> String {
    let state = crate::state::AppState::global();
    state.paths.config.to_string_lossy().to_string()
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Value {
    let current = env!("CARGO_PKG_VERSION");
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/repos/98Reyansh/Kovatube/releases/latest")
        .header("User-Agent", "Kovatube")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await;
    let Ok(resp) = resp else {
        return json!({ "ok": false, "current": current, "latest": "", "available": false, "status": "error", "reason": "Could not check for updates" });
    };
    let Ok(rel) = resp.json::<Value>().await else {
        return json!({ "ok": false, "current": current, "latest": "", "available": false, "status": "error", "reason": "Could not check for updates" });
    };
    let latest = rel.get("tag_name").and_then(|v| v.as_str()).unwrap_or("").trim_start_matches('v').to_string();
    let available = !latest.is_empty() && version_newer(&latest, current);
    let state = json!({ "ok": true, "current": current, "latest": latest, "available": available, "status": if available { "available" } else { "current" }, "reason": "" });
    if available {
        let _ = app.emit("update-available", state.clone());
    }
    state
}

fn version_newer(latest: &str, current: &str) -> bool {
    let parse = |s: &str| s.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    let a = parse(latest);
    let b = parse(current);
    a > b
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> Value {
    let _ = app.opener().open_url("https://github.com/98Reyansh/Kovatube/releases/latest", None::<&str>);
    json!({ "ok": true, "opened": true })
}

#[tauri::command]
pub fn get_downloads_path() -> String {
    let state = crate::state::AppState::global();
    state.paths.downloads.to_string_lossy().to_string()
}

#[tauri::command]
pub fn get_download_paths() -> Value {
    let state = crate::state::AppState::global();
    json!({
        "base": state.paths.downloads.to_string_lossy(),
        "music": state.paths.music.to_string_lossy(),
        "videos": state.paths.videos.to_string_lossy()
    })
}

#[tauri::command]
pub async fn get_downloads_list() -> Vec<Value> {
    let state = crate::state::AppState::global();
    downloads::scan_downloads(&state.paths)
}

#[tauri::command]
pub async fn select_directory(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    rx.await.ok().flatten().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_file(data: Value) -> Result<String, String> {
    let name = data.get("fileName").and_then(|v| v.as_str()).unwrap_or("kovatube.txt");
    let body = data.get("data").and_then(|v| v.as_str()).unwrap_or("");
    let dir = dirs::download_dir().unwrap_or_else(|| PathBuf::from("."));
    let path = dir.join(name);
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn net_probe() -> Value {
    let state = crate::state::AppState::global();
    let ok = state.http.get("https://www.youtube.com/generate_204").send().await.map(|r| r.status().is_success()).unwrap_or(false);
    json!({ "ok": ok })
}

#[tauri::command]
pub async fn yt_search(query: String) -> Value {
    let state = crate::state::AppState::global();
    let visitor = state.visitor.lock().ok().and_then(|v| v.clone());
    let result = youtube::search(&state.http, &query, visitor.as_deref()).await;
    if let Some(v) = result.get("visitorData").and_then(|v| v.as_str()) {
        if !v.is_empty() {
            if let Ok(mut slot) = state.visitor.lock() { *slot = Some(v.to_string()); }
        }
    }
    result
}

#[tauri::command]
pub async fn yt_home_feed() -> Value {
    let state = crate::state::AppState::global();
    youtube::home_feed(&state.http).await
}

#[tauri::command]
pub async fn yt_shorts_feed(app: AppHandle) -> Value {
    let state = crate::state::AppState::global();
    let page = youtube::search(&state.http, "funny shorts", None).await;
    let shorts = page.get("shorts").cloned().unwrap_or(json!([]));
    let _ = app.emit("shorts-feed-more", json!({ "shorts": shorts }));
    json!({ "shorts": shorts, "error": page.get("error").cloned().unwrap_or(Value::Null) })
}

#[tauri::command]
pub async fn yt_fyp_page(args: Option<Value>) -> Value {
    let state = crate::state::AppState::global();
    let args = args.unwrap_or(json!({}));
    let cursor = args.get("cursor").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let prefs = state.prefs.lock().ok().map(|p| p.clone()).unwrap_or(json!({}));
    let history = prefs.get("history").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut words = Vec::new();
    for item in history.iter().rev().take(12) {
        let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
        for word in title.split(|c: char| !c.is_ascii_alphanumeric()) {
            if word.len() >= 4 { words.push(word.to_ascii_lowercase()); }
        }
    }
    let fallback = ["music", "live", "podcast", "news", "gaming", "science", "cooking", "travel"];
    let query = if words.is_empty() { fallback[cursor % fallback.len()].to_string() } else { words[cursor % words.len()].clone() };
    let page = youtube::search(&state.http, &query, None).await;
    let videos = page.get("videos").cloned().unwrap_or(json!([]));
    let len = videos.as_array().map(|a| a.len()).unwrap_or(0);
    json!({
        "videos": videos,
        "nextCursor": cursor + 1,
        "hasMore": len > 0 && cursor < 8,
        "error": page.get("error").cloned().unwrap_or(Value::Null),
        "history": prefs.get("history").cloned().unwrap_or(json!([])),
        "subscriptions": prefs.get("subscriptions").cloned().unwrap_or(json!([]))
    })
}

#[tauri::command]
pub fn yt_prefs() -> Value {
    let state = crate::state::AppState::global();
    state.prefs.lock().map(|p| p.clone()).unwrap_or(json!({ "history": [], "subscriptions": [], "channelAvatars": {} }))
}

#[tauri::command]
pub fn yt_record_watch(video: Value) -> Value {
    let state = crate::state::AppState::global();
    if let Ok(mut prefs) = state.prefs.lock() {
        let history = prefs.as_object_mut().and_then(|o| o.entry("history").or_insert(json!([])).as_array_mut());
        if let Some(history) = history {
            history.retain(|v| v.get("id") != video.get("id"));
            history.insert(0, video);
            history.truncate(200);
        }
        let snapshot = prefs.clone();
        drop(prefs);
        save_prefs(&state);
        return snapshot.get("history").cloned().unwrap_or(json!([]));
    }
    json!([])
}

#[tauri::command]
pub fn yt_subscribe(channel: String) -> Value {
    let state = crate::state::AppState::global();
    if let Ok(mut prefs) = state.prefs.lock() {
        let list = prefs.as_object_mut().and_then(|o| o.entry("subscriptions").or_insert(json!([])).as_array_mut());
        if let Some(list) = list {
            if !list.iter().any(|v| v.as_str().unwrap_or("").eq_ignore_ascii_case(&channel)) {
                list.push(json!(channel));
            }
        }
        let snapshot = prefs.get("subscriptions").cloned().unwrap_or(json!([]));
        drop(prefs);
        save_prefs(&state);
        return snapshot;
    }
    json!([])
}

#[tauri::command]
pub fn yt_unsubscribe(channel: String) -> Value {
    let state = crate::state::AppState::global();
    if let Ok(mut prefs) = state.prefs.lock() {
        if let Some(list) = prefs.get_mut("subscriptions").and_then(|v| v.as_array_mut()) {
            list.retain(|v| !v.as_str().unwrap_or("").eq_ignore_ascii_case(&channel));
        }
        let snapshot = prefs.get("subscriptions").cloned().unwrap_or(json!([]));
        drop(prefs);
        save_prefs(&state);
        return snapshot;
    }
    json!([])
}

#[tauri::command]
pub async fn yt_video_info(videoId: String) -> Value {
    let state = crate::state::AppState::global();
    youtube::video_info(&state.http, &videoId).await
}

#[tauri::command]
pub async fn yt_captions(args: Value) -> Value {
    let state = crate::state::AppState::global();
    let video_id = args.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
    let lang = args.get("languageCode").and_then(|v| v.as_str()).unwrap_or("en");
    let kind = args.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    stream::captions(&state, video_id, lang, kind).await
}

#[tauri::command]
pub async fn yt_comments(args: Value) -> Value {
    let state = crate::state::AppState::global();
    let video_id = args.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
    let continuation = args.get("continuation").and_then(|v| v.as_str()).unwrap_or("");
    youtube::comments(&state.http, video_id, continuation).await
}

#[tauri::command]
pub async fn yt_comment_create(app: AppHandle, args: Value) -> Value {
    let state = crate::state::AppState::global();
    let video_id = args.get("videoId").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if video_id.is_empty() { return json!({ "ok": false, "reason": "Missing video" }); }
    if text.is_empty() { return json!({ "ok": false, "reason": "Write a comment first" }); }
    if !auth::status_value(&app).get("signedIn").and_then(|v| v.as_bool()).unwrap_or(false) {
        return json!({ "ok": false, "reason": "Sign in to comment" });
    }
    let watch = json!({ "context": { "client": { "clientName": "WEB", "clientVersion": "2.20231219.04.00", "hl": "en", "gl": "US" } }, "videoId": video_id });
    let page = match auth::authed_post(&app, &state, "session", "next", &watch, "https://www.youtube.com").await {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "reason": e }),
    };
    let parsed = youtube::parse_comments(&page);
    let params = parsed.get("createParams").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if params.is_empty() { return json!({ "ok": false, "reason": "Comments are turned off for this video" }); }
    let body = json!({
        "context": { "client": { "clientName": "WEB", "clientVersion": "2.20231219.04.00", "hl": "en", "gl": "US" } },
        "commentText": text,
        "createCommentParams": params
    });
    match auth::authed_post(&app, &state, "session", "comment/create_comment", &body, "https://www.youtube.com").await {
        Ok(_) => json!({
            "ok": true,
            "comment": { "id": format!("local-{}", state.next_id("c")), "text": text, "time": "Just now", "author": "You", "avatar": "", "likes": "", "replies": "", "replyToken": "", "creator": false }
        }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

#[tauri::command]
pub async fn yt_channel(channelName: String) -> Value {
    let state = crate::state::AppState::global();
    let page = youtube::search(&state.http, &channelName, None).await;
    let videos = page.get("videos").cloned().unwrap_or(json!([]));
    json!({
        "channel": {
            "name": channelName,
            "videos": videos,
            "nextToken": "",
            "avatar": "",
            "banner": "",
            "description": "",
            "subscriberCount": ""
        },
        "error": page.get("error").cloned().unwrap_or(Value::Null)
    })
}

#[tauri::command]
pub async fn yt_channel_avatar(channelName: String) -> String {
    let state = crate::state::AppState::global();
    let key = channelName.trim().to_ascii_lowercase();
    if let Some(saved) = state.prefs.lock().ok().and_then(|p| p.pointer(&format!("/channelAvatars/{key}")).and_then(|v| v.as_str()).map(|s| s.to_string())) {
        if !saved.is_empty() { return saved; }
    }
    String::new()
}

#[tauri::command]
pub async fn yt_channel_more(token: String, channelName: String) -> Value {
    json!({ "videos": [], "nextToken": token, "channel": channelName, "error": null })
}

#[tauri::command]
pub async fn yt_new_videos() -> Value {
    let state = crate::state::AppState::global();
    let subs = state.prefs.lock().ok().and_then(|p| p.get("subscriptions").and_then(|v| v.as_array()).cloned()).unwrap_or_default();
    let mut groups = Vec::new();
    for name in subs.into_iter().take(8) {
        let channel = name.as_str().unwrap_or("").to_string();
        if channel.is_empty() { continue; }
        let page = youtube::search(&state.http, &channel, None).await;
        groups.push(json!({ "channel": channel, "videos": page.get("videos").cloned().unwrap_or(json!([])) }));
    }
    json!({ "groups": groups, "videos": [], "error": null })
}

#[tauri::command]
pub async fn yt_convert_formats(videoUrl: String) -> Value {
    let state = crate::state::AppState::global();
    let id = youtube::extract_video_id(&videoUrl).unwrap_or_default();
    let mut visitor = state.visitor.lock().ok().and_then(|v| v.clone());
    if let Ok(data) = youtube::player(&state.http, &id, &mut visitor).await {
        if let Some(formats) = data.pointer("/streamingData/adaptiveFormats").and_then(|v| v.as_array()) {
            let mut out = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for f in formats {
                let height = f.get("height").and_then(|v| v.as_u64()).unwrap_or(0);
                let mime = f.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
                let (quality, kind) = if mime.starts_with("audio/") {
                    ("Audio".to_string(), "audio")
                } else if height > 0 {
                    (format!("{height}p"), "video")
                } else {
                    continue;
                };
                if seen.insert(quality.clone()) {
                    out.push(json!({ "quality": quality, "format": if kind == "audio" { "mp3" } else { "mp4" }, "type": kind, "url": "", "size": "" }));
                }
            }
            if !out.is_empty() {
                return json!({ "formats": out, "error": null });
            }
        }
    }
    json!({
        "formats": [
            { "quality": "1080p", "format": "mp4", "type": "video", "url": "", "size": "" },
            { "quality": "720p", "format": "mp4", "type": "video", "url": "", "size": "" },
            { "quality": "480p", "format": "mp4", "type": "video", "url": "", "size": "" },
            { "quality": "Audio", "format": "mp3", "type": "audio", "url": "", "size": "" }
        ],
        "error": null
    })
}

#[tauri::command]
pub fn yt_extract_id(url: String) -> Option<String> {
    youtube::extract_video_id(&url)
}

#[tauri::command]
pub async fn yt_stream(app: AppHandle, videoId: String, quality: Option<String>, relay: Option<bool>) -> Value {
    let state = crate::state::AppState::global();
    let settings = settings_of(&state);
    let quality = quality.filter(|q| !q.is_empty()).unwrap_or_else(|| settings.get("defaultQuality").and_then(|v| v.as_str()).unwrap_or("auto").to_string());
    stream::playback(&state, &app, &videoId, &quality, relay.unwrap_or(false)).await
}

#[tauri::command]
pub fn yt_stream_stop(videoId: String) {
    let state = crate::state::AppState::global();
    stream::stop(&state, &videoId);
}

#[tauri::command]
pub async fn yt_prewarm(app: AppHandle, videoId: String) -> Result<(), String> {
    let state = crate::state::AppState::global();
    let settings = settings_of(&state);
    let quality = settings.get("defaultQuality").and_then(|v| v.as_str()).unwrap_or("auto").to_string();
    let _ = stream::resolve(&state, &app, &videoId, &quality, false).await;
    Ok(())
}

#[tauri::command]
pub async fn cover_palette(url: String) -> Option<Value> {
    let state = crate::state::AppState::global();
    cover::palette(&state, &url).await
}

#[tauri::command]
pub async fn cover_image(url: String) -> Option<String> {
    let state = crate::state::AppState::global();
    cover::image_data_url(&state, &url).await
}

#[tauri::command]
pub async fn yt_music_home() -> Value {
    let state = crate::state::AppState::global();
    match youtube::music_browse(&state.http, "FEmusic_home", "", None).await {
        Ok(v) => v,
        Err(e) => json!({ "shelves": [], "error": e }),
    }
}

#[tauri::command]
pub async fn yt_music_charts() -> Value {
    let state = crate::state::AppState::global();
    match youtube::music_browse(&state.http, "FEmusic_charts", "", None).await {
        Ok(v) => v,
        Err(e) => json!({ "shelves": [], "error": e }),
    }
}

#[tauri::command]
pub async fn yt_music_search(args: Value) -> Value {
    let state = crate::state::AppState::global();
    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
    youtube::music_search(&state.http, query).await
}

#[tauri::command]
pub async fn yt_music_browse(browseId: String) -> Value {
    let state = crate::state::AppState::global();
    youtube::music_browse(&state.http, &browseId, "", None).await.unwrap_or_else(|e| json!({ "header": { "title": browseId }, "tracks": [], "error": e }))
}

#[tauri::command]
pub async fn yt_music_more(continuation: String) -> Value {
    let state = crate::state::AppState::global();
    youtube::music_browse(&state.http, "", &continuation, None).await.unwrap_or_else(|e| json!({ "tracks": [], "error": e }))
}

#[tauri::command]
pub async fn yt_music_library(app: AppHandle) -> Value {
    let state = crate::state::AppState::global();
    if !auth::status_value(&app).get("signedIn").and_then(|v| v.as_bool()).unwrap_or(false) {
        return json!({ "signedIn": false, "shelves": [], "items": [] });
    }
    let body = json!({ "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": "1.20240318.01.00", "hl": "en", "gl": "US" } }, "browseId": "FEmusic_library_landing" });
    match auth::authed_post(&app, &state, "music", "browse", &body, "https://music.youtube.com").await {
        Ok(data) => json!({ "signedIn": true, "shelves": youtube::music_shelves(&data), "items": youtube::music_tracks(&data) }),
        Err(_) => json!({ "signedIn": true, "shelves": [], "items": [] }),
    }
}

#[tauri::command]
pub async fn yt_music_liked_ids(app: AppHandle) -> Vec<String> {
    let state = crate::state::AppState::global();
    if !auth::status_value(&app).get("signedIn").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Vec::new();
    }
    let body = json!({ "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": "1.20240318.01.00", "hl": "en", "gl": "US" } }, "browseId": "FEmusic_liked_videos" });
    let Ok(data) = auth::authed_post(&app, &state, "music", "browse", &body, "https://music.youtube.com").await else { return Vec::new() };
    youtube::music_tracks(&data).into_iter().filter_map(|t| t.get("videoId").and_then(|v| v.as_str()).map(|s| s.to_string())).collect()
}

#[tauri::command]
pub async fn yt_music_rate(app: AppHandle, args: Value) -> Value {
    let state = crate::state::AppState::global();
    let video_id = args.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
    let like = args.get("like").and_then(|v| v.as_bool()).unwrap_or(false);
    let endpoint = if like { "like/like" } else { "like/removelike" };
    let body = json!({ "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": "1.20240318.01.00", "hl": "en", "gl": "US" } }, "target": { "videoId": video_id } });
    match auth::authed_post(&app, &state, "music", endpoint, &body, "https://music.youtube.com").await {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

#[tauri::command]
pub async fn yt_music_lyrics(args: Value) -> Value {
    let state = crate::state::AppState::global();
    let file = args.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
    if !file.is_empty() {
        if let Some(local) = downloads::read_local_lyrics(std::path::Path::new(file)) {
            return local;
        }
    }
    let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let artist = args.get("artist").and_then(|v| v.as_str()).unwrap_or("");
    let duration = args.get("duration").and_then(|v| v.as_str()).unwrap_or("");
    youtube::lyrics_for(&state.http, title, artist, duration).await
}

#[tauri::command]
pub async fn yt_audio_stream(app: AppHandle, videoId: String, opts: Option<Value>) -> Value {
    let state = crate::state::AppState::global();
    let _ = opts;
    stream::audio_only(&state, &app, &videoId).await
}

#[tauri::command]
pub fn audio_keepalive(on: bool) -> bool {
    let state = crate::state::AppState::global();
    if let Ok(mut slot) = state.inhibit.lock() {
        if let Some(child) = slot.as_mut() {
            let _ = child.kill();
        }
        *slot = None;
        if on {
            if let Ok(child) = std::process::Command::new("systemd-inhibit")
                .args(["--what=idle:sleep", "--who=Kovatube", "--why=Playing audio", "sleep", "infinity"])
                .spawn()
            {
                *slot = Some(child);
            }
        }
    }
    true
}

#[tauri::command]
pub async fn yt_audio_prewarm(app: AppHandle, videoId: String) -> Result<(), String> {
    let state = crate::state::AppState::global();
    let _ = stream::resolve(&state, &app, &videoId, "audio", false).await;
    Ok(())
}

#[tauri::command]
pub fn settings_get() -> Value {
    let state = crate::state::AppState::global();
    settings_of(&state)
}

#[tauri::command]
pub fn settings_set(patch: Value) -> Value {
    let state = crate::state::AppState::global();
    if let Ok(mut settings) = state.settings.lock() {
        if let (Some(base), Some(patch)) = (settings.as_object_mut(), patch.as_object()) {
            for (k, v) in patch {
                base.insert(k.clone(), v.clone());
            }
        }
        let snapshot = settings.clone();
        paths::save_settings(&state.paths, &snapshot);
        return snapshot;
    }
    json!({})
}

#[tauri::command]
pub fn prepare_playback(filePath: String) -> Option<String> {
    let state = crate::state::AppState::global();
    let path = PathBuf::from(&filePath);
    if !path.is_file() { return None; }
    let settings = settings_of(&state);
    let roots = state.paths.allowed_roots(&settings);
    if !paths::path_is_allowed(&path, &roots) { return None; }
    Some(paths::playback_url(state.proxy_port, &path))
}

#[tauri::command]
pub fn dl_start(app: AppHandle, opts: Value) -> Value {
    let state = crate::state::AppState::global();
    let id = downloads::start_download(&state, app, &opts, false);
    json!({ "id": id, "ok": true })
}

#[tauri::command]
pub fn dl_playlist(app: AppHandle, opts: Value) -> Value {
    let state = crate::state::AppState::global();
    downloads::enqueue_playlist(&state, app, &opts)
}

#[tauri::command]
pub async fn dl_playlists() -> Vec<Value> {
    let state = crate::state::AppState::global();
    downloads::playlists_for_ui(state)
}

#[tauri::command]
pub fn dl_playlist_autosync(id: String, enabled: bool) -> bool {
    let state = crate::state::AppState::global();
    downloads::set_autosync(&state, &id, enabled)
}

#[tauri::command]
pub async fn dl_playlist_sync(app: AppHandle, id: String) -> Value {
    let state = crate::state::AppState::global();
    downloads::sync_one(&state, &app, &id).await
}

#[tauri::command]
pub async fn dl_sync_all(app: AppHandle) -> Value {
    let state = crate::state::AppState::global();
    let ids: Vec<String> = state.playlists.lock().ok().map(|list| {
        list.iter().filter(|p| p.get("autoSync").and_then(|v| v.as_bool()).unwrap_or(true)).filter_map(|p| p.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())).collect()
    }).unwrap_or_default();
    for id in ids {
        let _ = downloads::sync_one(&state, &app, &id).await;
    }
    json!({ "ok": true })
}

#[tauri::command]
pub fn dl_cancel(downloadId: String) -> bool {
    let state = crate::state::AppState::global();
    downloads::cancel(&state, &downloadId)
}

#[tauri::command]
pub fn dl_active() -> Vec<Value> {
    let state = crate::state::AppState::global();
    downloads::active(&state)
}

#[tauri::command]
pub async fn dl_completed() -> Vec<Value> {
    let state = crate::state::AppState::global();
    downloads::completed_for_ui(state)
}

#[tauri::command]
pub fn dl_play(app: AppHandle, filePath: String) -> bool {
    std::path::Path::new(&filePath).is_file() && app.opener().open_path(filePath, None::<&str>).is_ok()
}

#[tauri::command]
pub fn dl_show_in_folder(app: AppHandle, filePath: String) -> bool {
    let path = std::path::Path::new(&filePath);
    let folder = if path.is_file() { path.parent().unwrap_or(path) } else { path };
    folder.is_dir() && app.opener().open_path(folder.to_string_lossy().to_string(), None::<&str>).is_ok()
}

fn smart_status(state: &AppState) -> Value {
    let settings = settings_of(state);
    let active: Vec<Value> = state.smart_active.lock().ok().map(|m| m.keys().map(|id| json!({ "id": id, "status": "downloading" })).collect()).unwrap_or_default();
    json!({
        "enabled": settings.get("smartDlEnabled").and_then(|v| v.as_bool()).unwrap_or(false),
        "clipboard": settings.get("smartDlClipboard").and_then(|v| v.as_bool()).unwrap_or(false),
        "count": settings.get("smartDlCount").and_then(|v| v.as_u64()).unwrap_or(0),
        "clipboardCount": settings.get("smartDlClipboardCount").and_then(|v| v.as_u64()).unwrap_or(0),
        "limit": settings.get("smartDlLimit").and_then(|v| v.as_u64()).unwrap_or(0),
        "active": active
    })
}

#[tauri::command]
pub fn smart_dl_toggle(enabled: bool) -> Value {
    let state = crate::state::AppState::global();
    let _ = settings_set(json!({ "smartDlEnabled": enabled }));
    smart_status(&state)
}

#[tauri::command]
pub fn smart_dl_clipboard_toggle(enabled: bool) -> Value {
    let state = crate::state::AppState::global();
    let _ = settings_set(json!({ "smartDlClipboard": enabled }));
    smart_status(&state)
}

#[tauri::command]
pub fn smart_dl_status() -> Value {
    let state = crate::state::AppState::global();
    smart_status(&state)
}

#[tauri::command]
pub fn smart_dl_reset_counts() -> Value {
    let state = crate::state::AppState::global();
    let _ = settings_set(json!({ "smartDlCount": 0, "smartDlClipboardCount": 0 }));
    smart_status(&state)
}

#[tauri::command]
pub fn smart_dl_history() -> Vec<Value> {
    let state = crate::state::AppState::global();
    paths::load_json_array(&state.paths.history)
}

#[tauri::command]
pub fn smart_dl_cancel(dlId: String) -> bool {
    let state = crate::state::AppState::global();
    downloads::cancel(&state, &dlId)
}

#[tauri::command]
pub async fn yt_auth_status(app: AppHandle) -> Value {
    auth::status_value(&app)
}

#[tauri::command]
pub async fn yt_auth_signin(app: AppHandle) -> Result<Value, String> {
    auth::sign_in(&app).await
}

#[tauri::command]
pub fn yt_auth_signout(app: AppHandle) -> Value {
    auth::clear_session(&app);
    let status = json!({ "signedIn": false, "account": null });
    let _ = app.emit("auth-updated", status.clone());
    status
}

#[tauri::command]
pub fn yt_auth_account(app: AppHandle) -> Value {
    auth::status_value(&app).get("account").cloned().unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn yt_auth_home_page(app: AppHandle, args: Option<Value>) -> Value {
    let state = crate::state::AppState::global();
    if !auth::status_value(&app).get("signedIn").and_then(|v| v.as_bool()).unwrap_or(false) {
        return json!({ "ok": false, "reason": "not-signed-in", "videos": [], "continuation": "", "hasMore": false });
    }
    let args = args.unwrap_or(json!({}));
    let continuation = args.get("continuation").and_then(|v| v.as_str()).unwrap_or("");
    let body = if continuation.is_empty() {
        json!({ "context": { "client": { "clientName": "WEB", "clientVersion": "2.20231219.04.00", "hl": "en", "gl": "US" } }, "browseId": "FEwhat_to_watch" })
    } else {
        json!({ "context": { "client": { "clientName": "WEB", "clientVersion": "2.20231219.04.00", "hl": "en", "gl": "US" } }, "continuation": continuation })
    };
    match auth::authed_post(&app, &state, "session", "browse", &body, "https://www.youtube.com").await {
        Ok(data) => {
            let videos = youtube::collect_videos(&data);
            let mut next = String::new();
            youtube::walk(&data, &mut |v| {
                if next.is_empty() {
                    if let Some(t) = v.pointer("/continuationCommand/token").and_then(|x| x.as_str()) {
                        next = t.to_string();
                    }
                }
            });
            json!({ "ok": true, "reason": null, "videos": videos, "continuation": next, "hasMore": !next.is_empty(), "cached": false })
        }
        Err(e) => json!({ "ok": false, "reason": if e.contains("401") || e.contains("403") { "expired" } else { "request-error" }, "videos": [], "continuation": "", "hasMore": false, "detail": e }),
    }
}

#[tauri::command]
pub async fn yt_auth_subscriptions(app: AppHandle) -> Value {
    let state = crate::state::AppState::global();
    if !auth::status_value(&app).get("signedIn").and_then(|v| v.as_bool()).unwrap_or(false) {
        return json!({ "ok": false, "subscriptions": [] });
    }
    let body = json!({ "context": { "client": { "clientName": "WEB", "clientVersion": "2.20231219.04.00", "hl": "en", "gl": "US" } }, "browseId": "FEchannels" });
    match auth::authed_post(&app, &state, "session", "browse", &body, "https://www.youtube.com").await {
        Ok(data) => {
            let mut names = Vec::new();
            youtube::walk(&data, &mut |v| {
                if let Some(ch) = v.get("channelRenderer") {
                    let name = youtube::text_of(ch.get("title"));
                    if !name.is_empty() && !names.contains(&name) { names.push(name); }
                }
            });
            json!({ "ok": true, "subscriptions": names, "channelAvatars": {} })
        }
        Err(e) => json!({ "ok": false, "reason": e, "subscriptions": [] }),
    }
}

#[allow(dead_code)]
fn _keep(paths: &Paths, key: &str) -> String {
    format!("{} {key}", paths.config.display())
}

#[allow(dead_code)]
fn _key() -> &'static str { KEY }
