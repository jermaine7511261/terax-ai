use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::platform::PlatformId;

/// Whether an inbound event came from a 1:1 chat or a group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatType {
    Dm,
    Group,
}

/// A media attachment carried on a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MediaItem {
    pub kind: MediaKind,
    pub url: Option<String>,
    pub name: Option<String>,
    pub size: Option<u64>,
    /// For iLink-style platforms, the AES-encrypted CDN query param.
    pub encrypted_query: Option<String>,
    /// Local filesystem path after download (e.g. `/tmp/yamet/media-xxx.bin`).
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Image,
    Voice,
    Video,
    File,
}

/// Normalized inbound message. Every platform adapter produces one of these;
/// the router keys it to a session and hands it to the agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MessageEvent {
    pub platform: PlatformId,
    pub chat_type: ChatType,
    pub chat_id: String,
    pub sender_id: String,
    pub text: Option<String>,
    pub message_id: Option<String>,
    /// Message id this one replies to (for threaded/quote replies).
    pub reply_to: Option<String>,
    pub media: Vec<MediaItem>,
    /// The raw platform payload, kept for debugging / pass-through.
    pub raw: serde_json::Value,
    pub timestamp: DateTime<Utc>,
}

impl MessageEvent {
    /// Build the canonical session key: `agent:main:{platform}:{chat_type}:{chat_id}`.
    /// Mirrors Hermes `session.py` routing semantics.
    pub fn session_key(&self) -> String {
        let ct = match self.chat_type {
            ChatType::Dm => "dm",
            ChatType::Group => "group",
        };
        format!("agent:main:{}:{}:{}", self.platform.as_str(), ct, self.chat_id)
    }

    pub fn is_dm(&self) -> bool {
        matches!(self.chat_type, ChatType::Dm)
    }
}
