mod auth;
mod commands;
mod cover;
mod downloads;
mod paths;
mod proxy;
mod state;
mod stream;
mod youtube;

use state::AppState;
use std::sync::atomic::Ordering;
use tauri::Manager;

fn spike_main_js(port: u16) -> String {
    format!(
        r#"(() => {{
  var gl = false, capture = false, tracks = 0, raf = false;
  try {{
    var canvas = document.createElement('canvas');
    gl = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  }} catch (e) {{}}
  try {{
    var audio = document.createElement('audio');
    capture = typeof audio.captureStream === 'function';
    if (capture) {{
      audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      var stream = audio.captureStream();
      tracks = stream.getAudioTracks ? stream.getAudioTracks().length : 0;
    }}
  }} catch (e) {{}}
  requestAnimationFrame(function () {{ raf = true; send(); }});
  setTimeout(send, 800);
  try {{
    var internals = window.__TAURI_INTERNALS__;
    if (internals && internals.invoke) {{
      internals.invoke('app_version', {{}}, {{}}).then(function (version) {{
        fetch('http://127.0.0.1:{port}/spike?kind=bridge&title=' + encodeURIComponent(String(version)));
      }}).catch(function (err) {{
        fetch('http://127.0.0.1:{port}/spike?kind=bridge&text=' + encodeURIComponent(String(err && err.message || err)));
      }});
    }} else {{
      fetch('http://127.0.0.1:{port}/spike?kind=bridge&text=no-internals');
    }}
  }} catch (err) {{}}
  var sent = false;
  function send() {{
    if (sent) return;
    sent = true;
    fetch('http://127.0.0.1:{port}/spike?kind=webview&webgl=' + gl + '&capture=' + capture + '&tracks=' + tracks + '&raf=' + raf + '&title=' + encodeURIComponent(document.title || ''));
  }}
}})()"#
    )
}

fn spike_signin_js(port: u16) -> String {
    format!(
        r#"setTimeout(function () {{
  var title = document.title || '';
  var text = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 400);
  location.href = 'http://127.0.0.1:{port}/spike?kind=signin&title=' + encodeURIComponent(title) + '&text=' + encodeURIComponent(text);
}}, 7000);"#
    )
}

fn ytfile_response(request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let state = AppState::global();
    let settings = state.settings.lock().map(|s| s.clone()).unwrap_or(serde_json::json!({}));
    let roots = state.paths.allowed_roots(&settings);
    let uri = request.uri().to_string();
    let path = uri.split("://").nth(1).and_then(|rest| {
        let raw = rest.split_once('/').map(|(_, p)| format!("/{p}")).unwrap_or_default();
        let decoded = percent_encoding::percent_decode_str(&raw).decode_utf8().ok()?;
        Some(std::path::PathBuf::from(decoded.as_ref()))
    });
    let range = request.headers().get("range").and_then(|v| v.to_str().ok()).map(|s| s.to_string());
    let Some(path) = path.filter(|p| paths::path_is_allowed(p, &roots)) else {
        return http::Response::builder().status(404).body(Vec::new()).unwrap();
    };
    let Some((status, bytes, content_range, _)) = paths::read_range(&path, range.as_deref()) else {
        return http::Response::builder().status(404).body(Vec::new()).unwrap();
    };
    let mut builder = http::Response::builder()
        .status(status)
        .header("Content-Type", paths::mime_for(&path))
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*")
        .header("Content-Length", bytes.len());
    if let Some(cr) = content_range {
        builder = builder.header("Content-Range", cr);
    }
    builder.body(bytes).unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .user_agent(youtube::UA)
        .redirect(reqwest::redirect::Policy::limited(8))
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .expect("http client");
    let client = http.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .register_uri_scheme_protocol("ytfile", |_ctx, request| ytfile_response(request))
        .setup(move |app| {
            let paths = paths::Paths::resolve();
            let port = proxy::start(client.clone(), &paths);
            AppState::install(AppState::new(port, client.clone()));
            let _ = tauri::async_runtime::spawn_blocking(|| {
                crate::state::repair_saved_playlists();
            });
            if std::env::var("KOVATUBE_SPIKE").ok().as_deref() == Some("1") {
                let app_handle = app.handle().clone();
                let http = client.clone();
                let _ = std::fs::remove_file("/tmp/kovatube-webkit.json");
                auth::open_signin_window(app.handle());
                tauri::async_runtime::spawn(async move {
                    let playback_handle = {
                        let http = http.clone();
                        tauri::async_runtime::spawn(async move {
                            stream::probe_direct(&http, AppState::global().proxy_port).await
                        })
                    };
                    tokio::time::sleep(std::time::Duration::from_secs(12)).await;
                    let playback = playback_handle.await.unwrap_or_else(|_| serde_json::json!({ "ok": false, "reason": "probe task failed" }));
                    let page = auth::probe_page(&app_handle).await;
                    let webkit = std::fs::read_to_string("/tmp/kovatube-webkit.json")
                        .ok()
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                        .unwrap_or_else(|| serde_json::json!({}));
                    let settings_present = AppState::global().paths.config.join("settings.json").is_file();
                    let payload = serde_json::json!({
                        "playback": playback,
                        "youtube": page,
                        "webkit": webkit,
                        "settingsPresent": settings_present
                    });
                    if let Some(window) = app_handle.get_webview_window("signin") {
                        let _ = window.close();
                    }
                    println!("[spike] {payload}");
                    let _ = std::fs::write("/tmp/kovatube-tauri-spike.json", serde_json::to_string_pretty(&payload).unwrap_or_default());
                });
            }
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            let state = AppState::global();
            match webview.label() {
                "session" => state.session_ready.store(true, Ordering::Relaxed),
                "music" => state.music_ready.store(true, Ordering::Relaxed),
                _ => {}
            }
            if std::env::var("KOVATUBE_SPIKE").ok().as_deref() == Some("1") {
                let port = state.proxy_port;
                let url = payload.url().as_str();
                if webview.label() == "main" {
                    let _ = webview.eval(&spike_main_js(port));
                } else if webview.label() == "signin" && url.contains("accounts.google.com") {
                    let _ = webview.eval(&spike_signin_js(port));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_fetch_result,
            commands::spike_report,
            commands::get_app_path,
            commands::app_version,
            commands::update_check,
            commands::update_install,
            commands::get_downloads_path,
            commands::get_download_paths,
            commands::get_downloads_list,
            commands::select_directory,
            commands::save_file,
            commands::net_probe,
            commands::yt_search,
            commands::yt_home_feed,
            commands::yt_shorts_feed,
            commands::yt_fyp_page,
            commands::yt_prefs,
            commands::yt_record_watch,
            commands::yt_subscribe,
            commands::yt_unsubscribe,
            commands::yt_video_info,
            commands::yt_captions,
            commands::yt_comments,
            commands::yt_comment_create,
            commands::yt_channel,
            commands::yt_channel_avatar,
            commands::yt_channel_more,
            commands::yt_new_videos,
            commands::yt_convert_formats,
            commands::yt_extract_id,
            commands::yt_stream,
            commands::yt_stream_stop,
            commands::yt_prewarm,
            commands::cover_palette,
            commands::cover_image,
            commands::yt_music_home,
            commands::yt_music_charts,
            commands::yt_music_search,
            commands::yt_music_browse,
            commands::yt_music_more,
            commands::yt_music_library,
            commands::yt_music_liked_ids,
            commands::yt_music_rate,
            commands::yt_music_lyrics,
            commands::yt_audio_stream,
            commands::audio_keepalive,
            commands::yt_audio_prewarm,
            commands::settings_get,
            commands::settings_set,
            commands::prepare_playback,
            commands::dl_start,
            commands::dl_playlist,
            commands::dl_playlists,
            commands::dl_playlist_autosync,
            commands::dl_playlist_sync,
            commands::dl_sync_all,
            commands::dl_cancel,
            commands::dl_active,
            commands::dl_completed,
            commands::dl_play,
            commands::dl_show_in_folder,
            commands::smart_dl_toggle,
            commands::smart_dl_clipboard_toggle,
            commands::smart_dl_status,
            commands::smart_dl_reset_counts,
            commands::smart_dl_history,
            commands::smart_dl_cancel,
            commands::yt_auth_status,
            commands::yt_auth_signin,
            commands::yt_auth_signout,
            commands::yt_auth_account,
            commands::yt_auth_home_page,
            commands::yt_auth_subscriptions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kovatube");
}
