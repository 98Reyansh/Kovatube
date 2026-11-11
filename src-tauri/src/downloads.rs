use crate::cover;
use crate::paths::{self, Paths};
use crate::state::{AppState, DownloadSlot};
use crate::stream::{self, kill_pid};
use crate::youtube;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

fn now_iso() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{secs}")
}

pub fn music_fields(path: &Path, port: u16) -> Value {
    let local = if path.is_file() { paths::playback_url(port, path) } else { String::new() };
    let sidecar = lyrics_sidecar(path);
    json!({
        "localUrl": local,
        "isAudio": paths::is_audio(path),
        "hasLyrics": sidecar.is_some()
    })
}

fn lyrics_sidecar(path: &Path) -> Option<PathBuf> {
    let stem = path.with_extension("");
    for ext in ["lrc", "txt"] {
        let candidate = stem.with_extension(ext);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn read_local_lyrics(path: &Path) -> Option<Value> {
    let sidecar = lyrics_sidecar(path)?;
    let raw = std::fs::read_to_string(&sidecar).ok()?;
    if sidecar.extension().and_then(|e| e.to_str()) == Some("lrc") {
        let lines = youtube::parse_lrc(&raw);
        if !lines.is_empty() {
            let rich = lines.iter().any(|line| line.get("words").and_then(|w| w.as_array()).map(|w| !w.is_empty()).unwrap_or(false));
            return Some(json!({
                "ok": true,
                "synced": lines,
                "syncType": if rich { "rich" } else { "line" },
                "source": "Saved",
                "lyrics": "",
                "footer": "Lyrics · saved with download"
            }));
        }
    }
    let text = raw.trim();
    if text.is_empty() {
        None
    } else {
        Some(json!({
            "ok": true,
            "synced": null,
            "syncType": "plain",
            "source": "Saved",
            "lyrics": text,
            "footer": "Lyrics · saved with download"
        }))
    }
}

pub fn playlists_for_ui(state: &AppState) -> Vec<Value> {
    let list = state.playlists.lock().ok().map(|p| p.clone()).unwrap_or_default();
    let music = paths::list_media(&state.paths.music);
    let videos = paths::list_media(&state.paths.videos);
    let downloads = paths::list_media(&state.paths.downloads);
    let mut out = Vec::new();
    for pl in list {
        let mut tracks = Vec::new();
        if let Some(items) = pl.get("tracks").and_then(|v| v.as_array()) {
            let mut items = items.clone();
            items.sort_by_key(|t| t.get("order").and_then(|v| v.as_u64()).unwrap_or(0));
            for t in items {
                let video_id = t.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
                let stored = t.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
                let path = if !stored.is_empty() && Path::new(stored).is_file() && paths::is_audio(Path::new(stored)) {
                    PathBuf::from(stored)
                } else {
                    match paths::find_in_list(&music, video_id, true)
                        .or_else(|| paths::find_in_list(&videos, video_id, true))
                        .or_else(|| paths::find_in_list(&downloads, video_id, true))
                    {
                        Some(p) => p,
                        None => continue,
                    }
                };
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                let local_thumb = cover::thumb_url(&state.paths, video_id);
                let thumbnail = if local_thumb.is_empty() {
                    t.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("").to_string()
                } else {
                    local_thumb
                };
                let mut row = json!({
                    "id": format!("{}:{}", pl.get("id").and_then(|v| v.as_str()).unwrap_or(""), t.get("order").and_then(|v| v.as_u64()).unwrap_or(0)),
                    "videoId": video_id,
                    "title": t.get("title").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("Unknown track"),
                    "artist": t.get("artist").and_then(|v| v.as_str()).unwrap_or(""),
                    "duration": t.get("duration").and_then(|v| v.as_str()).unwrap_or(""),
                    "thumbnail": thumbnail,
                    "fileName": path.file_name().and_then(|s| s.to_str()).unwrap_or(""),
                    "filePath": path.to_string_lossy(),
                    "totalBytes": size,
                    "format": format!(".{}", paths::ext_lower(&path))
                });
                if let (Some(obj), Value::Object(extra)) = (row.as_object_mut(), music_fields(&path, state.proxy_port)) {
                    for (k, v) in extra {
                        obj.insert(k, v);
                    }
                }
                tracks.push(row);
            }
        }
        if tracks.is_empty() {
            continue;
        }
        let total: u64 = tracks.iter().map(|t| t.get("totalBytes").and_then(|v| v.as_u64()).unwrap_or(0)).sum();
        let thumb = cover::thumb_url(&state.paths, tracks[0].get("videoId").and_then(|v| v.as_str()).unwrap_or(""));
        out.push(json!({
            "id": pl.get("id").cloned().unwrap_or(json!("")),
            "title": pl.get("title").and_then(|v| v.as_str()).unwrap_or("Playlist"),
            "artist": pl.get("artist").and_then(|v| v.as_str()).unwrap_or(""),
            "thumbnail": if thumb.is_empty() { tracks[0].get("thumbnail").cloned().unwrap_or(json!("")) } else { json!(thumb) },
            "browseId": pl.get("browseId").cloned().unwrap_or(json!("")),
            "createdAt": pl.get("createdAt").cloned().unwrap_or(json!("")),
            "updatedAt": pl.get("updatedAt").cloned().unwrap_or(json!("")),
            "autoSync": pl.get("autoSync").and_then(|v| v.as_bool()).unwrap_or(true),
            "lastSyncAt": pl.get("lastSyncAt").cloned().unwrap_or(json!("")),
            "syncing": false,
            "trackCount": tracks.len(),
            "totalBytes": total,
            "hasLyrics": tracks.iter().any(|t| t.get("hasLyrics").and_then(|v| v.as_bool()).unwrap_or(false)),
            "tracks": tracks
        }));
    }
    out
}

fn save_playlists(state: &AppState) {
    if let Ok(list) = state.playlists.lock() {
        paths::save_json(&state.paths.playlists, &Value::Array(list.clone()));
    }
}

fn playlist_id(meta: &Value) -> String {
    let browse = meta.get("browseId").and_then(|v| v.as_str()).unwrap_or("");
    if !browse.is_empty() {
        return format!("pl_{browse}");
    }
    let title = meta.get("title").and_then(|v| v.as_str()).unwrap_or("playlist");
    let slug: String = title.chars().filter(|c| c.is_ascii_alphanumeric()).take(24).collect();
    format!("pl_{}", if slug.is_empty() { "playlist" } else { &slug })
}

pub fn start_download(state: &AppState, app: AppHandle, opts: &Value, smart: bool) -> String {
    let video_id = opts.get("videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let audio = opts.get("audio").and_then(|v| v.as_bool()).unwrap_or(false)
        || opts.get("format").and_then(|v| v.as_str()).unwrap_or("").eq_ignore_ascii_case("mp3");
    let quality = opts.get("quality").and_then(|v| v.as_str()).unwrap_or("720").to_string();
    let title = opts.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let id = if smart { state.next_id("smart_") } else { state.next_id("dl_") };
    let target = if audio { state.paths.music.clone() } else { state.paths.videos.clone() };
    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let height: u64 = quality.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(720);
    let mut args = Vec::new();
    if audio {
        args.extend(["-f".into(), "bestaudio/best".into(), "--extract-audio".into(), "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "0".into()]);
    } else {
        args.extend(["-f".into(), youtube::download_format(height.min(1080)), "--merge-output-format".into(), "mp4".into()]);
    }
    let template = target.join("%(title)s [%(id)s].%(ext)s");
    args.extend([
        "--no-playlist".into(),
        "--newline".into(),
        "--no-colors".into(),
        "--progress".into(),
        "-o".into(),
        template.to_string_lossy().to_string(),
        url,
    ]);
    let child = Command::new("yt-dlp")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let child = match child {
        Ok(c) => c,
        Err(e) => {
            let event = if smart { "smart-dl-progress" } else { "download-progress" };
            let _ = app.emit(event, json!({ "id": id, "status": "failed", "error": e.to_string(), "videoId": video_id }));
            return id;
        }
    };
    let slot = DownloadSlot {
        child: Arc::new(Mutex::new(Some(child))),
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let child_slot = slot.child.clone();
    let cancel = slot.cancel.clone();
    if smart {
        state.smart_active.lock().ok().map(|mut m| m.insert(id.clone(), slot));
    } else {
        state.downloads.lock().ok().map(|mut m| m.insert(id.clone(), slot));
    }
    let app2 = app.clone();
    let id2 = id.clone();
    let video2 = video_id.clone();
    let title2 = title.clone();
    let paths = Paths::resolve();
    let port = state.proxy_port;
    let event_progress = if smart { "smart-dl-progress" } else { "download-progress" };
    let event_done = if smart { "smart-dl-complete" } else { "download-complete" };
    std::thread::spawn(move || {
        let mut stdout = child_slot.lock().ok().and_then(|mut g| g.as_mut().and_then(|c| c.stdout.take()));
        let mut file_name = String::new();
        if let Some(out) = stdout.as_mut() {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(out);
            for line in reader.lines().flatten() {
                if let Some(payload) = parse_progress(&line, &id2, &video2, &mut file_name) {
                    let _ = app2.emit(event_progress, payload);
                }
            }
        }
        let status = child_slot.lock().ok().and_then(|mut g| g.as_mut().and_then(|c| c.wait().ok()));
        let cancelled = cancel.load(Ordering::Relaxed);
        if cancelled {
            let _ = app2.emit(if smart { "smart-dl-cancelled" } else { "download-progress" }, json!({ "id": id2, "status": "cancelled", "videoId": video2 }));
            return;
        }
        let code = status.map(|s| s.code().unwrap_or(1)).unwrap_or(1);
        if code == 0 {
            let found = paths::find_media_in(if audio { &paths.music } else { &paths.videos }, &video2, audio)
                .or_else(|| paths::find_media(&paths, &video2, audio));
            let file_path = found.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            let name = found.as_ref().and_then(|p| p.file_name()).and_then(|s| s.to_str()).unwrap_or(&file_name).to_string();
            let bytes = found.as_ref().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len()).unwrap_or(0);
            let mut done = json!({
                "id": id2,
                "videoId": video2,
                "title": title2,
                "fileName": name,
                "filePath": file_path,
                "totalBytes": bytes,
                "status": "completed",
                "completedAt": now_iso()
            });
            if let Some(path) = found.as_ref() {
                if let (Some(obj), Value::Object(extra)) = (done.as_object_mut(), music_fields(path, port)) {
                    for (k, v) in extra {
                        obj.insert(k, v);
                    }
                }
            }
            let _ = app2.emit(event_done, done);
        } else {
            let _ = app2.emit(event_progress, json!({ "id": id2, "status": "failed", "error": format!("yt-dlp exited {code}"), "videoId": video2 }));
        }
    });
    let _ = app.emit(
        if smart { "smart-dl-progress" } else { "download-progress" },
        json!({ "id": id, "status": "downloading", "videoId": video_id, "title": title, "progress": 0, "fileName": "" }),
    );
    id
}

fn parse_progress(line: &str, id: &str, video_id: &str, file_name: &mut String) -> Option<Value> {
    if let Some(rest) = line.strip_prefix("[download] Destination:") {
        *file_name = Path::new(rest.trim()).file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        return None;
    }
    if line.contains("has already been downloaded") {
        return Some(json!({ "id": id, "videoId": video_id, "status": "downloading", "progress": 99, "fileName": file_name, "eta": "Finalizing..." }));
    }
    let percent = line.split('%').next().and_then(|s| s.split_whitespace().last()).and_then(|s| s.parse::<f64>().ok())?;
    if !line.contains("[download]") {
        return None;
    }
    let speed = line.split("at ").nth(1).and_then(|s| s.split_whitespace().next()).unwrap_or("");
    let eta = line.split("ETA ").nth(1).and_then(|s| s.split_whitespace().next()).unwrap_or("");
    Some(json!({
        "id": id,
        "videoId": video_id,
        "status": "downloading",
        "progress": percent,
        "speed": speed,
        "eta": eta,
        "fileName": file_name
    }))
}

pub fn cancel(state: &AppState, id: &str) -> bool {
    let mut found = false;
    for map in [
        state.downloads.lock().ok().map(|mut m| take_slot(&mut m, id)),
        state.smart_active.lock().ok().map(|mut m| take_slot(&mut m, id)),
    ] {
        if let Some(Some(slot)) = map {
            slot.cancel.store(true, Ordering::Relaxed);
            if let Some(pid) = slot.child.lock().ok().and_then(|mut g| g.as_mut().map(|c| c.id())) {
                kill_pid(pid);
            }
            found = true;
        }
    }
    found
}

fn take_slot(map: &mut std::collections::HashMap<String, DownloadSlot>, id: &str) -> Option<DownloadSlot> {
    map.remove(id)
}

pub fn active(state: &AppState) -> Vec<Value> {
    let mut out = Vec::new();
    if let Ok(map) = state.downloads.lock() {
        for id in map.keys() {
            out.push(json!({ "id": id, "status": "downloading" }));
        }
    }
    out
}

pub fn enqueue_playlist(state: &AppState, app: AppHandle, opts: &Value) -> Value {
    let tracks = opts.get("tracks").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let meta = opts.get("playlist").cloned().unwrap_or(json!({}));
    let id = playlist_id(&meta);
    let record_tracks: Vec<Value> = tracks
        .iter()
        .enumerate()
        .filter_map(|(i, t)| {
            let video_id = t.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
            if video_id.is_empty() { return None; }
            Some(json!({
                "videoId": video_id,
                "title": t.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "artist": t.get("artist").and_then(|v| v.as_str()).unwrap_or(""),
                "duration": t.get("duration").and_then(|v| v.as_str()).unwrap_or(""),
                "thumbnail": t.get("thumbnail").and_then(|v| v.as_str()).unwrap_or(""),
                "order": i,
                "status": "pending",
                "fileName": "",
                "filePath": ""
            }))
        })
        .collect();
    if let Ok(mut list) = state.playlists.lock() {
        if let Some(existing) = list.iter_mut().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id.as_str())) {
            existing["title"] = meta.get("title").cloned().unwrap_or(existing.get("title").cloned().unwrap_or(json!("Playlist")));
            existing["tracks"] = json!(record_tracks);
            existing["updatedAt"] = json!(now_iso());
        } else {
            list.push(json!({
                "id": id,
                "title": meta.get("title").and_then(|v| v.as_str()).unwrap_or("Playlist"),
                "artist": meta.get("artist").and_then(|v| v.as_str()).unwrap_or(""),
                "thumbnail": meta.get("thumbnail").and_then(|v| v.as_str()).unwrap_or(""),
                "browseId": meta.get("browseId").and_then(|v| v.as_str()).unwrap_or(""),
                "createdAt": now_iso(),
                "autoSync": true,
                "tracks": record_tracks
            }));
        }
    }
    save_playlists(state);
    let _ = app.emit("playlist-update", json!({ "id": id }));
    let concurrency = opts.get("concurrency").and_then(|v| v.as_u64()).unwrap_or(2).max(1) as usize;
    let pending: Vec<Value> = tracks
        .into_iter()
        .filter(|t| {
            let video_id = t.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
            paths::find_media(&state.paths, video_id, true).is_none()
        })
        .collect();
    let state_paths = state.paths.music.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut in_flight = Vec::new();
        for track in pending {
            let video_id = track.get("videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if video_id.is_empty() { continue; }
            let mut child = match Command::new("yt-dlp")
                .args([
                    "-f", "bestaudio/best", "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0",
                    "--no-playlist", "--newline", "--no-colors", "-o",
                ])
                .arg(state_paths.join("%(title)s [%(id)s].%(ext)s"))
                .arg(format!("https://www.youtube.com/watch?v={video_id}"))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(c) => c,
                Err(_) => continue,
            };
            in_flight.push(child.id());
            if in_flight.len() >= concurrency {
                let _ = child.wait();
                in_flight.pop();
            }
            let _ = &app2;
        }
    });
    json!({ "started": true, "id": id })
}

pub fn set_autosync(state: &AppState, id: &str, enabled: bool) -> bool {
    let mut ok = false;
    if let Ok(mut list) = state.playlists.lock() {
        if let Some(pl) = list.iter_mut().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id)) {
            pl["autoSync"] = json!(enabled);
            ok = true;
        }
    }
    if ok { save_playlists(state); }
    ok
}

pub async fn sync_one(state: &AppState, app: &AppHandle, id: &str) -> Value {
    let browse = state.playlists.lock().ok().and_then(|list| {
        list.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id)).and_then(|p| p.get("browseId").and_then(|v| v.as_str()).map(|s| s.to_string()))
    });
    let Some(browse) = browse.filter(|s| !s.is_empty()) else {
        return json!({ "ok": false, "reason": "No playlist id" });
    };
    let _ = app.emit("playlist-sync", json!({ "id": id, "status": "started" }));
    let url = if browse.starts_with("VL") || browse.starts_with("PL") {
        format!("https://www.youtube.com/playlist?list={}", browse.trim_start_matches("VL"))
    } else {
        format!("https://music.youtube.com/playlist?list={browse}")
    };
    let output = stream::run_tool("yt-dlp", &["--flat-playlist", "-J", "--no-warnings", &url], 40).await.unwrap_or_default();
    let parsed: Value = serde_json::from_str(&output).unwrap_or(json!({}));
    let entries = parsed.get("entries").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut added = 0;
    if let Ok(mut list) = state.playlists.lock() {
        if let Some(pl) = list.iter_mut().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id)) {
            let tracks = pl.get_mut("tracks").and_then(|v| v.as_array_mut());
            if let Some(tracks) = tracks {
                for entry in entries {
                    let video_id = entry.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if video_id.is_empty() || tracks.iter().any(|t| t.get("videoId").and_then(|v| v.as_str()) == Some(video_id)) {
                        continue;
                    }
                    tracks.push(json!({
                        "videoId": video_id,
                        "title": entry.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "artist": "",
                        "duration": "",
                        "thumbnail": "",
                        "order": tracks.len(),
                        "status": "pending",
                        "fileName": "",
                        "filePath": ""
                    }));
                    added += 1;
                    let opts = json!({ "videoId": video_id, "audio": true, "title": entry.get("title").and_then(|v| v.as_str()).unwrap_or(""), "quality": "audio" });
                    start_download(state, app.clone(), &opts, false);
                }
            }
            pl["lastSyncAt"] = json!(now_iso());
        }
    }
    save_playlists(state);
    let _ = app.emit("playlist-sync", json!({ "id": id, "status": "done", "added": added }));
    json!({ "ok": true, "added": added })
}

pub fn completed_for_ui(state: &AppState) -> Vec<Value> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for dir in [&state.paths.music, &state.paths.videos, &state.paths.downloads] {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || paths::is_sidecar(&path) { continue; }
            if !(paths::is_audio(&path) || paths::is_video(&path)) { continue; }
            let file_path = path.to_string_lossy().to_string();
            if !seen.insert(file_path.clone()) { continue; }
            let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let video_id = video_id_from_name(&file_name);
            let title = title_from_name(&file_name, &video_id);
            let thumb = if video_id.is_empty() { String::new() } else { cover::thumb_url(&state.paths, &video_id) };
            out.push(json!({
                "id": format!("fs_{}_{file_name}", dir.file_name().and_then(|s| s.to_str()).unwrap_or("downloads")),
                "videoId": video_id,
                "title": title,
                "thumbnail": thumb,
                "fileName": file_name,
                "filePath": file_path,
                "quality": "",
                "format": format!(".{}", paths::ext_lower(&path)),
                "totalBytes": std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
                "status": "completed",
                "isAudio": paths::is_audio(&path),
                "localUrl": paths::playback_url(state.proxy_port, &path),
                "hasLyrics": lyrics_sidecar(&path).is_some()
            }));
        }
    }
    out
}

fn title_from_name(name: &str, video_id: &str) -> String {
    let stem = name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(name);
    if video_id.is_empty() {
        return stem.to_string();
    }
    stem.strip_suffix(&format!(" [{video_id}]")).unwrap_or(stem).trim().to_string()
}

fn video_id_from_name(name: &str) -> String {
    let Some(open) = name.rfind('[') else { return String::new() };
    let Some(close) = name[open + 1..].find(']') else { return String::new() };
    let id = &name[open + 1..open + 1 + close];
    let rest = &name[open + 1 + close + 1..];
    if id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') && rest.starts_with('.') {
        id.to_string()
    } else {
        String::new()
    }
}

pub fn scan_downloads(paths: &Paths) -> Vec<Value> {
    let mut out = Vec::new();
    for dir in [&paths.music, &paths.videos, &paths.downloads] {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || paths::is_sidecar(&path) { continue; }
            if !(paths::is_audio(&path) || paths::is_video(&path)) { continue; }
            out.push(json!({
                "fileName": path.file_name().and_then(|s| s.to_str()).unwrap_or(""),
                "filePath": path.to_string_lossy(),
                "totalBytes": std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
                "isAudio": paths::is_audio(&path)
            }));
        }
    }
    out
}
