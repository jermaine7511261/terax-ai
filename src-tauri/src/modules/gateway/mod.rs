//! Gateway core for the domestic IM platform adapters.
//!
//! Design mirrors ' `gateway/platforms/base.py`:
//! - a `PlatformAdapter` trait every platform implements,
//! - a normalized `MessageEvent` model + session key routing,
//! - a platform registry with lazy (feature-gated) loading.

pub mod adapter;
pub mod adapters;
pub mod commands;
pub mod crypto;
pub mod message;
pub mod platform;
pub mod registry;
pub mod session;

pub use adapter::{ChatTarget, PlatformAdapter, SendReceipt};
pub use message::{ChatType, MediaItem, MessageEvent};
pub use platform::PlatformId;
pub use registry::GatewayRegistry;
