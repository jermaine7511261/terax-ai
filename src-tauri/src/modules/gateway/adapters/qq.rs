//! QQ adapter over the OneBot v11 protocol (local go-cqhttp).
//!
//! Connects to a local go-cqhttp WebSocket, receives private/group messages,
//! and sends replies via `send_private_msg` / `send_group_msg`.
//!
//! Reference: LangBot `aiocqhttp.py` + Hermes `gateway/platforms/qqbot/`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use futures_util::future::BoxFuture;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::http;

use crate::modules::gateway::adapter::{
    ChatTarget, EventTx, PlatformAdapter, SendReceipt, SendResult,
};
use crate::modules::gateway::message::{ChatType, MediaItem, MediaKind, MessageEvent};
use crate::modules::gateway::platform::PlatformId;
use serde::{Deserialize, Serialize};

/// OneBot WebSocket stream + the split-out send half, so `send_text` reuses the
/// connection held by the receive loop instead of dialing a new one per send.
type OnebotWs = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;
type OnebotSink = futures_util::stream::SplitSink<
    OnebotWs,
    tokio_tungstenite::tungstenite::Message,
>;

/// Connect to go-cqhttp's forward WebSocket, attaching `Authorization: Bearer`
/// when an access token is configured (OneBot v11 supports token auth).
async fn connect_onebot(cfg: &QqConfig) -> Result<OnebotWs, String> {
    let mut request = http::Request::builder()
        .uri(&cfg.ws_url)
        .body(())
        .map_err(|e| format!("onebot request build failed: {e}"))?;
    if !cfg.access_token.is_empty() {
        request.headers_mut().insert(
            "Authorization",
            http::HeaderValue::from_str(&format!("Bearer {}", cfg.access_token))
                .map_err(|e| format!("onebot auth header invalid: {e}"))?,
        );
    }
    let (ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("onebot connect failed: {e}"))?;
    Ok(ws)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QqConfig {
    pub ws_url: String,
    pub access_token: String,
}

impl Default for QqConfig {
    fn default() -> Self {
        Self {
            // Empty by default so an un-configured QQ shows as "not configured"
            // (the previous default made every fresh install look configured).
            ws_url: String::new(),
            access_token: String::new(),
        }
    }
}

pub struct QqAdapter {
    inner: Arc<QqInner>,
}

struct QqInner {
    cfg: QqConfig,
    stop: Arc<AtomicBool>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Reused outbound half of the OneBot WebSocket (set by the receive loop).
    /// `send_text` reuses it instead of opening a new connection per send.
    sender: Mutex<Option<futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        tokio_tungstenite::tungstenite::Message,
    >>>,
    /// echo id -> oneshot for the send receipt, so `send_text` can await the
    /// real `message_id` returned by OneBot instead of a generic empty receipt.
    pending_sends: Mutex<HashMap<String, tokio::sync::oneshot::Sender<SendReceipt>>>,
    /// Shared HTTP client for media downloads.
    client: reqwest::Client,
}

impl QqAdapter {
    pub fn new(cfg: QqConfig) -> Self {
        Self {
            inner: Arc::new(QqInner {
                cfg,
                stop: Arc::new(AtomicBool::new(false)),
                task: Mutex::new(None),
                sender: Mutex::new(None),
                pending_sends: Mutex::new(HashMap::new()),
                client: reqwest::Client::new(),
            }),
        }
    }
}

/// Extract the text from a OneBot `message` field (string or segment array).
fn extract_text(message: &serde_json::Value) -> Option<String> {
    match message {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(parts) => {
            let mut out = String::new();
            for p in parts {
                if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(text) = p.pointer("/data/text").and_then(|t| t.as_str()) {
                        out.push_str(text);
                    }
                }
            }
            Some(out)
        }
        _ => None,
    }
}

/// Extract media items (image/record/video/file segments) from a OneBot
/// `message` array. go-cqhttp includes a direct `url` for most segment types;
/// `file` segments carry `name` as well.
fn extract_media(message: &serde_json::Value) -> Vec<MediaItem> {
    let mut out = Vec::new();
    if let serde_json::Value::Array(parts) = message {
        for p in parts {
            let ty = p.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let kind = match ty {
                "image" => MediaKind::Image,
                "record" => MediaKind::Voice,
                "video" => MediaKind::Video,
                "file" => MediaKind::File,
                _ => continue,
            };
            let data = p.get("data");
            let url = data
                .and_then(|d| d.get("url"))
                .and_then(|u| u.as_str())
                .map(String::from);
            let name = data
                .and_then(|d| d.get("name"))
                .and_then(|n| n.as_str())
                .map(String::from);
            if url.is_none() && name.is_none() {
                continue;
            }
            out.push(MediaItem {
                kind,
                url,
                name,
                size: None,
                encrypted_query: None,
                local_path: None,
            });
        }
    }
    out
}

impl PlatformAdapter for QqAdapter {
    fn platform(&self) -> PlatformId {
        PlatformId::Qq
    }

    fn is_configured(&self) -> bool {
        !self.inner.cfg.ws_url.is_empty()
    }

    fn connect(&self, tx: EventTx) -> BoxFuture<'static, Result<(), String>> {
        let inner = self.inner.clone();
        Box::pin(async move {
            let this = inner.clone();
            let this2 = this.clone();
            let task = tokio::spawn(async move {
                loop {
                    if this2.stop.load(Ordering::Relaxed) {
                        break;
                    }
                    match run_onebot_loop(&this2, tx.clone()).await {
                        Ok(()) => {}
                        Err(e) => log::warn!("OneBot loop error: {e}"),
                    }
                    if this2.stop.load(Ordering::Relaxed) {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                }
            });
            *this.task.lock().unwrap_or_else(|e| e.into_inner()) = Some(task);
            Ok(())
        })
    }

    fn disconnect(&self) {
        self.inner.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.inner.task.lock().unwrap_or_else(|e| e.into_inner()).take() {
            t.abort();
        }
    }

    fn send_text(&self, target: &ChatTarget, text: &str) -> BoxFuture<'static, SendResult> {
        let this = self.inner.clone();
        let chat_type = target.chat_type;
        let chat_id = target.chat_id.clone();
        let content = text.to_string();
        Box::pin(async move {
            let action = match chat_type {
                ChatType::Dm => "send_private_msg",
                ChatType::Group => "send_group_msg",
            };
            let id_key = if chat_type == ChatType::Dm {
                "user_id"
            } else {
                "group_id"
            };
            let id_val = chat_id.parse::<i64>().unwrap_or_default();
            let echo = format!(
                "send-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            );
            let payload = serde_json::json!({
                "action": action,
                "params": { id_key: id_val, "message": content },
                "echo": echo,
            });
            let msg = tokio_tungstenite::tungstenite::Message::Text(payload.to_string().into());

            // Preferred path: reuse the connection held by the receive loop.
            // Take it out into a local so the std MutexGuard is dropped before
            // any await (holding it across an await would make the future
            // non-`Send`).
            let live_sink = this.sender.lock().unwrap_or_else(|e| e.into_inner()).take();
            if let Some(mut sink) = live_sink {
                let (tx_rcv, rx_rcv) = tokio::sync::oneshot::channel::<SendReceipt>();
                this.pending_sends.lock().unwrap_or_else(|e| e.into_inner()).insert(echo.clone(), tx_rcv);
                if let Err(e) = sink.send(msg).await {
                    log::warn!("onebot send via shared conn failed: {e}");
                    this.pending_sends.lock().unwrap_or_else(|e| e.into_inner()).remove(&echo);
                    return Err(format!("onebot send failed: {e}"));
                }
                // Put the sink back for future sends.
                *this.sender.lock().unwrap_or_else(|e| e.into_inner()) = Some(sink);
                return match tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    rx_rcv,
                )
                .await
                {
                    // The receive loop resolved our oneshot with the real
                    // message_id from OneBot's reply.
                    Ok(Ok(receipt)) => Ok(receipt),
                    _ => Ok(SendReceipt { message_id: None }),
                };
            }

            // Fallback: no live connection — open a one-shot (auth'd) connection
            // and read the echo reply ourselves.
            let mut ws = connect_onebot(&this.cfg).await?;
            ws.send(msg)
                .await
                .map_err(|e| format!("onebot send failed: {e}"))?;
            let mut message_id: Option<String> = None;
            let _ = tokio::time::timeout(std::time::Duration::from_secs(3), async {
                while let Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t))) =
                    ws.next().await
                {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                        if v.get("echo").and_then(|s| s.as_str()) == Some(&echo) {
                            if v.get("status").and_then(|s| s.as_str()) == Some("ok") {
                                message_id = v
                                    .get("data")
                                    .and_then(|d| d.get("message_id"))
                                    .map(|x| x.to_string());
                            }
                            return;
                        }
                    }
                }
            })
            .await;
            Ok(SendReceipt { message_id })
        })
    }
}

/// One connect cycle: receive inbound messages until error or stop. The
/// outbound half of the connection is stashed on `inner.sender` so `send_text`
/// reuses it instead of dialing a fresh WebSocket per message.
async fn run_onebot_loop(inner: &Arc<QqInner>, tx: EventTx) -> Result<(), String> {
    let ws = connect_onebot(&inner.cfg).await?;
    let (sink, mut stream) = ws.split();
    *inner.sender.lock().unwrap_or_else(|e| e.into_inner()) = Some(sink);
    while !inner.stop.load(Ordering::Relaxed) {
        let msg = match stream.next().await {
            Some(Ok(m)) => m,
            Some(Err(e)) => return Err(format!("ws error: {e}")),
            None => return Ok(()),
        };
        if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
            let v: serde_json::Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };
            // A reply to one of our sends (carries `echo`): resolve the pending
            // oneshot with the real message_id so send_text can return it.
            if let Some(echo) = v.get("echo").and_then(|x| x.as_str()) {
                if let Some(tx_send) = inner.pending_sends.lock().unwrap_or_else(|e| e.into_inner()).remove(echo) {
                    let message_id = v
                        .get("data")
                        .and_then(|d| d.get("message_id"))
                        .map(|x| x.to_string());
                    let _ = tx_send.send(SendReceipt { message_id });
                }
                continue;
            }
            if v.get("post_type").and_then(|x| x.as_str()) != Some("message") {
                continue;
            }
            let chat_type = match v.get("message_type").and_then(|x| x.as_str()) {
                Some("group") => ChatType::Group,
                _ => ChatType::Dm,
            };
            let chat_id = if chat_type == ChatType::Group {
                v.get("group_id").and_then(|x| x.as_i64()).map(|i| i.to_string()).unwrap_or_default()
            } else {
                v.get("user_id").and_then(|x| x.as_i64()).map(|i| i.to_string()).unwrap_or_default()
            };
            let sender = v.get("user_id").and_then(|x| x.as_i64()).map(|i| i.to_string()).unwrap_or_default();
            let text = extract_text(v.get("message").unwrap_or(&serde_json::Value::Null));
            let message_id = v.get("message_id").map(|x| x.to_string());
            let message = v.get("message").unwrap_or(&serde_json::Value::Null);
            let mut media = extract_media(message);
            // Resolve media downloads: fill local_path for each item.
            super::media::download_media_items(&inner.client, &mut media, "qq").await;
            let ev = MessageEvent {
                platform: PlatformId::Qq,
                chat_type,
                chat_id,
                sender_id: sender,
                text,
                message_id,
                reply_to: None,
                media,
                raw: v,
                timestamp: Utc::now(),
            };
            if tx.try_send(ev).is_err() {
                return Err("event channel closed".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_media_handles_image_record_file_segments() {
        let msg = json!([
            { "type": "text", "data": { "text": "hi" } },
            { "type": "image", "data": { "url": "https://q.qlogo.cn/x.png" } },
            { "type": "record", "data": { "url": "https://x/voice.amr" } },
            { "type": "file", "data": { "name": "doc.pdf", "url": "https://x/doc.pdf" } },
        ]);
        let media = extract_media(&msg);
        assert_eq!(media.len(), 3);
        assert_eq!(media[0].kind, MediaKind::Image);
        assert_eq!(media[0].url.as_deref(), Some("https://q.qlogo.cn/x.png"));
        assert_eq!(media[1].kind, MediaKind::Voice);
        assert_eq!(media[2].kind, MediaKind::File);
        assert_eq!(media[2].name.as_deref(), Some("doc.pdf"));
    }

    #[test]
    fn extract_media_skips_text_and_unknown_segments() {
        assert!(
            extract_media(&json!([{ "type": "text", "data": { "text": "x" } }])).is_empty()
        );
        assert!(extract_media(&json!([{ "type": "face", "data": {} }])).is_empty());
        assert!(extract_media(&json!("plain string")).is_empty());
    }
}
