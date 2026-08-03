//! QQ adapter over the OneBot v11 protocol (local go-cqhttp).
//!
//! Connects to a local go-cqhttp WebSocket, receives private/group messages,
//! and sends replies via `send_private_msg` / `send_group_msg`.
//!
//! Reference: LangBot `aiocqhttp.py` + Hermes `gateway/platforms/qqbot/`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use futures_util::future::BoxFuture;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;

use crate::modules::gateway::adapter::{
    ChatTarget, EventTx, PlatformAdapter, SendReceipt, SendResult,
};
use crate::modules::gateway::message::{ChatType, MessageEvent};
use crate::modules::gateway::platform::PlatformId;

#[derive(Debug, Clone)]
pub struct QqConfig {
    pub ws_url: String,
    pub access_token: String,
}

impl Default for QqConfig {
    fn default() -> Self {
        Self {
            ws_url: "ws://127.0.0.1:6700".to_string(),
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
}

impl QqAdapter {
    pub fn new(cfg: QqConfig) -> Self {
        Self {
            inner: Arc::new(QqInner {
                cfg,
                stop: Arc::new(AtomicBool::new(false)),
                task: Mutex::new(None),
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
            *this.task.lock().unwrap() = Some(task);
            Ok(())
        })
    }

    fn disconnect(&self) {
        self.inner.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.inner.task.lock().unwrap().take() {
            t.abort();
        }
    }

    fn send_text(&self, target: &ChatTarget, text: &str) -> BoxFuture<'static, SendResult> {
        let this = self.inner.clone();
        let chat_type = target.chat_type;
        let chat_id = target.chat_id.clone();
        let content = text.to_string();
        Box::pin(async move {
            let url = this.cfg.ws_url.clone();
            let (mut ws, _) = tokio_tungstenite::connect_async(&url)
                .await
                .map_err(|e| format!("onebot connect failed: {e}"))?;
            let action = match chat_type {
                ChatType::Dm => "send_private_msg",
                ChatType::Group => "send_group_msg",
            };
            let id_key = if chat_type == ChatType::Dm {
                "user_id"
            } else {
                "group_id"
            };
            let id_val = chat_id
                .parse::<i64>()
                .unwrap_or_default();
            let payload = serde_json::json!({
                "action": action,
                "params": { id_key: id_val, "message": content },
                "echo": format!("send-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)),
            });
            ws.send(tokio_tungstenite::tungstenite::Message::Text(
                payload.to_string().into(),
            ))
            .await
            .map_err(|e| format!("onebot send failed: {e}"))?;
            // Read the matching reply (best-effort).
            let _ = tokio::time::timeout(std::time::Duration::from_secs(3), async {
                while let Some(msg) = ws.next().await {
                    if let Ok(tokio_tungstenite::tungstenite::Message::Text(t)) = msg {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                            if v.get("status").and_then(|s| s.as_str()) == Some("ok") {
                                return;
                            }
                        }
                    }
                }
            })
            .await;
            Ok(SendReceipt { message_id: None })
        })
    }
}

/// One connect cycle: receive inbound messages until error or stop.
async fn run_onebot_loop(inner: &Arc<QqInner>, tx: EventTx) -> Result<(), String> {
    let (mut ws, _) = tokio_tungstenite::connect_async(&inner.cfg.ws_url)
        .await
        .map_err(|e| format!("onebot connect failed: {e}"))?;
    while !inner.stop.load(Ordering::Relaxed) {
        let msg = match ws.next().await {
            Some(Ok(m)) => m,
            Some(Err(e)) => return Err(format!("ws error: {e}")),
            None => return Ok(()),
        };
        if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
            let v: serde_json::Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };
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
            let ev = MessageEvent {
                platform: PlatformId::Qq,
                chat_type,
                chat_id,
                sender_id: sender,
                text,
                message_id,
                reply_to: None,
                media: Vec::new(),
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
