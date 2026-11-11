use crate::proxy;
use crate::state::{AppState, Relay};
use crate::youtube::{self, MediaPair};
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub async fn resolve(state: &AppState, app: &AppHandle, video_id: &str, quality: &str, force_ytdlp: bool) -> Result<(String, String, String), String> {
    let key = format!("{video_id}|{quality}");
    if !force_ytdlp {
        if let Some(hit) = state.url_cache.lock().ok().and_then(|c| c.get(&key).cloned()) {
            if now_ms().saturating_sub(hit.at) < 3 * 3600 * 1000 {
                return Ok((hit.video_url, hit.audio_url, hit.source));
            }
        }
    }
    if force_ytdlp || state.blocked.lock().map(|b| b.contains(video_id)).unwrap_or(false) {
        let pair = ytdlp_pair(video_id, quality).await?;
        remember(state, &key, &pair.0, &pair.1, "ytdlp");
        return Ok((pair.0, pair.1, "ytdlp".into()));
    }
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<(String, String, String), String>>(2);
    let tx_i = tx.clone();
    let client = state.http.clone();
    let id = video_id.to_string();
    let quality_i = quality.to_string();
    let mut visitor = state.visitor.lock().ok().and_then(|v| v.clone());
    tokio::spawn(async move {
        let result = match youtube::player(&client, &id, &mut visitor).await {
            Ok(data) => match youtube::pick_pair(&data, &quality_i) {
                Some(pair) => Ok((pair.video_url, pair.audio_url, "innertube".into())),
                None => Err("no plain avc1 pair".into()),
            },
            Err(e) => Err(e),
        };
        let _ = tx_i.send(result).await;
    });
    let id2 = video_id.to_string();
    let quality2 = quality.to_string();
    tokio::spawn(async move {
        let result = ytdlp_pair(&id2, &quality2).await.map(|(v, a)| (v, a, "ytdlp".into()));
        let _ = tx.send(result).await;
    });
    let mut failure = "could not resolve streams".to_string();
    for _ in 0..2 {
        if let Some(item) = rx.recv().await {
            match item {
                Ok((video, audio, source)) => {
                    remember(state, &key, &video, &audio, &source);
                    if source == "innertube" {
                        let probe_video = video.clone();
                        let probe_audio = audio.clone();
                        let client = state.http.clone();
                        let id = video_id.to_string();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if !pair_readable(&client, &probe_video, &probe_audio).await {
                                let _ = app.emit("stream-capped", json!({ "videoId": id }));
                            }
                        });
                    }
                    return Ok((video, audio, source));
                }
                Err(e) => failure = e,
            }
        }
    }
    Err(failure)
}

fn remember(state: &AppState, key: &str, video: &str, audio: &str, source: &str) {
    if let Ok(mut cache) = state.url_cache.lock() {
        cache.insert(key.to_string(), crate::state::CachedPair {
            at: now_ms(),
            video_url: video.to_string(),
            audio_url: audio.to_string(),
            source: source.to_string(),
        });
    }
}

async fn pair_readable(client: &reqwest::Client, video: &str, audio: &str) -> bool {
    async fn deep(client: &reqwest::Client, url: &str) -> bool {
        let Ok(parsed) = url::Url::parse(url) else { return false };
        let clen: u64 = parsed.query_pairs().find(|(k, _)| k == "clen").and_then(|(_, v)| v.parse().ok()).unwrap_or(0);
        if clen < 4096 {
            return false;
        }
        let start = (clen as f64 * 0.9) as u64;
        let resp = client
            .get(url)
            .header("Range", format!("bytes={start}-{}", start + 2047))
            .header("Referer", "https://www.youtube.com/")
            .header("User-Agent", youtube::UA)
            .timeout(Duration::from_secs(4))
            .send()
            .await;
        matches!(resp, Ok(r) if r.status().as_u16() == 206)
    }
    let (v, a) = tokio::join!(deep(client, video), deep(client, audio));
    v && a
}

async fn ytdlp_pair(video_id: &str, quality: &str) -> Result<(String, String), String> {
    let format = youtube::stream_format(quality);
    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let output = run_tool(
        "yt-dlp",
        &[
            "--js-runtimes", "node", "-g", "-f", &format, "--no-playlist", "--skip-download", "--no-colors", &url,
        ],
        25,
    )
    .await?;
    let lines: Vec<&str> = output.lines().map(str::trim).filter(|l| l.starts_with("http")).collect();
    if lines.len() < 2 {
        return Err("yt-dlp could not resolve streams".into());
    }
    Ok((lines[0].to_string(), lines[1].to_string()))
}

pub async fn run_tool(bin: &str, args: &[&str], timeout_secs: u64) -> Result<String, String> {
    let mut child = Command::new(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("{bin}: {e}"))?;
    let pid = child.id().unwrap_or(0);
    let wait = async {
        let mut out = String::new();
        if let Some(mut stdout) = child.stdout.take() {
            let _ = stdout.read_to_string(&mut out).await;
        }
        let status = child.wait().await.map_err(|e| e.to_string())?;
        if !status.success() && out.trim().is_empty() {
            return Err(format!("{bin} exited {status}"));
        }
        Ok(out)
    };
    match tokio::time::timeout(Duration::from_secs(timeout_secs), wait).await {
        Ok(result) => result,
        Err(_) => {
            kill_pid(pid);
            Err(format!("{bin} timed out"))
        }
    }
}

pub fn kill_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill").args(["/F", "/PID", &pid.to_string()]).status();
    }
}

pub async fn playback(state: &AppState, app: &AppHandle, video_id: &str, quality: &str, relay: bool) -> Value {
    let force = relay && state.blocked.lock().map(|b| b.contains(video_id)).unwrap_or(false);
    let resolved = match resolve(state, app, video_id, quality, force).await {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "reason": e }),
    };
    let (video, audio, source) = resolved;
    if !relay && !video.is_empty() && !audio.is_empty() {
        return json!({
            "ok": true,
            "direct": true,
            "videoUrl": proxy::proxied(state.proxy_port, &video),
            "audioUrl": proxy::proxied(state.proxy_port, &audio),
            "source": source
        });
    }
    match start_relay(state, video_id, &video, &audio).await {
        Ok(()) => json!({
            "ok": true,
            "url": format!("http://127.0.0.1:{}/stream/{video_id}/index.m3u8", state.proxy_port),
            "source": source
        }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

async fn start_relay(state: &AppState, video_id: &str, video: &str, audio: &str) -> Result<(), String> {
    stop(state, video_id);
    let dir = state.paths.stream_cache.join(video_id);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let playlist = dir.join("index.m3u8");
    let mut child = Command::new("ffmpeg")
        .args([
            "-y", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
            "-f", "hls", "-hls_time", "1", "-hls_list_size", "0", "-hls_flags", "independent_segments",
            "-hls_segment_type", "mpegts", "-start_number", "0",
        ])
        .arg(&playlist)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false)
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.id().unwrap_or(0);
    if let Ok(mut relays) = state.relays.lock() {
        relays.insert(video_id.to_string(), Relay { pid });
    }
    tauri::async_runtime::spawn(async move {
        let _ = child.wait().await;
    });
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        if playlist.is_file() {
            if let Ok(body) = std::fs::read_to_string(&playlist) {
                if body.contains("#EXTINF") {
                    return Ok(());
                }
            }
        }
        if tokio::time::Instant::now() > deadline {
            stop(state, video_id);
            return Err("Stream timed out while starting".into());
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

pub fn stop(state: &AppState, video_id: &str) {
    if let Ok(mut relays) = state.relays.lock() {
        if let Some(relay) = relays.remove(video_id) {
            kill_pid(relay.pid);
        }
    }
}

pub async fn audio_only(state: &AppState, app: &AppHandle, video_id: &str) -> Value {
    match resolve(state, app, video_id, "audio", false).await {
        Ok((_, audio, source)) => json!({
            "ok": true,
            "audioUrl": proxy::proxied(state.proxy_port, &audio),
            "source": source
        }),
        Err(e) => json!({ "ok": false, "reason": e }),
    }
}

pub async fn captions(state: &AppState, video_id: &str, language: &str, kind: &str) -> Value {
    let lang = language.trim();
    if video_id.is_empty() || lang.len() < 2 {
        return json!({ "cues": [], "error": "Couldn't load captions" });
    }
    let track_kind = if kind == "asr" { "asr" } else { "manual" };
    let cache_key = format!("{video_id}|{lang}|{track_kind}");
    if let Some(hit) = state.caption_cache.lock().ok().and_then(|c| c.get(&cache_key).cloned()) {
        return json!({ "cues": hit, "error": null });
    }
    let dir = std::env::temp_dir().join(format!("kovatube-caps-{video_id}-{lang}"));
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::create_dir_all(&dir);
    let output = dir.join("cap");
    let flag = if track_kind == "asr" { "--write-auto-subs" } else { "--write-subs" };
    let template = output.to_string_lossy().to_string();
    let url = format!("https://www.youtube.com/watch?v={video_id}");
    let _ = run_tool(
        "yt-dlp",
        &["--js-runtimes", "node", "--skip-download", "--no-playlist", "--no-colors", "--sub-format", "vtt", "--sub-langs", lang, flag, "-o", &template, &url],
        30,
    )
    .await;
    let cues = std::fs::read_dir(&dir)
        .ok()
        .and_then(|entries| {
            let mut files: Vec<_> = entries.flatten().map(|e| e.path()).filter(|p| paths_vtt(p)).collect();
            files.sort();
            let preferred = files.iter().find(|p| p.to_string_lossy().contains(&format!(".{lang}."))).cloned().or_else(|| files.into_iter().next())?;
            let text = std::fs::read_to_string(preferred).ok()?;
            Some(youtube::parse_vtt(&text))
        })
        .unwrap_or_default();
    let _ = std::fs::remove_dir_all(&dir);
    if cues.is_empty() {
        return json!({ "cues": [], "error": "Couldn't load captions" });
    }
    if let Ok(mut cache) = state.caption_cache.lock() {
        cache.insert(cache_key, cues.clone());
    }
    json!({ "cues": cues, "error": null })
}

fn paths_vtt(path: &std::path::Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("vtt")).unwrap_or(false)
}

pub async fn probe_direct(client: &reqwest::Client, port: u16) -> Value {
    let mut visitor = None;
    let mut video_url = String::new();
    if let Ok(data) = youtube::player(client, "jNQXAC9IVRw", &mut visitor).await {
        if let Some(MediaPair { video_url: url, .. }) = youtube::pick_pair(&data, "360") {
            video_url = url;
        }
    }
    if video_url.is_empty() {
        video_url = match ytdlp_pair("jNQXAC9IVRw", "360").await {
            Ok((url, _)) => url,
            Err(e) => return json!({ "ok": false, "reason": e }),
        };
    }
    let proxied = proxy::proxied(port, &video_url);
    match client.get(&proxied).header("Range", "bytes=0-1023").send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            let bytes = resp.bytes().await.map(|b| b.len()).unwrap_or(0);
            json!({ "ok": status == 200 || status == 206, "status": status, "contentType": ct, "bytes": bytes })
        }
        Err(e) => json!({ "ok": false, "reason": e.to_string() }),
    }
}
