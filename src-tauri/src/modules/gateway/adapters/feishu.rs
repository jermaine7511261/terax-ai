//! Feishu (飞书 / Lark) platform adapter.
//!
//! Reference implementations:
//! - Hermes  `plugins/platforms/feishu/adapter.py`
//! - LangBot `pkg/platform/sources/lark.py`
//!
//! Protocol notes (lark-oapi, faithful to the references above — no invented
//! endpoints):
//!
//! - **Token**: obtain a `tenant_access_token` via
//!   `POST /open-apis/auth/v3/tenant_access_token/internal` with body
//!   `{"app_id", "app_secret"}`. The token is used as the `Authorization:
//!   Bearer <token>` header for every downstream call.
//!
//! - **Event subscription**: WebSocket long-connection (client) mode. First
//!   ask the server for a connection URL via
//!   `GET /open-apis/ws/v1/endpoint` (auth header), then connect to the
//!   returned `wss://` URL. Inbound frames carry a `type` field:
//!     * `http_callback`  → the `data` object is a Feishu event (schema /
//!       header / event). After handling we must ACK with
//!       `{"type":"ack","status":{"code":0}}`.
//!     * `client_heartbeat` → must reply `{"type":"client_heartbeat_ack"}`.
//!
//! - **Send**: `POST /open-apis/im/v1/messages?receive_id_type=...` with body
//!   `{"receive_id","msg_type","content","uuid"}` where `content` is a JSON
//!   *string*, e.g. `{"text":"hello"}` for `msg_type=text`. `receive_id_type`
//!   is `chat_id` for groups / p2p chats, `open_id` for `ou_` ids, `user_id`
//!   for `feishu_user_id:` prefixed ids.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use futures_util::future::BoxFuture;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::modules::gateway::adapter::{ChatTarget, PlatformAdapter, SendReceipt, SendResult};
use crate::modules::gateway::message::{ChatType, MediaItem, MessageEvent};
use crate::modules::gateway::platform::PlatformId;

/// The gateway's inbound delivery channel (see `adapter::EventTx`).
type EventTx = mpsc::Sender<MessageEvent>;

/// Endpoint domain for Feishu (CN). The international Lark instance uses
/// `open.larksuite.com`; the paths below are identical otherwise.
const FEISHU_BASE: &str = "https://open.feishu.cn";

/// Idle-read timeout for the WebSocket loop. Used to keep the connection
/// healthy and to give `disconnect()` a chance to observe the stop flag.
const WS_READ_TIMEOUT_SECS: u64 = 25;

/// Credentials configured in the gateway settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuConfig {
    pub app_id: String,
    pub app_secret: String,
}

impl Default for FeishuConfig {
    fn default() -> Self {
        Self {
            app_id: String::new(),
            app_secret: String::new(),
        }
    }
}

/// Concrete Feishu platform adapter. Connection state lives behind interior
/// mutability so `connect`/`disconnect` can take `&self` (the registry drops
/// its lock before awaiting the connect future).
pub struct FeishuAdapter {
    cfg: FeishuConfig,
    stop: Arc<AtomicBool>,
    task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl FeishuAdapter {
    pub fn new(cfg: FeishuConfig) -> Self {
        Self {
            cfg,
            stop: Arc::new(AtomicBool::new(false)),
            task: Arc::new(Mutex::new(None)),
        }
    }
}

/// Generate a short unique id (used for Feishu message `uuid` idempotency).
fn new_uuid() -> String {
    use rand::Rng;
    let bytes: [u8; 16] = rand::thread_rng().gen();
    hex::encode(bytes)
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/// Exchange `app_id` + `app_secret` for a `tenant_access_token`.
///
/// Mirrors Hermes `_probe_bot_http` and lark-oapi's internal token flow:
/// `POST {base}/open-apis/auth/v3/tenant_access_token/internal`.
async fn fetch_tenant_access_token(
    client: &reqwest::Client,
    cfg: &FeishuConfig,
) -> Result<String, String> {
    let url = format!("{FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal");
    let body = json!({
        "app_id": cfg.app_id,
        "app_secret": cfg.app_secret,
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("feishu token request failed: {e}"))?;
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("feishu token response unparseable: {e}"))?;

    v.get("tenant_access_token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("no tenant_access_token in response: {v}"))
}

/// Ask the server for a WebSocket connection URL (long-connection / client
/// mode). Mirrors lark-oapi's `ws.Client._get_conn_url`:
/// `GET {base}/open-apis/ws/v1/endpoint` → `data.url` (a `wss://` address).
async fn fetch_ws_endpoint(
    client: &reqwest::Client,
    token: &str,
) -> Result<String, String> {
    let url = format!("{FEISHU_BASE}/open-apis/ws/v1/endpoint");

    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("feishu ws endpoint request failed: {e}"))?;
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("feishu ws endpoint response unparseable: {e}"))?;

    v.pointer("/data/url")
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("no ws endpoint url in response: {v}"))
}

// ---------------------------------------------------------------------------
// Outbound send
// ---------------------------------------------------------------------------

/// `POST {base}/open-apis/im/v1/messages?receive_id_type=...` with a
/// `msg_type=text` body. Returns a receipt carrying the new message id.
async fn feishu_send_text(
    cfg: &FeishuConfig,
    token: &str,
    target: &ChatTarget,
    text: &str,
) -> SendResult {
    let _ = cfg; // config retained for future media uploads
    let client = reqwest::Client::new();

    // Map the normalized target to Feishu's receive_id_type (mirrors LangBot's
    // `send_message` mapping and Hermes' `_build_create_message_request`).
    let (receive_id_type, receive_id) = match target.chat_type {
        ChatType::Dm => {
            if let Some(stripped) = target.chat_id.strip_prefix("feishu_user_id:") {
                ("user_id", stripped.to_string())
            } else if target.chat_id.starts_with("ou_") {
                ("open_id", target.chat_id.clone())
            } else {
                // p2p chat id (oc_...)
                ("chat_id", target.chat_id.clone())
            }
        }
        ChatType::Group => ("chat_id", target.chat_id.clone()),
    };

    let url = format!(
        "{FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type={receive_id_type}"
    );
    let body = json!({
        "receive_id": receive_id,
        "msg_type": "text",
        "content": json!({"text": text}).to_string(),
        "uuid": new_uuid(),
    });

    let resp = client
        .post(&url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("feishu send request failed: {e}"))?;
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("feishu send response unparseable: {e}"))?;

    let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
    if code != 0 {
        return Err(format!("feishu send error: {v}"));
    }

    let message_id = v
        .pointer("/data/message_id")
        .and_then(|m| m.as_str())
        .map(|s| s.to_string());
    Ok(SendReceipt { message_id })
}

// ---------------------------------------------------------------------------
// Inbound event handling
// ---------------------------------------------------------------------------

/// Handle a single WebSocket text frame (a Feishu long-connection message).
///
/// `http_callback` frames carry inbound events and must be ACKed; heartbeat
/// frames must be answered with a heartbeat-ack. Mirrors lark-oapi's
/// `ws.Client._handle_message`.
async fn handle_ws_frame<S>(
    write: &mut S,
    text: &str,
    tx: EventTx,
) -> Result<(), String>
where
    S: futures_util::Sink<Message> + Unpin,
    <S as futures_util::Sink<Message>>::Error: std::fmt::Display,
{
    let frame: Value = serde_json::from_str(text)
        .map_err(|e| format!("feishu ws frame unparseable: {e}"))?;

    match frame.get("type").and_then(|t| t.as_str()) {
        Some("http_callback") => {
            if let Some(data) = frame.get("data") {
                handle_inbound_event(data, &tx);
            }
            let ack = serde_json::to_string(&json!({"type": "ack", "status": {"code": 0}}))
                .unwrap_or_else(|_| r#"{"type":"ack","status":{"code":0}}"#.to_string());
            ws_send(write, ack).await?;
        }
        Some("client_heartbeat") => {
            ws_send(write, r#"{"type":"client_heartbeat_ack"}"#.to_string()).await?;
        }
        _ => { /* ignore other frame types */ }
    }
    Ok(())
}

async fn ws_send<S>(write: &mut S, text: String) -> Result<(), String>
where
    S: futures_util::Sink<Message> + Unpin,
    <S as futures_util::Sink<Message>>::Error: std::fmt::Display,
{
    write
        .send(Message::Text(text.into()))
        .await
        .map_err(|e| format!("feishu ws send failed: {e}"))?;
    Ok(())
}

/// Normalize a Feishu `im.message.receive_v1` event into a gateway
/// `MessageEvent` and push it onto the inbound channel.
fn handle_inbound_event(data: &Value, tx: &EventTx) {
    let event_type = data
        .pointer("/header/event_type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if event_type != "im.message.receive_v1" {
        return;
    }

    // Never echo our own (bot/app) messages back into the loop.
    let sender_type = data
        .pointer("/event/sender/sender_type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if sender_type == "bot" || sender_type == "app" {
        return;
    }

    let message = match data.pointer("/event/message") {
        Some(m) => m,
        None => return,
    };

    let message_id = message
        .get("message_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if message_id.is_empty() {
        return;
    }

    let chat_id = message
        .get("chat_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let chat_type = match message
        .get("chat_type")
        .and_then(|v| v.as_str())
        .unwrap_or("p2p")
    {
        "group" => ChatType::Group,
        _ => ChatType::Dm,
    };

    let sender_id = data
        .pointer("/event/sender/sender_id/open_id")
        .and_then(|v| v.as_str())
        .or_else(|| {
            data.pointer("/event/sender/sender_id/user_id")
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            data.pointer("/event/sender/sender_id/union_id")
                .and_then(|v| v.as_str())
        })
        .unwrap_or("<unknown>")
        .to_string();

    let text = extract_message_text(message);

    let reply_to = message
        .get("parent_id")
        .and_then(|v| v.as_str())
        .or_else(|| message.get("upper_message_id").and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    let ev = MessageEvent {
        platform: PlatformId::Feishu,
        chat_type,
        chat_id,
        sender_id,
        text,
        message_id: Some(message_id),
        reply_to,
        media: Vec::<MediaItem>::new(),
        raw: data.clone(),
        timestamp: Utc::now(),
    };

    // Non-blocking push; drop the event if the router is saturated.
    let _ = tx.try_send(ev);
}

/// Extract the plain-text payload from a Feishu message. For `text` messages
/// the `content` field is a JSON string shaped like `{"text":"..."}`.
fn extract_message_text(message: &Value) -> Option<String> {
    let msg_type = message
        .get("message_type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if msg_type != "text" {
        return None;
    }
    let content = message.get("content").and_then(|v| v.as_str())?;
    let content_json: Value = serde_json::from_str(content).ok()?;
    content_json
        .get("text")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// Connection loop
// ---------------------------------------------------------------------------

/// Run one WebSocket session: fetch a token, resolve the WS endpoint, connect
/// and dispatch frames until the socket closes or the stop flag is set.
async fn run_ws_session(
    client: &reqwest::Client,
    cfg: &FeishuConfig,
    tx: EventTx,
    stop: &AtomicBool,
) -> Result<(), String> {
    let token = fetch_tenant_access_token(client, cfg).await?;
    let ws_url = fetch_ws_endpoint(client, &token).await?;

    let (ws_stream, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| format!("feishu ws connect failed: {e}"))?;
    let (mut write, mut read) = ws_stream.split();

    loop {
        if stop.load(Ordering::SeqCst) {
            return Ok(());
        }
        let item = tokio::time::timeout(Duration::from_secs(WS_READ_TIMEOUT_SECS), read.next()).await;
        match item {
            Err(_) => {
                // Read idle timeout; tungstenite handles protocol ping/pong in
                // the background, so just keep the loop alive.
                continue;
            }
            Ok(None) => return Err("feishu ws closed by server".into()),
            Ok(Some(Err(e))) => return Err(format!("feishu ws read error: {e}")),
            Ok(Some(Ok(msg))) => {
                if let Message::Text(text) = msg {
                    handle_ws_frame(&mut write, text.as_str(), tx.clone()).await?;
                }
            }
        }
    }
}

/// Top-level event loop. Reconnects with exponential backoff until the adapter
/// is stopped.
async fn feishu_event_loop(cfg: FeishuConfig, tx: EventTx, stop: Arc<AtomicBool>) {
    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[Feishu] failed to build http client: {e}");
            return;
        }
    };

    let mut backoff: u64 = 2;
    while !stop.load(Ordering::SeqCst) {
        match run_ws_session(&client, &cfg, tx.clone(), &stop).await {
            Ok(()) => backoff = 2,
            Err(e) => log::warn!("[Feishu] session ended: {e}; reconnecting in {backoff}s"),
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_secs(backoff)).await;
        backoff = (backoff * 2).min(60);
    }
}

// ---------------------------------------------------------------------------
// PlatformAdapter trait implementation
// ---------------------------------------------------------------------------

impl PlatformAdapter for FeishuAdapter {
    fn platform(&self) -> PlatformId {
        PlatformId::Feishu
    }

    fn is_configured(&self) -> bool {
        !self.cfg.app_id.is_empty() && !self.cfg.app_secret.is_empty()
    }

    fn connect(&self, tx: EventTx) -> BoxFuture<'static, Result<(), String>> {
        let cfg = self.cfg.clone();
        let stop = self.stop.clone();
        let task = self.task.clone();
        let configured = !cfg.app_id.is_empty() && !cfg.app_secret.is_empty();
        Box::pin(async move {
            if !configured {
                return Err("feishu platform not configured".into());
            }
            stop.store(false, Ordering::SeqCst);
            let handle = tokio::spawn(async move {
                feishu_event_loop(cfg, tx, stop).await;
            });
            let mut guard = task.lock().unwrap();
            if let Some(prev) = guard.take() {
                prev.abort();
            }
            *guard = Some(handle);
            Ok(())
        })
    }

    fn disconnect(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.task.lock().unwrap().take() {
            handle.abort();
        }
    }

    fn send_text(&self, target: &ChatTarget, text: &str) -> BoxFuture<'static, SendResult> {
        let cfg = self.cfg.clone();
        // Clone the target/text into owned values so the returned future does
        // not borrow references with shorter lifetimes than `&self` (required
        // by the `BoxFuture<'static, ...>` elided-lifetime signature).
        let target = target.clone();
        let text = text.to_string();
        Box::pin(async move {
            let client = reqwest::Client::new();
            let token = match fetch_tenant_access_token(&client, &cfg).await {
                Ok(t) => t,
                Err(e) => return Err(e),
            };
feishu_send_text(&cfg, &token, &target, &text).await
})
}
}
