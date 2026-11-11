use serde_json::{json, Value};

pub const KEY: &str = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
pub const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

fn web_client() -> Value {
    json!({ "clientName": "WEB", "clientVersion": "2.20231219.04.00", "hl": "en", "gl": "US" })
}

fn music_client() -> Value {
    json!({ "clientName": "WEB_REMIX", "clientVersion": "1.20240318.01.00", "hl": "en", "gl": "US" })
}

pub fn walk(v: &Value, f: &mut dyn FnMut(&Value)) {
    f(v);
    match v {
        Value::Array(items) => {
            for item in items {
                walk(item, f);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                walk(item, f);
            }
        }
        _ => {}
    }
}

pub fn text_of(v: Option<&Value>) -> String {
    let Some(v) = v else { return String::new() };
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    if let Some(s) = v.get("simpleText").and_then(|x| x.as_str()) {
        return s.to_string();
    }
    if let Some(runs) = v.get("runs").and_then(|x| x.as_array()) {
        return runs
            .iter()
            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("");
    }
    if let Some(s) = v.pointer("/content").and_then(|x| x.as_str()) {
        return s.to_string();
    }
    String::new()
}

pub fn fmt_duration(secs: u64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

pub fn extract_video_id(url: &str) -> Option<String> {
    if url.is_empty() {
        return None;
    }
    if let Some(id) = url
        .split(['?', '&', '/'])
        .find(|part| part.len() == 11 && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
    {
        if url.contains("watch") || url.contains("youtu.be") || url.contains("shorts") || url.contains("embed") || url.trim() == id {
            return Some(id.to_string());
        }
    }
    let bytes = url.as_bytes();
    let mut i = 0;
    while i + 11 <= bytes.len() {
        let slice = &url[i..i + 11];
        let ok = slice.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if ok {
            let before = url[..i].ends_with("v=") || url[..i].ends_with("be/") || url[..i].ends_with("shorts/") || url[..i].ends_with("embed/") || i == 0;
            if before && (i + 11 == url.len() || !url[i + 11..].chars().next().unwrap_or('a').is_ascii_alphanumeric()) {
                return Some(slice.to_string());
            }
        }
        i += 1;
    }
    None
}

fn last_thumb(v: &Value) -> String {
    v.pointer("/thumbnail/thumbnails")
        .or_else(|| v.pointer("/thumbnails"))
        .and_then(|t| t.as_array())
        .and_then(|a| a.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string()
}

fn is_short(vr: &Value) -> bool {
    vr.pointer("/thumbnailOverlays")
        .and_then(|v| v.as_array())
        .map(|items| {
            items.iter().any(|o| {
                o.pointer("/thumbnailOverlayTimeStatusRenderer/style")
                    .and_then(|s| s.as_str())
                    == Some("SHORTS")
            })
        })
        .unwrap_or(false)
}

pub fn video_card(vr: &Value) -> Option<Value> {
    let id = vr.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() {
        return None;
    }
    let owner = text_of(vr.get("ownerText"));
    let channel = if owner.is_empty() { text_of(vr.get("shortBylineText")) } else { owner };
    let views_text = text_of(vr.get("viewCountText"));
    let views = if views_text.is_empty() { text_of(vr.get("shortViewCountText")) } else { views_text };
    Some(json!({
        "id": id,
        "title": text_of(vr.get("title")),
        "channel": channel,
        "views": views,
        "duration": text_of(vr.get("lengthText")),
        "thumbnail": last_thumb(vr),
        "publishedTime": text_of(vr.get("publishedTimeText")),
        "isShort": is_short(vr),
        "url": format!("https://www.youtube.com/watch?v={id}")
    }))
}

pub fn collect_videos(data: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    walk(data, &mut |v| {
        if let Some(vr) = v.get("videoRenderer").or_else(|| v.get("gridVideoRenderer")).or_else(|| v.get("reelItemRenderer")) {
            if let Some(card) = video_card(vr) {
                let id = card.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if seen.insert(id) {
                    out.push(card);
                }
            }
        }
    });
    out
}

pub async fn post_json(client: &reqwest::Client, url: &str, body: &Value, extra: &[(&str, &str)]) -> Result<Value, String> {
    let mut req = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("User-Agent", UA)
        .json(body);
    for (k, v) in extra {
        req = req.header(*k, *v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

pub async fn get_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let resp = client.get(url).header("User-Agent", UA).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

pub async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client.get(url).header("User-Agent", UA).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

pub async fn search(client: &reqwest::Client, query: &str, visitor: Option<&str>) -> Value {
    let q = query.trim();
    if q.is_empty() {
        return json!({ "videos": [], "shorts": [], "error": null });
    }
    let mut ctx = web_client();
    if let Some(v) = visitor {
        if !v.is_empty() {
            ctx["visitorData"] = json!(v);
        }
    }
    let url = format!("https://www.youtube.com/youtubei/v1/search?key={KEY}&prettyPrint=false");
    match post_json(client, &url, &json!({ "context": { "client": ctx }, "query": q }), &[]).await {
        Ok(data) => {
            let all = collect_videos(&data);
            let videos: Vec<_> = all.iter().filter(|v| v.get("isShort").and_then(|x| x.as_bool()) != Some(true)).cloned().collect();
            let shorts: Vec<_> = all.iter().filter(|v| v.get("isShort").and_then(|x| x.as_bool()) == Some(true)).cloned().collect();
            let visitor = data.pointer("/responseContext/visitorData").and_then(|v| v.as_str()).unwrap_or("");
            json!({ "videos": videos, "shorts": shorts, "visitorData": visitor, "error": null })
        }
        Err(e) => json!({ "videos": [], "shorts": [], "error": e }),
    }
}

pub async fn home_feed(client: &reqwest::Client) -> Value {
    let queries = ["trending music", "popular videos", "viral videos", "top gaming"];
    let mut videos = Vec::new();
    let mut shorts = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut error = None;
    for q in queries {
        let page = search(client, q, None).await;
        if error.is_none() {
            if let Some(e) = page.get("error").and_then(|v| v.as_str()) {
                if !e.is_empty() {
                    error = Some(e.to_string());
                }
            }
        }
        for key in ["videos", "shorts"] {
            if let Some(arr) = page.get(key).and_then(|v| v.as_array()) {
                for item in arr {
                    let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if id.is_empty() || !seen.insert(id.to_string()) {
                        continue;
                    }
                    if key == "videos" { videos.push(item.clone()); } else { shorts.push(item.clone()); }
                }
            }
        }
        if videos.len() >= 12 && !shorts.is_empty() {
            break;
        }
    }
    json!({ "videos": videos, "shorts": shorts, "error": error })
}

fn find_string(v: &Value, key: &str) -> String {
    let mut found = String::new();
    walk(v, &mut |n| {
        if !found.is_empty() {
            return;
        }
        if let Some(s) = n.get(key).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                found = s.to_string();
            }
        }
    });
    found
}

fn music_list_item(r: &Value) -> Option<Value> {
    let video_id = find_string(r, "videoId");
    let browse_id = find_string(r, "browseId");
    if video_id.is_empty() && browse_id.is_empty() {
        return None;
    }
    let title = r
        .pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text")
        .map(|v| text_of(Some(v)))
        .unwrap_or_default();
    let subtitle = r
        .pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text")
        .map(|v| text_of(Some(v)))
        .unwrap_or_default();
    let duration = r
        .pointer("/fixedColumns/0/musicResponsiveListItemFixedColumnRenderer/text")
        .map(|v| text_of(Some(v)))
        .unwrap_or_default();
    Some(json!({
        "videoId": video_id,
        "browseId": browse_id,
        "title": title,
        "subtitle": subtitle,
        "artist": subtitle,
        "duration": duration,
        "thumbnail": last_thumb(r),
        "kind": if video_id.is_empty() { "playlist" } else { "song" }
    }))
}

fn music_card(r: &Value) -> Option<Value> {
    let video_id = find_string(r, "videoId");
    let browse_id = find_string(r, "browseId");
    if video_id.is_empty() && browse_id.is_empty() {
        return None;
    }
    Some(json!({
        "videoId": video_id,
        "browseId": browse_id,
        "title": text_of(r.get("title")),
        "subtitle": text_of(r.get("subtitle")),
        "thumbnail": last_thumb(r),
        "kind": if video_id.is_empty() { "playlist" } else { "song" }
    }))
}

fn direct_music_items(node: &Value) -> Vec<Value> {
    let mut items = Vec::new();
    let contents = node.get("contents").and_then(|v| v.as_array()).or_else(|| node.get("items").and_then(|v| v.as_array()));
    if let Some(arr) = contents {
        for entry in arr {
            if let Some(r) = entry.get("musicResponsiveListItemRenderer") {
                if let Some(item) = music_list_item(r) { items.push(item); }
            } else if let Some(r) = entry.get("musicTwoRowItemRenderer") {
                if let Some(item) = music_card(r) { items.push(item); }
            }
        }
    }
    items
}

pub fn music_shelves(data: &Value) -> Vec<Value> {
    let mut shelves = Vec::new();
    walk(data, &mut |v| {
        for key in ["musicCarouselShelfRenderer", "musicShelfRenderer", "gridRenderer"] {
            if let Some(node) = v.get(key) {
                let mut title = text_of(node.get("title"));
                if title.is_empty() {
                    title = text_of(node.pointer("/header/musicCarouselShelfBasicHeaderRenderer/title"));
                }
                let items = direct_music_items(node);
                if !items.is_empty() {
                    shelves.push(json!({ "title": title, "items": items }));
                }
            }
        }
    });
    shelves
}

pub fn music_tracks(data: &Value) -> Vec<Value> {
    let mut tracks = Vec::new();
    walk(data, &mut |v| {
        if let Some(r) = v.get("musicResponsiveListItemRenderer") {
            if let Some(item) = music_list_item(r) {
                if item.get("videoId").and_then(|x| x.as_str()).unwrap_or("").len() == 11 {
                    tracks.push(item);
                }
            }
        }
    });
    tracks
}

fn music_continuation(data: &Value) -> String {
    let mut token = String::new();
    walk(data, &mut |v| {
        if !token.is_empty() {
            return;
        }
        if let Some(t) = v.pointer("/continuationCommand/token").and_then(|x| x.as_str()) {
            token = t.to_string();
        }
    });
    token
}

pub async fn music_browse(client: &reqwest::Client, browse_id: &str, continuation: &str, authed_body: Option<Value>) -> Result<Value, String> {
    let url = format!("https://music.youtube.com/youtubei/v1/browse?key={KEY}&prettyPrint=false");
    let body = if let Some(body) = authed_body {
        body
    } else if !continuation.is_empty() {
        json!({ "context": { "client": music_client() }, "continuation": continuation })
    } else {
        json!({ "context": { "client": music_client() }, "browseId": browse_id })
    };
    let data = post_json(
        client,
        &url,
        &body,
        &[
            ("Origin", "https://music.youtube.com"),
            ("Referer", "https://music.youtube.com/"),
            ("X-YouTube-Client-Name", "67"),
            ("X-YouTube-Client-Version", "1.20240318.01.00"),
        ],
    )
    .await?;
    let header_title = {
        let mut title = String::new();
        walk(&data, &mut |v| {
            if title.is_empty() {
                if let Some(h) = v.get("musicDetailHeaderRenderer").or_else(|| v.get("musicImmersiveHeaderRenderer")) {
                    title = text_of(h.get("title"));
                }
            }
        });
        if title.is_empty() { browse_id.to_string() } else { title }
    };
    Ok(json!({
        "header": { "title": header_title, "subtitle": "", "thumbnail": "" },
        "shelves": music_shelves(&data),
        "tracks": music_tracks(&data),
        "items": music_tracks(&data),
        "continuation": music_continuation(&data)
    }))
}

pub async fn music_search(client: &reqwest::Client, query: &str) -> Value {
    let url = format!("https://music.youtube.com/youtubei/v1/search?key={KEY}&prettyPrint=false");
    match post_json(
        client,
        &url,
        &json!({ "context": { "client": music_client() }, "query": query }),
        &[("Origin", "https://music.youtube.com"), ("Referer", "https://music.youtube.com/")],
    )
    .await
    {
        Ok(data) => {
            let mut items = Vec::new();
            walk(&data, &mut |v| {
                if let Some(r) = v.get("musicResponsiveListItemRenderer") {
                    if let Some(item) = music_list_item(r) { items.push(item); }
                } else if let Some(r) = v.get("musicTwoRowItemRenderer") {
                    if let Some(item) = music_card(r) { items.push(item); }
                }
            });
            json!({ "items": items, "continuation": music_continuation(&data), "error": null })
        }
        Err(e) => json!({ "items": [], "continuation": "", "error": e }),
    }
}

struct StreamClient {
    label: &'static str,
    name_num: &'static str,
    client: Value,
    ua: &'static str,
}

fn stream_clients() -> Vec<StreamClient> {
    vec![
        StreamClient {
            label: "visionos",
            name_num: "101",
            client: json!({
                "clientName": "VISIONOS",
                "clientVersion": "1.02",
                "deviceMake": "Apple",
                "deviceModel": "RealityDevice17,1",
                "osName": "visionOS",
                "osVersion": "26.5.23O471",
                "hl": "en",
                "gl": "US",
                "timeZone": "UTC",
                "utcOffsetMinutes": 0
            }),
            ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        },
        StreamClient {
            label: "android_vr",
            name_num: "28",
            client: json!({
                "clientName": "ANDROID_VR",
                "clientVersion": "1.60.19",
                "hl": "en",
                "gl": "US",
                "timeZone": "UTC",
                "utcOffsetMinutes": 0
            }),
            ua: "com.google.android.apps.youtube.vr.oculus/1.60.19",
        },
    ]
}

pub struct MediaPair {
    pub video_url: String,
    pub audio_url: String,
    #[allow(dead_code)]
    pub height: u64,
}

fn plain_url(f: &Value) -> Option<&str> {
    if f.get("signatureCipher").is_some() || f.get("cipher").is_some() {
        return None;
    }
    f.get("url").and_then(|u| u.as_str()).filter(|u| u.starts_with("http"))
}

pub fn pick_pair(data: &Value, quality: &str) -> Option<MediaPair> {
    if data.pointer("/playabilityStatus/status").and_then(|v| v.as_str()) != Some("OK") {
        return None;
    }
    let adaptive = data.pointer("/streamingData/adaptiveFormats")?.as_array()?;
    let cap: u64 = if quality.is_empty() || quality == "auto" {
        1080
    } else {
        quality.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(1080)
    };
    let mut videos: Vec<&Value> = adaptive
        .iter()
        .filter(|f| {
            let mime = f.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
            plain_url(f).is_some() && mime.starts_with("video/") && mime.contains("avc1") && mime.contains("mp4") && f.get("height").and_then(|v| v.as_u64()).unwrap_or(0) <= cap
        })
        .collect();
    videos.sort_by_key(|f| std::cmp::Reverse((f.get("height").and_then(|v| v.as_u64()).unwrap_or(0), f.get("bitrate").and_then(|v| v.as_u64()).unwrap_or(0))));
    let mut audios: Vec<&Value> = adaptive
        .iter()
        .filter(|f| {
            let mime = f.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
            plain_url(f).is_some() && mime.starts_with("audio/") && mime.contains("mp4a")
        })
        .collect();
    audios.sort_by_key(|f| {
        let mime = f.get("mimeType").and_then(|v| v.as_str()).unwrap_or("").to_ascii_lowercase();
        let english = mime.contains("en") || f.get("audioTrack").and_then(|a| a.get("id")).and_then(|v| v.as_str()).unwrap_or("").contains(".en");
        std::cmp::Reverse((english, f.get("bitrate").and_then(|v| v.as_u64()).unwrap_or(0)))
    });
    let video = videos.first()?;
    let audio = audios.first()?;
    Some(MediaPair {
        video_url: plain_url(video)?.to_string(),
        audio_url: plain_url(audio)?.to_string(),
        height: video.get("height").and_then(|v| v.as_u64()).unwrap_or(0),
    })
}

pub async fn player(client: &reqwest::Client, video_id: &str, visitor: &mut Option<String>) -> Result<Value, String> {
    let url = format!("https://www.youtube.com/youtubei/v1/player?key={KEY}&prettyPrint=false");
    let mut last = None;
    for c in stream_clients() {
        let mut client_obj = c.client.clone();
        if let Some(v) = visitor.clone() {
            client_obj["visitorData"] = json!(v);
        }
        let version = c.client.get("clientVersion").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let body = json!({
            "context": { "client": client_obj },
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true
        });
        let mut req = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("User-Agent", c.ua)
            .header("Origin", "https://www.youtube.com")
            .header("X-YouTube-Client-Name", c.name_num)
            .header("X-YouTube-Client-Version", &version)
            .json(&body);
        if let Some(v) = visitor.clone() {
            req = req.header("X-Goog-Visitor-Id", v);
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(_) => continue,
        };
        if !resp.status().is_success() {
            continue;
        }
        let data: Value = match resp.json().await {
            Ok(d) => d,
            Err(_) => continue,
        };
        if let Some(vd) = data.pointer("/responseContext/visitorData").and_then(|v| v.as_str()) {
            *visitor = Some(vd.to_string());
        }
        if data.pointer("/playabilityStatus/status").and_then(|v| v.as_str()) == Some("LOGIN_REQUIRED") {
            let fresh = data.pointer("/responseContext/visitorData").and_then(|v| v.as_str()).map(|s| s.to_string());
            if fresh.is_some() && fresh != *visitor {
                if let Some(vd) = fresh {
                    *visitor = Some(vd);
                    let mut retry_client = c.client.clone();
                    retry_client["visitorData"] = json!(visitor.clone().unwrap_or_default());
                    let retry_body = json!({
                        "context": { "client": retry_client },
                        "videoId": video_id,
                        "contentCheckOk": true,
                        "racyCheckOk": true
                    });
                    let retry = client
                        .post(&url)
                        .header("Content-Type", "application/json")
                        .header("User-Agent", c.ua)
                        .header("Origin", "https://www.youtube.com")
                        .header("X-YouTube-Client-Name", c.name_num)
                        .header("X-YouTube-Client-Version", &version)
                        .header("X-Goog-Visitor-Id", visitor.clone().unwrap_or_default())
                        .json(&retry_body);
                    if let Ok(resp) = retry.send().await {
                        if resp.status().is_success() {
                            if let Ok(retried) = resp.json::<Value>().await {
                                if let Some(vd) = retried.pointer("/responseContext/visitorData").and_then(|v| v.as_str()) {
                                    *visitor = Some(vd.to_string());
                                }
                                if retried.pointer("/playabilityStatus/status").and_then(|v| v.as_str()) == Some("OK") {
                                    return Ok(retried);
                                }
                                last = Some(retried);
                                continue;
                            }
                        }
                    }
                }
            }
            last = Some(data);
            continue;
        }
        let _ = c.label;
        return Ok(data);
    }
    last.ok_or_else(|| "no player response".to_string())
}

pub fn caption_tracks_from_player(data: &Value) -> Vec<Value> {
    let Some(tracks) = data.pointer("/captions/playerCaptionsTracklistRenderer/captionTracks").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    tracks
        .iter()
        .filter_map(|t| {
            let lang = t.get("languageCode").and_then(|v| v.as_str()).unwrap_or("");
            if lang.is_empty() {
                return None;
            }
            let kind = t.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            Some(json!({
                "languageCode": lang,
                "name": text_of(t.get("name")),
                "kind": kind
            }))
        })
        .collect()
}

pub fn caption_tracks_from_html(html: &str) -> Vec<Value> {
    let marker = "\"captionTracks\":";
    let Some(start) = html.find(marker) else { return Vec::new() };
    let slice = &html[start + marker.len()..];
    let Some(end) = slice.find("],") else { return Vec::new() };
    let raw = format!("{}]", &slice[..end]);
    let Ok(tracks) = serde_json::from_str::<Vec<Value>>(&raw) else { return Vec::new() };
    tracks
        .iter()
        .filter_map(|t| {
            let lang = t.get("languageCode").and_then(|v| v.as_str()).unwrap_or("");
            if lang.is_empty() { return None; }
            Some(json!({
                "languageCode": lang,
                "name": text_of(t.get("name")),
                "kind": t.get("kind").and_then(|v| v.as_str()).unwrap_or("")
            }))
        })
        .collect()
}

pub async fn video_info(client: &reqwest::Client, video_id: &str) -> Value {
    if video_id.is_empty() {
        return json!({ "info": null, "error": "No video ID" });
    }
    let watch = format!("https://www.youtube.com/watch?v={video_id}");
    let oembed_url = format!("https://www.youtube.com/oembed?url={}&format=json", urlencoding::encode(&watch));
    let (oembed, html) = tokio::join!(get_json(client, &oembed_url), get_text(client, &watch));
    if let Ok(oembed) = oembed {
        let html = html.unwrap_or_default();
        let duration = html
            .split("\"lengthSeconds\":\"").nth(1)
            .and_then(|s| s.split('"').next())
            .and_then(|s| s.parse::<u64>().ok())
            .map(fmt_duration)
            .unwrap_or_default();
        let views = html
            .split("\"viewCount\":\"").nth(1)
            .and_then(|s| s.split('"').next())
            .and_then(|s| s.parse::<u64>().ok())
            .map(|n| format_views(n))
            .unwrap_or_default();
        let description = html
            .split("\"shortDescription\":\"").nth(1)
            .and_then(|s| s.split("\",\"").next())
            .unwrap_or("")
            .replace("\\n", "\n")
            .replace("\\\"", "\"");
        return json!({
            "info": {
                "id": video_id,
                "title": oembed.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "channel": oembed.get("author_name").and_then(|v| v.as_str()).unwrap_or(""),
                "views": views,
                "duration": duration,
                "description": description,
                "thumbnail": oembed.get("thumbnail_url").and_then(|v| v.as_str()).unwrap_or(""),
                "captions": caption_tracks_from_html(&html)
            },
            "error": null
        });
    }
    let mut visitor = None;
    match player(client, video_id, &mut visitor).await {
        Ok(data) => {
            let vd = data.get("videoDetails").cloned().unwrap_or(json!({}));
            let secs = vd.get("lengthSeconds").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()).unwrap_or(0);
            json!({
                "info": {
                    "id": video_id,
                    "title": vd.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                    "channel": vd.get("author").and_then(|v| v.as_str()).unwrap_or(""),
                    "views": vd.get("viewCount").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()).map(format_views).unwrap_or_default(),
                    "duration": if secs > 0 { fmt_duration(secs) } else { String::new() },
                    "description": vd.get("shortDescription").and_then(|v| v.as_str()).unwrap_or(""),
                    "thumbnail": last_thumb(&vd),
                    "captions": caption_tracks_from_player(&data)
                },
                "error": null
            })
        }
        Err(e) => json!({ "info": null, "error": e }),
    }
}

fn format_views(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out.chars().rev().collect()
}

pub fn parse_vtt(text: &str) -> Vec<Value> {
    let mut cues = Vec::new();
    let lines: Vec<&str> = text.trim_start_matches('\u{feff}').split('\n').collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if let Some((start, end)) = parse_stamp(line) {
            i += 1;
            let mut parts = Vec::new();
            while i < lines.len() && !lines[i].trim().is_empty() {
                parts.push(lines[i].trim().to_string());
                i += 1;
            }
            let cue_text = strip_tags(&parts.join("\n"));
            if !cue_text.is_empty() && end > start {
                cues.push(json!({ "start": start, "end": end, "text": cue_text }));
            }
        }
        i += 1;
    }
    cues
}

fn parse_stamp(line: &str) -> Option<(f64, f64)> {
    let (left, right) = line.split_once("-->")?;
    Some((stamp_seconds(left.trim())?, stamp_seconds(right.trim().split_whitespace().next()?)?))
}

fn stamp_seconds(stamp: &str) -> Option<f64> {
    let mut parts = stamp.split(':').collect::<Vec<_>>();
    if parts.len() == 2 {
        parts.insert(0, "0");
    }
    if parts.len() != 3 {
        return None;
    }
    let (sec, ms) = parts[2].split_once('.').unwrap_or((parts[2], "0"));
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = sec.parse().ok()?;
    let frac: f64 = format!("0.{ms}").parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s + frac)
}

fn strip_tags(text: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for c in text.chars() {
        if c == '<' { inside = true; continue; }
        if c == '>' { inside = false; continue; }
        if !inside { out.push(c); }
    }
    out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").trim().to_string()
}

fn legacy_comment(r: &Value) -> Option<Value> {
    let id = r.get("commentId").and_then(|v| v.as_str()).unwrap_or("");
    let text = text_of(r.get("contentText"));
    let author = text_of(r.get("authorText"));
    if id.is_empty() || (text.is_empty() && author.is_empty()) {
        return None;
    }
    Some(json!({
        "id": id,
        "text": text,
        "time": text_of(r.get("publishedTimeText")),
        "author": author,
        "avatar": r.pointer("/authorThumbnail/thumbnails").and_then(|v| v.as_array()).and_then(|a| a.last()).and_then(|t| t.get("url")).and_then(|u| u.as_str()).unwrap_or(""),
        "likes": text_of(r.get("voteCount")),
        "replies": r.get("replyCount").map(|v| v.to_string().trim_matches('"').to_string()).unwrap_or_default(),
        "creator": r.get("authorIsChannelOwner").and_then(|v| v.as_bool()).unwrap_or(false),
        "replyToken": ""
    }))
}

pub fn parse_comments(data: &Value) -> Value {
    let mut comments = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut continuation = String::new();
    let mut disabled = String::new();
    let mut create_params = String::new();
    walk(data, &mut |v| {
        if let Some(r) = v.get("commentRenderer") {
            if let Some(c) = legacy_comment(r) {
                let id = c.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                if seen.insert(id) { comments.push(c); }
            }
        }
        if let Some(p) = v.get("commentEntityPayload") {
            let id = p.pointer("/properties/commentId").and_then(|x| x.as_str()).unwrap_or("");
            let text = p.pointer("/properties/content/content").and_then(|x| x.as_str()).unwrap_or("");
            let author = p.pointer("/author/displayName").and_then(|x| x.as_str()).unwrap_or("");
            if !id.is_empty() && seen.insert(id.to_string()) && (!text.is_empty() || !author.is_empty()) {
                comments.push(json!({
                    "id": id,
                    "text": text,
                    "time": p.pointer("/properties/publishedTime").and_then(|x| x.as_str()).unwrap_or(""),
                    "author": author,
                    "avatar": "",
                    "likes": "",
                    "replies": "",
                    "creator": false,
                    "replyToken": ""
                }));
            }
        }
        if continuation.is_empty() {
            if let Some(t) = v.pointer("/continuationItemRenderer/continuationEndpoint/continuationCommand/token").and_then(|x| x.as_str()) {
                continuation = t.to_string();
            }
        }
        if create_params.is_empty() {
            if let Some(p) = v.pointer("/createCommentEndpoint/createCommentParams").and_then(|x| x.as_str()) {
                create_params = p.to_string();
            }
        }
        if disabled.is_empty() {
            if let Some(msg) = v.get("messageRenderer") {
                let t = text_of(msg.get("text"));
                if t.to_ascii_lowercase().contains("comment") { disabled = t; }
            }
        }
    });
    json!({
        "comments": comments,
        "continuation": continuation,
        "disabled": disabled,
        "createParams": create_params,
        "count": "",
        "sorts": [],
        "error": null
    })
}

pub async fn comments(client: &reqwest::Client, video_id: &str, continuation: &str) -> Value {
    let url = format!("https://www.youtube.com/youtubei/v1/next?key={KEY}");
    let body = if continuation.is_empty() {
        json!({ "context": { "client": web_client() }, "videoId": video_id })
    } else {
        json!({ "context": { "client": web_client() }, "continuation": continuation })
    };
    match post_json(client, &url, &body, &[]).await {
        Ok(data) => {
            if continuation.is_empty() {
                let parsed = parse_comments(&data);
                let token = parsed.get("continuation").and_then(|v| v.as_str()).unwrap_or("");
                if parsed.get("comments").and_then(|v| v.as_array()).map(|a| a.is_empty()).unwrap_or(true) && !token.is_empty() {
                    return Box::pin(comments(client, video_id, token)).await;
                }
                parsed
            } else {
                parse_comments(&data)
            }
        }
        Err(e) => json!({ "comments": [], "continuation": "", "disabled": "", "createParams": "", "count": "", "sorts": [], "error": e }),
    }
}

pub fn parse_lrc(raw: &str) -> Vec<Value> {
    let mut lines = Vec::new();
    for raw_line in raw.lines() {
        let (stamps, body) = lrc_stamps(raw_line.trim());
        if stamps.is_empty() {
            continue;
        }
        let (mut words, text) = lrc_words(&body);
        if text.is_empty() && words.is_empty() {
            continue;
        }
        if words.is_empty() {
            words = interpolate_words(&text);
        }
        for t in stamps {
            let mut line = json!({ "t": t, "text": text });
            if !words.is_empty() {
                let shifted = shift_words(&words, t);
                line["words"] = Value::Array(shifted);
            }
            lines.push(line);
        }
    }
    lines.sort_by(|a, b| {
        let at = a.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let bt = b.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
        at.partial_cmp(&bt).unwrap_or(std::cmp::Ordering::Equal)
    });
    // Word estimates need the gap to the next line, which is only known after sorting.
    for i in 0..lines.len() {
        let has_real = lines[i].get("words").and_then(|w| w.as_array()).map(|w| w.iter().any(|word| word.get("sep").is_some())).unwrap_or(false);
        if has_real {
            continue;
        }
        let text = lines[i].get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let start = lines[i].get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let next = lines.get(i + 1).and_then(|l| l.get("t").and_then(|v| v.as_f64()));
        let words = timed_words(&text, start, next);
        if !words.is_empty() {
            lines[i]["words"] = Value::Array(words);
        }
    }
    lines
}

fn lrc_stamps(line: &str) -> (Vec<f64>, String) {
    let mut stamps = Vec::new();
    let mut body = String::new();
    let mut i = 0;
    while i < line.len() {
        if line.as_bytes()[i] == b'[' {
            if let Some(rel) = line[i + 1..].find(']') {
                let inside = &line[i + 1..i + 1 + rel];
                if let Some(t) = lrc_time(inside) {
                    stamps.push(t);
                    i += rel + 2;
                    continue;
                }
            }
        }
        let ch = line[i..].chars().next().unwrap_or(' ');
        body.push(ch);
        i += ch.len_utf8();
    }
    (stamps, body)
}

fn lrc_words(body: &str) -> (Vec<Value>, String) {
    let mut words = Vec::new();
    let mut text = String::new();
    let mut i = 0;
    while i < body.len() {
        if body.as_bytes()[i] == b'<' {
            if let Some(rel) = body[i + 1..].find('>') {
                let tag = &body[i + 1..i + 1 + rel];
                let after = i + 1 + rel + 1;
                if lrc_time(tag).is_some() {
                    let t = lrc_time(tag).unwrap_or(0.0);
                    let next = body[after..].find('<').map(|n| after + n).unwrap_or(body.len());
                    let raw = &body[after..next];
                    let w = raw.trim();
                    if !w.is_empty() {
                        let sep = if raw.chars().last().map(|c| c.is_whitespace()).unwrap_or(false) { " " } else { "" };
                        words.push(json!({ "t": t, "w": w, "sep": sep }));
                    }
                    text.push_str(raw);
                    i = next;
                    continue;
                }
            }
        }
        let ch = body[i..].chars().next().unwrap_or(' ');
        text.push(ch);
        i += ch.len_utf8();
    }
    (words, text.trim().to_string())
}

fn interpolate_words(text: &str) -> Vec<Value> {
    text.split_whitespace().filter(|w| !w.is_empty()).map(|w| json!({ "w": w })).collect()
}

fn shift_words(words: &[Value], _line_t: f64) -> Vec<Value> {
    words.to_vec()
}

fn timed_words(text: &str, start: f64, next: Option<f64>) -> Vec<Value> {
    let tokens: Vec<&str> = text.split_whitespace().filter(|w| !w.is_empty()).collect();
    if tokens.is_empty() {
        return Vec::new();
    }
    let gap = next.map(|n| (n - start).max(0.3)).unwrap_or(4.0);
    let weights: Vec<f64> = tokens.iter().map(|w| syllables(w) as f64 + w.len() as f64 * 0.15).collect();
    let total = weights.iter().sum::<f64>().max(1.0);
    let est = total * 0.26 + 0.35;
    let dur = gap.min(est.max(0.7));
    let mut acc = 0.0;
    tokens.into_iter().zip(weights).map(|(w, weight)| {
        let t = start + (dur * acc) / total;
        acc += weight;
        let end = start + (dur * acc) / total;
        json!({ "t": t, "end": end, "w": w })
    }).collect()
}

fn syllables(word: &str) -> usize {
    let mut count = 0;
    let mut in_group = false;
    for c in word.to_ascii_lowercase().chars() {
        if "aeiouy".contains(c) {
            if !in_group {
                count += 1;
                in_group = true;
            }
        } else {
            in_group = false;
        }
    }
    count.max(1)
}

fn lrc_time(stamp: &str) -> Option<f64> {
    let (m, rest) = stamp.split_once(':')?;
    let (s, frac) = rest.split_once(['.', ':']).unwrap_or((rest, "0"));
    let m: f64 = m.parse().ok()?;
    let s: f64 = s.parse().ok()?;
    let frac: f64 = format!("0.{frac}").parse().unwrap_or(0.0);
    Some(m * 60.0 + s + frac)
}

pub async fn lyrics_for(client: &reqwest::Client, title: &str, artist: &str, duration: &str) -> Value {
    let dur = duration_seconds(duration);
    let url = format!(
        "https://lrclib.net/api/search?track_name={}&artist_name={}",
        urlencoding::encode(title),
        urlencoding::encode(artist)
    );
    let hits = match get_json(client, &url).await {
        Ok(Value::Array(items)) => items,
        _ => return json!({ "ok": false, "reason": "No lyrics", "synced": null, "lyrics": "", "footer": "" }),
    };
    let mut best: Option<(f64, Value)> = None;
    for hit in hits {
        let name = hit.get("trackName").and_then(|v| v.as_str()).unwrap_or("").to_ascii_lowercase();
        let by = hit.get("artistName").and_then(|v| v.as_str()).unwrap_or("").to_ascii_lowercase();
        let mut score = 0.0;
        if name == title.to_ascii_lowercase() { score += 8.0; }
        else if !title.is_empty() && (name.contains(&title.to_ascii_lowercase()) || title.to_ascii_lowercase().contains(&name)) { score += 3.0; }
        if !artist.is_empty() && (by == artist.to_ascii_lowercase() || by.contains(&artist.to_ascii_lowercase())) { score += 4.0; }
        if let (Some(d), Some(want)) = (hit.get("duration").and_then(|v| v.as_f64()), dur) {
            score -= (d - want).abs() / 5.0;
        }
        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
            best = Some((score, hit));
        }
    }
    let Some((_, hit)) = best else {
        return json!({ "ok": false, "reason": "No lyrics", "synced": null, "lyrics": "", "footer": "" });
    };
    if let Some(synced) = hit.get("syncedLyrics").and_then(|v| v.as_str()) {
        let lines = parse_lrc(synced);
        if lines.len() >= 2 {
            return json!({ "ok": true, "synced": lines, "syncType": "line", "source": "LRCLIB", "lyrics": "", "footer": "Lyrics · LRCLIB" });
        }
    }
    let plain = hit.get("plainLyrics").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if plain.is_empty() {
        json!({ "ok": false, "reason": "No lyrics", "synced": null, "lyrics": "", "footer": "" })
    } else {
        json!({ "ok": true, "synced": null, "syncType": "plain", "source": "LRCLIB", "lyrics": plain, "footer": "Lyrics · LRCLIB" })
    }
}

fn duration_seconds(duration: &str) -> Option<f64> {
    if duration.is_empty() { return None; }
    let parts: Vec<&str> = duration.split(':').collect();
    if parts.len() == 2 {
        let m: f64 = parts[0].parse().ok()?;
        let s: f64 = parts[1].parse().ok()?;
        return Some(m * 60.0 + s);
    }
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().ok()?;
        let m: f64 = parts[1].parse().ok()?;
        let s: f64 = parts[2].parse().ok()?;
        return Some(h * 3600.0 + m * 60.0 + s);
    }
    duration.parse().ok()
}

pub fn stream_format(quality: &str) -> String {
    let cap: u64 = if quality.is_empty() || quality == "auto" {
        1080
    } else {
        quality.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(1080)
    };
    let video = format!("bestvideo[vcodec^=avc1][height<={cap}]");
    format!("{video}[ext=mp4]+bestaudio[ext=m4a][language^=en]/{video}+bestaudio[ext=m4a]/{video}[ext=mp4]+bestaudio[ext=m4a]/{video}+bestaudio")
}

pub fn download_format(height: u64) -> String {
    format!(
        "bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a][language^=en]/bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/best[height<={height}][ext=mp4]/best[height<={height}]"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_watch_id() {
        assert_eq!(extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(extract_video_id("https://youtu.be/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
    }

    #[test]
    fn parses_a_vtt_cue() {
        let cues = parse_vtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello &amp; welcome\n");
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0]["text"], "Hello & welcome");
    }

    #[test]
    fn strips_word_timestamps_from_lrc() {
        let lines = parse_lrc("[00:01.00]<00:01.00>Hello <00:01.40>world\n[ti:Song]\n");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["text"], "Hello world");
        let words = lines[0]["words"].as_array().unwrap();
        assert_eq!(words.len(), 2);
        assert_eq!(words[0]["w"], "Hello");
        assert_eq!(words[1]["w"], "world");
    }
}
