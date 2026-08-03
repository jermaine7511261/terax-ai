//! 微信公众号 (WeChat Official Account) adapter.
//!
//! Official platform: AppID+AppSecret → access_token; inbound messages arrive
//! via the passive callback (SHA-1 signature + AES-256-CBC encrypted XML);
//! outbound replies use the customer-service message API.
//!
//! Reference: LangBot `officialaccount.py`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use chrono::Utc;
use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::modules::gateway::adapter::{
    ChatTarget, EventTx, PlatformAdapter, SendReceipt, SendResult,
};
use crate::modules::gateway::crypto::{constant_time_eq, sha1_hex};
use crate::modules::gateway::message::{ChatType, MessageEvent};
use crate::modules::gateway::platform::PlatformId;
use base64::Engine;

const API_BASE: &str = "https://api.weixin.qq.com/cgi-bin";

type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OfficialAccountConfig {
    pub app_id: String,
    pub app_secret: String,
    pub token: String,
    pub encoding_aes_key: String,
}

pub struct OfficialAccountAdapter {
    inner: Arc<OaInner>,
}

struct OaInner {
    cfg: OfficialAccountConfig,
    stop: Arc<AtomicBool>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    access_token: Mutex<Option<(String, i64)>>,
    /// Local callback URL (bound port), surfaced to the settings UI so the
    /// user can tunnel it as the公众号回调地址.
    callback_url: Mutex<Option<String>>,
    /// Shared HTTP client — reused across token refresh and message sends
    /// instead of dialing a fresh connection pool per request.
    client: reqwest::Client,
}

impl OfficialAccountAdapter {
    pub fn new(cfg: OfficialAccountConfig) -> Self {
        Self {
            inner: Arc::new(OaInner {
                cfg,
                stop: Arc::new(AtomicBool::new(false)),
                task: Mutex::new(None),
                access_token: Mutex::new(None),
                callback_url: Mutex::new(None),
                client: reqwest::Client::new(),
            }),
        }
    }

    async fn get_access_token(&self) -> Result<String, String> {
        if let Some((tok, expires_at)) = &*self.inner.access_token.lock().unwrap() {
            if Utc::now().timestamp() < *expires_at - 60 {
                return Ok(tok.clone());
            }
        }
        let url = format!(
            "{}/token?grant_type=client_credential&appid={}&secret={}",
            API_BASE, self.inner.cfg.app_id, self.inner.cfg.app_secret
        );
        let resp: serde_json::Value = self
            .inner
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("token failed: {e}"))?
            .json()
            .await
            .map_err(|e| format!("token parse failed: {e}"))?;
        let token = resp
            .get("access_token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("token err: {resp}"))?;
        let expires_in = resp.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(7200);
        let expires_at = Utc::now().timestamp() + expires_in;
        *self.inner.access_token.lock().unwrap() = Some((token.to_string(), expires_at));
        Ok(token.to_string())
    }
}

/// WeChat Official Account AES-256-CBC decrypt (PKCS#7).
/// key = 32 bytes (base64(EncodingAESKey+"=")), iv = key[0..16].
fn aes256_cbc_decrypt(key: &[u8], iv: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 || iv.len() != 16 {
        return Err("oa decrypt: bad key/iv length".into());
    }
    Aes256CbcDec::new(key.into(), iv.into())
        .decrypt_padded_vec_mut::<Pkcs7>(ciphertext)
        .map_err(|e| format!("oa decrypt failed: {e}"))
}

/// Verify callback signature: sha1(sort(token, timestamp, nonce)).
fn verify_signature(token: &str, ts: &str, nonce: &str, sig: &str) -> bool {
    let mut parts = vec![token.to_string(), ts.to_string(), nonce.to_string()];
    parts.sort();
    constant_time_eq(&sha1_hex(parts.join("").as_bytes()), sig)
}

/// Decrypt the message body: random(16) + msg_len(4 big-endian) + content + appid.
fn decrypt_msg(encoding_aes_key: &str, encrypt: &str) -> Result<String, String> {
    let padded = format!("{encoding_aes_key}=");
    let key_full = base64::engine::general_purpose::STANDARD
        .decode(padded)
        .map_err(|e| format!("bad encoding_aes_key: {e}"))?;
    if key_full.len() != 32 {
        return Err("encoding_aes_key must decode to 32 bytes".into());
    }
    let cipher = base64::engine::general_purpose::STANDARD
        .decode(encrypt)
        .map_err(|e| format!("bad encrypt: {e}"))?;
    let plain = aes256_cbc_decrypt(&key_full, &key_full[0..16], &cipher)?;
    if plain.len() < 20 {
        return Err("decrypted payload too short".into());
    }
    let msg_len = u32::from_be_bytes([plain[16], plain[17], plain[18], plain[19]]) as usize;
    String::from_utf8(plain[20..20 + msg_len].to_vec()).map_err(|e| format!("bad utf8: {e}"))
}

impl PlatformAdapter for OfficialAccountAdapter {
    fn platform(&self) -> PlatformId {
        PlatformId::OfficialAccount
    }

    fn is_configured(&self) -> bool {
        !self.inner.cfg.app_id.is_empty() && !self.inner.cfg.app_secret.is_empty()
    }

    fn connect(&self, tx: EventTx) -> BoxFuture<'static, Result<(), String>> {
        let this = self.inner.clone();
        Box::pin(async move {
            let stop = this.stop.clone();
            let inner = this.clone();
            let task = tokio::spawn(async move {
                // Passive callback requires a public URL. We bind a local HTTP
                // server so the user can expose/tunnel it as the公众号回调地址.
                let _ = run_oa_callback_server(&inner, tx).await;
                loop {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
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
        let to = target.chat_id.clone();
        let content = text.to_string();
        Box::pin(async move {
            // Customer-service message (only within 48h of user interaction).
            let url = format!("{API_BASE}/message/custom/send");
            let body = serde_json::json!({
                "touser": to,
                "msgtype": "text",
                "text": { "content": content },
            });
            let client = this.client.clone();
            // Refresh token then send.
            let token = {
                // reuse cached token via a short re-fetch
                this.access_token
                    .lock()
                    .unwrap()
                    .clone()
                    .map(|(t, _)| t)
                    .unwrap_or_default()
            };
            let token = if token.is_empty() {
                let resp: serde_json::Value = client
                    .get(&format!(
                        "{API_BASE}/token?grant_type=client_credential&appid={}&secret={}",
                        this.cfg.app_id, this.cfg.app_secret
                    ))
                    .send()
                    .await
                    .map_err(|e| format!("token failed: {e}"))?
                    .json()
                    .await
                    .map_err(|e| format!("token parse failed: {e}"))?;
                let t = resp
                    .get("access_token")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("token err: {resp}"))?;
                let exp = resp.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(7200);
                *this.access_token.lock().unwrap() = Some((t.to_string(), Utc::now().timestamp() + exp));
                t.to_string()
            } else {
                token
            };
            let resp: serde_json::Value = client
                .post(format!("{url}?access_token={token}"))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("custom/send failed: {e}"))?
                .json()
                .await
                .map_err(|e| format!("custom/send parse failed: {e}"))?;
            if resp.get("errcode").and_then(|v| v.as_i64()) != Some(0) {
                return Err(format!("custom/send err: {resp}"));
            }
            Ok(SendReceipt { message_id: None })
        })
    }

    fn callback_url(&self) -> Option<String> {
        self.inner.callback_url.lock().unwrap().clone()
    }
}

/// Minimal passive-callback HTTP server (GET url-verification + POST message).
/// Binds a fixed, predictable port (8788 — matches the tunnel guide) so the
/// user can configure a stable tunnel; falls back to an ephemeral port if the
/// fixed one is taken.
async fn run_oa_callback_server(inner: &Arc<OaInner>, tx: EventTx) -> Result<(), String> {
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:8788").await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("oa callback bind failed: {e}"))?,
    };
    let addr = listener
        .local_addr()
        .map_err(|e| format!("oa callback addr failed: {e}"))?;
    let callback_url = format!("http://{addr}/callback");
    *inner.callback_url.lock().unwrap() = Some(callback_url.clone());
    log::info!("WeChat OA callback server on {addr} — set this URL (tunneled) as the公众号回调地址: {callback_url}");
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
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = Vec::new();
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), sock.read_buf(&mut buf)).await;
            let req = String::from_utf8_lossy(&buf).to_string();
            let body = if req.starts_with("GET ") {
                // URL verification: echo echostr after signature check.
                let sig = qparam(&req, "signature").unwrap_or_default();
                let ts = qparam(&req, "timestamp").unwrap_or_default();
                let nonce = qparam(&req, "nonce").unwrap_or_default();
                let echostr = qparam(&req, "echostr").unwrap_or_default();
                if verify_signature(&token_c, &ts, &nonce, &sig) {
                    format!("{echostr}")
                } else {
                    String::new()
                }
            } else {
                // POST: encrypted XML; decrypt and deliver.
                let encrypt = extract_encrypt(&req);
                if let Some(enc) = encrypt {
                    if let Ok(plain) = decrypt_msg(&aes_key_c, &enc) {
                        if let Ok(ev) = parse_oa_message(&plain) {
                            let _ = tx_c.try_send(ev);
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

fn qparam(req: &str, key: &str) -> Option<String> {
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
    if let Some(e) = qparam(req, "encrypt") {
        return Some(e);
    }
    if let Some(start) = req.find("<Encrypt>") {
        let rest = &req[start + 9..];
        if let Some(end) = rest.find("</Encrypt>") {
            return Some(rest[..end].to_string());
        }
    }
    None
}

/// Parse decrypted XML: FromUserName, MsgType, Content, MsgId.
fn parse_oa_message(xml: &str) -> Result<MessageEvent, String> {
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
    Ok(MessageEvent {
        platform: PlatformId::OfficialAccount,
        chat_type: ChatType::Dm,
        chat_id: from.clone(),
        sender_id: from,
        text: if msg_type == "text" { Some(content) } else { None },
        message_id: if msg_id.is_empty() { None } else { Some(msg_id) },
        reply_to: None,
        media: Vec::new(),
        raw: serde_json::json!({ "xml": xml }),
        timestamp: Utc::now(),
    })
}
