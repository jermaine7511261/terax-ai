//! Gateway registry: owns the platform adapters, dispatches inbound events to
//! the agent handler, and fans out outbound sends. Mirrors Hermes
//! `gateway/platform_registry.py` + the `GatewayRunner` event loop.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;

use super::adapter::{ChatTarget, PlatformAdapter, PlatformEventSink, SendResult};
use super::message::MessageEvent;
use super::platform::PlatformId;
use super::session::SessionRouter;

/// Inbound event handler, installed by the Tauri layer to route into the agent.
pub type EventHandler = Arc<dyn Fn(MessageEvent) + Send + Sync>;

/// Out-of-band platform events (re-login QR, status changes) fanned out to the
/// frontend. `(platform_id, serializable payload)`.
pub type PlatformEventHandler = Arc<dyn Fn(String, serde_json::Value) + Send + Sync>;

/// Per-platform token bucket for inbound rate limiting: bursts of up to
/// `RATE_CAPACITY` events pass, then refill at `RATE_REFILL_PER_SEC`.
#[derive(Default)]
struct TokenBucket {
    tokens: f64,
    last: Option<Instant>,
}

impl TokenBucket {
    fn allow(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = self
            .last
            .map(|t| now.duration_since(t).as_secs_f64())
            .unwrap_or(0.0);
        self.tokens = (self.tokens + elapsed * RATE_REFILL_PER_SEC).min(RATE_CAPACITY);
        self.last = Some(now);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

const RATE_CAPACITY: f64 = 20.0;
const RATE_REFILL_PER_SEC: f64 = 10.0;
/// message_id dedup: drop repeats within this window.
const DEDUP_WINDOW_MS: u64 = 300_000;
const DEDUP_CAP: usize = 4096;

#[derive(Clone)]
pub struct GatewayRegistry {
    inner: Arc<Inner>,
}

struct Inner {
    adapters: Mutex<HashMap<PlatformId, Arc<dyn PlatformAdapter>>>,
    sessions: SessionRouter,
    handler: Mutex<Option<EventHandler>>,
    /// Fired when a new un-authorized session appears, with the session key and
    /// a sender+text summary so the approval UI shows who/what was dropped.
    on_pending: Mutex<Option<Arc<dyn Fn(String, Option<String>) + Send + Sync>>>,
    /// Fired after a platform's inbound loop connects, with the platform id
    /// and its local callback URL (empty for non-callback platforms). Lets the
    /// settings UI surface "paste this into the platform admin console".
    on_connected: Mutex<Option<Arc<dyn Fn(String, Option<String>) + Send + Sync>>>,
    /// Out-of-band platform events (e.g. Weixin background re-login QR frames).
    platform_event: Mutex<Option<PlatformEventHandler>>,
    connected: Mutex<HashSet<PlatformId>>,
    /// Platforms whose connect is currently in flight — guards against
    /// re-entrant connect_platform calls while an inbound loop is still
    /// establishing.
    connecting: Mutex<HashSet<PlatformId>>,
    /// message_id -> received_at_ms, for duplicate suppression.
    seen: Mutex<HashMap<String, u64>>,
    /// per-platform inbound rate buckets.
    rates: Mutex<HashMap<PlatformId, TokenBucket>>,
}

impl GatewayRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                adapters: Mutex::new(HashMap::new()),
                sessions: SessionRouter::new(),
                handler: Mutex::new(None),
                on_pending: Mutex::new(None),
                on_connected: Mutex::new(None),
                platform_event: Mutex::new(None),
                connected: Mutex::new(HashSet::new()),
                connecting: Mutex::new(HashSet::new()),
                seen: Mutex::new(HashMap::new()),
                rates: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn register(&self, adapter: Box<dyn PlatformAdapter>) {
        self.inner
            .adapters
            .lock()
            .unwrap()
            .insert(adapter.platform(), Arc::from(adapter));
    }

    pub fn set_handler(&self, handler: EventHandler) {
        *self.inner.handler.lock().unwrap() = Some(handler);
    }

    /// Register a callback fired when a new un-authorized session appears,
    /// with the session key and an optional `sender: text` summary (so the
    /// frontend approval UI shows what was dropped instead of losing it).
    pub fn set_on_pending(&self, cb: Arc<dyn Fn(String, Option<String>) + Send + Sync>) {
        *self.inner.on_pending.lock().unwrap() = Some(cb);
    }

    /// Register a callback fired when a platform's inbound loop connects.
    pub fn set_on_connected(&self, cb: Arc<dyn Fn(String, Option<String>) + Send + Sync>) {
        *self.inner.on_connected.lock().unwrap() = Some(cb);
    }

    /// Register the out-of-band platform event fan-out. Every adapter that uses
    /// `set_event_sink` will receive a sink forwarding into this callback.
    pub fn set_platform_event(&self, cb: PlatformEventHandler) {
        *self.inner.platform_event.lock().unwrap() = Some(cb);
    }

    /// Build a sink for one adapter that forwards into the global
    /// `platform_event` callback, if one is installed.
    fn sink_for(&self, platform: PlatformId) -> Option<PlatformEventSink> {
        let cb = self.inner.platform_event.lock().unwrap().clone()?;
        Some(Arc::new(move |payload| cb(platform.as_str().to_string(), payload)))
    }

    /// Current local callback URLs for every platform (empty string when the
    /// platform doesn't use callbacks or isn't connected).
    pub fn callback_urls(&self) -> Vec<(String, Option<String>)> {
        self.inner
            .adapters
            .lock()
            .unwrap()
            .iter()
            .map(|(id, a)| (id.as_str().to_string(), a.callback_url()))
            .collect()
    }

    pub fn registered_platforms(&self) -> Vec<PlatformId> {
        self.inner.adapters.lock().unwrap().keys().copied().collect()
    }

    pub fn is_configured(&self, id: PlatformId) -> bool {
        self.inner
            .adapters
            .lock()
            .unwrap()
            .get(&id)
            .map(|a| a.is_configured())
            .unwrap_or(false)
    }

    pub fn sessions(&self) -> &SessionRouter {
        &self.inner.sessions
    }

    /// Start a platform's inbound loop. Spawns a task that drains the event
    /// channel, touches the session router, and forwards each event to the
    /// agent handler.
    pub async fn connect_platform(&self, id: PlatformId) -> Result<(), String> {
        // Idempotency guard: if already connected or already mid-connect, no-op
        // rather than spawning a second inbound loop.
        {
            let connected = self.inner.connected.lock().unwrap();
            let connecting = self.inner.connecting.lock().unwrap();
            if connected.contains(&id) || connecting.contains(&id) {
                return Ok(());
            }
        }
        self.inner.connecting.lock().unwrap().insert(id.clone());
        let handler = self.inner.handler.lock().unwrap().clone();
        let (tx, mut rx) = mpsc::channel::<MessageEvent>(128);
        {
            let adapter = self
                .inner
                .adapters
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or_else(|| "platform not registered".to_string())?;
            if !adapter.is_configured() {
                return Err("platform not configured".into());
            }
            // Install the out-of-band event sink (re-login QR, etc.) before
            // starting the loop, so background adapters can reach the UI.
            if let Some(sink) = self.sink_for(id) {
                adapter.set_event_sink(sink);
            }
            // Drop the lock before awaiting the adapter's connect future.
            match adapter.connect(tx).await {
                Ok(()) => {}
                Err(e) => {
                    self.inner.connecting.lock().unwrap().remove(&id);
                    return Err(e);
                }
            }
        }
        self.inner.connecting.lock().unwrap().remove(&id);
        self.inner.connected.lock().unwrap().insert(id.clone());
        // Surface the (possibly callback-based) local URL to the settings UI.
        if let Some(cb) = self.inner.on_connected.lock().unwrap().as_ref() {
            let url = self
                .inner
                .adapters
                .lock()
                .unwrap()
                .get(&id)
                .and_then(|a| a.callback_url());
            cb(id.as_str().to_string(), url);
        }
        let this = self.clone();
        tokio::spawn(async move {
            let mut now_ms = || {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0)
            };
            while let Some(ev) = rx.recv().await {
                // Inbound rate limit (per platform): bursts are allowed, floods
                // are dropped so a misbehaving peer can't hammer the agent.
                {
                    let mut rates = this.inner.rates.lock().unwrap();
                    let bucket = rates.entry(ev.platform).or_default();
                    if !bucket.allow() {
                        log::warn!(
                            "gateway: dropping inbound from {} (rate limited)",
                            ev.platform.as_str()
                        );
                        continue;
                    }
                }
                // Duplicate suppression: platforms re-deliver on network blips;
                // a repeated message_id within the window is dropped once.
                if let Some(mid) = &ev.message_id {
                    let mut seen = this.inner.seen.lock().unwrap();
                    if seen.len() >= DEDUP_CAP {
                        let cutoff = now_ms().saturating_sub(DEDUP_WINDOW_MS);
                        seen.retain(|_, t| *t >= cutoff);
                        if seen.len() >= DEDUP_CAP {
                            seen.clear();
                        }
                    }
                    if seen.insert(mid.clone(), now_ms()).is_some() {
                        log::debug!(
                            "gateway: dropping duplicate message_id {mid} from {}",
                            ev.platform.as_str()
                        );
                        continue;
                    }
                }
                let sk = ev.session_key();
                let (p, ct, cid) = (
                    ev.platform.as_str().to_string(),
                    match ev.chat_type {
                        super::message::ChatType::Dm => "dm",
                        super::message::ChatType::Group => "group",
                    }
                    .to_string(),
                    ev.chat_id.clone(),
                );
                this.inner.sessions.touch(&sk, &p, &ct, &cid);
                // Auth gate (default-deny): only approved sessions may drive
                // the agent. Unauthorized messages are queued for approval and
                // dropped from the agent path — but the pending callback gets a
                // sender+text summary so the approval UI isn't blind.
                if this.inner.sessions.is_authorized(&sk) {
                    if let Some(h) = &handler {
                        h(ev);
                    }
                } else {
                    this.inner.sessions.request_approval(&sk);
                    if let Some(cb) = this.inner.on_pending.lock().unwrap().as_ref() {
                        let summary = if ev.text.is_some() && !ev.sender_id.is_empty() {
                            let text = ev.text.clone().unwrap_or_default();
                            let clipped: String =
                                text.chars().take(80).collect();
                            Some(format!("{}: {clipped}", ev.sender_id))
                        } else if !ev.sender_id.is_empty() {
                            Some(ev.sender_id.clone())
                        } else {
                            None
                        };
                        cb(sk.clone(), summary);
                    }
                }
            }
        });
        Ok(())
    }

    pub async fn disconnect_platform(&self, id: PlatformId) {
        if let Some(adapter) = self.inner.adapters.lock().unwrap().get(&id).cloned() {
            adapter.disconnect();
        }
        self.inner.connected.lock().unwrap().remove(&id);
        self.inner.connecting.lock().unwrap().remove(&id);
    }

    pub fn is_connected(&self, id: PlatformId) -> bool {
        self.inner.connected.lock().unwrap().contains(&id)
    }

    pub async fn send_text(
        &self,
        id: PlatformId,
        target: &ChatTarget,
        text: &str,
    ) -> SendResult {
        let adapter = self
            .inner
            .adapters
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or_else(|| "platform not registered".to_string())?;
        adapter.send_text(target, text).await
    }
}

impl Default for GatewayRegistry {
    fn default() -> Self {
        Self::new()
    }
}
