use crate::paths::{self, Paths};
use crate::youtube::UA;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct ProxyState {
    pub client: reqwest::Client,
    pub cache: PathBuf,
    pub roots: Arc<Vec<PathBuf>>,
}

#[derive(Deserialize)]
struct MediaQuery {
    u: String,
}

#[derive(Deserialize)]
struct SpikeQuery {
    kind: Option<String>,
    webgl: Option<String>,
    capture: Option<String>,
    tracks: Option<String>,
    raf: Option<String>,
    title: Option<String>,
    text: Option<String>,
}

pub fn router(state: ProxyState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers(Any);
    Router::new()
        .route("/media", get(media))
        .route("/local", get(local_file))
        .route("/stream/:id/:file", get(hls_file))
        .route("/health", get(|| async { "ok" }))
        .route("/spike", get(spike))
        .layer(cors)
        .with_state(state)
}

pub fn start(client: reqwest::Client, paths: &Paths) -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("proxy bind");
    listener.set_nonblocking(true).expect("proxy nonblocking");
    let port = listener.local_addr().expect("proxy addr").port();
    let state = ProxyState {
        client,
        cache: paths.stream_cache.clone(),
        roots: Arc::new(vec![paths.stream_cache.clone(), paths.downloads.clone(), paths.thumbs.clone(), paths.config.clone()]),
    };
    tauri::async_runtime::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener).expect("tokio listener");
        let _ = axum::serve(listener, router(state)).await;
    });
    port
}

pub fn proxied(port: u16, url: &str) -> String {
    if url.starts_with("http://127.0.0.1:") || url.starts_with("ytfile:") {
        return url.to_string();
    }
    format!("http://127.0.0.1:{port}/media?u={}", urlencoding::encode(url))
}

async fn media(State(st): State<ProxyState>, Query(q): Query<MediaQuery>, headers: HeaderMap) -> Response {
    if !(q.u.starts_with("https://") || q.u.starts_with("http://")) {
        return Response::builder().status(StatusCode::BAD_REQUEST).body(Body::from("bad url")).unwrap();
    }
    let mut req = st
        .client
        .get(&q.u)
        .header("User-Agent", UA)
        .header("Referer", "https://www.youtube.com/")
        .header("Origin", "https://www.youtube.com");
    if let Some(range) = headers.get(header::RANGE) {
        req = req.header(header::RANGE, range);
    }
    let upstream = match req.send().await {
        Ok(r) => r,
        Err(e) => return Response::builder().status(StatusCode::BAD_GATEWAY).body(Body::from(e.to_string())).unwrap(),
    };
    let status = upstream.status();
    let mut builder = Response::builder().status(status);
    for name in [header::CONTENT_TYPE, header::CONTENT_LENGTH, header::CONTENT_RANGE, header::ACCEPT_RANGES] {
        if let Some(v) = upstream.headers().get(&name) {
            builder = builder.header(name, v.clone());
        }
    }
    builder = builder
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Length, Content-Range, Accept-Ranges, Content-Type");
    let stream = upstream.bytes_stream().map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)));
    builder.body(Body::from_stream(stream)).unwrap()
}

#[derive(Deserialize)]
struct LocalQuery {
    p: String,
}

async fn local_file(Query(q): Query<LocalQuery>, headers: HeaderMap) -> Response {
    let path = std::path::PathBuf::from(&q.p);
    let app = crate::state::AppState::global();
    let settings = app.settings.lock().map(|s| s.clone()).unwrap_or(json!({}));
    let roots = app.paths.allowed_roots(&settings);
    if !path.is_file() || !paths::path_is_allowed(&path, &roots) {
        return Response::builder().status(StatusCode::NOT_FOUND).body(Body::empty()).unwrap();
    }
    let Ok(file) = tokio::fs::File::open(&path).await else {
        return Response::builder().status(StatusCode::NOT_FOUND).body(Body::empty()).unwrap();
    };
    let Ok(meta) = file.metadata().await else {
        return Response::builder().status(StatusCode::NOT_FOUND).body(Body::empty()).unwrap();
    };
    let total = meta.len();
    if total == 0 {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, paths::mime_for(&path))
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, 0)
            .body(Body::empty())
            .unwrap();
    }
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let (start, end, status) = if range.is_some() {
        match paths::parse_range(range, total) {
            Some((start, end)) if start < total => (start, end.min(total - 1), StatusCode::PARTIAL_CONTENT),
            _ => {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                    .body(Body::empty())
                    .unwrap();
            }
        }
    } else {
        (0, total - 1, StatusCode::OK)
    };
    let mut file = file;
    if tokio::io::AsyncSeekExt::seek(&mut file, std::io::SeekFrom::Start(start)).await.is_err() {
        return Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Body::empty()).unwrap();
    }
    let limited = tokio::io::AsyncReadExt::take(file, end - start + 1);
    let stream = futures_util::stream::unfold(limited, |mut file| async move {
        let mut buf = vec![0u8; 64 * 1024];
        match tokio::io::AsyncReadExt::read(&mut file, &mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok::<axum::body::Bytes, std::io::Error>(buf.into()), file))
            }
            Err(e) => Some((Err(e), file)),
        }
    });
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, paths::mime_for(&path))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_LENGTH, end - start + 1);
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"));
    }
    builder.body(Body::from_stream(stream)).unwrap()
}

async fn hls_file(State(st): State<ProxyState>, Path((id, file)): Path<(String, String)>) -> Response {
    if id.contains("..") || file.contains("..") || file.contains('/') || file.contains('\\') {
        return Response::builder().status(StatusCode::BAD_REQUEST).body(Body::from("bad path")).unwrap();
    }
    let path = st.cache.join(&id).join(&file);
    if !paths::path_is_allowed(&path, &st.roots) {
        return Response::builder().status(StatusCode::NOT_FOUND).body(Body::empty()).unwrap();
    }
    file_response(&path, None)
}

async fn spike(Query(q): Query<SpikeQuery>) -> &'static str {
    let path = "/tmp/kovatube-webkit.json";
    let mut existing: Value = std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}));
    let key = q.kind.unwrap_or_else(|| "webview".into());
    let text = q.text.map(|t| t.chars().take(400).collect::<String>());
    existing[key] = json!({
        "webgl": q.webgl,
        "capture": q.capture,
        "tracks": q.tracks,
        "raf": q.raf,
        "title": q.title,
        "text": text,
    });
    let _ = std::fs::write(path, serde_json::to_string(&existing).unwrap_or_default());
    "ok"
}

pub fn file_response(path: &std::path::Path, range: Option<&str>) -> Response {
    let Some((status, bytes, content_range, _total)) = paths::read_range(path, range) else {
        return Response::builder().status(StatusCode::NOT_FOUND).body(Body::empty()).unwrap();
    };
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, paths::mime_for(path))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_LENGTH, bytes.len());
    if let Some(cr) = content_range {
        builder = builder.header(header::CONTENT_RANGE, cr);
    }
    builder.body(Body::from(bytes)).unwrap()
}
