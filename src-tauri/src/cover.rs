use crate::paths::{self, Paths};
use crate::state::AppState;
use crate::youtube::UA;
use base64::Engine;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub async fn palette(state: &AppState, url: &str) -> Option<Value> {
    if !(url.starts_with("https://") || url.starts_with("ytfile://")) {
        return None;
    }
    if let Some(hit) = state.cover_palette.lock().ok().and_then(|m| m.get(url).cloned()) {
        return Some(hit);
    }
    let bytes = source_bytes(state, url).await?;
    let image = image::load_from_memory(&bytes).ok()?;
    let sample = image.resize(24, 24, image::imageops::FilterType::Triangle).to_rgba8();
    let mut wr = 0.0f64;
    let mut wg = 0.0;
    let mut wb = 0.0;
    let mut weight = 0.0;
    let mut ar = 0.0;
    let mut ag = 0.0;
    let mut ab = 0.0;
    let mut count = 0.0;
    for pixel in sample.pixels() {
        let r = pixel[0] as f64;
        let g = pixel[1] as f64;
        let b = pixel[2] as f64;
        count += 1.0;
        ar += r;
        ag += g;
        ab += b;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let light = (max + min) / 510.0;
        let sat = if max == min { 0.0 } else { (max - min) / if light > 0.5 { 510.0 - max - min } else { max + min } };
        if light < 0.1 || light > 0.92 || sat < 0.12 {
            continue;
        }
        let w = sat * sat;
        wr += r * w;
        wg += g * w;
        wb += b * w;
        weight += w;
    }
    let (r, g, b) = if weight > 0.0 {
        (wr / weight, wg / weight, wb / weight)
    } else if count > 0.0 {
        (ar / count, ag / count, ab / count)
    } else {
        (88.0, 72.0, 108.0)
    };
    let palette = json!({
        "top": shade(r, g, b, 0.5),
        "mid": shade(r, g, b, 0.36),
        "bottom": shade(r, g, b, 0.22)
    });
    if let Ok(mut map) = state.cover_palette.lock() {
        if map.len() > 40 {
            map.clear();
        }
        map.insert(url.to_string(), palette.clone());
    }
    Some(palette)
}

pub async fn image_data_url(state: &AppState, url: &str) -> Option<String> {
    if !(url.starts_with("https://") || url.starts_with("ytfile://")) {
        return None;
    }
    if let Some(hit) = state.cover_image.lock().ok().and_then(|m| m.get(url).cloned()) {
        return Some(hit);
    }
    let bytes = source_bytes(state, url).await?;
    if bytes.len() < 32 {
        return None;
    }
    let mime = if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 {
        "image/jpeg"
    } else if bytes.len() >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 {
        "image/png"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" {
        "image/webp"
    } else {
        "image/jpeg"
    };
    let data = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
    if let Ok(mut map) = state.cover_image.lock() {
        if map.len() > 24 {
            map.clear();
        }
        map.insert(url.to_string(), data.clone());
    }
    Some(data)
}

fn shade(r: f64, g: f64, b: f64, amount: f64) -> String {
    let r = (r * amount).round().clamp(0.0, 255.0) as u8;
    let g = (g * amount).round().clamp(0.0, 255.0) as u8;
    let b = (b * amount).round().clamp(0.0, 255.0) as u8;
    format!("rgb({r}, {g}, {b})")
}

async fn source_bytes(state: &AppState, url: &str) -> Option<Vec<u8>> {
    if let Some(path) = ytfile_path(url) {
        let settings = state.settings.lock().ok()?.clone();
        let roots = state.paths.allowed_roots(&settings);
        if paths::path_is_allowed(&path, &roots) {
            return std::fs::read(path).ok();
        }
        return None;
    }
    let resp = state.http.get(url).header("User-Agent", UA).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.bytes().await.ok().map(|b| b.to_vec())
}

pub fn ytfile_path(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("ytfile://")?;
    let path = rest.split_once('/').map(|(_, p)| format!("/{p}")).unwrap_or_default();
    let decoded = percent_encoding::percent_decode_str(&path).decode_utf8().ok()?;
    Some(Path::new(decoded.as_ref()).to_path_buf())
}

pub fn thumb_url(paths: &Paths, video_id: &str) -> String {
    if video_id.is_empty() {
        return String::new();
    }
    let path = paths.thumbs.join(format!("{video_id}.jpg"));
    if path.is_file() {
        paths::file_to_yturl(&path)
    } else {
        String::new()
    }
}
