//! 企业微信 (WeCom) platform adapter.
//!
//! Uses the official WeCom API: CorpID + CorpSecret → access_token, inbound
//! messages arrive via the app callback (encrypted AES-CBC), outbound replies
//! go through the application message API.
//!
//! Reference: Hermes `plugins/platforms/wecom/` + LangBot `wecom.py`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};

use crate::modules::gateway::adapter::{
    ChatTarget, EventTx, PlatformAdapter, SendReceipt, SendResult,
};
use crate::modules::gateway::crypto::{aes128_cbc_decrypt, constant_time_eq, sha1_hex};
use crate::modules::gateway::message::{ChatType, MediaItem, MediaKind, MessageEvent};
use crate::modules::gateway::platform::PlatformId;
use base64::Engine;

const API_BASE: &str = "https://qyapi.weixin.qq.com/cgi-bin";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WeComConfig {
    pub corp_id: String,
    pub corp_secret: String,
    pub agent_id: String,
    pub token: String,
    pub encoding_aes_key: String,
}

pub struct WeComAdapter {
    inner: Arc<WeComInner>,
}

struct WeComInner {
    cfg: WeComConfig,
    stop: Arc<AtomicBool>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    access_token: Mutex<Option<(String, i64)>>,
    /// Local callback URL (bound port), surfaced to the settings UI so the
    /// user can tunnel it as the WeCom app callback.
    callback_url: Mutex<Option<String>>,
    /// Shared HTTP client — reused across token refresh and message sends
    /// instead of dialing a fresh connection pool per request.
    client: reqwest::Client,
}

impl WeComInner {
    /// Fetch (or reuse) a valid access_token (~7200s lifetime).
    async fn get_access_token(&self) -> Result<String, String> {
        if let Some((tok, expires_at)) = &*self.access_token.lock().unwrap_or_else(|e| e.into_inner()) {
            if Utc::now().timestamp() < *expires_at - 60 {
                return Ok(tok.clone());
            }
        }
        let url = format!(
            "{}/gettoken?corpid={}&corpsecret={}",
            API_BASE, self.cfg.corp_id, self.cfg.corp_secret
        );
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("gettoken failed: {e}"))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("gettoken parse failed: {e}"))?;
        let token = resp
            .get("access_token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("gettoken err: {}", resp))?;
        let expires_in = resp
            .get("expires_in")
            .and_then(|v| v.as_i64())
            .unwrap_or(7200);
        let expires_at = Utc::now().timestamp() + expires_in;
        *self.access_token.lock().unwrap_or_else(|e| e.into_inner()) = Some((token.to_string(), expires_at));
        Ok(token.to_string())
    }
}

impl WeComAdapter {
    pub fn new(cfg: WeComConfig) -> Self {
        Self {
            inner: Arc::new(WeComInner {
                cfg,
                stop: Arc::new(AtomicBool::new(false)),
                task: Mutex::new(None),
                access_token: Mutex::new(None),
                callback_url: Mutex::new(None),
                client: reqwest::Client::new(),
            }),
        }
    }
}

impl PlatformAdapter for WeComAdapter {
    fn platform(&self) -> PlatformId {
        PlatformId::WeCom
    }

    fn is_configured(&self) -> bool {
        !self.inner.cfg.corp_id.is_empty() && !self.inner.cfg.corp_secret.is_empty()
    }

    fn connect(&self, tx: EventTx) -> BoxFuture<'static, Result<(), String>> {
        let this = self.inner.clone();
        Box::pin(async move {
            let stop = this.stop.clone();
            let inner = this.clone();
            let task = tokio::spawn(async move {
                // WeCom inbound requires a public callback URL; we run a local
                // callback server so the user can tunnel it.
                let _ = run_callback_server(&inner, tx).await;
                loop {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
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
        let to = target.chat_id.clone();
        let agent_id = this.cfg.agent_id.clone();
        let content = text.to_string();
        Box::pin(async move {
            let token = this.get_access_token().await?;
            let url = format!("{API_BASE}/message/send?access_token={token}");
            let body = serde_json::json!({
                "touser": to,
                "msgtype": "text",
                "agentid": agent_id,
                "text": { "content": content },
            });
            let resp: serde_json::Value = this
                .client
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("message/send failed: {e}"))?
                .json()
                .await
                .map_err(|e| format!("message/send parse failed: {e}"))?;
            if resp.get("errcode").and_then(|v| v.as_i64()) != Some(0) {
                return Err(format!("message/send err: {resp}"));
            }
            Ok(SendReceipt {
                message_id: resp.get("msgid").and_then(|v| v.as_str()).map(String::from),
            })
        })
    }

    fn callback_url(&self) -> Option<String> {
        self.inner.callback_url.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// Verify the callback signature: sha1(sort(token, timestamp, nonce, encrypt)).
fn verify_cb_signature(token: &str, ts: &str, nonce: &str, encrypt: &str, sig: &str) -> bool {
    let mut parts = vec![token.to_string(), ts.to_string(), nonce.to_string(), encrypt.to_string()];
    parts.sort();
    let joined = parts.join("");
    constant_time_eq(&sha1_hex(joined.as_bytes()), sig)
}

/// Decrypt a WeCom callback message.
fn decrypt_cb_msg(encoding_aes_key: &str, encrypt: &str) -> Result<String, String> {
    let padded = format!("{encoding_aes_key}=");
    let key_full = base64::engine::general_purpose::STANDARD
        .decode(padded)
        .map_err(|e| format!("bad encoding_aes_key: {e}"))?;
    if key_full.len() != 32 {
        return Err("encoding_aes_key must decode to 32 bytes".into());
    }
    let key = &key_full[0..16];
    let iv = &key_full[0..16];
    let cipher = base64::engine::general_purpose::STANDARD
        .decode(encrypt)
        .map_err(|e| format!("bad encrypt: {e}"))?;
    let plain = aes128_cbc_decrypt(key, iv, &cipher)?;
    if plain.len() < 20 {
        return Err("decrypted payload too short".into());
    }
    let msg_len = u32::from_be_bytes([plain[16], plain[17], plain[18], plain[19]]) as usize;
    let msg = &plain[20..20 + msg_len];
    String::from_utf8(msg.to_vec()).map_err(|e| format!("bad utf8: {e}"))
}

/// Minimal callback HTTP server: GET URL-verification, POST encrypted message.
/// Binds a fixed, predictable port (8787 — matches the tunnel guide) so the
/// user can configure a stable tunnel; falls back to an ephemeral port if the
/// fixed one is taken.
async fn run_callback_server(inner: &Arc<WeComInner>, tx: EventTx) -> Result<(), String> {
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:8787").await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("callback bind failed: {e}"))?,
    };
    let addr = listener
        .local_addr()
        .map_err(|e| format!("callback addr failed: {e}"))?;
    let callback_url = format!("http://{addr}/callback");
    *inner.callback_url.lock().unwrap_or_else(|e| e.into_inner()) = Some(callback_url.clone());
    log::info!("WeCom callback server listening on {addr} — configure this URL as the app's callback (tunnel to public if needed): {callback_url}");
    let token = inner.cfg.token.clone();
    let aes_key = inner.cfg.encoding_aes_key.clone();
    loop {
        if inner.stop.load(Ordering::Relaxed) {
            break;
        }
        let (mut sock, _) = match listener.accept().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        let token_c = token.clone();
        let aes_key_c = aes_key.clone();
        let tx_c = tx.clone();
        let client_c = inner.client.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = Vec::new();
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                sock.read_buf(&mut buf),
            )
            .await;
            let req = String::from_utf8_lossy(&buf).to_string();
            let body = if req.starts_with("GET ") {
                let echo = parse_query(&req, "echostr").unwrap_or_default();
                format!("{echo}")
            } else {
                let encrypt = extract_encrypt(&req);
                if let Some(enc) = encrypt {
                    let (ts, nonce, sig) = extract_cb_meta(&req);
                    if verify_cb_signature(&token_c, &ts, &nonce, &enc, &sig) {
                        if let Ok(plain) = decrypt_cb_msg(&aes_key_c, &enc) {
                            if let Ok(mut msg) = parse_cb_message(&plain) {
                                // Resolve PicUrl media downloads (skip MediaId which needs API).
                                super::media::download_media_items(
                                    &client_c,
                                    &mut msg.media,
                                    "wecom",
                                ).await;
                                let _ = tx_c.try_send(msg);
                            }
                        }
                    }
                }
                String::new()
            };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = sock.write_all(resp.as_bytes()).await;
        });
    }
    Ok(())
}

fn parse_query(req: &str, key: &str) -> Option<String> {
    let path = req.split(' ').nth(1)?;
    let q = path.split('?').nth(1)?;
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        if it.next()? == key {
            return url::form_urlencoded::parse(it.next()?.as_bytes())
                .next()
                .map(|(_, v)| v.into_owned());
        }
    }
    None
}

fn extract_encrypt(req: &str) -> Option<String> {
    if let Some(e) = parse_query(req, "encrypt") {
        return Some(e);
    }
    if let Some(start) = req.find("\"encrypt\":\"") {
        let rest = &req[start + 11..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    None
}

fn extract_cb_meta(req: &str) -> (String, String, String) {
    (
        parse_query(req, "timestamp").unwrap_or_default(),
        parse_query(req, "nonce").unwrap_or_default(),
        parse_query(req, "msg_signature").unwrap_or_default(),
    )
}

/// Parse the decrypted XML message into a MessageEvent.
fn parse_cb_message(xml: &str) -> Result<MessageEvent, String> {
    let get = |tag: &str| -> String {
        let open = format!("<{tag}>");
        let close = format!("</{tag}>");
        if let (Some(a), Some(b)) = (xml.find(&open), xml.find(&close)) {
            if b > a {
                return xml[a + open.len()..b].to_string();
            }
        }
        String::new()
    };
    let from = get("FromUserName");
    let msg_type = get("MsgType");
    let content = get("Content");
    let msg_id = get("MsgId");
    let media_id = get("MediaId");
    let pic_url = get("PicUrl");
    Ok(MessageEvent {
        platform: PlatformId::WeCom,
        chat_type: ChatType::Dm,
        chat_id: from.clone(),
        sender_id: from,
        text: if msg_type == "text" { Some(content) } else { None },
        message_id: if msg_id.is_empty() { None } else { Some(msg_id) },
        reply_to: None,
        media: build_media(&msg_type, &media_id, &pic_url),
        raw: serde_json::json!({ "xml": xml }),
        timestamp: Utc::now(),
    })
}

/// Build a media item for a non-text callback message. `PicUrl` (image) is
/// directly fetchable; `MediaId` requires the corp `media/get` API, so the raw
/// id is carried in `url` for the consumer to resolve.
fn build_media(msg_type: &str, media_id: &str, pic_url: &str) -> Vec<MediaItem> {
    if msg_type == "text" {
        return Vec::new();
    }
    let kind = match msg_type {
        "image" => MediaKind::Image,
        "voice" => MediaKind::Voice,
        "video" => MediaKind::Video,
        "file" => MediaKind::File,
        _ => return Vec::new(),
    };
    let url = if !pic_url.is_empty() {
        pic_url.to_string()
    } else if !media_id.is_empty() {
        media_id.to_string()
    } else {
        return Vec::new();
    };
    vec![MediaItem {
        kind,
        url: Some(url),
        name: None,
        size: None,
        encrypted_query: None,
        local_path: None,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_media_text_is_empty() {
        assert!(build_media("text", "m1", "").is_empty());
    }

    #[test]
    fn build_media_prefers_pic_url_over_media_id() {
        let media = build_media("image", "media-1", "https://x/p.png");
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].kind, MediaKind::Image);
        assert_eq!(media[0].url.as_deref(), Some("https://x/p.png"));
    }

    #[test]
    fn build_media_falls_back_to_media_id() {
        let media = build_media("file", "media-2", "");
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].kind, MediaKind::File);
        assert_eq!(media[0].url.as_deref(), Some("media-2"));
    }

    #[test]
    fn build_media_unknown_type_is_empty() {
        assert!(build_media("event", "", "").is_empty());
    }
}
