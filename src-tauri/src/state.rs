use crate::paths::{self, Paths};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::process::Child;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, OnceLock};

static GLOBAL: OnceLock<AppState> = OnceLock::new();
use tokio::sync::oneshot;

pub struct FetchOut {
    pub status: u16,
    pub body: String,
    pub error: String,
}

pub struct DownloadSlot {
    pub child: Arc<Mutex<Option<Child>>>,
    pub cancel: Arc<AtomicBool>,
}

pub struct Relay {
    pub pid: u32,
}

#[derive(Clone)]
pub struct CachedPair {
    pub at: u64,
    pub video_url: String,
    pub audio_url: String,
    pub source: String,
}

pub struct AppState {
    pub paths: Paths,
    pub http: reqwest::Client,
    pub proxy_port: u16,
    pub settings: Mutex<Value>,
    pub playlists: Mutex<Vec<Value>>,
    pub prefs: Mutex<Value>,
    pub visitor: Mutex<Option<String>>,
    pub blocked: Mutex<HashSet<String>>,
    pub url_cache: Mutex<HashMap<String, CachedPair>>,
    pub downloads: Mutex<HashMap<String, DownloadSlot>>,
    pub relays: Mutex<HashMap<String, Relay>>,
    pub caption_cache: Mutex<HashMap<String, Vec<Value>>>,
    pub fetches: Mutex<HashMap<String, oneshot::Sender<FetchOut>>>,
    pub session_ready: AtomicBool,
    pub music_ready: AtomicBool,
    pub cover_palette: Mutex<HashMap<String, Value>>,
    pub cover_image: Mutex<HashMap<String, String>>,
    pub smart_active: Mutex<HashMap<String, DownloadSlot>>,
    pub inhibit: Mutex<Option<Child>>,
    pub id_seq: AtomicU64,
}

impl AppState {
    pub fn new(proxy_port: u16, http: reqwest::Client) -> Self {
        let paths = Paths::resolve();
        let settings = paths::load_settings(&paths);
        let playlists = paths::load_json_array(&paths.playlists);
        let prefs = load_prefs(&paths);
        Self {
            paths,
            http,
            proxy_port,
            settings: Mutex::new(settings),
            playlists: Mutex::new(playlists),
            prefs: Mutex::new(prefs),
            visitor: Mutex::new(None),
            blocked: Mutex::new(HashSet::new()),
            url_cache: Mutex::new(HashMap::new()),
            downloads: Mutex::new(HashMap::new()),
            relays: Mutex::new(HashMap::new()),
            caption_cache: Mutex::new(HashMap::new()),
            fetches: Mutex::new(HashMap::new()),
            session_ready: AtomicBool::new(false),
            music_ready: AtomicBool::new(false),
            cover_palette: Mutex::new(HashMap::new()),
            cover_image: Mutex::new(HashMap::new()),
            smart_active: Mutex::new(HashMap::new()),
            inhibit: Mutex::new(None),
            id_seq: AtomicU64::new(1),
        }
    }

    pub fn next_id(&self, prefix: &str) -> String {
        let n = self.id_seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        format!("{prefix}{n}")
    }

    pub fn install(state: AppState) {
        let _ = GLOBAL.set(state);
    }

    pub fn global() -> &'static AppState {
        GLOBAL.get().expect("app state")
    }
}

fn load_prefs(paths: &Paths) -> Value {
    if let Ok(text) = std::fs::read_to_string(&paths.prefs) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            return v;
        }
    }
    serde_json::json!({ "history": [], "subscriptions": [], "channelAvatars": {} })
}

pub fn repair_saved_playlists() {
    let state = AppState::global();
    let paths = state.paths.clone();
    let mut list = state.playlists.lock().map(|p| p.clone()).unwrap_or_default();
    repair_playlists(&paths, &mut list);
    if let Ok(mut guard) = state.playlists.lock() {
        *guard = list.clone();
    }
    paths::save_json(&paths.playlists, &Value::Array(list));
}

fn repair_playlists(paths: &Paths, list: &mut [Value]) {
    let music = paths::list_media(&paths.music);
    let videos = paths::list_media(&paths.videos);
    let downloads = paths::list_media(&paths.downloads);
    for pl in list.iter_mut() {
        let Some(tracks) = pl.get_mut("tracks").and_then(|t| t.as_array_mut()) else { continue };
        for track in tracks {
            let video_id = track.get("videoId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let current = track.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
            let current_path = std::path::PathBuf::from(current);
            let bad = current.is_empty() || !current_path.is_file() || !paths::is_audio(&current_path);
            if bad {
                let found = paths::find_in_list(&music, &video_id, true)
                    .or_else(|| paths::find_in_list(&videos, &video_id, true))
                    .or_else(|| paths::find_in_list(&downloads, &video_id, true));
                if let Some(found) = found {
                    track["filePath"] = Value::String(found.to_string_lossy().to_string());
                    track["fileName"] = Value::String(
                        found.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
                    );
                    track["status"] = Value::String("done".into());
                }
            }
        }
    }
}
