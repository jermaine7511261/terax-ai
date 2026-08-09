//! AI subsystem native core (迭代 25, P0 基建).
//!
//! LLM 调用、token 估算、harness 会话状态机在 Rust 实现。模型调用走
//! `net::safe_client_for_url`（与 `ai_http_stream` 同一 SSRF 守卫），密钥在
//! keyring 内解析、绝不透传前端。

pub mod agents;
pub mod client;
pub mod context;
pub mod graph;
pub mod guardrails;
pub mod harness;
pub mod media;
pub mod memory;
pub mod preferences;
pub mod prompt;
pub mod research;
pub mod resilience;
pub mod skills;
