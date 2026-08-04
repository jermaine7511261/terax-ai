//! DingTalk (钉钉) platform adapter.
//!
//! Uses DingTalk **Stream Mode** (`dingtalk-stream` protocol): the client
//! actively opens a long-lived WebSocket to `wss://wss-open.dingtalk.com`
//! instead of exposing a webhook. Auth is done once at bootstrap with an
//! HMAC-SHA256 signature, then the server hands back a `wsEndpoint` +
//! `ticket`; the client re-connects there and subscribes to the chatbot
//! message topic.
//!
//! Reference implementations followed:
//! - Hermes  `plugins/platforms/dingtalk/adapter.py`
//! - LangBot `pkg/platform/sources/dingtalk.py` + `libs/dingtalk_api/`
//!
//! Outbound messages are sent through the DingTalk robot OpenAPI
//! (`/v1.0/robot/oToMessages/batchSend` for DMs, `/v1.0/robot/groupMessages/send`
//! for groups) using an OAuth access token.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use chrono::{TimeZone, Utc};
use futures_util::future::BoxFuture;
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::modules::gateway::adapter::{
    ChatTarget, EventTx, PlatformAdapter, SendReceipt, SendResult,
};

/// Shared HTTP client for all outbound DingTalk calls. Reused instead of
/// dialing a fresh connection pool per request.
fn http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}
use crate::modules::gateway::message::{ChatType, MediaItem, MessageEvent};
use crate::modules::gateway::platform::PlatformId;

/// The concrete WebSocket stream type produced by `tokio_tungstenite::connect_async`.
type WsStream = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

/// Bootstrap WebSocket endpoint for DingTalk Stream Mode.
const BOOTSTRAP_URL: &str = "wss://wss-open.dingtalk.com/connect";
/// Topic to which the client subscribes to receive chatbot messages.
const CHATBOT_TOPIC: &str = "/v1.0/im/bot/message/get";
/// DingTalk OpenAPI base.
const OPENAPI_BASE: &str = "https://api.dingtalk.com";

// ---------------------------------------------------------------------------
// Config / Adapter
// ---------------------------------------------------------------------------

/// Credentials for the DingTalk chatbot.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DingTalkConfig {
    /// The AppKey (client id) of the DingTalk application / robot.
    pub app_key: String,
    /// The AppSecret (client secret) of the DingTalk application / robot.
    pub app_secret: String,
    /// Optional dedicated robot code. For enterprise-internal robots this
    /// equals the AppKey; when `None`/empty the adapter falls back to
    /// `app_key` (mirrors LangBot's `self.robot_code or self.key`).
    pub robot_code: Option<String>,
}

pub struct DingTalkAdapter {
    cfg: DingTalkConfig,
    stop: Arc<AtomicBool>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl DingTalkAdapter {
    pub fn new(cfg: DingTalkConfig) -> Self {
        Self {
            cfg,
            stop: Arc::new(AtomicBool::new(false)),
            task: Mutex::new(None),
        }
    }
}

// ---------------------------------------------------------------------------
// HMAC signature (mirrors the Python `dingtalk_stream` SDK)
// ---------------------------------------------------------------------------

/// Compute the bootstrap `sign` query parameter.
///
/// Mirrors the Python SDK's `get_websocket_url`:
///   string_to_sign = f"{timestamp}\n{client_secret}"
///   sign = base64(hmac_sha256(key=string_to_sign, msg=b""))
fn compute_sign(secret: &str, timestamp: &str) -> String {
    let key = format!("{timestamp}\n{secret}");
    let mut mac =
        Hmac::<Sha256>::new_from_slice(key.as_bytes()).expect("hmac accepts any key length");
    mac.update(b"");
    let digest = mac.finalize().into_bytes();
    base64::engine::general_purpose::STANDARD.encode(digest)
}

fn epoch_ms() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    now.as_millis().to_string()
}

/// Build the bootstrap WebSocket URL with auth query params.
fn bootstrap_url(app_key: &str, app_secret: &str) -> String {
    let timestamp = epoch_ms();
    let sign = compute_sign(app_secret, &timestamp);
    url::Url::parse_with_params(
        BOOTSTRAP_URL,
        &[
            ("clientId", app_key),
            ("clientSecret", app_secret),
            ("timestamp", &timestamp),
            ("sign", &sign),
            ("protocol", "1.0"),
        ],
    )
    .expect("static bootstrap url + valid params")
    .to_string()
}

/// Append the `ticket` query param to the server-provided `wsEndpoint`.
fn ticket_url(endpoint: &str, ticket: &str) -> String {
    url::Url::parse_with_params(endpoint, &[("ticket", ticket)])
        .map(|u| u.to_string())
        .unwrap_or_else(|_| bootstrap_url("", "")) // fallback; should not happen
}

// ---------------------------------------------------------------------------
// Frame structures (dingtalk-stream wire format)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct StreamFrame {
    #[serde(default)]
    headers: StreamFrameHeaders,
    #[serde(default)]
    body: serde_json::Value,
}

#[derive(Debug, Deserialize, Default)]
struct StreamFrameHeaders {
    #[serde(rename = "topic", default)]
    topic: String,
    #[serde(rename = "messageId", default)]
    message_id: String,
    #[serde(rename = "eventBornTime", default)]
    event_born_time: Option<i64>,
}

/// Server `body` of the `/meta/connect` bootstrap message.
#[derive(Debug, Deserialize)]
struct ConnectBody {
    #[serde(default)]
    code: i64,
    #[serde(rename = "wsEndpoint", default)]
    ws_endpoint: String,
    #[serde(default)]
    ticket: String,
}

// ---------------------------------------------------------------------------
// Inbound message parsing
// ---------------------------------------------------------------------------

/// Build a normalized `MessageEvent` from a chatbot message `body`.
fn parse_chatbot_message(body: &serde_json::Value) -> Option<MessageEvent> {
    let msg_id = body.get("msgId").and_then(|v| v.as_str()).unwrap_or_default();
    let conversation_id = body
        .get("conversationId")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let sender_id = body
        .get("senderStaffId")
        .and_then(|v| v.as_str())
        .or_else(|| body.get("senderId").and_then(|v| v.as_str()))
        .unwrap_or_default();

    if msg_id.is_empty() || conversation_id.is_empty() {
        return None;
    }

    // conversationType: "1" = single chat (friend), "2" = group chat.
    let conversation_type = body
        .get("conversationType")
        .and_then(|v| v.as_str())
        .unwrap_or("1");
    let chat_type = if conversation_type == "2" {
        ChatType::Group
    } else {
        ChatType::Dm
    };

    // Message text: `text: { content }` for text msgs; rich-text `content`
    // is a JSON array — flatten to plain text where reasonable.
    let mut text: Option<String> = None;
    if let Some(t) = body.get("text") {
        if let Some(content) = t.get("content").and_then(|v| v.as_str()) {
            text = Some(content.to_string());
        }
    }
    if text.is_none() {
        if let Some(content) = body.get("content") {
            if let Some(s) = content.as_str() {
                text = Some(s.to_string());
            } else if let Some(arr) = content.as_array() {
                let parts: Vec<String> = arr
                    .iter()
                    .filter_map(|item| {
                        item.get("text")
                            .and_then(|t| t.get("text").and_then(|x| x.as_str()))
                            .map(|s| s.to_string())
                    })
                    .filter(|s| !s.is_empty())
                    .collect();
                if !parts.is_empty() {
                    text = Some(parts.join(" "));
                }
            }
        }
    }

    let timestamp = body
        .get("createAt")
        .and_then(|v| v.as_i64())
        .or_else(|| body.get("createTime").and_then(|v| v.as_i64()))
        .and_then(|ms| Utc.timestamp_millis_opt(ms).single())
        .unwrap_or_else(Utc::now);

    // Media: when a picture/audio/file message has a downloadCode, surface a
    // media item carrying the download code in `url` (further resolution via
    // `/v1.0/robot/messageFiles/download` is left to the caller).
    let media = extract_media(body);

    Some(MessageEvent {
        platform: PlatformId::DingTalk,
        chat_type,
        chat_id: conversation_id.to_string(),
        sender_id: sender_id.to_string(),
        text,
        message_id: if msg_id.is_empty() { None } else { Some(msg_id.to_string()) },
        reply_to: None,
        media,
        raw: body.clone(),
        timestamp,
    })
}

/// Minimal media extraction for picture / audio / file messages.
fn extract_media(body: &serde_json::Value) -> Vec<MediaItem> {
    let msg_type = body.get("msgtype").and_then(|v| v.as_str());

    // `downloadCode` can sit directly on the body, or inside a JSON-string
    // `content` field (non-text message types).
    let download_code = body
        .get("downloadCode")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            let content = body.get("content").and_then(|v| v.as_str())?;
            let parsed: serde_json::Value = serde_json::from_str(content).ok()?;
            parsed
                .get("downloadCode")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        });

    let mut items = Vec::new();
    if let Some(code) = download_code {
        let kind = match msg_type {
            Some("picture") => crate::modules::gateway::message::MediaKind::Image,
            Some("audio") => crate::modules::gateway::message::MediaKind::Voice,
            Some("video") => crate::modules::gateway::message::MediaKind::Video,
            Some("file") => crate::modules::gateway::message::MediaKind::File,
            _ => crate::modules::gateway::message::MediaKind::File,
        };
        let name = body
            .get("fileName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        items.push(MediaItem {
            kind,
            // TODO: resolve downloadCode → real URL via
            //   POST /v1.0/robot/messageFiles/download
            url: Some(code.to_string()),
            name,
            size: None,
            encrypted_query: None,
            local_path: None,
        });
    }
    items
}

/// Download a DingTalk media file given its `download_code`. Returns the
/// local filesystem path on success, or an error string.
///
/// Flow: fetch access token → POST
/// `/v1.0/robot/messageFiles/download` to resolve a temporary download URL
/// → HTTP-GET the binary content → write to `~/.yamet/media/`.
async fn download_dingtalk_media(
    app_key: &str,
    app_secret: &str,
    robot_code: &str,
    download_code: &str,
) -> Result<String, String> {
    let token = fetch_access_token(app_key, app_secret).await?;
    let client = http_client();

    // 1. Resolve the temporary download URL.
    let url = format!("{OPENAPI_BASE}/v1.0/robot/messageFiles/download");
    let resp = client
        .post(&url)
        .header("x-acs-dingtalk-access-token", &token)
        .header("Content-Type", "application/json")
        .json(&json!({ "downloadCode": download_code, "robotCode": robot_code }))
        .send()
        .await
        .map_err(|e| format!("media download request failed: {e}"))?;
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("media download response parse failed: {e}"))?;
    let download_url = v
        .get("downloadUrl")
        .and_then(|u| u.as_str())
        .ok_or_else(|| format!("no downloadUrl in media response: {v}"))?;

    // 2. Fetch the actual binary content.
    let resp = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("media binary fetch failed: {e}"))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("media binary read failed: {e}"))?;

    // 3. Persist to the local media directory.
    let media_dir = dirs::home_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join(".yamet")
        .join("media");
    std::fs::create_dir_all(&media_dir)
        .map_err(|e| format!("media dir create failed: {e}"))?;
    let path = media_dir.join(format!(
        "dingtalk-{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        download_code
            .chars()
            .take(16)
            .collect::<String>()
    ));
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("media write failed: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Stream loop
// ---------------------------------------------------------------------------

/// Run one full stream session: bootstrap connect → ticket connect →
/// subscribe → read/dispatch. Returns Ok when the session ended cleanly
/// (e.g. stopped), Err on a transient failure (caller reconnects).
async fn run_stream_session(
    app_key: &str,
    app_secret: &str,
    robot_code: &str,
    stop: &Arc<AtomicBool>,
    tx: EventTx,
) -> Result<(), String> {
    // 1) Bootstrap connect (HMAC-signed).
    let url = bootstrap_url(app_key, app_secret);
    let (mut ws, _resp) = connect_async(url)
        .await
        .map_err(|e| format!("bootstrap ws connect failed: {e}"))?;

    // 2) Read the /meta/connect handshake → wsEndpoint + ticket.
    let (endpoint, ticket) = loop {
        let frame = read_frame(&mut ws).await?;
        if frame.headers.topic == "/meta/connect" {
            let body: ConnectBody = serde_json::from_value(frame.body)
                .map_err(|e| format!("bad /meta/connect body: {e}"))?;
            if body.ws_endpoint.is_empty() || body.ticket.is_empty() {
                return Err("bootstrap gave empty wsEndpoint/ticket".into());
            }
            break (body.ws_endpoint, body.ticket);
        }
    };

    // 3) Connect to the real endpoint with the ticket, then subscribe.
    let mut ws = connect_async(ticket_url(&endpoint, &ticket))
        .await
        .map_err(|e| format!("endpoint ws connect failed: {e}"))?
        .0;

    // Subscribe frame.
    let subscribe = json!({
        "headers": { "topic": "/meta/subscribe", "messageId": format!("sub-{}", epoch_ms()) },
        "body": { "topic": CHATBOT_TOPIC }
    });
    ws.send(WsMessage::Text(subscribe.to_string().into()))
        .await
        .map_err(|e| format!("subscribe send failed: {e}"))?;

    // 4) Read messages until stopped / error.
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let frame = read_frame(&mut ws).await?;
        let topic = frame.headers.topic.clone();
        let msg_id = frame.headers.message_id.clone();
        let body = frame.body.clone();

        if topic == CHATBOT_TOPIC {
            if let Some(mut ev) = parse_chatbot_message(&body) {
                // Resolve media downloads: convert downloadCode → local file.
                for item in &mut ev.media {
                    if let Some(code) = item.url.as_deref() {
                        if let Ok(local) =
                            download_dingtalk_media(app_key, app_secret, robot_code, code).await
                        {
                            item.local_path = Some(local);
                        }
                    }
                }
                if tx.send(ev).await.is_err() {
                    // Receiver (registry) gone; treat as clean stop.
                    break;
                }
            }
            // Ack so DingTalk doesn't redeliver.
            let ack = json!({
                "headers": { "topic": "/meta/ack", "messageId": msg_id },
                "body": {}
            });
            let _ = ws.send(WsMessage::Text(ack.to_string().into())).await;
        }
    }

    Ok(())
}

/// One frame from the WebSocket; handles text + binary JSON.
async fn read_frame(ws: &mut WsStream) -> Result<StreamFrame, String> {
    loop {
        let msg = ws
            .next()
            .await
            .ok_or_else(|| "ws closed".to_string())?
            .map_err(|e| format!("ws read error: {e}"))?;
        let payload: String = match msg {
            WsMessage::Text(t) => t.to_string(),
            WsMessage::Binary(b) => String::from_utf8_lossy(&b).to_string(),
            WsMessage::Close(_) => return Err("ws closed by server".into()),
            WsMessage::Ping(p) => {
                let _ = ws.send(WsMessage::Pong(p)).await;
                continue;
            }
            _ => continue,
        };
        if payload.trim().is_empty() {
            continue;
        }
        return serde_json::from_str(&payload).map_err(|e| format!("bad frame json: {e}"));
    }
}

// ---------------------------------------------------------------------------
// Outbound (robot OpenAPI)
// ---------------------------------------------------------------------------

/// Fetch an OAuth access token (cached per call-site).
async fn fetch_access_token(app_key: &str, app_secret: &str) -> Result<String, String> {
    let url = format!("{OPENAPI_BASE}/v1.0/oauth2/accessToken");
    let client = http_client();
    let body = serde_json::to_vec(&json!({ "appKey": app_key, "appSecret": app_secret }))
        .map_err(|e| format!("token serialization failed: {e}"))?;
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    let status = resp.status();
    let text_body = resp
        .text()
        .await
        .map_err(|e| format!("token response unreadable: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&text_body)
        .unwrap_or_else(|_| serde_json::Value::String(text_body.clone()));
    if !status.is_success() {
        return Err(format!("token request status {status}: {v}"));
    }
    v.get("accessToken")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("no accessToken in response: {v}"))
}

async fn send_robot_message(
    app_key: &str,
    app_secret: &str,
    robot_code: &str,
    target: &ChatTarget,
    text: &str,
) -> Result<SendReceipt, String> {
    let token = fetch_access_token(app_key, app_secret).await?;
    let client = http_client();

    let (url, body) = match target.chat_type {
        ChatType::Dm => {
            let url = format!("{OPENAPI_BASE}/v1.0/robot/oToMessages/batchSend");
            let body = json!({
                "robotCode": robot_code,
                "userIds": [target.chat_id],
                "msgKey": "sampleText",
                "msgParam": serde_json::to_string(&json!({ "content": text })).unwrap_or_default(),
            });
            (url, body)
        }
        ChatType::Group => {
            let url = format!("{OPENAPI_BASE}/v1.0/robot/groupMessages/send");
            let body = json!({
                "robotCode": robot_code,
                "openConversationId": target.chat_id,
                "msgKey": "sampleText",
                "msgParam": serde_json::to_string(&json!({ "content": text })).unwrap_or_default(),
            });
            (url, body)
        }
    };

    let bytes = serde_json::to_vec(&body)
        .map_err(|e| format!("send serialization failed: {e}"))?;
    let resp = client
        .post(url)
        .header("x-acs-dingtalk-access-token", &token)
        .header("Content-Type", "application/json")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("send request failed: {e}"))?;
    let status = resp.status();
    let text_body = resp
        .text()
        .await
        .map_err(|e| format!("send response unreadable: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&text_body)
        .unwrap_or_else(|_| serde_json::Value::String(text_body));
    if !status.is_success() {
        return Err(format!("send status {status}: {v}"));
    }
    // Some endpoints return a `processQueryKey`/`messageId`; surface what's there.
    let message_id = v
        .get("processQueryKey")
        .and_then(|k| k.as_str())
        .or_else(|| v.get("messageId").and_then(|k| k.as_str()))
        .map(|s| s.to_string());
    Ok(SendReceipt { message_id })
}

// ---------------------------------------------------------------------------
// PlatformAdapter impl
// ---------------------------------------------------------------------------

impl PlatformAdapter for DingTalkAdapter {
    fn platform(&self) -> PlatformId {
        PlatformId::DingTalk
    }

    fn is_configured(&self) -> bool {
        !self.cfg.app_key.is_empty() && !self.cfg.app_secret.is_empty()
    }

    fn connect(&self, tx: EventTx) -> BoxFuture<'static, Result<(), String>> {
        let app_key = self.cfg.app_key.clone();
        let app_secret = self.cfg.app_secret.clone();
        let robot_code = self.cfg.robot_code.clone().unwrap_or_else(|| app_key.clone());
        let stop = Arc::clone(&self.stop);

        let mut guard = self.task.lock().unwrap();
        if let Some(handle) = guard.take() {
            handle.abort();
        }

        let task = tokio::spawn(async move {
            let mut backoff: u64 = 2;
            loop {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                match run_stream_session(&app_key, &app_secret, &robot_code, &stop, tx.clone()).await {
                    Ok(()) => {
                        backoff = 2;
                    }
                    Err(e) => {
                        log::warn!("[dingtalk] stream session error: {e}");
                    }
                }
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(60);
            }
        });

        *guard = Some(task);
        Box::pin(async { Ok(()) })
    }

    fn disconnect(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.task.lock().unwrap().take() {
            handle.abort();
        }
    }

    fn send_text(&self, target: &ChatTarget, text: &str) -> BoxFuture<'static, SendResult> {
        let app_key = self.cfg.app_key.clone();
        let app_secret = self.cfg.app_secret.clone();
        let robot_code = self
            .cfg
            .robot_code
            .clone()
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| self.cfg.app_key.clone());
        let target = target.clone();
        let text = text.to_string();

        let configured = !app_key.is_empty() && !app_secret.is_empty();
        Box::pin(async move {
            if !configured {
                return Err("dingtalk not configured".to_string());
            }
            send_robot_message(&app_key, &app_secret, &robot_code, &target, &text).await
        })
    }
}
