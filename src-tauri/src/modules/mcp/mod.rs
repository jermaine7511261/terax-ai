//! MCP (Model Context Protocol) native integration module.
//! Native stdio and SSE JSON-RPC clients with full session lifecycle,
//! tool/resource/prompt surfaces, and workspace authorization.
//! This is a native feature, not plugin-based.

pub mod protocol;
pub mod server;
pub mod session;
pub mod transport;

pub use server::{McpServerConfig, McpServerInfo, McpServerState};
pub use session::{McpPromptInfo, McpResourceInfo, McpSessionStatus, McpToolInfo};
pub use transport::{McpTransport, McpTransportType, SseTransport, StdioTransport};
