use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct Paths {
    pub config: PathBuf,
    pub downloads: PathBuf,
    pub music: PathBuf,
    pub videos: PathBuf,
    pub thumbs: PathBuf,
    pub stream_cache: PathBuf,
    pub settings: PathBuf,
    pub playlists: PathBuf,
    pub prefs: PathBuf,
    pub history: PathBuf,
}

impl Paths {
    pub fn resolve() -> Self {
        let config = config_dir();
        let downloads = config.join("downloads");
        let music = downloads.join("music");
        let videos = downloads.join("videos");
        let thumbs = config.join("thumbs");
        let stream_cache = config.join("stream-cache");
        for dir in [&config, &downloads, &music, &videos, &thumbs, &stream_cache] {
            let _ = fs::create_dir_all(dir);
        }
        Self {
            settings: config.join("settings.json"),
            playlists: config.join("playlists.json"),
            prefs: config.join("prefs.json"),
            history: config.join("smart-history.json"),
            config,
            downloads,
            music,
            videos,
            thumbs,
            stream_cache,
        }
    }

    pub fn allowed_roots(&self, settings: &Value) -> Vec<PathBuf> {
        let mut roots = vec![
            self.config.clone(),
            self.downloads.clone(),
            self.music.clone(),
            self.videos.clone(),
            self.thumbs.clone(),
        ];
        if let Some(dir) = settings.get("downloadDir").and_then(|v| v.as_str()) {
            if !dir.is_empty() {
                roots.push(PathBuf::from(dir));
            }
        }
        roots
    }
}

fn config_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        let legacy = home.join(".config").join("Kovatube");
        if legacy.is_dir() {
            return legacy;
        }
        if let Some(base) = dirs::config_dir() {
            return base.join("Kovatube");
        }
        return home.join(".config").join("Kovatube");
    }
    PathBuf::from("Kovatube")
}

pub fn default_settings(paths: &Paths) -> Value {
    json!({
        "theme": "dark",
        "musicStyle": "standard",
        "accentColor": "red",
        "autoplay": true,
        "defaultQuality": "auto",
        "defaultDownloadFormat": "mp4",
        "downloadDir": paths.downloads.to_string_lossy(),
        "showDescriptions": true,
        "reduceMotion": false,
        "playbackMode": "inApp",
        "smartDlEnabled": false,
        "smartDlClipboard": false,
        "smartDlLimit": 10,
        "smartDlConcurrency": 2,
        "smartDlCount": 0,
        "smartDlClipboardCount": 0,
        "smartDlInterval": 60,
        "fypSource": "auto",
        "welcomed": false,
        "navPosition": "side",
        "playerBar": "pill",
        "lyricAnimation": "karaoke",
        "lyricShader": true,
        "captionLang": ""
    })
}

pub fn load_settings(paths: &Paths) -> Value {
    let mut merged = default_settings(paths);
    if let Ok(text) = fs::read_to_string(&paths.settings) {
        if let Ok(Value::Object(saved)) = serde_json::from_str::<Value>(&text) {
            if let Value::Object(base) = &mut merged {
                for (k, v) in saved {
                    base.insert(k, v);
                }
            }
        }
    }
    merged
}

pub fn save_settings(paths: &Paths, settings: &Value) {
    if let Ok(text) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(&paths.settings, text);
    }
}

pub fn load_json_array(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
}

pub fn save_json(path: &Path, value: &Value) {
    if let Ok(text) = serde_json::to_string_pretty(value) {
        let _ = fs::write(path, text);
    }
}

pub fn ext_lower(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn is_audio(path: &Path) -> bool {
    matches!(
        ext_lower(path).as_str(),
        "mp3" | "m4a" | "aac" | "opus" | "ogg" | "oga" | "flac" | "wav"
    )
}

pub fn is_video(path: &Path) -> bool {
    matches!(
        ext_lower(path).as_str(),
        "mp4" | "mkv" | "webm" | "mov" | "avi" | "m4v"
    )
}

pub fn is_sidecar(path: &Path) -> bool {
    matches!(ext_lower(path).as_str(), "lrc" | "txt" | "part" | "ytdl" | "json")
}

pub fn find_media_in(dir: &Path, video_id: &str, prefer_audio: bool) -> Option<PathBuf> {
    if video_id.is_empty() || !dir.is_dir() {
        return None;
    }
    let mut hits = Vec::new();
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || is_sidecar(&path) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.contains(video_id) {
            continue;
        }
        if is_audio(&path) || is_video(&path) {
            hits.push(path);
        }
    }
    hits.sort_by_key(|p| {
        let audio = is_audio(p);
        if prefer_audio { !audio } else { audio }
    });
    hits.into_iter().next()
}

pub fn list_media(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && !is_sidecar(path) && (is_audio(path) || is_video(path)))
        .collect()
}

pub fn find_in_list(files: &[PathBuf], video_id: &str, prefer_audio: bool) -> Option<PathBuf> {
    if video_id.is_empty() {
        return None;
    }
    let mut hits: Vec<&PathBuf> = files
        .iter()
        .filter(|path| path.file_name().and_then(|name| name.to_str()).unwrap_or("").contains(video_id))
        .collect();
    hits.sort_by_key(|path| {
        let audio = is_audio(path);
        if prefer_audio { !audio } else { audio }
    });
    hits.into_iter().next().cloned()
}

pub fn find_media(paths: &Paths, video_id: &str, prefer_audio: bool) -> Option<PathBuf> {
    for dir in [&paths.music, &paths.videos, &paths.downloads] {
        if let Some(hit) = find_media_in(dir, video_id, prefer_audio) {
            return Some(hit);
        }
    }
    None
}

pub fn playback_url(port: u16, path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    format!("http://127.0.0.1:{port}/local?p={}", urlencoding::encode(&normalized))
}

pub fn file_to_yturl(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let encoded = normalized
        .split('/')
        .map(|part| urlencoding::encode(part).into_owned())
        .collect::<Vec<_>>()
        .join("/");
    format!("ytfile://localhost{encoded}")
}

pub fn mime_for(path: &Path) -> &'static str {
    match ext_lower(path).as_str() {
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "opus" => "audio/opus",
        "ogg" | "oga" => "audio/ogg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "m3u8" => "application/vnd.apple.mpegurl",
        "ts" => "video/mp2t",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "vtt" => "text/vtt",
        "lrc" | "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

pub fn read_range(path: &Path, range_header: Option<&str>) -> Option<(u16, Vec<u8>, Option<String>, u64)> {
    let file = fs::File::open(path).ok()?;
    let total = file.metadata().ok()?.len();
    if total == 0 {
        return Some((200, Vec::new(), None, 0));
    }
    let (start, end) = parse_range(range_header, total).unwrap_or_else(|| {
        if total <= 8 * 1024 * 1024 {
            (0, total - 1)
        } else {
            (0, (2 * 1024 * 1024 - 1).min(total - 1))
        }
    });
    if start >= total {
        return Some((416, Vec::new(), Some(format!("bytes */{total}")), total));
    }
    let end = end.min(total - 1);
    let len = (end - start + 1) as usize;
    use std::io::{Read, Seek, SeekFrom};
    let mut file = file;
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = vec![0u8; len];
    let n = file.read(&mut buf).ok()?;
    buf.truncate(n);
    let partial = range_header.is_some() || (start, end) != (0, total - 1);
    if partial {
        let cr = format!("bytes {start}-{end}/{total}");
        Some((206, buf, Some(cr), total))
    } else {
        Some((200, buf, None, total))
    }
}

pub fn parse_range(header: Option<&str>, total: u64) -> Option<(u64, u64)> {
    let header = header?;
    let spec = header.trim().strip_prefix("bytes=")?;
    let (start_s, end_s) = spec.split_once('-')?;
    if start_s.is_empty() {
        let tail: u64 = end_s.parse().ok()?;
        let start = total.saturating_sub(tail);
        return Some((start, total.saturating_sub(1)));
    }
    let start: u64 = start_s.parse().ok()?;
    let end = if end_s.is_empty() {
        total.saturating_sub(1)
    } else {
        end_s.parse::<u64>().ok()?.min(total.saturating_sub(1))
    };
    Some((start, end.max(start)))
}

#[cfg(test)]
mod tests {
    use super::find_media_in;
    use std::fs;

    #[test]
    fn find_media_skips_lyric_sidecar() {
        let dir = std::env::temp_dir().join(format!("kovatube-media-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Song [abc123].lrc"), "[00:00.00] hi").unwrap();
        fs::write(dir.join("Song [abc123].mp3"), b"audio").unwrap();
        let hit = find_media_in(&dir, "abc123", true).unwrap();
        assert_eq!(hit.extension().and_then(|e| e.to_str()), Some("mp3"));
        let _ = fs::remove_dir_all(&dir);
    }
}

pub fn path_is_allowed(path: &Path, roots: &[PathBuf]) -> bool {
    let Ok(real) = fs::canonicalize(path) else { return false };
    roots.iter().any(|root| {
        fs::canonicalize(root)
            .map(|r| real.starts_with(&r))
            .unwrap_or(false)
    })
}
