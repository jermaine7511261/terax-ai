use futures_util::future::BoxFuture;
use tokio::sync::mpsc;

use super::message::{ChatType, MessageEvent};
use super::platform::PlatformId;

/// Where an outbound message should be delivered.
#[derive(Debug, Clone)]
pub struct ChatTarget {
    pub chat_type: ChatType,
    pub chat_id: String,
    /// Optional reply anchor (platform message id).
    pub reply_to: Option<String>,
}

/// A successful send's receipt.
#[derive(Debug, Clone, Default)]
pub struct SendReceipt {
    pub message_id: Option<String>,
}

pub type SendResult = Result<SendReceipt, String>;

/// Error surfaced by the gateway core / adapters.
#[derive(Debug)]
pub enum GatewayError {
    NotConfigured,
    NotConnected,
    Network(String),
    Protocol(String),
    Auth(String),
    Io(std::io::Error),
}

impl std::fmt::Display for GatewayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GatewayError::NotConfigured => f.write_str("platform not configured"),
            GatewayError::NotConnected => f.write_str("platform not connected"),
            GatewayError::Network(e) => write!(f, "network: {e}"),
            GatewayError::Protocol(e) => write!(f, "protocol: {e}"),
            GatewayError::Auth(e) => write!(f, "auth: {e}"),
            GatewayError::Io(e) => write!(f, "io: {e}"),
        }
    }
}

impl std::error::Error for GatewayError {}

/// A running adapter's inbound delivery channel. The adapter calls
/// `tx.send(event)` for every inbound message; the registry routes it.
pub type EventTx = mpsc::Sender<MessageEvent>;

/// Every domestic IM platform implements this trait. The shape mirrors Hermes'
/// `BasePlatformAdapter` (base.py): connect/poll inbound, send outbound,
/// report whether credentials are configured.
pub trait PlatformAdapter: Send + Sync {
    fn platform(&self) -> PlatformId;

    /// Whether required credentials are present (configured in settings).
    fn is_configured(&self) -> bool;

    /// Start the background poll/stream loop. Must return quickly; the loop
    /// runs on its own task and delivers inbound events into `tx`.
    /// Implementations use interior mutability to track connection state, so
    /// this takes `&self` (avoids holding a lock across an await).
    fn connect(&self, tx: EventTx) -> BoxFuture<'_, Result<(), String>>;

    /// Stop the connection loop (e.g. when the user disables the platform).
    fn disconnect(&self);

    /// Send a plain-text message to a target.
    fn send_text(&self, target: &ChatTarget, text: &str) -> BoxFuture<'_, SendResult>;
}
