//! Gateway registry: owns the platform adapters, dispatches inbound events to
//! the agent handler, and fans out outbound sends. Mirrors Hermes
//! `gateway/platform_registry.py` + the `GatewayRunner` event loop.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

use super::adapter::{ChatTarget, PlatformAdapter, SendResult};
use super::message::MessageEvent;
use super::platform::PlatformId;
use super::session::SessionRouter;

/// Inbound event handler, installed by the Tauri layer to route into the agent.
pub type EventHandler = Arc<dyn Fn(MessageEvent) + Send + Sync>;

#[derive(Clone)]
pub struct GatewayRegistry {
    inner: Arc<Inner>,
}

struct Inner {
    adapters: Mutex<HashMap<PlatformId, Arc<dyn PlatformAdapter>>>,
    sessions: SessionRouter,
    handler: Mutex<Option<EventHandler>>,
}

impl GatewayRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                adapters: Mutex::new(HashMap::new()),
                sessions: SessionRouter::new(),
                handler: Mutex::new(None),
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
            // Drop the lock before awaiting the adapter's connect future.
            adapter.connect(tx).await?;
        }
        let this = self.clone();
        tokio::spawn(async move {
            while let Some(ev) = rx.recv().await {
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
                if let Some(h) = &handler {
                    h(ev);
                }
            }
        });
        Ok(())
    }

    pub async fn disconnect_platform(&self, id: PlatformId) {
        if let Some(adapter) = self.inner.adapters.lock().unwrap().get(&id).cloned() {
            adapter.disconnect();
        }
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
