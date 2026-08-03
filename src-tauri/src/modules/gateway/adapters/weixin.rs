//! Weixin personal-account adapter (Tencent iLink Bot API).
//!
//! This is a faithful Rust port of the iLink protocol from Hermes'
//! `gateway/platforms/weixin.py`:
//!
//! - Inbound delivery is driven by **long-polling** `ilink/bot/getupdates`
//!   (35s server timeout); every response's `get_updates_buf` is saved and
//!   echoed back on the next poll.
//! - Outbound replies use `ilink/bot/sendmessage` and **must echo the latest
//!   `context_token`** received from the peer.
//! - Login is a **QR-code flow**: fetch a QR with `get_bot_qrcode`, poll
//!   `get_qrcode_status` until `confirmed`, then use the issued `bot_token`.
//! - Session expiry (`errcode = -14`, or `-2` with errmsg `"unknown error"`)
//!   triggers an automatic QR **re-login**; genuine rate-limit `-2` backs off
//!   exponentially and retries.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use chrono::Utc;
use futures_util::future::BoxFuture;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::task::JoinHandle;

use crate::modules::gateway::adapter::{ChatTarget, EventTx, PlatformAdapter, SendReceipt, SendResult};
use crate::modules::gateway::message::{ChatType, MediaItem, MessageEvent};
use crate::modules::gateway::platform::PlatformId;

// --- iLink protocol constants (mirror weixin.py) ----------------------------

pub const ILINK_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
const ILINK_APP_ID: &str = "bot";
/// (2 << 16) | (2 << 8) | 0 = 0x20200 = 131584
const ILINK_APP_CLIENT_VERSION: u64 = 0x20200;
const CHANNEL_VERSION: &str = "2.2.0";

const EP_GET_UPDATES: &str = "ilink/bot/getupdates";
const EP_SEND_MESSAGE: &str = "ilink/bot/sendmessage";
/// Kept for protocol completeness; typing delivery is not part of send_text.
#[allow(dead_code)]
const EP_SEND_TYPING: &str = "ilink/bot/sendtyping";
#[allow(dead_code)]
const EP_GET_CONFIG: &str = "ilink/bot/getconfig";
const EP_GET_BOT_QR: &str = "ilink/bot/get_bot_qrcode";
const EP_GET_QR_STATUS: &str = "ilink/bot/get_qrcode_status";

const LONG_POLL_TIMEOUT_MS: u64 = 35_000;
const API_TIMEOUT_MS: u64 = 15_000;
#[allow(dead_code)]
const CONFIG_TIMEOUT_MS: u64 = 10_000;
const QR_TIMEOUT_MS: u64 = 35_000;

const RETRY_DELAY_SECONDS: u64 = 2;
const BACKOFF_DELAY_SECONDS: u64 = 30;
const MAX_CONSECUTIVE_FAILURES: u32 = 3;

/// Session-expired signal.
const SESSION_EXPIRED_ERRCODE: i64 = -14;
/// Frequency limit — back off and retry.
const RATE_LIMIT_ERRCODE: i64 = -2;

const ITEM_TEXT: i64 = 1;
const MSG_TYPE_BOT: i64 = 2;
const MSG_STATE_FINISH: i64 = 2;

/// True when iLink returns ret=-2 / errcode=-2 with errmsg `"unknown error"`,
/// which is a stale-session signal (same as errcode=-14) rather than a real
/// rate limit.
fn is_stale_session_ret(ret: Option<i64>, errcode: Option<i64>, errmsg: Option<&str>) -> bool {
    if ret != Some(RATE_LIMIT_ERRCODE) && errcode != Some(RATE_LIMIT_ERRCODE) {
        return false;
    }
    errmsg.unwrap_or("").trim().to_ascii_lowercase() == "unknown error"
}

fn is_err(value: Option<i64>) -> bool {
    matches!(value, Some(v) if v != 0)
}

/// Random `X-WECHAT-UIN` header value: base64 of the decimal string of a random u32.
fn random_wechat_uin() -> String {
    use rand::Rng;
    let n = rand::thread_rng().gen::<u32>();
    base64::engine::general_purpose::STANDARD.encode(n.to_string())
}

/// The base_info object flattened into every POST body.
fn base_info() -> Value {
    json!({ "channel_version": CHANNEL_VERSION })
}

/// iLink request headers (mirrors weixin.py `_headers`).
fn headers(token: Option<&str>, body: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    h.insert(
        "AuthorizationType",
        HeaderValue::from_static("ilink_bot_token"),
    );
    h.insert(
        "X-WECHAT-UIN",
        HeaderValue::from_str(&random_wechat_uin()).unwrap_or_else(|_| HeaderValue::from_static("")),
    );
    h.insert("iLink-App-Id", HeaderValue::from_static(ILINK_APP_ID));
    h.insert(
        "iLink-App-ClientVersion",
        HeaderValue::from_str(&ILINK_APP_CLIENT_VERSION.to_string()).expect("valid header"),
    );
    if let Some(tok) = token {
        if !tok.is_empty() {
            let bearer = format!("Bearer {tok}");
            h.insert("Authorization", HeaderValue::from_str(&bearer).expect("valid header"));
        }
    }
    let _ = body;
    h
}

/// Headers for token-less GET calls (QR flow).
fn get_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("iLink-App-Id", HeaderValue::from_static(ILINK_APP_ID));
    h.insert(
        "iLink-App-ClientVersion",
        HeaderValue::from_str(&ILINK_APP_CLIENT_VERSION.to_string()).expect("valid header"),
    );
    h
}

/// POST to an iLink endpoint. Body = payload flattened with `base_info`.
async fn api_post(
    client: &reqwest::Client,
    base_url: &str,
    endpoint: &str,
    payload: Value,
    token: Option<&str>,
    timeout_ms: u64,
) -> Result<Value, String> {
    let body = {
        let mut obj = payload;
        if let Value::Object(map) = &mut obj {
            map.insert("base_info".to_string(), base_info());
        }
        obj.to_string()
    };
    let url = format!("{}/{}", base_url.trim_end_matches('/'), endpoint);
    let resp = client
        .post(&url)
        .headers(headers(token, &body))
        .body(body)
        .timeout(Duration::from_millis(timeout_ms))
        .send()
        .await
        .map_err(|e| format!("iLink POST {endpoint}: {e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("iLink POST {endpoint} read body: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "iLink POST {endpoint} HTTP {status}: {}",
            &text[..text.len().min(200)]
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("iLink POST {endpoint} bad json: {e}"))
}

/// GET an iLink endpoint (token-less; used by the QR flow).
async fn api_get(
    client: &reqwest::Client,
    base_url: &str,
    endpoint: &str,
    timeout_ms: u64,
) -> Result<Value, String> {
    let url = format!("{}/{}", base_url.trim_end_matches('/'), endpoint);
    let resp = client
        .get(&url)
        .headers(get_headers())
        .timeout(Duration::from_millis(timeout_ms))
        .send()
        .await
        .map_err(|e| format!("iLink GET {endpoint}: {e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("iLink GET {endpoint} read body: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "iLink GET {endpoint} HTTP {status}: {}",
            &text[..text.len().min(200)]
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("iLink GET {endpoint} bad json: {e}"))
}

/// Long-poll `getupdates`. On timeout returns an empty success frame that keeps
/// the current sync buffer (mirrors weixin.py `_get_updates`).
async fn get_updates(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    sync_buf: &str,
    timeout_ms: u64,
) -> Result<Value, String> {
    // +5s headroom so the server's long-poll timeout wins and we treat a
    // clean timeout as "no messages" rather than a connection error.
    let timeout_budget = Duration::from_millis(timeout_ms + 5000);
    match tokio::time::timeout(
        timeout_budget,
        api_post(
            client,
            base_url,
            EP_GET_UPDATES,
            json!({ "get_updates_buf": sync_buf }),
            Some(token),
            timeout_ms,
        ),
    )
    .await
    {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e),
        Err(_) => Ok(json!({ "ret": 0, "msgs": [], "get_updates_buf": sync_buf })),
    }
}

/// Send a text message (mirrors weixin.py `_send_message`).
async fn send_message(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    to: &str,
    text: &str,
    context_token: Option<&str>,
    client_id: &str,
) -> Result<Value, String> {
    if text.trim().is_empty() {
        return Err("_send_message: text must not be empty".into());
    }
    let mut message = json!({
        "from_user_id": "",
        "to_user_id": to,
        "client_id": client_id,
        "message_type": MSG_TYPE_BOT,
        "message_state": MSG_STATE_FINISH,
        "item_list": [{"type": ITEM_TEXT, "text_item": {"text": text}}],
    });
    if let Some(tok) = context_token {
        if !tok.is_empty() {
            message["context_token"] = json!(tok);
        }
    }
    api_post(
        client,
        base_url,
        EP_SEND_MESSAGE,
        json!({ "msg": message }),
        Some(token),
        API_TIMEOUT_MS,
    )
    .await
}

/// Guess the chat type / effective chat id for an inbound message
/// (mirrors weixin.py `_guess_chat_type`).
fn guess_chat_type(message: &Value, account_id: &str) -> (ChatType, String) {
    let room_id = message
        .get("room_id")
        .or_else(|| message.get("chat_room_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);
    let to_user_id = message
        .get("to_user_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let from_user_id = message
        .get("from_user_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let msg_type = message.get("msg_type").and_then(Value::as_i64);
    let is_group = room_id.is_some()
        || (!to_user_id.is_empty()
            && !account_id.is_empty()
            && to_user_id != account_id
            && msg_type == Some(1));
    if is_group {
        let cid = room_id
            .or_else(|| {
                if to_user_id.is_empty() {
                    None
                } else {
                    Some(to_user_id.to_string())
                }
            })
            .unwrap_or_else(|| from_user_id.to_string());
        (ChatType::Group, cid)
    } else {
        (ChatType::Dm, from_user_id.to_string())
    }
}

/// Extract the plain text from `item_list` (mirrors weixin.py `_extract_text`).
fn extract_text(item_list: &Value) -> String {
    if let Some(items) = item_list.as_array() {
        for item in items {
            if item.get("type").and_then(Value::as_i64) == Some(ITEM_TEXT) {
                let text = item
                    .get("text_item")
                    .and_then(|t| t.get("text"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                return text.to_string();
            }
        }
    }
    String::new()
}

// --- Config + adapter --------------------------------------------------------

/// Weixin configuration. `token`/`account_id` come from a successful QR login
/// (or are injected from settings).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeixinConfig {
    pub base_url: String,
    pub token: String,
    pub account_id: String,
}

impl Default for WeixinConfig {
    fn default() -> Self {
        Self {
            base_url: ILINK_BASE_URL.to_string(),
            token: String::new(),
            account_id: String::new(),
        }
    }
}

/// Interior (shareable) state of the adapter. Kept behind an `Arc<Inner>` so
/// `connect(&self)` can hand a clone of the same state to the spawned poll task.
struct Inner {
    cfg: WeixinConfig,
    /// Live auth token — may be replaced by a QR re-login after session expiry.
    token: Mutex<String>,
    /// Live base url — may be redirected by the QR flow's `baseurl`.
    base_url: Mutex<String>,
    stop: AtomicBool,
    task: Mutex<Option<JoinHandle<()>>>,
    /// Peer (chat id) -> latest context_token echo.
    context_tokens: Mutex<HashMap<String, String>>,
    /// Persisted across reconnects so a fresh poll continues from the last sync point.
    sync_buf: Mutex<String>,
    client: reqwest::Client,
}

pub struct WeixinAdapter {
    inner: Arc<Inner>,
}

impl WeixinAdapter {
    pub fn new(cfg: WeixinConfig) -> Self {
        let client = reqwest::Client::builder()
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            inner: Arc::new(Inner {
                token: Mutex::new(cfg.token.clone()),
                base_url: Mutex::new(cfg.base_url.clone()),
                cfg,
                stop: AtomicBool::new(false),
                task: Mutex::new(None),
                context_tokens: Mutex::new(HashMap::new()),
                sync_buf: Mutex::new(String::new()),
                client,
            }),
        }
    }

    fn token(&self) -> String {
        self.inner.token.lock().unwrap().clone()
    }

    fn base_url(&self) -> String {
        self.inner.base_url.lock().unwrap().clone()
    }

    /// Run the interactive iLink QR login flow. Returns the credential triple
    /// (account_id, token, base_url) on success, or `None` on failure/timeout.
    async fn qr_login(&self) -> Option<(String, String, String)> {
        let bot_type = "3";
        let qr_resp = api_get(
            &self.inner.client,
            ILINK_BASE_URL,
            &format!("{EP_GET_BOT_QR}?bot_type={bot_type}"),
            QR_TIMEOUT_MS,
        )
        .await
        .ok()?;

        let qrcode_value = qr_resp
            .get("qrcode")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if qrcode_value.is_empty() {
            log::error!("weixin: QR response missing qrcode");
            return None;
        }

        let deadline = tokio::time::Instant::now() + Duration::from_secs(480);
        let mut current_base_url = ILINK_BASE_URL.to_string();
        let mut refresh_count: u32 = 0;
        let mut qrcode_value = qrcode_value;

        loop {
            if tokio::time::Instant::now() >= deadline {
                log::error!("weixin: QR login timed out");
                return None;
            }
            let status_resp = match api_get(
                &self.inner.client,
                &current_base_url,
                &format!("{EP_GET_QR_STATUS}?qrcode={qrcode_value}"),
                QR_TIMEOUT_MS,
            )
            .await
            {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("weixin: QR poll error: {e}");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };

            let status = status_resp
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("wait");
            match status {
                "scaned_but_redirect" => {
                    if let Some(host) = status_resp.get("redirect_host").and_then(Value::as_str) {
                        if !host.is_empty() {
                            current_base_url = format!("https://{host}");
                        }
                    }
                }
                "expired" => {
                    refresh_count += 1;
                    if refresh_count > 3 {
                        log::error!("weixin: QR expired too many times");
                        return None;
                    }
                    log::info!("weixin: QR expired, refreshing ({refresh_count}/3)");
                    let new_qr = api_get(
                        &self.inner.client,
                        ILINK_BASE_URL,
                        &format!("{EP_GET_BOT_QR}?bot_type={bot_type}"),
                        QR_TIMEOUT_MS,
                    )
                    .await
                    .ok()?;
                    let new_qr = new_qr
                        .get("qrcode")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if new_qr.is_empty() {
                        return None;
                    }
                    qrcode_value = new_qr;
                    current_base_url = ILINK_BASE_URL.to_string();
                }
                "confirmed" => {
                    let account_id = status_resp
                        .get("ilink_bot_id")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let token = status_resp
                        .get("bot_token")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let base_url = status_resp
                        .get("baseurl")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .unwrap_or(ILINK_BASE_URL)
                        .to_string();
                    if account_id.is_empty() || token.is_empty() {
                        log::error!("weixin: QR confirmed but credential payload incomplete");
                        return None;
                    }
                    log::info!("weixin: QR login confirmed account_id={account_id}");
                    return Some((account_id, token, base_url));
                }
                _ => { /* "wait" / "scaned" — keep polling */ }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    async fn poll_loop(&self, tx: EventTx) {
        let mut consecutive_failures: u32 = 0;
        let mut timeout_ms = LONG_POLL_TIMEOUT_MS;

        while !self.inner.stop.load(Ordering::SeqCst) {
            let base_url = self.base_url();
            let token = self.token();
            let sync_buf = self.inner.sync_buf.lock().unwrap().clone();

            match get_updates(&self.inner.client, &base_url, &token, &sync_buf, timeout_ms).await {
                Ok(response) => {
                    // Server may suggest a long-poll timeout.
                    if let Some(st) = response.get("longpolling_timeout_ms").and_then(Value::as_i64) {
                        if st > 0 {
                            timeout_ms = st as u64;
                        }
                    }

                    let ret = response.get("ret").and_then(Value::as_i64);
                    let errcode = response.get("errcode").and_then(Value::as_i64);
                    let errmsg = response.get("errmsg").and_then(Value::as_str);
                    if is_err(ret) || is_err(errcode) {
                        let session_expired = ret == Some(SESSION_EXPIRED_ERRCODE)
                            || errcode == Some(SESSION_EXPIRED_ERRCODE)
                            || is_stale_session_ret(ret, errcode, errmsg);
                        if session_expired {
                            log::error!(
                                "weixin: session expired (ret={ret:?} errcode={errcode:?}); re-logging in via QR"
                            );
                            match self.qr_login().await {
                                Some((_account_id, new_token, new_base)) => {
                                    log::info!("weixin: re-login OK, refreshing token/base");
                                    *self.inner.token.lock().unwrap() = new_token;
                                    *self.inner.base_url.lock().unwrap() = new_base;
                                    consecutive_failures = 0;
                                    continue;
                                }
                                None => {
                                    log::error!("weixin: re-login failed; backing off");
                                    tokio::time::sleep(Duration::from_secs(BACKOFF_DELAY_SECONDS)).await;
                                    consecutive_failures = 0;
                                    continue;
                                }
                            }
                        }

                        consecutive_failures += 1;
                        log::warn!(
                            "weixin: getUpdates failed ret={ret:?} errcode={errcode:?} errmsg={errmsg:?} ({} / MAX)",
                            consecutive_failures
                        );
                        let delay = if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                            consecutive_failures = 0;
                            BACKOFF_DELAY_SECONDS
                        } else {
                            RETRY_DELAY_SECONDS
                        };
                        tokio::time::sleep(Duration::from_secs(delay)).await;
                        continue;
                    }

                    consecutive_failures = 0;
                    let new_sync_buf = response.get("get_updates_buf").and_then(Value::as_str).unwrap_or("");
                    if !new_sync_buf.is_empty() {
                        *self.inner.sync_buf.lock().unwrap() = new_sync_buf.to_string();
                    }

                    if let Some(msgs) = response.get("msgs").and_then(Value::as_array) {
                        let account_id = self.inner.cfg.account_id.clone();
                        for message in msgs {
                            self.handle_inbound(&tx, message, &account_id).await;
                        }
                    }
                }
                Err(e) => {
                    consecutive_failures += 1;
                    log::error!(
                        "weixin: poll error ({}/{MAX}): {e}",
                        consecutive_failures,
                        MAX = MAX_CONSECUTIVE_FAILURES
                    );
                    let delay = if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                        consecutive_failures = 0;
                        BACKOFF_DELAY_SECONDS
                    } else {
                        RETRY_DELAY_SECONDS
                    };
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                }
            }
        }
    }

    async fn handle_inbound(&self, tx: &EventTx, message: &Value, account_id: &str) {
        let sender_id = message
            .get("from_user_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        if sender_id.is_empty() || (!account_id.is_empty() && sender_id == account_id) {
            return;
        }

        let message_id = message
            .get("message_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .to_string();

        // Store the latest context_token for this peer (echo on outbound).
        if let Some(ct) = message.get("context_token").and_then(Value::as_str) {
            let ct = ct.trim().to_string();
            if !ct.is_empty() {
                self.inner
                    .context_tokens
                    .lock()
                    .unwrap()
                    .insert(sender_id.clone(), ct);
            }
        }

        let (chat_type, chat_id) = guess_chat_type(message, account_id);
        let text = extract_text(&message.get("item_list").cloned().unwrap_or(Value::Null));
        if text.is_empty() {
            return;
        }

        let event = MessageEvent {
            platform: PlatformId::Weixin,
            chat_type,
            chat_id,
            sender_id,
            text: Some(text),
            message_id: if message_id.is_empty() { None } else { Some(message_id) },
            reply_to: None,
            media: Vec::<MediaItem>::new(),
            raw: message.clone(),
            timestamp: Utc::now(),
        };

        if tx.send(event).await.is_err() {
            // Receiver dropped — stop polling.
            self.inner.stop.store(true, Ordering::SeqCst);
        }
    }
}

impl PlatformAdapter for WeixinAdapter {
    fn platform(&self) -> PlatformId {
        PlatformId::Weixin
    }

    fn is_configured(&self) -> bool {
        !self.token().is_empty()
    }

    fn connect(&self, tx: EventTx) -> BoxFuture<'static, Result<(), String>> {
        let token = self.token();
        let inner = self.inner.clone();
        Box::pin(async move {
            if token.is_empty() {
                return Err("weixin not configured (no token)".into());
            }
            inner.stop.store(false, Ordering::SeqCst);
            let me = inner.clone();
            let handle = tokio::spawn(async move {
                let adapter = WeixinAdapter { inner: me };
                adapter.poll_loop(tx).await;
            });
            *inner.task.lock().unwrap() = Some(handle);
            Ok(())
        })
    }

    fn disconnect(&self) {
        self.inner.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.inner.task.lock().unwrap().take() {
            handle.abort();
        }
    }

    fn send_text(&self, target: &ChatTarget, text: &str) -> BoxFuture<'static, SendResult> {
        // Own all data up front so the returned future does not borrow
        // `self`/`target`/`text` across the trait's elided lifetime.
        let inner = self.inner.clone();
        let chat_id = target.chat_id.clone();
        let text = text.to_string();
        Box::pin(async move {
            let token = inner.token.lock().unwrap().clone();
            if token.is_empty() {
                return Err("weixin not connected (no token)".into());
            }
            let base_url = inner.base_url.lock().unwrap().clone();
            let context_token = inner.context_tokens.lock().unwrap().get(&chat_id).cloned();

            let client_id = format!("weixin-{}", hex::encode(rand::random::<[u8; 16]>()));

            // Single attempt with session-expired token-strip retry and
            // rate-limit exponential backoff (mirrors weixin.py).
            let mut context_token = context_token;
            let mut retried_without_token = false;
            let mut attempt: u32 = 0;
            let mut last_error: Option<String> = None;
            const MAX_ATTEMPTS: u32 = 4;

            loop {
                if attempt >= MAX_ATTEMPTS {
                    return Err(last_error.unwrap_or_else(|| "weixin send failed".into()));
                }
                match send_message(
                    &inner.client,
                    &base_url,
                    &token,
                    &chat_id,
                    &text,
                    context_token.as_deref(),
                    &client_id,
                )
                .await
                {
                    Ok(resp) => {
                        let ret = resp.get("ret").and_then(Value::as_i64);
                        let errcode = resp.get("errcode").and_then(Value::as_i64);
                        let errmsg = resp
                            .get("errmsg")
                            .or_else(|| resp.get("msg"))
                            .and_then(Value::as_str);

                        if !is_err(ret) && !is_err(errcode) {
                            return Ok(SendReceipt {
                                message_id: Some(client_id.clone()),
                            });
                        }

                        let session_expired = ret == Some(SESSION_EXPIRED_ERRCODE)
                            || errcode == Some(SESSION_EXPIRED_ERRCODE)
                            || is_stale_session_ret(ret, errcode, errmsg);
                        if session_expired {
                            if !retried_without_token && context_token.is_some() {
                                retried_without_token = true;
                                context_token = None;
                                inner.context_tokens.lock().unwrap().remove(&chat_id);
                                log::warn!("weixin: session expired for {chat_id}; retrying without context_token");
                                continue;
                            }
                            return Err(format!(
                                "weixin send session expired (ret={ret:?} errcode={errcode:?})"
                            ));
                        }

                        let rate_limited =
                            ret == Some(RATE_LIMIT_ERRCODE) || errcode == Some(RATE_LIMIT_ERRCODE);
                        if rate_limited {
                            last_error = Some(format!(
                                "iLink sendmessage rate limited: ret={ret:?} errcode={errcode:?} errmsg={errmsg:?}"
                            ));
                            attempt += 1;
                            // 3x exponential backoff for rate limit
                            let wait = Duration::from_secs(2u64.saturating_pow(attempt)) * 3;
                            log::warn!("weixin: rate limited for {chat_id}; backing off {}s", wait.as_secs());
                            tokio::time::sleep(wait).await;
                            continue;
                        }

                        return Err(format!(
                            "iLink sendmessage error: ret={ret:?} errcode={errcode:?} errmsg={errmsg:?}"
                        ));
                    }
                    Err(e) => {
                        last_error = Some(e);
                        attempt += 1;
                        let wait = Duration::from_secs(2u64.saturating_pow(attempt));
                        log::warn!(
                            "weixin: send chunk failed to={chat_id} attempt={attempt}/{MAX_ATTEMPTS}, retrying in {}s",
                            wait.as_secs()
                        );
                        tokio::time::sleep(wait).await;
                    }
                }
            }
        })
    }
}
